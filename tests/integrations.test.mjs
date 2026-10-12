import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createEvidenceBundle, verifyEvidenceBundle, verifyPublicEnvelope, evidenceReport, describeEvidence,
  createMcpGate, createMcpConnection, expressGate, fastifyGate, createX402Fetch, createAp2Authorizer, MemoryStore, instrument, BudgetLedger,
  DecisionPipeline, digest } from "../dist/runtime/index.js";
import { AffixSDK } from "../dist/index.js";
import { canonicalPolicyHash } from "../dist/policy-binding.js";
import { createLocalSigningKeyPair, signLocalPayload } from "../dist/local-signing.js";
import { spendingPolicy, verifyAgentSpend } from "../dist/agentic-pay-kit.js";

const keys = createLocalSigningKeyPair();
const signing = { hmacSecret: "testing-only-shared-secret", secretKeyB64: keys.secret_key_b64, publicKeyB64: keys.public_key_b64 };
const trust = { trustedPublicKeys: [keys.public_key_b64] };

test("pipeline binds exact input and decision through the real SDK signed envelope", async () => {
  const stored = [];
  const sdk = Object.assign(Object.create(AffixSDK.prototype), {
    config: { allowOfflineProve: true, licenceOnly: true },
    hmacSecret: signing.hmacSecret, signingKeys: keys,
    licence: { ensureFreshPolicy: async () => {}, getState: () => ({}), consumeQuota: async () => {} },
    stats: { bump: async () => {} }, store: { save: async record => stored.push(record) }
  });
  const at = Date.UTC(2026, 9, 5);
  const policy = { id: "purchase", version: "1", mode: "all", rules: [{ source: "stock", operator: "truthy", maxAgeMs: 60000 }] };
  let inStock = true;
  const pipeline = new DecisionPipeline({ clock: () => at, sources: { stock: async () => ({ value: inStock }) } });
  const input = { recipient: "merchant-a", amount: 19, currency: "GBP" };
  const result = await pipeline.prove(sdk, policy, input, { requestId: "signed-decision" });
  assert.equal((await verifyPublicEnvelope(result.proof.envelope, { ...trust, proof: result.proof.envelope.payload.proof, circuitId: result.proof.envelope.payload.circuit_id })).valid, true);
  assert.equal(result.proof.envelope.payload.policy_hash, canonicalPolicyHash(result.binding));
  assert.equal(result.binding.input_digest, digest(input));
  assert.equal(result.binding.decision_digest, digest(result.result));
  assert.deepEqual(result.binding.policy, policy);
  assert.notEqual(result.proof.envelope.payload.policy_hash, result.result.policyDigest);
  assert.notEqual(canonicalPolicyHash({ ...result.binding, input_digest: digest({ ...input, recipient: "merchant-b" }) }), result.proof.envelope.payload.policy_hash);
  assert.notEqual(canonicalPolicyHash({ ...result.binding, decision_digest: digest({ ...result.result, decision: "deny" }) }), result.proof.envelope.payload.policy_hash);
  const tampered = structuredClone(result.proof.envelope);
  tampered.payload.policy_hash = canonicalPolicyHash(policy);
  assert.equal((await verifyPublicEnvelope(tampered, { ...trust, proof: tampered.payload.proof, circuitId: tampered.payload.circuit_id })).valid, false);
  assert.deepEqual(stored[0].envelope, result.proof.envelope);
  inStock = false;
  const denied = await pipeline.prove(sdk, policy, input, { requestId: "signed-denial" });
  assert.equal(denied.proof.envelope.payload.decision, "no");
  assert.equal((await verifyPublicEnvelope(denied.proof.envelope, { ...trust, proof: denied.proof.envelope.payload.proof, circuitId: denied.proof.envelope.payload.circuit_id })).valid, true);
});

test("real ML-DSA manifest verification requires an external trust key", async () => {
  const bundle = createEvidenceBundle([{ name: "decision", data: { outcome: "allow" } }], { signing });
  assert.equal((await verifyEvidenceBundle(bundle)).signatureValid, false);
  const result = await verifyEvidenceBundle(bundle, trust);
  assert.equal(result.signatureValid, true);
  assert.equal(result.zeroKnowledgeVerified, false);
  assert.equal(result.remoteAttestationVerified, false);
  bundle.artifacts[0].data.outcome = "deny";
  assert.equal((await verifyEvidenceBundle(bundle, trust)).integrityValid, false);
});

test("manifest relabeling, extra artifacts and forged signatures fail", async () => {
  const bundle = createEvidenceBundle([{ name: "proof", data: { id: "p1" } }], { signing });
  const renamed = structuredClone(bundle); renamed.manifest.entries[0].name = "other";
  assert.equal((await verifyEvidenceBundle(renamed, trust)).integrityValid, false);
  const added = structuredClone(bundle); added.artifacts.push({ name: "hidden", data: "x" });
  assert.equal((await verifyEvidenceBundle(added, trust)).integrityValid, false);
  bundle.signature.mldsa_signature_b64 = "Zm9yZ2Vk";
  assert.equal((await verifyEvidenceBundle(bundle, trust)).signatureValid, false);
  assert.throws(() => createEvidenceBundle([{ name: "a", data: 1 }, { name: "a", data: 2 }]), /Duplicate/);
});

test("public verifier does not claim HMAC or ZK verification", async () => {
  const payload = { decision: "yes", policy_hash: "fixed", nested: { z: 1, a: true } };
  const attestation = signLocalPayload(payload, signing);
  const verified = await verifyPublicEnvelope({ payload, attestation }, { ...trust, allowUnbound: true });
  assert.equal(verified.valid, true);
  assert.equal(verified.hmacVerified, false);
  assert.equal(verified.zeroKnowledgeVerified, false);
  assert.equal((await verifyPublicEnvelope({ payload: { ...payload, decision: "no" }, attestation }, { ...trust, allowUnbound: true })).valid, false);
  assert.equal(describeEvidence({ proof_mode: "ultrahonk" }).cryptographicallyVerified, false);
});

test("evidence report escapes untrusted artifact names", async () => {
  const bundle = createEvidenceBundle([{ name: '<img src=x onerror="alert(1)">', data: null }]);
  const html = evidenceReport(bundle, await verifyEvidenceBundle(bundle));
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("&lt;img"), true);
  assert.equal(html.includes("Not checked") || html.includes("not checked"), true);
});

test("MCP hides tools and rechecks authorization at invocation", async () => {
  let permission = true, calls = 0;
  const gate = createMcpGate({ tools: [{ name: "send", inputSchema: { type: "object" } }],
    canDiscover: async context => context.user === "kris" && permission,
    authorize: async ({ arguments: args }) => ({ decision: args.approved ? "allow" : "review" }),
    execute: async () => { calls++; return { content: [{ type: "text", text: "Sent" }] }; } });
  assert.equal((await gate.list({ user: "other" })).tools.length, 0);
  assert.equal((await gate.list({ user: "kris" })).tools.length, 1);
  assert.equal((await gate.call("send", {}, { user: "kris" })).isError, true);
  assert.equal(calls, 0);
  await gate.call("send", { approved: true }, { user: "kris" });
  assert.equal(calls, 1);
  permission = false;
  await assert.rejects(gate.call("send", { approved: true }, { user: "kris" }), /unavailable/);
});

test("Express and Fastify gates block deny/review and forward errors", async () => {
  const req = {};
  let code, nextCalls = 0;
  const response = { status(n) { code = n; return this; }, code(n) { code = n; return this; }, json: value => value, send: value => value };
  await expressGate(async () => ({ decision: "allow" }))(req, response, () => nextCalls++);
  assert.equal(nextCalls, 1);
  assert.equal(req.affixDecision.decision, "allow");
  await expressGate(async () => ({ decision: "review" }))({}, response, () => assert.fail());
  assert.equal(code, 409);
  await fastifyGate(async () => ({ decision: "deny" }))({}, response);
  assert.equal(code, 403);
  await expressGate(async () => { throw new Error("broken"); })({}, response, error => assert.equal(error.message, "broken"));
});

test("MCP connection manifests contain env names, not API key values", () => {
  const manifest = createMcpConnection({ command: "node", args: ["server.mjs"] });
  assert.deepEqual(manifest.requiredEnvironment, ["AFFIX_API_KEY"]);
  assert.throws(() => createMcpConnection({ command: "node", apiKeyEnv: "bad-value" }));
});

const accepted = { scheme: "exact", network: "eip155:8453", amount: "1000", asset: "token-address", payTo: "recipient", maxTimeoutSeconds: 60 };
const challenge = { x402Version: 2, resource: { url: "https://paid.test/data" }, accepts: [accepted] };
const header = value => Buffer.from(JSON.stringify(value)).toString("base64");

test("x402 v2 binds negotiated payment and verifies settlement", async () => {
  let calls = 0;
  const paidFetch = createX402Fetch({ allowedOrigins: ["https://paid.test"],
    fetch: async (url, options) => {
      calls++; assert.equal(url, challenge.resource.url); assert.equal(options.redirect, "error");
      if (calls === 1) return new Response("", { status: 402, headers: { "PAYMENT-REQUIRED": header(challenge) } });
      const payment = JSON.parse(Buffer.from(options.headers.get("PAYMENT-SIGNATURE"), "base64"));
      assert.deepEqual(payment.accepted, accepted);
      return new Response("data", { headers: { "PAYMENT-RESPONSE": header({ success: true, transaction: "fixture" }) } });
    }, authorize: async () => ({ decision: "allow", accepted }),
    sign: async request => ({ ...request, payload: { signature: "fixture-signature" } }),
    verifySettlement: async ({ settlement }) => settlement.transaction === "fixture" });
  const result = await paidFetch(challenge.resource.url);
  assert.equal(result.paid, true);
  assert.equal(await result.response.text(), "data");
  assert.equal(calls, 2);
  await assert.rejects(paidFetch("https://other.test/data"), /origin/);
});

test("x402 does not pay on denied, unbound or unverified requests", async () => {
  let signs = 0;
  const base = { allowedOrigins: ["https://paid.test"], fetch: async () => new Response("", { status: 402, headers: { "PAYMENT-REQUIRED": header(challenge) } }),
    authorize: async () => ({ decision: "deny" }), sign: async request => { signs++; return { ...request, payload: {} }; }, verifySettlement: async () => false };
  await assert.rejects(createX402Fetch(base)(challenge.resource.url), /authorized/);
  assert.equal(signs, 0);
  await assert.rejects(createX402Fetch({ ...base, authorize: async () => ({ decision: "allow", accepted: { ...accepted, amount: "0" } }) })(challenge.resource.url), /not in/);
  await assert.rejects(createX402Fetch(base)(challenge.resource.url, { headers: { "PAYMENT-SIGNATURE": "old" } }), /authorized signer/);
  const wrong = { ...challenge, resource: { url: "https://other.test/data" } };
  await assert.rejects(createX402Fetch({ ...base, fetch: async () => new Response("", { status: 402, headers: { "PAYMENT-REQUIRED": header(wrong) } }) })(challenge.resource.url), /unbound/);
});

test("AP2 normalized claims require trusted verification and single consumption", async () => {
  const now = Date.now();
  const claims = { mandateId: "mandate-1", principal: "human", agent: "agent", merchant: "merchant", currency: "GBP", checkoutDigest: "checkout-1", amountMinor: 1900, expiresAt: now + 10000 };
  const authorize = createAp2Authorizer({ store: new MemoryStore(), scope: "tenant", clock: () => now, verifyMandate: async () => ({ verified: true, claims }) });
  const expected = { ...claims, requestId: "request-1" };
  await assert.rejects(authorize({ signedMandate: "signed-token", expected: { ...expected, amountMinor: 2000 } }), /amount/);
  await authorize({ signedMandate: "signed-token", expected });
  await assert.rejects(authorize({ signedMandate: "signed-token", expected }), /consumed/);
  const untrusted = createAp2Authorizer({ store: new MemoryStore(), scope: "tenant", verifyMandate: async () => ({ verified: false }) });
  await assert.rejects(untrusted({ signedMandate: "unsigned", expected }), /signature/);
});

test("telemetry excludes inputs and exporter failure cannot repeat an action", async () => {
  const attributes = [];
  const trace = instrument({ tracer: { startSpan: () => ({ setStatus() {}, setAttribute: (...args) => attributes.push(args), end() { throw new Error("export failed"); } }) },
    meter: { createCounter: () => ({ add: (_, attrs) => attributes.push(attrs) }), createHistogram: () => ({ record() {} }) } });
  assert.equal(await trace("action", async () => "customer-secret"), "customer-secret");
  assert.equal(JSON.stringify(attributes).includes("customer-secret"), false);
  await assert.rejects(trace("action", async () => { throw new Error("operation-failed"); }), /operation-failed/);
});

test("legacy daily cap fails closed without ledger and reserves with ledger", async () => {
  const policy = spendingPolicy({ currency: "GBP", maxPerDay: 15, maxPerAction: 10 });
  assert.equal(policy.decide({ amount: 10 }).reason, "daily_budget_required");
  const ledger = new BudgetLedger({ store: new MemoryStore() });
  const sdk = { prove: async input => ({ decision: input.decision, proof_id: input.request_id }) };
  const input = { sdk, policy, amount: 10, currency: "GBP", agentId: "agent", budgetLedger: ledger, budgetAccount: "team", requestId: "first" };
  const first = await verifyAgentSpend(input);
  assert.equal(first.allowed, true);
  assert.equal(first.reservation.amountMinor, 1000);
  assert.equal((await verifyAgentSpend(input)).reason, "reservation_already_exists");
  const second = await verifyAgentSpend({ ...input, requestId: "second" });
  assert.equal(second.allowed, false);
  assert.equal(second.reason, "daily_budget_exceeded");
});

test("legacy gate validates missing merchant/category and releases failed proofs", async () => {
  assert.equal(spendingPolicy({ allowedMerchants: ["merchant.test"] }).decide({}).reason, "merchant_required");
  assert.equal(spendingPolicy({ allowedCategories: ["retail"] }).decide({}).reason, "category_required");
  assert.equal(spendingPolicy({ expiresAt: "bad-date" }).decide({}).allowed, false);
  const ledger = new BudgetLedger({ store: new MemoryStore() });
  await assert.rejects(verifyAgentSpend({ sdk: { prove: async () => { throw new Error("proof failed"); } }, policy: { maxPerDay: 15 }, amount: 10,
    requestId: "failed", budgetLedger: ledger, budgetAccount: "team" }));
  assert.equal(ledger.summary("team", "GBP").usedMinor, 0);
});

test("evidence CLI verifies signatures, writes report and refuses overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "affix-cli-"));
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL("../dist/runtime/cli.js", import.meta.url).pathname, ...args], { stdio: "inherit" });
    child.on("error", reject); child.on("close", resolve);
  });
  try {
    const bundle = createEvidenceBundle([{ name: "check", data: { decision: "allow" } }], { signing });
    const path = join(directory, "bundle.json"), key = join(directory, "key.txt"), report = join(directory, "report.html");
    await writeFile(path, JSON.stringify(bundle)); await writeFile(key, keys.public_key_b64);
    assert.equal(await run(["verify", path, "--trusted-key", key, "--report", report]), 0);
    assert.match(await readFile(report, "utf8"), /Trusted manifest signature verified/);
    assert.equal(await run(["verify", path, "--trusted-key", key, "--report", report]), 1);
    assert.equal(await run(["verify", path]), 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("x402 unverifiable settlement never reports a completed payment", async () => {
  let calls = 0;
  const run = createX402Fetch({ allowedOrigins: ["https://paid.test"],
    fetch: async () => ++calls === 1 ? new Response("", { status: 402, headers: { "PAYMENT-REQUIRED": header(challenge) } }) :
      new Response("data", { headers: { "PAYMENT-RESPONSE": header({ success: true }) } }),
    authorize: async () => ({ decision: "allow", accepted }), sign: async request => ({ ...request, payload: { signature: "fixture" } }),
    verifySettlement: async () => false });
  await assert.rejects(run(challenge.resource.url), /reconcile/);
  assert.equal(calls, 2);
});

test("public core remains importable and stamps the new version", async () => {
  const core = await import("../dist/index.js");
  assert.equal(typeof core.AffixSDK, "function");
  assert.equal(typeof core.AgentTrust, "function");
  assert.equal(core.buildVersionBinding({ circuitId: "simple_yesno" }).sdk_version, "2.0.3");
});
