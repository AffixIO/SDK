// 2.0.3 regressions for Articus's CitrineOS findings F1–F6 (/workspace/citrineos-affixio/REPORT.md).
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, existsSync, statSync, writeFileSync, readFileSync, mkdirSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { AffixSDK, createLocalSigningKeyPair, signLocalPayload, verifyLocalAttestation, verifyAffixioAttestation, fetchAffixioKeys, clearAffixioKeyCache, publicKeyHash, affixioKeysUrl, signedVerifyPayload } from "../dist/index.js";
import { MemoryStore, FileStore, BudgetLedger, WorkflowSession, DecisionPipeline } from "../dist/runtime/index.js";
import { ProofStore } from "../dist/proof-store.js";
import { MemoryDocumentStore, createDefaultJsonDocumentStore } from "../dist/storage/index.js";

const SECRET = "regression-test-shared-secret-0123";
const tmp = (p = "affix-203-") => mkdtempSync(join(tmpdir(), p));
const paths = dir => ({ operatorBaseDir: join(dir, ".affix"), licenceStatePath: join(dir, "l.json"), proofStorePath: join(dir, "p.json"), statsPath: join(dir, "s.json"), offlineQueuePath: join(dir, "q.json"), spendDir: join(dir, "spend") });

// ---- fake AffixIO API (records every request; signs /verify like the real server) ----
const apiSeed = new Uint8Array(32).fill(7);
const apiKeys = ml_dsa65.keygen(apiSeed);
const apiPubB64 = Buffer.from(apiKeys.publicKey).toString("base64");
const PUBLISHED_ID = "mldsa65-" + createHash("sha256").update(Buffer.from(apiKeys.publicKey).toString("hex")).digest("hex").slice(0, 16);
const keySet = { schema: "affix.keys.v1", keys: [{ key_id: PUBLISHED_ID, algorithm: "ML-DSA-65", public_key_b64: apiPubB64, status: "active", not_before: null, not_after: null }] };
function signCore(core) {
  const digest = createHash("sha256").update(JSON.stringify(core)).digest("hex");
  return { signed_at: new Date().toISOString(), payload_digest: digest, mldsa_signature_b64: Buffer.from(ml_dsa65.sign(apiKeys.secretKey, Buffer.from(digest, "hex"))).toString("base64"), algorithm: "ML-DSA-65" };
}
async function fakeApi() {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/auth/check" || req.url === "/v1/auth/pulse") return res.end(JSON.stringify({ status: "active", ok: true }));
      if (req.url === "/v1/keys") return res.end(JSON.stringify(keySet));
      if (req.url.startsWith("/v1/circuits/simple_yesno/verify")) {
        const core = { proof_id: "p1", valid: true, verified: true, decision: "yes", circuit_id: "simple_yesno", engine: "noir+barretenberg", proof_digest: "ab".repeat(32), proof_ref: "ref1", return_value: null, policy_version: "2.0.0-beta.1", requested_circuit_id: "simple_yesno", bound_circuit_id: "simple_yesno", circuit_binding: "server_prove_record", vk_hash: null };
        return res.end(JSON.stringify({ ...core, attestation: signCore(core), merkle_root: "cd".repeat(32), merkle_leaf_hash: "ef".repeat(32) }));
      }
      res.statusCode = 404; res.end("{}");
    });
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise(r => server.close(r)) };
}

// ------------------------------- F2 -------------------------------
test("F2: explicit apiBase is honoured without proofMode; licence check goes to it, not production", async () => {
  const api = await fakeApi(); const dir = tmp();
  try {
    const sdk = new AffixSDK({ apiKey: "test-not-a-real-key", apiBase: api.base, ...paths(dir), hmacSecret: SECRET, signingKeys: createLocalSigningKeyPair(), silenceHmacWarning: true });
    assert.equal(sdk.apiBase, api.base);
    assert.equal(await sdk.checkLicence(true), true);
    assert.ok(api.hits.includes("/v1/auth/check"));
    sdk.dispose();
  } finally { await api.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("F2: operator config.json apiBase never overrides an explicit apiBase; it is only a fallback", () => {
  const dir = tmp(); const base = join(dir, ".affix"); mkdirSync(base, { recursive: true });
  writeFileSync(join(base, "config.json"), JSON.stringify({ version: 1, apiBase: "https://api.affix-io.com", proofMode: "hmac" }));
  const a = new AffixSDK({ apiKey: "x", apiBase: "http://127.0.0.1:9", ...paths(dir), hmacSecret: SECRET, signingKeys: createLocalSigningKeyPair(), silenceHmacWarning: true });
  assert.equal(a.apiBase, "http://127.0.0.1:9"); a.dispose();
  writeFileSync(join(base, "config.json"), JSON.stringify({ version: 1, apiBase: "http://127.0.0.1:8" }));
  const b = new AffixSDK({ apiKey: "x", ...paths(dir), hmacSecret: SECRET, signingKeys: createLocalSigningKeyPair(), silenceHmacWarning: true });
  assert.equal(b.apiBase, "http://127.0.0.1:8", "file is the fallback when nothing explicit is set"); b.dispose();
  rmSync(dir, { recursive: true, force: true });
});

test("F2: AFFIX_API_BASE is honoured; a conflicting config.apiBase throws; keys URL follows the base", async () => {
  const dir = tmp(); const old = process.env.AFFIX_API_BASE;
  try {
    process.env.AFFIX_API_BASE = "http://127.0.0.1:7/";
    const s = new AffixSDK({ apiKey: "x", ...paths(dir), hmacSecret: SECRET, signingKeys: createLocalSigningKeyPair(), silenceHmacWarning: true });
    assert.equal(s.apiBase, "http://127.0.0.1:7"); s.dispose();
    assert.throws(() => new AffixSDK({ apiKey: "x", apiBase: "http://127.0.0.1:6", ...paths(dir) }), /affixio_api_base_conflict/);
    assert.equal(affixioKeysUrl(), "http://127.0.0.1:7/v1/keys");
    let seen; clearAffixioKeyCache();
    await fetchAffixioKeys({ force: true, fetch: async (url) => { seen = url; return { ok: true, json: async () => keySet }; } });
    assert.equal(seen, "http://127.0.0.1:7/v1/keys");
  } finally { if (old === undefined) delete process.env.AFFIX_API_BASE; else process.env.AFFIX_API_BASE = old; clearAffixioKeyCache(); rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------- F1 -------------------------------
test("F1: supplied secrets are never written; nothing lands in the CWD by default", () => {
  const dir = tmp();
  const code = `import { AffixSDK, createLocalSigningKeyPair } from ${JSON.stringify(new URL("../dist/index.js", import.meta.url).href)};
    const s = new AffixSDK({ apiKey: "x", apiBase: "http://127.0.0.1:9", hmacSecret: "${SECRET}", signingKeys: createLocalSigningKeyPair(), silenceHmacWarning: true }); s.dispose();
    const d = new AffixSDK({ apiKey: "x", apiBase: "http://127.0.0.1:9", silenceHmacWarning: true }); console.log(JSON.stringify(d.secretSources)); d.dispose();`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(join(dir, ".affix", "secrets")), false, "no ./.affix/secrets in the working directory");
  assert.deepEqual(JSON.parse(r.stdout.trim()), { hmacSecret: "generated-ephemeral", signingKeys: "generated-ephemeral" });
  assert.match(r.stderr, /AFFIXIO_EPHEMERAL_SECRETS/);
  rmSync(dir, { recursive: true, force: true });
});

test("F1: persistence is opt-in, needs an explicit path, uses 0700/0600, and existing files are still read", () => {
  const dir = tmp();
  assert.throws(() => new AffixSDK({ apiKey: "x", apiBase: "http://127.0.0.1:9", persistSecrets: true }), /persist_secrets_requires_explicit_path/);
  const p = paths(dir);
  const a = new AffixSDK({ apiKey: "x", apiBase: "http://127.0.0.1:9", persistSecrets: true, ...p, silenceHmacWarning: true });
  const sd = join(p.operatorBaseDir, "secrets");
  assert.equal(statSync(sd).mode & 0o777, 0o700);
  assert.equal(statSync(join(sd, "hmac.secret")).mode & 0o777, 0o600);
  assert.equal(statSync(join(sd, "mldsa65.json")).mode & 0o777, 0o600);
  const id = a.exportLocalPublicKey().key_id; a.dispose();
  const b = new AffixSDK({ apiKey: "x", apiBase: "http://127.0.0.1:9", ...p, silenceHmacWarning: true }); // no persist flag: reads the existing key
  assert.equal(b.exportLocalPublicKey().key_id, id); assert.equal(b.secretSources.signingKeys, "file"); b.dispose();
  const k = createLocalSigningKeyPair();
  const c = new AffixSDK({ apiKey: "x", apiBase: "http://127.0.0.1:9", ...p, signingKeys: k, persistSecrets: true, silenceHmacWarning: true });
  assert.equal(c.exportLocalPublicKey().key_id, k.key_id, "supplied key wins over the file");
  assert.equal(JSON.parse(readFileSync(join(sd, "mldsa65.json"), "utf8")).key_id, id, "supplied key is not written over the file");
  c.dispose(); rmSync(dir, { recursive: true, force: true });
});

// ------------------------------- F3 + F6 -------------------------------
test("F3: sdk.verify keeps the signed fields and checks the API attestation against pinned keys", async () => {
  const api = await fakeApi(); const dir = tmp();
  try {
    const sdk = new AffixSDK({ apiKey: "test-key-1234", apiBase: api.base, licenceOnly: false, autoFlush: false, ...paths(dir), hmacSecret: SECRET, signingKeys: createLocalSigningKeyPair(), silenceHmacWarning: true,
      affixioExpectedKeys: [{ key_id: PUBLISHED_ID, public_key_hash: publicKeyHash(apiPubB64) }] });
    clearAffixioKeyCache();
    const r = await sdk.verify("simple_yesno", "0x" + "11".repeat(64), true, { queueOnFailure: false });
    assert.equal(r.attestation_valid, true, r.attestation_reason);
    assert.equal(r.attestation_reason, "trusted_affixio_signature");
    assert.equal(r.attestation_key_id, PUBLISHED_ID, "F6: published key id, not the hash prefix");
    for (const f of ["engine", "proof_ref", "return_value", "policy_version"]) assert.ok(f in r.signed_payload, f);
    assert.equal(r.engine, "noir+barretenberg");
    assert.ok(api.hits.includes("/v1/keys"), "keys fetched from the configured base");
    const own = await verifyAffixioAttestation(r.signed_payload, r.attestation, { kind: "verify", trustedKeys: keySet });
    assert.equal(own.valid, true);
    const tampered = { ...r.signed_payload, decision: "no" };
    assert.equal((await verifyAffixioAttestation(tampered, r.attestation, { kind: "verify", trustedKeys: keySet })).reason, "digest_mismatch");
    const wrongPin = await sdk.verify("simple_yesno", "0x" + "11".repeat(64), true, { queueOnFailure: false, affixioKeys: { keys: [{ key_id: "other", algorithm: "ML-DSA-65", public_key_b64: createLocalSigningKeyPair().public_key_b64, status: "active" }] } });
    assert.equal(wrongPin.attestation_valid, false);
    await assert.rejects(sdk.verify("simple_yesno", "0x" + "11".repeat(64), true, { queueOnFailure: false, requireValidAttestation: true, affixioKeys: { keys: [{ key_id: "other", algorithm: "ML-DSA-65", public_key_b64: createLocalSigningKeyPair().public_key_b64, status: "active" }] } }), /affixio_attestation_invalid/);
    assert.deepEqual(Object.keys(signedVerifyPayload({ a: 1, attestation: {}, merkle_root: "x", b: 2 })), ["a", "b"]);
    sdk.dispose();
  } finally { clearAffixioKeyCache(); await api.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("F6: verifyAffixioAttestation reports the published key_id with the hash-derived alias", async () => {
  const core = { a: 1 }; const att = signCore(core);
  const r = await verifyAffixioAttestation(core, att, { kind: "verify", allowVkOnly: true, trustedKeys: keySet });
  assert.equal(r.valid, true); assert.equal(r.key_id, PUBLISHED_ID); assert.match(r.key_id_alias, /^[0-9a-f]{16}$/); assert.equal(r.public_key_hash, publicKeyHash(apiPubB64));
  const local = createLocalSigningKeyPair();
  const la = signLocalPayload(core, { hmacSecret: SECRET, secretKeyB64: local.secret_key_b64, publicKeyB64: local.public_key_b64 });
  assert.equal(verifyLocalAttestation(core, la, { trustedKeys: local.public_key_b64 }).key_id, local.key_id, "local host keys keep their own id");
});

// ------------------------------- F4 -------------------------------
test("F4: stores roll back a throwing transaction and only copy what they touch", () => {
  for (const store of [new MemoryStore(), new FileStore(join(tmp(), "s.json"))]) {
    store.transaction(r => { r.a = { n: 1 }; r.b = { n: 2 }; });
    assert.throws(() => store.transaction(r => { r.a.n = 99; delete r.b; r.c = { n: 3 }; throw new Error("boom"); }), /boom/);
    assert.deepEqual(store.transaction(r => ({ a: r.a, b: r.b, c: r.c ?? null, keys: Object.keys(r).sort() })), { a: { n: 1 }, b: { n: 2 }, c: null, keys: ["a", "b"] });
    const leaked = store.transaction(r => r.a); leaked.n = 5;
    assert.equal(store.transaction(r => r.a.n), 1, "returned values are copies");
    assert.throws(() => store.transaction(r => { r.x = new Date(); }), /plain JSON/);
    assert.throws(() => store.transaction(() => Promise.resolve()), /synchronous/);
  }
});

test("F4: FileStore log replays across instances, survives a torn tail, compacts to the 2.0.2 format", () => {
  const dir = tmp(); const path = join(dir, "state.json");
  const a = new FileStore(path, { compactEvery: 5 });
  for (let i = 0; i < 3; i++) a.transaction(r => { r["k" + i] = { i }; });
  const b = new FileStore(path);
  assert.deepEqual(b.transaction(r => Object.keys(r).sort()), ["k0", "k1", "k2"]);
  b.transaction(r => { r.k1 = { i: 10 }; });
  assert.equal(a.transaction(r => r.k1.i), 10, "a sees b's write");
  appendFileSync(path + ".log", '{"s":{"torn":'); // crash mid-append
  assert.equal(new FileStore(path).transaction(r => ("torn" in r)), false);
  a.transaction(r => { r.k3 = { i: 3 }; });
  assert.equal(new FileStore(path).transaction(r => r.k3.i), 3, "append after a torn tail stays readable");
  a.compact();
  const snap = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(snap.schema, "affix.runtime.v1");
  assert.deepEqual(Object.keys(snap.records).sort(), ["k0", "k1", "k2", "k3"]);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  // a 2.0.2 file (no generation, no log) loads unchanged
  const old = join(dir, "old.json");
  writeFileSync(old, JSON.stringify({ schema: "affix.runtime.v1", records: { x: { v: 1 } } }));
  assert.equal(new FileStore(old).transaction(r => r.x.v), 1);
  rmSync(dir, { recursive: true, force: true });
});

test("F4: 3,000 workflow commands stay fast (no O(n) copy per transaction)", async () => {
  const policy = { id: "p", version: "1", mode: "all", rules: [{ source: "ok", operator: "truthy", maxAgeMs: 60000 }] };
  const pipe = new DecisionPipeline({ sources: { ok: async () => ({ value: true }) } });
  for (const store of [new MemoryStore(), new FileStore(join(tmp(), "w.json"))]) {
    const s = new WorkflowSession({ store, scope: "t", sessionId: "s" });
    const t = [];
    for (let i = 0; i < 3000; i++) {
      const intent = { action: "cmd", n: i }; const r = await pipe.evaluate(policy, intent);
      const t0 = performance.now(); s.propose({ id: "c" + i, intent, policy, result: r }); await s.execute("c" + i, async () => ({ ok: 1 })); t.push(performance.now() - t0);
    }
    const first = t.slice(0, 300).reduce((a, b) => a + b) / 300, last = t.slice(-300).reduce((a, b) => a + b) / 300;
    assert.ok(last < Math.max(first * 4, 5), `last ${last.toFixed(2)} ms vs first ${first.toFixed(2)} ms`);
  }
});

// ------------------------------- F5 -------------------------------
test("F5: proof store is bounded by a cap and a TTL, newest first", async () => {
  let now = Date.parse("2026-10-10T00:00:00Z");
  const ps = new ProofStore(new MemoryDocumentStore(), 3, "proofs", { ttlMs: 60_000, clock: () => now });
  for (let i = 0; i < 5; i++) await ps.save({ proof_id: "p" + i, created_at: new Date(now).toISOString() });
  assert.deepEqual((await ps.list()).map(p => p.proof_id), ["p4", "p3", "p2"]);
  now += 120_000;
  await ps.save({ proof_id: "new", created_at: new Date(now).toISOString() });
  assert.deepEqual((await ps.list()).map(p => p.proof_id), ["new"]);
});

test("F5: default file proof store appends per record, compacts into a 2.0.2-readable proofs.json", async () => {
  const dir = tmp(); const path = join(dir, "proofs.json");
  writeFileSync(path, JSON.stringify([{ proof_id: "old", created_at: new Date().toISOString() }], null, 2)); // 2.0.2 file
  const docs = createDefaultJsonDocumentStore({ proofs: path, offlineQueue: join(dir, "q"), codeUses: join(dir, "c"), licence: join(dir, "l"), stats: join(dir, "s") });
  const ps = new ProofStore(docs, 10, "proofs");
  for (let i = 0; i < 4; i++) await ps.save({ proof_id: "p" + i, created_at: new Date().toISOString() });
  assert.equal(JSON.parse(readFileSync(path, "utf8")).length, 1, "saves append to the log, not the document");
  assert.deepEqual((await ps.list()).map(p => p.proof_id), ["p3", "p2", "p1", "p0", "old"]);
  await ps.save({ proof_id: "p1", created_at: new Date().toISOString(), v: 2 }); // re-save replaces
  for (let i = 4; i < 20; i++) await ps.save({ proof_id: "p" + i, created_at: new Date().toISOString() });
  const listed = await ps.list();
  assert.equal(listed.length, 10); assert.equal(listed[0].proof_id, "p19");
  const onDisk = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(Array.isArray(onDisk) && onDisk.length <= 10 && onDisk[0].proof_id.startsWith("p"), "compacted file is a plain newest-first array");
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual((await new ProofStore(docs, 10, "proofs").list()).map(p => p.proof_id), listed.map(p => p.proof_id), "a second instance sees the same list");
  rmSync(dir, { recursive: true, force: true });
});

test("docs items: accepting a legacy v1 envelope warns", async () => {
  const k = createLocalSigningKeyPair(); const p = { a: 1 };
  const v1 = signLocalPayload(p, { hmacSecret: SECRET, secretKeyB64: k.secret_key_b64, publicKeyB64: k.public_key_b64, legacyV1: true });
  const warned = new Promise(r => process.once("warning", w => r(w.code)));
  assert.equal(verifyLocalAttestation(p, v1, { trustedKeys: k.public_key_b64, rejectLegacyV1: false }).valid, true);
  assert.equal(await warned, "AFFIXIO_LEGACY_V1_ACCEPTED");
});
