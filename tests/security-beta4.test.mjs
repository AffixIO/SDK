// 2.0.0-beta.4 regressions for Articus's beta.3 attacks (/workspace/zenoh-affixio/beta3-test/attacks3.mjs): V5, X1, K4/K5, lows.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { AffixSDK, createLocalSigningKeyPair, signLocalPayload, verifyLocalAttestation, wrapProofEnvelope, lightProve, canonicalLocalPayload,
  localSignatureMessage, checkEnvelopeBinding, verifyAffixioAttestation, fetchAffixioKeys, publicKeyHash, LOCAL_SIGNATURE_V2_PREFIX } from "../dist/index.js";
import { verifyPublicEnvelope } from "../dist/runtime/index.js";
import { verifyArtifactOffline } from "../dist/extensions/index.js";
import { normaliseWitnessInputs } from "../dist/witness.js";
import { proofDigest } from "../dist/local-prove.js";

const SECRET = "regression-test-shared-secret-0123";
const k = createLocalSigningKeyPair();
const atk = createLocalSigningKeyPair();
const pin = { key_id: k.key_id, public_key_b64: k.public_key_b64 };
const prove = (a) => lightProve({ circuit_id: "simple_yesno", inputs: normaliseWitnessInputs({ a }) }, SECRET, { decision: "yes" }).proof;
const envFor = (proof, extra = {}) => wrapProofEnvelope({ proof, circuit_id: "simple_yesno", proof_mode: "hmac", decision: "yes", ...extra }, { hmacSecret: SECRET, signingKeys: k });
async function sdk(extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), "affix-b4-"));
  return new AffixSDK({ apiKey: "local_operator", apiBase: "http://127.0.0.1:9", hmacSecret: SECRET, signingKeys: k, operatorBaseDir: join(dir, ".affix"),
    licenceStatePath: join(dir, "l.json"), proofStorePath: join(dir, "p.json"), statsPath: join(dir, "s.json"), offlineQueuePath: join(dir, "q.json"),
    spendDir: join(dir, "spend"), silenceHmacWarning: true, ...extra });
}

test("V5: envelope of proof B does not validate proof A (verifyLocal)", async () => {
  const s = await sdk();
  const A = prove("0x1"), B = prove("0x2");
  const r = await s.verifyLocal("simple_yesno", A, { envelope: envFor(B) });
  assert.equal(r.proof_valid, true); assert.equal(r.envelope_ok, false); assert.equal(r.valid, false);
  assert.equal(r.envelope_reason, "envelope_proof_mismatch");
  assert.equal((await s.verifyLocal("simple_yesno", A, { envelope: envFor(A) })).valid, true);
  // circuit mismatch
  assert.equal((await s.verifyLocal("simple_yesno", A, { envelope: envFor(A, { circuit_id: "other_circuit" }) })).envelope_reason, "envelope_circuit_mismatch");
  // digest-only payload binds by computed digest
  const dEnv = wrapProofEnvelope({ proof_digest: proofDigest(A, "simple_yesno", true), circuit_id: "simple_yesno", decision: "yes" }, { hmacSecret: SECRET, signingKeys: k });
  assert.equal((await s.verifyLocal("simple_yesno", A, { envelope: dEnv })).valid, true);
  assert.equal((await s.verifyLocal("simple_yesno", B, { envelope: dEnv })).valid, false);
  // no circuit_id: proof_mode must match
  assert.equal(checkEnvelopeBinding({ proof: A, proof_mode: "hmac" }, { proof: A, proofMode: "hmac" }).bound, true);
  assert.equal(checkEnvelopeBinding({ proof: A, proof_mode: "ultrahonk" }, { proof: A, proofMode: "hmac" }).bound, false);
  assert.equal(checkEnvelopeBinding({ proof: A }, { proof: A, circuitId: "simple_yesno" }).bound, false);
});

test("V5: binding in browser and offline verifiers", async () => {
  const A = prove("0x1"), B = prove("0x2");
  const eB = envFor(B);
  assert.equal((await verifyPublicEnvelope(eB, { trustedPublicKeys: [k.public_key_b64], proof: A, circuitId: "simple_yesno" })).reason, "envelope_proof_mismatch");
  assert.equal((await verifyPublicEnvelope(eB, { trustedPublicKeys: [k.public_key_b64], proof: B, circuitId: "simple_yesno" })).valid, true);
  const off = verifyArtifactOffline({ proof: eB.payload, attestation: eB.attestation, trustedKeys: [pin], proofHex: A, circuitId: "simple_yesno" });
  assert.equal(off.ok, false); assert.match(off.errors.join(), /envelope_proof_mismatch/);
  assert.equal(verifyArtifactOffline({ proof: eB.payload, attestation: eB.attestation, trustedKeys: [pin], proofHex: B, circuitId: "simple_yesno" }).ok, true);
});

test("X1: v1 signature over a v2-shaped payload is not accepted as v2; legacyV1 refuses it", async () => {
  const forgedAt = "2026-06-01T00:00:00.000Z";
  const inner = { proof_id: "afx_crossdomain", decision: "yes" };
  const crafted = { domain: "affix.sdk.local-signature.v2", key_id: k.key_id, payload: inner, signed_at: forgedAt };
  assert.throws(() => signLocalPayload(crafted, { hmacSecret: SECRET, secretKeyB64: k.secret_key_b64, publicKeyB64: k.public_key_b64, legacyV1: true }), /legacy_v1_refused/);
  // even a raw v1-style signature (made without the SDK guard) does not verify as v2
  const rawSig = Buffer.from(ml_dsa65.sign(Buffer.from(k.secret_key_b64, "base64"), Buffer.from(canonicalLocalPayload(crafted)))).toString("base64");
  const crossAtt = { schema: "affix.local-signature.v2", algorithm: "HMAC-SHA256+ML-DSA-65", signed_at: forgedAt, key_id: k.key_id,
    payload_digest: createHash("sha256").update(canonicalLocalPayload(inner)).digest("hex"), hmac_b64: "", mldsa_signature_b64: rawSig, mldsa_public_key_b64: k.public_key_b64 };
  assert.equal(verifyLocalAttestation(inner, crossAtt, { trustedKeys: pin }).reason, "invalid_signature");
  assert.equal((await verifyPublicEnvelope({ payload: inner, attestation: crossAtt }, { trustedPublicKeys: [k.public_key_b64], allowUnbound: true })).reason, "invalid_signature");
  // and v1 verification refuses v2-shaped payloads
  const v1att = { ...crossAtt, schema: "affix.local-signature.v1", payload_digest: createHash("sha256").update(canonicalLocalPayload(crafted)).digest("hex") };
  assert.equal(verifyLocalAttestation(crafted, v1att, { trustedKeys: pin, rejectLegacyV1: false }).reason, "legacy_v1_v2_shaped_payload");
  // v2 message has the fixed prefix
  const msg = Buffer.from(localSignatureMessage(inner, crossAtt)).toString("utf8");
  assert.ok(msg.startsWith(LOCAL_SIGNATURE_V2_PREFIX));
  // normal v2 still works
  assert.equal(verifyLocalAttestation(inner, signLocalPayload(inner, { hmacSecret: SECRET, secretKeyB64: k.secret_key_b64, publicKeyB64: k.public_key_b64 }), { trustedKeys: pin }).valid, true);
});

test("rejectLegacyV1: option, and default true for verifier roles", async () => {
  const p = { proof_id: "x" };
  const v1 = signLocalPayload(p, { hmacSecret: SECRET, secretKeyB64: k.secret_key_b64, publicKeyB64: k.public_key_b64, legacyV1: true });
  assert.equal(verifyLocalAttestation(p, v1, { trustedKeys: pin, rejectLegacyV1: false }).valid, true);
  assert.equal(verifyLocalAttestation(p, v1, { trustedKeys: pin, rejectLegacyV1: true }).reason, "legacy_v1_rejected");
  assert.equal((await verifyPublicEnvelope({ payload: p, attestation: v1 }, { trustedPublicKeys: [k.public_key_b64], rejectLegacyV1: true, allowUnbound: true })).reason, "legacy_v1_rejected");
  const A = prove("0x1");
  const v1env = { payload: { proof: A, circuit_id: "simple_yesno" }, attestation: signLocalPayload({ proof: A, circuit_id: "simple_yesno" }, { hmacSecret: SECRET, secretKeyB64: k.secret_key_b64, publicKeyB64: k.public_key_b64, legacyV1: true }) };
  // 2.0.2: server role rejects v1 by default; stored v1 envelopes need rejectLegacyV1: false.
  const server = await sdk();
  assert.equal((await server.verifyLocal("simple_yesno", A, { envelope: v1env })).envelope_reason, "legacy_v1_rejected", "server: v1 rejected by default (2.0.2)");
  const legacyOk = await sdk({ rejectLegacyV1: false });
  assert.equal((await legacyOk.verifyLocal("simple_yesno", A, { envelope: v1env, allowMissingDecision: true })).envelope_ok, true, "server opt-in accepts v1");
  const strict = await sdk({ rejectLegacyV1: true });
  assert.equal((await strict.verifyLocal("simple_yesno", A, { envelope: v1env })).envelope_reason, "legacy_v1_rejected");
  const dev = await sdk({ role: "device", trustedSigningKeys: [k.public_key_b64], hmacSecret: undefined });
  assert.equal(dev.rejectLegacyV1, true);
});

const ksFor = (keys) => ({ schema: "affix.keys.v1", keys });
const entry = (kp, id) => ({ key_id: id, algorithm: "ML-DSA-65", public_key_b64: kp.public_key_b64, status: "active", not_before: null, not_after: null });
const feed = (doc) => ({ force: true, fetch: async () => ({ ok: true, json: async () => doc }) });

test("K4/K5: expectedKeys pins key bytes; extra keys and swapped bytes are rejected", async () => {
  const genuine = entry(k, "mldsa65-genuine");
  const pins = [{ key_id: "mldsa65-genuine", public_key_hash: publicKeyHash(k.public_key_b64) }];
  assert.equal((await fetchAffixioKeys({ ...feed(ksFor([genuine])), expectedKeys: pins })).keys.length, 1);
  await assert.rejects(fetchAffixioKeys({ ...feed(ksFor([genuine, entry(atk, "mldsa65-attacker")])), expectedKeys: pins }), /unpinned key mldsa65-attacker/);
  await assert.rejects(fetchAffixioKeys({ ...feed(ksFor([{ ...genuine, public_key_b64: atk.public_key_b64 }])), expectedKeys: pins }), /do not match the pinned public_key_hash/);
  await assert.rejects(fetchAffixioKeys({ ...feed(ksFor([genuine])), expectedKeys: [{ key_id: "x" }] }), (e) => e.code === "invalid_key_pin");
  // expectedKeyIds alone is presence-only (documented, warns) - still passes K4 shape
  const r = await fetchAffixioKeys({ ...feed(ksFor([genuine, entry(atk, "mldsa65-attacker")])), expectedKeyIds: ["mldsa65-genuine"] });
  assert.equal(r.keys.length, 2);
});

test("server attestations: accept/reject paths for retired and expiring keys", async () => {
  const server = ml_dsa65.keygen(new Uint8Array(32).fill(5));
  const b64 = Buffer.from(server.publicKey).toString("base64");
  const p = { proof_id: "pf", valid: true };
  const digest = createHash("sha256").update(JSON.stringify(p)).digest("hex");
  const att = { signed_at: "2026-06-01T00:00:00Z", payload_digest: digest, algorithm: "ML-DSA-65",
    mldsa_signature_b64: Buffer.from(ml_dsa65.sign(server.secretKey, Buffer.from(digest, "hex"))).toString("base64") };
  const base = { key_id: "mldsa65-s", algorithm: "ML-DSA-65", public_key_b64: b64, status: "active", not_before: "2026-01-01T00:00:00Z" };
  const cases = [
    ["active, no expiry", base, {}, true],
    ["retired", { ...base, status: "retired" }, {}, false],
    ["retired + allowLegacyUnsignedTime", { ...base, status: "retired" }, { allowLegacyUnsignedTime: true }, true],
    ["active, not_after in future", { ...base, not_after: "2999-01-01T00:00:00Z" }, {}, false],
    ["active, not_after in future + allowLegacyUnsignedTime", { ...base, not_after: "2999-01-01T00:00:00Z" }, { allowLegacyUnsignedTime: true }, true],
    ["expired", { ...base, not_after: "2026-02-01T00:00:00Z", status: "retired" }, {}, false],
    ["revoked + allowLegacyUnsignedTime", { ...base, status: "revoked" }, { allowLegacyUnsignedTime: true }, false],
  ];
  for (const [name, key, opts, want] of cases)
    assert.equal((await verifyAffixioAttestation(p, att, { kind: "verify", allowVkOnly: true, trustedKeys: [key], ...opts })).valid, want, name);
});

test("allowLegacyUnsignedTime emits a warning", async () => {
  const warnings = [];
  const on = (w) => warnings.push(w.code);
  process.on("warning", on);
  const p = { proof_id: "w" };
  const v1 = signLocalPayload(p, { hmacSecret: SECRET, secretKeyB64: k.secret_key_b64, publicKeyB64: k.public_key_b64, legacyV1: true, signedAt: "2025-06-01T00:00:00Z" });
  const windowed = { ...pin, not_after: "2026-01-01T00:00:00Z" };
  assert.equal(verifyLocalAttestation(p, v1, { trustedKeys: windowed, allowLegacyUnsignedTime: true, rejectLegacyV1: false }).valid, true);
  await new Promise((r) => setImmediate(r));
  process.off("warning", on);
  assert.ok(warnings.includes("AFFIXIO_ALLOW_LEGACY_UNSIGNED_TIME"), JSON.stringify(warnings));
});
