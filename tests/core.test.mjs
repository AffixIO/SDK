import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { MemoryStore, FileStore, BudgetLedger, minorUnits, DecisionPipeline, evaluatePolicy, replayPolicy,
  WorkflowSession, verifyLineage, digest, watchSources, dataCheckSource } from "../dist/runtime/index.js";

const now = Date.UTC(2026, 9, 5, 12);
const policy = { id: "purchase", version: "1", mode: "all", rules: [{ source: "stock", operator: "truthy", maxAgeMs: 60000 }] };
const actionIntent = { amount: 10, currency: "GBP", action: "buy" };
const allow = () => evaluatePolicy(policy, [{ source: "stock", status: "ok", value: true, observedAt: now }], { now, input: actionIntent });
const proposal = (id = "one") => ({ id, intent: actionIntent, policy, result: allow(), budget: { account: "team", amount: 10, currency: "GBP", limit: 15 } });
const reservation = (id = "one", amount = 10) => ({ account: "team", id, binding: "intent", amount, currency: "GBP", limit: 15 });
const session = (options = {}) => new WorkflowSession({ store: new MemoryStore(), scope: "tenant-a", sessionId: "s", clock: () => now, ...options });

test("currency precision supports GBP, JPY and KWD without rounding away spend", () => {
  assert.equal(minorUnits(1.23, "GBP"), 123);
  assert.equal(minorUnits(12, "JPY"), 12);
  assert.equal(minorUnits(1.234, "KWD"), 1234);
  for (const amount of [-1, NaN, Infinity, 1.234, Number.MAX_SAFE_INTEGER]) assert.throws(() => minorUnits(amount, "GBP"));
});

test("store rollback and reference isolation", () => {
  const store = new MemoryStore();
  assert.throws(() => store.transaction(records => { records.a = 1; throw new Error("rollback"); }));
  assert.equal(store.transaction(records => records.a ?? null), null);
  assert.throws(() => store.transaction(async () => 1), /synchronous/);
  const result = store.transaction(records => records.a = { value: 1 });
  result.value = 2;
  assert.equal(store.transaction(records => records.a.value), 1);
});

test("budget reserves once, enforces aggregate limits and prevents key reuse", () => {
  const ledger = new BudgetLedger({ store: new MemoryStore(), clock: () => now });
  assert.equal(ledger.reserve(reservation()).status, "held");
  ledger.reserve(reservation());
  assert.equal(ledger.summary("team", "GBP").usedMinor, 1000);
  assert.throws(() => ledger.reserve(reservation("two")), /exceeded/);
  assert.throws(() => ledger.reserve(reservation("one", 1)), /different/);
  ledger.start("team", "one");
  assert.throws(() => ledger.release("team", "one"), /reconciliation/);
  ledger.commit("team", "one");
  assert.equal(ledger.summary("team", "GBP").committedMinor, 1000);
  assert.throws(() => ledger.reserve(reservation()), /committed/);
});

test("held expiry and cross-midnight unknown exposure", () => {
  let time = now;
  const ledger = new BudgetLedger({ store: new MemoryStore(), clock: () => time });
  ledger.reserve({ ...reservation(), ttlMs: 1000 });
  time += 1001;
  assert.equal(ledger.summary("team", "GBP").usedMinor, 0);
  assert.throws(() => ledger.start("team", "one"));
  ledger.reserve(reservation("two"));
  ledger.start("team", "two");
  time += 86400000;
  assert.equal(ledger.summary("team", "GBP").reservedMinor, 1000);
  assert.throws(() => ledger.reserve(reservation("three")), /exceeded/);
  ledger.reconcile("team", "two", { outcome: "not-executed", evidence: "processor-status-123" });
  assert.equal(ledger.summary("team", "GBP").usedMinor, 0);
});

test("persistent store survives reopening and protects file mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "affix-store-"));
  try {
    const path = join(dir, "state.json");
    new BudgetLedger({ store: new FileStore(path), clock: () => now }).reserve(reservation());
    assert.equal(new BudgetLedger({ store: new FileStore(path), clock: () => now }).summary("team", "GBP").usedMinor, 1000);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("concurrent processes cannot overspend one file budget", async () => {
  const dir = mkdtempSync(join(tmpdir(), "affix-race-"));
  const moduleUrl = new URL("../dist/runtime/index.js", import.meta.url).href;
  try {
    const workers = Array.from({ length: 8 }, (_, i) => new Promise((resolve, reject) => {
      const code = `import {FileStore,BudgetLedger} from ${JSON.stringify(moduleUrl)}; const l=new BudgetLedger({store:new FileStore(${JSON.stringify(join(dir, "state.json"))})}); try {l.reserve({account:'a',id:'${i}',binding:'b',amount:1,currency:'GBP',limit:3});process.exit(0)} catch(e) { if(e.message==='Daily budget exceeded') process.exit(2); console.error(e);process.exit(3) }`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", code]);
      let errors = "";
      child.stderr.on("data", chunk => errors += chunk);
      child.on("error", reject);
      child.on("exit", status => status === 0 || status === 2 ? resolve(status) : reject(new Error(errors)));
    }));
    const results = await Promise.all(workers);
    assert.equal(results.filter(status => status === 0).length, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("source pipeline composes values but persists only check fingerprints", async () => {
  const pipeline = new DecisionPipeline({ clock: () => now, sources: { stock: async () => ({ value: true }) } });
  const result = await pipeline.evaluate(policy, { customer: "private-reference" });
  assert.equal(result.decision, "allow");
  assert.equal(JSON.stringify(result).includes("private-reference"), false);
  assert.equal("value" in result.checks[0], false);
  let calls = 0;
  const proof = await pipeline.prove({ prove: async input => { calls++; assert.equal(input.meta.policy_digest, digest(policy)); return { proof: "fixture" }; } }, policy, {}, { requestId: "p1" });
  assert.equal(calls, 1);
  assert.equal(proof.result.decision, "allow");
});

test("missing, stale, future, error and timed-out sources require review", async () => {
  for (const observation of [[], [{ source: "stock", status: "ok", value: true, observedAt: now - 60001 }],
    [{ source: "stock", status: "ok", value: true, observedAt: now + 1 }], [{ source: "stock", status: "error", observedAt: now }]]) {
    assert.equal(evaluatePolicy(policy, observation, { now }).decision, "review");
  }
  const pipeline = new DecisionPipeline({ clock: () => now, timeoutMs: 10, sources: { stock: () => new Promise(() => {}) } });
  const result = await pipeline.prove({ prove: async () => assert.fail("Review must not become a yes/no proof") }, policy, {}, { requestId: "review" });
  assert.equal(result.proof, null);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(pipeline.evaluate(policy, {}, { signal: controller.signal }));
});

test("deterministic replay, duplicate sources, all/any and validation", () => {
  const observations = [{ source: "stock", status: "ok", value: false, observedAt: now }];
  const cases = [{ id: "c1", at: now, observations }];
  assert.deepEqual(replayPolicy(policy, cases), replayPolicy(policy, cases));
  assert.equal(replayPolicy(policy, cases)[0].result.decision, "deny");
  assert.throws(() => evaluatePolicy(policy, [...observations, ...observations], { now }), /Duplicate/);
  assert.throws(() => evaluatePolicy({ ...policy, rules: [] }, [], { now }));
  const any = { ...policy, mode: "any", rules: [...policy.rules, { source: "override", operator: "eq", value: "yes", maxAgeMs: 1000 }] };
  assert.equal(evaluatePolicy(any, [...observations, { source: "override", status: "ok", value: "yes", observedAt: now }], { now }).decision, "allow");
});

test("source watcher detects changes and stops with abort", async () => {
  let value = true;
  const pipeline = new DecisionPipeline({ clock: () => now, sources: { stock: async () => ({ value }) } });
  const controller = new AbortController();
  const stream = watchSources(pipeline, policy, {}, { signal: controller.signal, intervalMs: 1 });
  assert.equal((await stream.next()).value.changed, false);
  value = false;
  assert.equal((await stream.next()).value.changed, true);
  controller.abort();
  assert.equal((await stream.next()).done, true);
});

test("workflow success is durable, single-execution and scope isolated", async () => {
  const store = new MemoryStore();
  const first = session({ store });
  first.propose(proposal());
  const result = await first.execute("one", async (_, { idempotencyKey }) => ({ reference: idempotencyKey }));
  assert.equal(result.record.state, "completed");
  assert.equal(verifyLineage(result.record.events), true);
  const restored = session({ store });
  assert.equal(restored.get("one").state, "completed");
  await assert.rejects(restored.execute("one", async () => assert.fail()), /completed/);
  assert.equal(session({ store, scope: "other" }).get("one"), null);
  first.propose(proposal("two"));
  await assert.rejects(first.execute("two", async () => assert.fail()), /exceeded/);
  const handover = first.handover("one", { taskId: "task-1", from: "agent-a", to: "agent-b" });
  assert.equal(handover.digest, digest(handover.receipt));
  assert.equal(first.list({ page: 1, pageSize: 1 }).total, 2);
});

test("review authorization is explicit, bound and expiring", async () => {
  const input = proposal(); input.result.decision = "review";
  const first = session({ authorizeReview: async ({ actor }) => actor === "reviewer" });
  first.propose(input);
  await assert.rejects(first.execute("one", async () => null), /review/);
  await assert.rejects(first.review("one", { actor: "agent", decision: "approve" }), /authorized/);
  await first.review("one", { actor: "reviewer", decision: "approve" });
  await first.execute("one", async () => "done");
  await assert.rejects(first.review("one", { actor: "reviewer", decision: "approve" }));
  const stale = session({ clock: () => now + 60001, authorizeReview: () => true });
  stale.propose(input);
  await assert.rejects(stale.review("one", { actor: "reviewer", decision: "approve" }), /stale/);
});

test("uncertain action holds budget until authorized reconciliation", async () => {
  const first = session({ authorizeReconciliation: ({ actor }) => actor === "ops" });
  first.propose(proposal());
  await assert.rejects(first.execute("one", async () => { throw new Error("Connection lost after sending"); }));
  assert.equal(first.get("one").state, "unknown");
  await assert.rejects(first.execute("one", async () => null), /unknown/);
  await assert.rejects(first.reconcile("one", { actor: "agent", outcome: "not-executed", evidence: "check" }));
  await first.reconcile("one", { actor: "ops", outcome: "not-executed", evidence: "provider-status" });
  first.propose(proposal("two"));
  await first.execute("two", async () => ({ ok: true }));
});

test("lineage and immutable intent binding detect tampering", () => {
  const first = session();
  const record = first.propose(proposal());
  assert.throws(() => first.propose({ ...proposal(), intent: { amount: 999, currency: "GBP" } }), /match/);
  assert.throws(() => first.propose({ ...proposal(), policy: { ...policy, version: "2" } }), /policy/);
  record.events[0].details.decision = "deny";
  assert.equal(verifyLineage(record.events), false);
  assert.equal(first.get("one").events[0].details.decision, "allow");
});

test("process exit during action preserves executing state on disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "affix-crash-"));
  const path = join(dir, "state.json");
  const moduleUrl = new URL("../dist/runtime/index.js", import.meta.url).href;
  try {
    await new Promise((resolve, reject) => {
      const code = `import {FileStore,WorkflowSession} from ${JSON.stringify(moduleUrl)}; const session=new WorkflowSession({store:new FileStore(${JSON.stringify(path)}),scope:'tenant-a',sessionId:'s',clock:()=>${now}});session.propose(${JSON.stringify(proposal())});await session.execute('one',async()=>{process.exit(0)});`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: "inherit" });
      child.on("error", reject); child.on("close", code => code === 0 ? resolve() : reject(new Error(`Child exited ${code}`)));
    });
    const restored = session({ store: new FileStore(path), authorizeReconciliation: ({ actor }) => actor === "ops" });
    assert.equal(restored.get("one").state, "executing");
    await assert.rejects(restored.execute("one", async () => assert.fail()), /executing/);
    await restored.reconcile("one", { actor: "ops", outcome: "not-executed", evidence: "fixture-status-confirmed" });
    assert.equal(restored.get("one").state, "cancelled");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("structured scope keys prevent delimiter collisions", async () => {
  const store = new MemoryStore();
  const a = session({ store, scope: "a:b" });
  const b = session({ store, scope: "a" });
  a.propose({ ...proposal(), budget: { ...proposal().budget, account: "c" } });
  b.propose({ ...proposal(), budget: { ...proposal().budget, account: "b:c" } });
  await a.execute("one", async () => null);
  await b.execute("one", async () => null);
  assert.notEqual(a.get("one").reservation.account, b.get("one").reservation.account);
});

test("explicit policy review preserves freshness and simulation needs fixed time", () => {
  const reviewed = { ...policy, requireReview: true };
  const result = evaluatePolicy(reviewed, [{ source: "stock", status: "ok", value: true, observedAt: now }], { now });
  assert.equal(result.decision, "review");
  assert.ok(result.validUntil > now);
  assert.throws(() => replayPolicy(policy, [{ id: "one", observations: [] }]), /timestamp/);
});

test("existing data-check sources map to pipeline decisions without raw fields", async () => {
  const source = dataCheckSource({ lookup: async query => query.id === "one" ? { pass: true, fields: { privateValue: "secret" } } : null },
    input => ({ id: input.id }), { clock: () => now });
  const pipeline = new DecisionPipeline({ clock: () => now, sources: { stock: source } });
  const result = await pipeline.evaluate(policy, { id: "one" });
  assert.equal(result.decision, "allow");
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal((await pipeline.evaluate(policy, { id: "missing" })).decision, "review");
});

test("decisions cannot move between action inputs or mutate during source collection", async () => {
  const input = { recipient: "original" };
  const mutablePolicy = structuredClone(policy);
  const pipeline = new DecisionPipeline({ clock: () => now, sources: { stock: async received => {
    input.recipient = "changed";
    mutablePolicy.version = "changed";
    assert.equal(received.recipient, "original");
    return { value: true };
  } } });
  const result = await pipeline.evaluate(mutablePolicy, input);
  assert.equal(result.inputDigest, digest({ recipient: "original" }));
  assert.equal(result.policyDigest, digest(policy));
  const first = session();
  assert.throws(() => first.propose({ id: "one", intent: { recipient: "changed" }, policy, result }), /exact action/);
  assert.equal(first.propose({ id: "one", intent: { recipient: "original" }, policy, result }).state, "ready");
});
