// 2.0.0-beta.3 regressions for Articus's beta.2 holes (/workspace/zenoh-affixio/beta2-test/holes.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { AffixSDK, createLocalSigningKeyPair, signLocalPayload, verifyLocalAttestation, wrapProofEnvelope, lightProve,
  verifyAffixioAttestation, fetchAffixioKeys, clearAffixioKeyCache, computeKeySetHash, publicKeyHash } from "../dist/index.js";
import { verifyPublicEnvelope } from "../dist/runtime/index.js";
import { verifyArtifactOffline } from "../dist/extensions/index.js";
import { normaliseWitnessInputs } from "../dist/witness.js";

const SECRET = "regression-test-shared-secret-0123";
const k = createLocalSigningKeyPair();
const evil = createLocalSigningKeyPair();
const signing = (keys, extra = {}) => ({ hmacSecret: SECRET, secretKeyB64: keys.secret_key_b64, publicKeyB64: keys.public_key_b64, ...extra });
const payload = { proof_id: "p", decision: "yes", cmd: "unlock" };
const expired = { key_id: k.key_id, public_key_b64: k.public_key_b64, not_before: "2025-01-01T00:00:00Z", not_after: "2026-01-01T00:00:00Z", status: "retired" };
const fixture = JSON.parse(await readFile(new URL("./fixtures/zenoh-local.json", import.meta.url), "utf8"));

test("H1: signed_at is inside the v2 signature; editing/removing it cannot revive an expired key", async () => {
  const att = signLocalPayload(payload, signing(k)); // signed now (after not_after)
  assert.equal(att.schema, "affix.local-signature.v2");
  const v = (a, keys = expired) => verifyLocalAttestation(payload, a, { trustedKeys: keys }).reason;
  assert.equal(v(att), "key_outside_validity_window");
  assert.equal(v({ ...att, signed_at: "2025-06-01T00:00:00Z" }), "invalid_signature");
  assert.equal(v({ ...att, signed_at: "garbage" }), "invalid_signed_at");
  assert.equal(v({ ...att, signed_at: undefined }), "invalid_signed_at");
  assert.equal(v(att, { ...expired, status: "revoked" }), "key_revoked");
  // genuinely signed inside the window still passes
  const inWindow = signLocalPayload(payload, signing(k, { signedAt: "2025-06-01T00:00:00Z" }));
  assert.equal(v(inWindow), "trusted_mldsa_signature");
  // no window -> plain pinned check
  assert.equal(v(att, { key_id: k.key_id, public_key_b64: k.public_key_b64 }), "trusted_mldsa_signature");
  // browser path agrees
  assert.equal((await verifyPublicEnvelope({ payload, attestation: { ...att, signed_at: "2025-06-01T00:00:00Z" } }, { trustedKeys: [expired], allowUnbound: true, rejectLegacyV1: false })).reason, "invalid_signature");
  assert.equal((await verifyPublicEnvelope({ payload, attestation: inWindow }, { trustedKeys: [expired], allowUnbound: true, rejectLegacyV1: false })).reason, "trusted_mldsa_signature");
  assert.equal((await verifyPublicEnvelope({ payload, attestation: att }, { trustedKeys: [expired], allowUnbound: true, rejectLegacyV1: false })).reason, "key_outside_validity_window");
  // offline path
  assert.match(verifyArtifactOffline({ proof: payload, attestation: { ...att, signed_at: "2025-06-01T00:00:00Z" }, trustedKeys: [expired], allowUnbound: true }).errors[0], /invalid_signature/);
});

test("H1: legacy v1 envelopes (unsigned signed_at) fail when a window applies unless allowLegacyUnsignedTime", async () => {
  const v1 = signLocalPayload(payload, signing(k, { legacyV1: true, signedAt: "2025-06-01T00:00:00Z" }));
  assert.equal(v1.schema, "affix.local-signature.v1");
  assert.equal(verifyLocalAttestation(payload, v1, { trustedKeys: expired, rejectLegacyV1: false }).reason, "unsigned_timestamp");
  assert.equal(verifyLocalAttestation(payload, { ...v1, signed_at: undefined }, { trustedKeys: expired, rejectLegacyV1: false }).reason, "unsigned_timestamp");
  assert.equal(verifyLocalAttestation(payload, v1, { trustedKeys: expired, allowLegacyUnsignedTime: true, rejectLegacyV1: false }).valid, true);
  assert.equal(verifyLocalAttestation(payload, v1, { trustedKeys: k.public_key_b64, rejectLegacyV1: false }).valid, true, "no window: v1 still verifies");
  assert.equal((await verifyPublicEnvelope({ payload, attestation: v1 }, { trustedKeys: [expired], allowUnbound: true, rejectLegacyV1: false })).reason, "unsigned_timestamp");
  // Articus's Zenoh beta.1 envelopes (v1) with an expired pin
  const c = fixture.commands[0];
  const att = { schema: "affix.local-signature.v1", algorithm: "HMAC-SHA256+ML-DSA-65", signed_at: "2025-06-01T00:00:00Z",
    payload_digest: createHash("sha256").update(c.envelope_canonical).digest("hex"), key_id: c.key_id, hmac_b64: "",
    mldsa_signature_b64: c.mldsa_sig_b64, mldsa_public_key_b64: fixture.signer.public_key_b64 };
  assert.equal(verifyLocalAttestation(JSON.parse(c.envelope_canonical), att, { trustedKeys: { ...fixture.signer, not_after: "2026-01-01T00:00:00Z" }, rejectLegacyV1: false }).reason, "unsigned_timestamp");
});

test("H1: verifyAffixioAttestation never uses the unsigned signed_at for key validity", async () => {
  clearAffixioKeyCache();
  const server = ml_dsa65.keygen(new Uint8Array(32).fill(3));
  const b64 = Buffer.from(server.publicKey).toString("base64");
  const p = { proof_id: "pf", valid: true };
  const digest = createHash("sha256").update(JSON.stringify(p)).digest("hex");
  const att = { signed_at: "2025-06-01T00:00:00Z", payload_digest: digest, algorithm: "ML-DSA-65",
    mldsa_signature_b64: Buffer.from(ml_dsa65.sign(server.secretKey, Buffer.from(digest, "hex"))).toString("base64") };
  const key = { key_id: "mldsa65-x", algorithm: "ML-DSA-65", public_key_b64: b64, status: "active", not_before: "2025-01-01T00:00:00Z" };
  assert.equal((await verifyAffixioAttestation(p, att, { kind: "verify", allowVkOnly: true, trustedKeys: [key] })).valid, true);
  const exp = { ...key, not_after: "2026-01-01T00:00:00Z", status: "retired" };
  assert.equal((await verifyAffixioAttestation(p, att, { kind: "verify", allowVkOnly: true, trustedKeys: [exp] })).reason, "unsigned_timestamp");
  assert.equal((await verifyAffixioAttestation(p, { ...att, signed_at: undefined }, { kind: "verify", allowVkOnly: true, trustedKeys: [exp] })).reason, "unsigned_timestamp");
  assert.equal((await verifyAffixioAttestation(p, att, { kind: "verify", allowVkOnly: true, trustedKeys: [exp], allowLegacyUnsignedTime: true })).valid, true);
  assert.equal((await verifyAffixioAttestation(p, att, { kind: "verify", allowVkOnly: true, trustedKeys: [{ ...key, status: "revoked" }] })).valid, false);
  assert.equal((await verifyAffixioAttestation(p, att, { kind: "verify", allowVkOnly: true, trustedKeys: [key], requireSignedTime: true })).reason, "unsigned_timestamp");
  assert.equal((await verifyAffixioAttestation(p, att, { kind: "verify", allowVkOnly: true, trustedKeys: [{ ...key, not_before: "2999-01-01T00:00:00Z" }] })).valid, false);
});

test("pin the key set offline: expectedKeySetHash / expectedKeyIds", async () => {
  clearAffixioKeyCache();
  const set = { schema: "affix.keys.v1", keys: [{ key_id: "mldsa65-a", algorithm: "ML-DSA-65", public_key_b64: k.public_key_b64, status: "active", not_before: null, not_after: null }] };
  const fetch = async () => ({ ok: true, json: async () => set });
  const h = computeKeySetHash(set);
  assert.equal((await fetchAffixioKeys({ fetch, expectedKeySetHash: h, force: true })).keys.length, 1);
  await assert.rejects(fetchAffixioKeys({ fetch, expectedKeySetHash: "00".repeat(32), force: true }), (e) => e.code === "affixio_keyset_pin_mismatch");
  await fetchAffixioKeys({ fetch, expectedKeyIds: ["mldsa65-a"], force: true });
  await fetchAffixioKeys({ fetch, expectedKeyIds: [publicKeyHash(k.public_key_b64)], force: true });
  await assert.rejects(fetchAffixioKeys({ fetch, expectedKeyIds: ["mldsa65-other"], force: true }), /missing pinned key/);
});

async function sdk(extra) {
  const dir = await mkdtemp(join(tmpdir(), "affix-b3-"));
  const s = new AffixSDK({ apiKey: "local_operator", apiBase: "http://127.0.0.1:9", hmacSecret: SECRET, operatorBaseDir: join(dir, ".affix"),
    licenceStatePath: join(dir, "l.json"), proofStorePath: join(dir, "p.json"), statsPath: join(dir, "s.json"), offlineQueuePath: join(dir, "q.json"),
    spendDir: join(dir, "spend"), silenceHmacWarning: true, ...extra });
  return { s, dir };
}

test("H2: trustOwnSigningKey:false is honoured; verifier roles neither trust nor create a local key", async () => {
  const { s: server } = await sdk({ signingKeys: k, trustOwnSigningKey: false });
  assert.deepEqual(server.trustedKeys(), []);
  const proof = lightProve({ circuit_id: "simple_yesno", inputs: normaliseWitnessInputs({ a: "0x1" }) }, SECRET, { decision: "yes" }).proof;
  const env = wrapProofEnvelope({ proof, circuit_id: "simple_yesno", decision: "yes" }, { hmacSecret: SECRET, signingKeys: k });
  await assert.rejects(server.verifyLocal("simple_yesno", proof, { envelope: env }), (e) => e.code === "no_trusted_keys");
  for (const role of ["device", "edge", "offline-verifier"]) {
    const { s, dir } = await sdk({ role });
    assert.deepEqual(s.trustedKeys(), [], role);
    assert.equal(existsSync(join(dir, ".affix", "secrets", "mldsa65.json")), false, `${role} must not create a key`);
    assert.throws(() => s.exportLocalPublicKey(), /no_local_signing_key/);
  }
  // explicit opt-in still works
  // 2.0.3 (F1): generated keys stay in memory unless persistSecrets: true (with an explicit operatorBaseDir).
  const { s: dev2, dir: d2 } = await sdk({ role: "device", generateSigningKey: true, trustOwnSigningKey: true });
  assert.equal(existsSync(join(d2, ".affix", "secrets", "mldsa65.json")), false);
  assert.equal(dev2.trustedKeys().length, 1);
  // device with a gateway pin verifies the gateway's envelope (ML-DSA only)
  const { s: dev3 } = await sdk({ role: "device", trustedSigningKeys: [k.public_key_b64] });
  assert.equal(dev3.trustedKeys()[0].public_key_b64, k.public_key_b64);
});

test("H3: verifyLocal valid requires envelope_ok whenever an envelope is supplied", async () => {
  const { s } = await sdk({ signingKeys: k });
  const proof = lightProve({ circuit_id: "simple_yesno", inputs: normaliseWitnessInputs({ a: "0x1" }) }, SECRET, { decision: "yes" }).proof;
  const forged = wrapProofEnvelope({ proof, decision: "yes" }, { hmacSecret: SECRET, signingKeys: evil });
  const r = await s.verifyLocal("simple_yesno", proof, { envelope: forged });
  assert.equal(r.proof_valid, true); assert.equal(r.envelope_ok, false);
  assert.equal(r.valid, false); assert.equal(r.verified, false); assert.equal(r.decision, "no");
  const good = wrapProofEnvelope({ proof, circuit_id: "simple_yesno", decision: "yes" }, { hmacSecret: SECRET, signingKeys: k });
  const ok = await s.verifyLocal("simple_yesno", proof, { envelope: good });
  assert.equal(ok.valid, true); assert.equal(ok.envelope_ok, true);
  assert.equal((await s.verifyLocal("simple_yesno", proof)).valid, true, "no envelope: proof alone");
});
