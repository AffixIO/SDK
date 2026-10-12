import { createHash } from "node:crypto";
import { canonical, required, positive } from "./canonical.js";

export const digest = value => createHash("sha256").update(canonical(value)).digest("hex");

export function minorUnits(amount, currency) {
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) throw new TypeError("Invalid currency");
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) throw new TypeError("Invalid amount");
  const scaled = amount * 10 ** digits;
  const result = Math.round(scaled);
  if (!Number.isSafeInteger(result) || Math.abs(result - scaled) > 1e-7) throw new TypeError("Amount must use currency precision");
  return result;
}

function normalize(input) {
  required(input.account, "account");
  required(input.id, "reservation id");
  required(input.binding, "intent binding");
  const amountMinor = minorUnits(input.amount, input.currency);
  const limitMinor = minorUnits(input.limit, input.currency);
  return { account: input.account, id: input.id, binding: input.binding, currency: input.currency, amountMinor, limitMinor };
}

const reservationKey = input => `budget:${digest([input.account, input.id])}`;
const indexKey = (account, currency) => `budgetidx:${digest([account, currency])}`;
const dayOf = now => new Date(now).toISOString().slice(0, 10);
const KEEP_DAYS = 7;

// 2.0.3 (H1): one aggregate record per account+currency holds the open (held/executing)
// reservations and committed totals per day, so a reservation touches O(1) records instead of
// re-reading every earlier one. Stores written before the index existed are scanned once, on
// first use, to build it. The index and the reservation change in the same store transaction.
function loadIndex(records, account, currency) {
  const key = indexKey(account, currency);
  let idx = records[key];
  if (!idx) {
    idx = { schema: "affix.budget.index.v1", account, currency, open: {}, committed: {} };
    for (const k of Object.keys(records)) {
      if (!k.startsWith("budget:")) continue;
      const r = records[k];
      if (r.account !== account || r.currency !== currency) continue;
      if (r.status === "held" || r.status === "executing") idx.open[k] = { amountMinor: r.amountMinor, status: r.status, day: r.day, expiresAt: r.expiresAt };
      else if (r.status === "committed") idx.committed[r.day] = (idx.committed[r.day] ?? 0) + r.amountMinor;
    }
    records[key] = idx;
    idx = records[key];
  }
  return idx;
}

function usage(idx, now) {
  const day = dayOf(now);
  let reservedMinor = 0;
  for (const [k, o] of Object.entries(idx.open)) {
    if (o.status === "held" && o.expiresAt <= now) { delete idx.open[k]; continue; }
    if (o.status === "executing" || o.day === day) reservedMinor += o.amountMinor;
  }
  const committedMinor = idx.committed[day] ?? 0;
  return { day, reservedMinor, committedMinor };
}

function pruneDays(idx, now) {
  const cutoff = dayOf(now - KEEP_DAYS * 86400000);
  for (const d of Object.keys(idx.committed)) if (d < cutoff) delete idx.committed[d];
}

export function reserveBudget(records, input, now) {
  const normalized = normalize(input);
  const key = reservationKey(normalized);
  const existing = records[key];
  if (existing) {
    if (input.reuseExisting === false) throw new Error("Reservation already exists");
    if (existing.inputDigest !== digest(normalized)) throw new Error("Reservation id reused with different intent");
    if (existing.status === "held" && existing.expiresAt <= now) existing.status = "expired";
    if (!["held", "executing"].includes(existing.status)) throw new Error(`Reservation is ${existing.status}`);
    return existing;
  }
  const idx = loadIndex(records, normalized.account, normalized.currency);
  const { day, reservedMinor, committedMinor } = usage(idx, now);
  if (normalized.amountMinor > normalized.limitMinor - reservedMinor - committedMinor) throw new Error("Daily budget exceeded");
  const ttlMs = positive(input.ttlMs ?? 300000, "reservation lifetime");
  records[key] = { ...normalized, inputDigest: digest(normalized), day, status: "held", createdAt: now, expiresAt: now + ttlMs };
  idx.open[key] = { amountMinor: normalized.amountMinor, status: "held", day, expiresAt: now + ttlMs };
  pruneDays(idx, now);
  return records[key];
}

export function indexTransition(records, key, record, now) {
  const idx = loadIndex(records, record.account, record.currency);
  if (record.status === "held" || record.status === "executing") {
    idx.open[key] = { amountMinor: record.amountMinor, status: record.status, day: record.day, expiresAt: record.expiresAt };
    return;
  }
  delete idx.open[key];
  if (record.status === "committed") idx.committed[record.day] = (idx.committed[record.day] ?? 0) + record.amountMinor;
  pruneDays(idx, now);
}

export function transitionBudget(records, input, status, now) {
  const key = reservationKey(input);
  const record = records[key];
  if (!record) throw new Error("Reservation not found");
  if (record.status === status) return record;
  if (status === "executing") {
    if (record.status !== "held" || record.expiresAt <= now || record.day !== dayOf(now)) {
      throw new Error("Reservation cannot start; refresh the decision");
    }
  } else if (status === "committed") {
    if (record.status !== "executing") throw new Error("Only an executing reservation can be committed");
    record.day = dayOf(now);
  } else if (status === "released") {
    if (record.status !== "held") throw new Error("Executing reservations require reconciliation");
  } else throw new Error("Invalid reservation transition");
  record.status = status;
  record.updatedAt = now;
  indexTransition(records, key, record, now);
  return record;
}

export class BudgetLedger {
  constructor({ store, clock = Date.now }) { this.store = store; this.clock = clock; }
  get(account, id) { return this.store.transaction(records => records[reservationKey({ account, id })] ?? null); }
  reserve(input) { return this.store.transaction(records => reserveBudget(records, input, this.clock())); }
  start(account, id) { return this.store.transaction(records => transitionBudget(records, { account, id }, "executing", this.clock())); }
  commit(account, id) { return this.store.transaction(records => transitionBudget(records, { account, id }, "committed", this.clock())); }
  release(account, id) { return this.store.transaction(records => transitionBudget(records, { account, id }, "released", this.clock())); }
  reconcile(account, id, { outcome, evidence }) {
    required(evidence, "reconciliation evidence reference");
    if (!["committed", "not-executed"].includes(outcome)) throw new Error("Invalid reconciliation outcome");
    return this.store.transaction(records => {
      const key = reservationKey({ account, id });
      const record = records[key];
      if (!record || record.status !== "executing") throw new Error("Reservation is not awaiting reconciliation");
      record.status = outcome === "committed" ? "committed" : "released";
      record.day = dayOf(this.clock());
      record.evidence = evidence;
      indexTransition(records, key, record, this.clock());
      return record;
    });
  }
  summary(account, currency) {
    required(account, "account");
    minorUnits(0, currency);
    const now = this.clock();
    const day = new Date(now).toISOString().slice(0, 10);
    return this.store.transaction(records => {
      const { reservedMinor, committedMinor } = usage(loadIndex(records, account, currency), now);
      return { account, currency, day, committedMinor, reservedMinor, usedMinor: committedMinor + reservedMinor };
    });
  }
}
