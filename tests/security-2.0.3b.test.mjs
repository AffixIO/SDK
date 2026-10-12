// 2.0.3 (second round) regressions: H1 budget index, H2 stale lock recovery, H3 no CWD writes.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { MemoryStore, FileStore, BudgetLedger } from "../dist/runtime/index.js";
import { withFileLock, lockStaleReason } from "../dist/file-lock.js";

const tmp = () => mkdtempSync(join(tmpdir(), "affix-203b-"));
const DAY0 = Date.parse("2026-10-10T09:00:00Z");

function countingStore(inner) {
  const stats = { reads: 0 };
  return { stats, transaction: fn => inner.transaction(r => fn(new Proxy(r, { get(t, k) { if (typeof k === "string") stats.reads++; return t[k]; } }))) };
}

test("H1: a reservation touches O(1) records after 2,000 earlier reservations", () => {
  let now = DAY0;
  const store = countingStore(new MemoryStore());
  const l = new BudgetLedger({ store, clock: () => now });
  for (let i = 0; i < 2000; i++) { const id = "r" + i; l.reserve({ account: "a", id, binding: "b" + i, amount: 0.01, currency: "GBP", limit: 1000 }); l.start("a", id); l.commit("a", id); }
  store.stats.reads = 0;
  l.reserve({ account: "a", id: "x", binding: "bx", amount: 1, currency: "GBP", limit: 1000 });
  assert.ok(store.stats.reads <= 4, `reads=${store.stats.reads}`);
  assert.equal(l.summary("a", "GBP").committedMinor, 2000);
});

test("H1: limits, idempotent ids, expiry, release, commit and next-day reset stay correct", () => {
  let now = DAY0;
  const l = new BudgetLedger({ store: new MemoryStore(), clock: () => now });
  const r = (id, amount, extra = {}) => l.reserve({ account: "a", id, binding: "b-" + id, amount, currency: "GBP", limit: 10, ttlMs: 60000, ...extra });
  r("1", 4); r("2", 4);
  assert.throws(() => r("3", 4), /Daily budget exceeded/);
  assert.equal(r("1", 4).id, "1", "same id + same intent returns the existing hold");
  assert.throws(() => l.reserve({ account: "a", id: "1", binding: "other", amount: 4, currency: "GBP", limit: 10 }), /different intent/);
  l.release("a", "2"); r("3", 4);
  now += 61000; // holds 1 and 3 expire
  r("4", 9);
  l.start("a", "4"); l.commit("a", "4");
  assert.throws(() => r("5", 2), /Daily budget exceeded/);
  assert.equal(l.summary("a", "GBP").usedMinor, 900);
  assert.equal(l.summary("a", "USD").usedMinor, 0);
  r("6", 1, { account: "b" }); // other account unaffected
  now += 86400000; r("7", 9);
  assert.equal(l.summary("a", "GBP").committedMinor, 0);
});

test("H1: stores written before the index existed are scanned once to build it", () => {
  const store = new MemoryStore();
  store.transaction(rec => {
    rec["budget:legacy1"] = { account: "a", id: "l1", currency: "GBP", amountMinor: 600, limitMinor: 1000, status: "committed", day: "2026-10-10", createdAt: DAY0, expiresAt: DAY0 + 1 };
    rec["budget:legacy2"] = { account: "a", id: "l2", currency: "GBP", amountMinor: 300, limitMinor: 1000, status: "executing", day: "2026-10-09", createdAt: DAY0, expiresAt: DAY0 + 1 };
  });
  const l = new BudgetLedger({ store, clock: () => DAY0 });
  assert.equal(l.summary("a", "GBP").usedMinor, 900);
  assert.throws(() => l.reserve({ account: "a", id: "n", binding: "b", amount: 2, currency: "GBP", limit: 10 }), /Daily budget exceeded/);
  l.reserve({ account: "a", id: "n2", binding: "b", amount: 1, currency: "GBP", limit: 10 });
});

const lockHolder = (lockPath, readyFile) => `import { withFileLock } from ${JSON.stringify(new URL("../dist/file-lock.js", import.meta.url).href)}; import { writeFileSync } from "node:fs";
  withFileLock(${JSON.stringify(lockPath)}, () => { writeFileSync(${JSON.stringify(readyFile)}, "1"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); });`;
async function holdLock(lockPath) {
  const ready = lockPath + ".ready";
  rmSync(ready, { force: true });
  const child = spawn(process.execPath, ["--input-type=module", "-e", lockHolder(lockPath, ready)], { stdio: "ignore" });
  for (let i = 0; i < 200 && !existsSync(ready); i++) await new Promise(r => setTimeout(r, 25));
  assert.ok(existsSync(ready), "child took the lock");
  return child;
}

test("H2: a lock left by a SIGKILLed process is recovered; data intact", async () => {
  const dir = tmp(); const path = join(dir, "s.json");
  new FileStore(path).transaction(r => { r.k = { v: 1 }; });
  for (let i = 0; i < 3; i++) {
    const child = await holdLock(path + ".lock");
    child.kill("SIGKILL"); await new Promise(r => child.on("exit", r));
    assert.ok(existsSync(path + ".lock"), "stale lock left behind");
    const info = JSON.parse(readFileSync(path + ".lock", "utf8"));
    assert.equal(info.host, hostname()); assert.equal(info.pid, child.pid); assert.ok(info.procStart && info.acquiredAt);
    assert.equal(new FileStore(path, { lockTimeoutMs: 2000 }).transaction(r => { r.k.v++; return r.k.v; }), i + 2);
  }
  rmSync(dir, { recursive: true, force: true });
});

test("H2: a live lock held by another process is never broken", async () => {
  const dir = tmp(); const path = join(dir, "s.json");
  const child = await holdLock(path + ".lock");
  try {
    const before = readFileSync(path + ".lock", "utf8");
    assert.throws(() => new FileStore(path, { lockTimeoutMs: 400 }).transaction(r => { r.x = 1; }), /lock_timeout/);
    assert.equal(readFileSync(path + ".lock", "utf8"), before);
  } finally { child.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); }
});

test("H2: stale-lock rules: legacy dead pid, foreign host lease, torn lock", () => {
  const now = Date.now();
  assert.equal(lockStaleReason(JSON.stringify({ pid: process.pid, host: hostname(), procStart: "x-not-me", acquiredAt: 0 }), now, now), "holder_pid_reused");
  assert.equal(lockStaleReason(JSON.stringify({ pid: 2 ** 22 + 12345, host: hostname(), acquiredAt: now }), now, now), "holder_dead");
  assert.equal(lockStaleReason(JSON.stringify({ pid: 1, host: "other-host", acquiredAt: now - 1000, leaseMs: 30000 }), now, now), null);
  assert.equal(lockStaleReason(JSON.stringify({ pid: 1, host: "other-host", acquiredAt: now - 31000, leaseMs: 30000 }), now, now), "lease_expired");
  assert.equal(lockStaleReason("", now - 1000, now), null);
  assert.equal(lockStaleReason("", now - 31000, now), "unreadable_lock_lease_expired");
  assert.equal(lockStaleReason(`${2 ** 22 + 12345}\n`, now - 5000, now), "legacy_lock_dead_pid");
  const dir = tmp(); const lp = join(dir, "x.lock");
  writeFileSync(lp, `${2 ** 22 + 12345}\n`, { mode: 0o600 });
  const old = new Date(Date.now() - 5000); require_utimes(lp, old);
  assert.equal(withFileLock(lp, () => 42, { timeoutMs: 1000 }), 42);
  assert.equal(existsSync(lp), false);
  rmSync(dir, { recursive: true, force: true });
});
import { utimesSync } from "node:fs";
function require_utimes(p, d) { utimesSync(p, d, d); }

test("H3: no operatorBaseDir means nothing is written to the working directory", () => {
  const dir = tmp();
  const code = `import { AffixSDK, createLocalSigningKeyPair } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
    const s = new AffixSDK({ apiKey: "local_operator", apiBase: "http://127.0.0.1:9", hmacSecret: "h3-secret-0123456789abcd", signingKeys: createLocalSigningKeyPair(), silenceHmacWarning: true });
    for (let i = 0; i < 3; i++) await s.prove({ circuitId: "simple_yesno", proofMode: "hmac", mode: "offline", decision: "yes", fields: { a: "0x" + (i + 1) } });
    const listed = (await s.listStoredProofs()).length; const stats = await s.statsSnapshot?.() ?? null;
    let spend = "none"; try { await s.spendStatus(); } catch (e) { spend = e.message.split(":")[0]; }
    s.dispose(); console.log(JSON.stringify({ listed, spend }));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split("\n").at(-1));
  assert.equal(out.listed, 3, "proofs listed from memory");
  assert.equal(out.spend, "spend_journal_requires_operatorBaseDir");
  assert.deepEqual(readdirSync(dir), [], "working directory untouched");
  rmSync(dir, { recursive: true, force: true });
});

test("H3: with operatorBaseDir, data files are 0600 in a 0700 directory", async () => {
  const dir = tmp(); const base = join(dir, "affix");
  const { AffixSDK, createLocalSigningKeyPair } = await import("../dist/index.js");
  const s = new AffixSDK({ apiKey: "local_operator", apiBase: "http://127.0.0.1:9", operatorBaseDir: base, hmacSecret: "h3-secret-0123456789abcd", signingKeys: createLocalSigningKeyPair(), silenceHmacWarning: true });
  await s.prove({ circuitId: "simple_yesno", proofMode: "hmac", mode: "offline", decision: "yes", fields: { a: "0x1" } });
  s.dispose();
  assert.equal(statSync(base).mode & 0o777, 0o700);
  const files = readdirSync(base).filter(f => statSync(join(base, f)).isFile() && !f.endsWith(".lock"));
  assert.ok(files.length >= 2, files.join(","));
  for (const f of files) assert.equal(statSync(join(base, f)).mode & 0o777, 0o600, f);
  rmSync(dir, { recursive: true, force: true });
});

test("H2: store reopens after repeated SIGKILLs of a writer mid-transaction (no empty/torn lock)", async () => {
  const dir = tmp(); const path = join(dir, "s.json");
  const code = `import { FileStore } from ${JSON.stringify(new URL("../dist/runtime/index.js", import.meta.url).href)};
    const s = new FileStore(${JSON.stringify(path)}); for (let i = 0; ; i++) s.transaction(r => { r["k" + process.pid + "_" + i] = { i, pad: "x".repeat(500) }; });`;
  for (let round = 0; round < 8; round++) {
    const c = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: "ignore" });
    await new Promise(r => setTimeout(r, 250 + round * 97));
    c.kill("SIGKILL"); await new Promise(r => c.once("exit", r));
    if (existsSync(path + ".lock")) assert.ok(readFileSync(path + ".lock", "utf8").includes('"pid"'), "lock is never empty");
  }
  const n = new FileStore(path, { lockTimeoutMs: 3000 }).transaction(r => Object.keys(r).length);
  assert.ok(n > 0, `records=${n}`);
  rmSync(dir, { recursive: true, force: true });
});
