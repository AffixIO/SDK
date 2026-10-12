import { randomUUID } from "node:crypto";
import { clone, required, positive } from "./canonical.js";
import { digest, reserveBudget, transitionBudget, indexTransition } from "./budget.js";

function event(record, type, at, details = {}) {
  const entry = { sequence: record.events.length + 1, type, at, details, previous: record.events.at(-1)?.hash ?? null };
  record.events.push({ ...entry, hash: digest(entry) });
  record.updatedAt = at;
}

export class WorkflowSession {
  constructor({ store, scope, sessionId, clock = Date.now, authorizeReview, authorizeReconciliation }) {
    required(scope, "scope"); required(sessionId, "session id");
    this.store = store; this.scope = scope; this.sessionId = sessionId; this.clock = clock;
    this.authorizeReview = authorizeReview; this.authorizeReconciliation = authorizeReconciliation;
  }
  key(id) { required(id, "action id"); return `action:${digest([this.scope, this.sessionId, id])}`; }
  get(id) { return this.store.transaction(records => records[this.key(id)] ?? null); }
  list({ page = 1, pageSize = 20 } = {}) {
    positive(page, "page"); positive(pageSize, "page size");
    if (pageSize > 100) throw new Error("Page size exceeds 100");
    return this.store.transaction(records => {
      const all = Object.keys(records).filter(key => key.startsWith("action:")).map(key => [key, records[key]]).filter(([, record]) => record.scope === this.scope && record.sessionId === this.sessionId)
        .map(([, record]) => record).sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
      return { page, pageSize, total: all.length, items: all.slice((page - 1) * pageSize, page * pageSize) };
    });
  }
  propose({ id, intent, policy, result, budget, parentId = null, ttlMs = 300000 }) {
    required(id, "action id"); positive(ttlMs, "action lifetime");
    if (!["allow", "deny", "review"].includes(result.decision) || result.policyDigest !== digest(policy)) throw new Error("Decision does not match policy");
    if (result.inputDigest !== digest(intent)) throw new Error("Decision does not match the exact action intent");
    if (!Number.isSafeInteger(result.validUntil) || !Number.isSafeInteger(result.evaluatedAt) || result.evaluatedAt > this.clock()) throw new Error("Invalid decision timestamps");
    if (budget) {
      required(budget.account, "budget account");
      if (budget.amount !== intent.amount || budget.currency !== intent.currency) throw new Error("Budget must match intent");
    }
    const payload = clone({ intent, policy, result, budget: budget ?? null, parentId });
    const binding = digest(payload);
    return this.store.transaction(records => {
      const key = this.key(id);
      if (records[key]) {
        if (records[key].binding !== binding) throw new Error("Action id reused with different input");
        return records[key];
      }
      if (parentId) {
        const parent = records[this.key(parentId)];
        if (!parent || parent.state !== "completed") throw new Error("Parent action has not completed");
      }
      const now = this.clock();
      const record = { id, scope: this.scope, sessionId: this.sessionId, ...payload, binding,
        state: result.decision === "allow" ? "ready" : result.decision === "deny" ? "denied" : "review",
        createdAt: now, updatedAt: now, expiresAt: Math.min(now + ttlMs, result.validUntil), events: [] };
      event(record, "proposed", now, { decision: result.decision });
      records[key] = record;
      return record;
    });
  }
  async review(id, { actor, decision, note = "" }) {
    required(actor, "reviewer");
    if (!["approve", "deny"].includes(decision)) throw new Error("Invalid review decision");
    const snapshot = this.get(id);
    if (!snapshot || snapshot.state !== "review") throw new Error("Action is not awaiting review");
    if (!this.authorizeReview || await this.authorizeReview({ actor, decision, action: snapshot }) !== true) throw new Error("Review not authorized");
    return this.store.transaction(records => {
      const record = records[this.key(id)];
      if (record.binding !== snapshot.binding || record.state !== "review" || record.expiresAt <= this.clock()) throw new Error("Review is stale; re-evaluate with a new action id");
      record.state = decision === "approve" ? "ready" : "denied";
      event(record, "reviewed", this.clock(), { actor, decision, note });
      return record;
    });
  }
  async execute(id, operation) {
    if (typeof operation !== "function") throw new TypeError("Operation required");
    const token = randomUUID();
    const active = this.store.transaction(records => {
      const record = records[this.key(id)];
      if (!record || record.state !== "ready") throw new Error(`Action cannot execute: ${record?.state ?? "missing"}`);
      const now = this.clock();
      if (record.expiresAt <= now) throw new Error("Action expired; evaluate again");
      if (record.budget) {
        const account = `scope:${digest([this.scope, record.budget.account])}`;
        const reservationId = digest([this.sessionId, id]);
        reserveBudget(records, { ...record.budget, account, id: reservationId, binding: record.binding, ttlMs: record.expiresAt - now }, now);
        transitionBudget(records, { account, id: reservationId }, "executing", now);
        record.reservation = { account, id: reservationId };
      }
      record.state = "executing"; record.executionToken = token;
      event(record, "execution_started", now);
      return record;
    });
    try {
      const value = await operation(clone(active.intent), { idempotencyKey: digest([this.scope, this.sessionId, id]), signalDeadline: active.expiresAt });
      const resultDigest = digest(value ?? null);
      const record = this.store.transaction(records => {
        const current = records[this.key(id)];
        if (current.state !== "executing" || current.executionToken !== token) throw new Error("Execution state changed; reconcile externally");
        if (current.reservation) transitionBudget(records, current.reservation, "committed", this.clock());
        current.state = "completed"; current.resultDigest = resultDigest;
        event(current, "execution_confirmed", this.clock(), { resultDigest });
        return current;
      });
      return { record, value };
    } catch (error) {
      this.store.transaction(records => {
        const current = records[this.key(id)];
        if (current.state === "executing" && current.executionToken === token) {
          current.state = "unknown";
          event(current, "execution_uncertain", this.clock());
        }
      });
      throw error;
    }
  }
  async reconcile(id, { actor, outcome, evidence }) {
    required(actor, "reconciler"); required(evidence, "evidence reference");
    if (!["completed", "not-executed"].includes(outcome)) throw new Error("Invalid reconciliation outcome");
    const snapshot = this.get(id);
    if (!snapshot || !["unknown", "executing"].includes(snapshot.state)) throw new Error("No uncertain execution");
    if (!this.authorizeReconciliation || await this.authorizeReconciliation({ actor, outcome, evidence, action: snapshot }) !== true) throw new Error("Reconciliation not authorized");
    return this.store.transaction(records => {
      const record = records[this.key(id)];
      if (record.events.at(-1).hash !== snapshot.events.at(-1).hash) throw new Error("Execution changed during reconciliation");
      if (record.reservation) {
        if (outcome === "completed") transitionBudget(records, record.reservation, "committed", this.clock());
        else {
          const reservationKey = `budget:${digest([record.reservation.account, record.reservation.id])}`;
          const reservation = records[reservationKey];
          if (reservation.status !== "executing") throw new Error("Reservation changed");
          reservation.status = "released"; reservation.evidence = evidence;
          indexTransition(records, reservationKey, reservation, this.clock());
        }
      }
      record.state = outcome === "completed" ? "completed" : "cancelled";
      event(record, "reconciled", this.clock(), { actor, outcome, evidence });
      return record;
    });
  }
  cancel(id) {
    return this.store.transaction(records => {
      const record = records[this.key(id)];
      if (!record || !["ready", "review"].includes(record.state)) throw new Error("Action cannot be cancelled");
      record.state = "cancelled";
      event(record, "cancelled", this.clock());
      return record;
    });
  }
  handover(id, { taskId, from, to }) {
    required(taskId, "task id"); required(from, "sending agent"); required(to, "receiving agent");
    return this.store.transaction(records => {
      const record = records[this.key(id)];
      if (!record || record.state !== "completed") throw new Error("Only completed evidence can be handed over");
      const receipt = { schema: "affix.handover.v1", taskId, from, to, actionId: id, binding: record.binding,
        scope: this.scope, sessionId: this.sessionId, resultDigest: record.resultDigest ?? null, lineageHead: record.events.at(-1).hash, createdAt: this.clock() };
      event(record, "handed_over", this.clock(), { receiptDigest: digest(receipt), to, taskId });
      return { receipt, digest: digest(receipt) };
    });
  }
}

export function verifyLineage(events) {
  let previous = null;
  return Array.isArray(events) && events.every((entry, index) => {
    const { hash, ...payload } = entry;
    const valid = entry.sequence === index + 1 && entry.previous === previous && digest(payload) === hash;
    previous = hash;
    return valid;
  });
}
