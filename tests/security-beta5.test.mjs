// 2.0.0-beta.5 regressions for Articus's beta.4 findings (/workspace/zenoh-affixio/beta4-test/attacks4.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AffixSDK, createLocalSigningKeyPair, signLocalPayload, verifyLocalAttestation, verifyProofEnvelope, wrapProofEnvelope, lightProve, checkEnvelopeBinding } from "../dist/index.js";
import { verifyPublicEnvelope } from "../dist/runtime/index.js";
import { verifyPublicEnvelope as browserVerify } from "../dist/runtime/browser.js";
import { verifyArtifactOffline } from "../dist/extensions/index.js";
import { normaliseWitnessInputs } from "../dist/witness.js";
import { proofDigest } from "../dist/local-prove.js";

const SECRET = "regression-test-shared-secret-0123";
const k = createLocalSigningKeyPair();
const pin = [{ key_id: k.key_id, public_key_b64: k.public_key_b64 }];
const prove = (a, decision = "yes") => lightProve({ circuit_id: "simple_yesno", inputs: normaliseWitnessInputs({ a }) }, SECRET, { decision });
const env = (payload) => wrapProofEnvelope(payload, { hmacSecret: SECRET, signingKeys: k });
async function sdk(extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), "affix-b5-"));
  return new AffixSDK({ apiKey: "local_operator", apiBase: "http://127.0.0.1:9", hmacSecret: SECRET, signingKeys: k, operatorBaseDir: join(dir, ".affix"),
    licenceStatePath: join(dir, "l.json"), proofStorePath: join(dir, "p.json"), statsPath: join(dir, "s.json"), offlineQueuePath: join(dir, "q.json"),
    spendDir: join(dir, "spend"), silenceHmacWarning: true, ...extra });
}

test("1: offline verify requires binding; allowUnbound marks result unbound (O3)", () => {
  const A = prove("0x1").proof;
  const e = env({ proof: A, circuit_id: "simple_yesno" });
  const none = verifyArtifactOffline({ proof: e.payload, attestation: e.attestation, trustedKeys: pin });
  assert.equal(none.ok, false); assert.equal(none.binding, "missing"); assert.equal(none.bound, false);
  assert.match(none.errors.join(), /binding_required/);
  const skipped = verifyArtifactOffline({ proof: e.payload, attestation: e.attestation, trustedKeys: pin, allowUnbound: true });
  assert.equal(skipped.ok, true); assert.equal(skipped.binding, "skipped"); assert.equal(skipped.unbound, true); assert.equal(skipped.bound, false);
  const checked = verifyArtifactOffline({ proof: e.payload, attestation: e.attestation, trustedKeys: pin, proofHex: A, circuitId: "simple_yesno" });
  assert.equal(checked.ok, true); assert.equal(checked.binding, "checked"); assert.equal(checked.bound, true);
});

test("1: browser/workflows verifyPublicEnvelope requires binding (P3)", async () => {
  const A = prove("0x1").proof;
  const e = env({ proof: A, circuit_id: "simple_yesno" });
  for (const verify of [verifyPublicEnvelope, browserVerify]) {
    const none = await verify(e, { trustedKeys: pin });
    assert.equal(none.valid, false); assert.equal(none.reason, "binding_required"); assert.equal(none.binding, "missing");
    assert.equal((await verify(e, { trustedKeys: pin, proof: A })).reason, "binding_needs_circuit");
    const skipped = await verify(e, { trustedKeys: pin, allowUnbound: true });
    assert.equal(skipped.valid, true); assert.equal(skipped.unbound, true); assert.equal(skipped.binding, "skipped"); assert.equal(skipped.bound, false);
    const ok = await verify(e, { trustedKeys: pin, proof: A, circuitId: "simple_yesno" });
    assert.equal(ok.valid, true); assert.equal(ok.bound, true); assert.equal(ok.binding, "checked");
  }
});

test("2: standalone verifyLocalAttestation rejects v1 by default; SDK instance inherits role default", async () => {
  const p = { proof_id: "x" };
  const v1 = signLocalPayload(p, { hmacSecret: SECRET, secretKeyB64: k.secret_key_b64, publicKeyB64: k.public_key_b64, legacyV1: true });
  assert.equal(verifyLocalAttestation(p, v1, { trustedKeys: pin }).reason, "legacy_v1_rejected");
  assert.equal(verifyLocalAttestation(p, v1, { trustedKeys: pin, rejectLegacyV1: false }).valid, true);
  assert.equal(verifyProofEnvelope({ payload: p, attestation: v1 }, { trustedKeys: pin }), false);
  assert.equal((await verifyPublicEnvelope({ payload: p, attestation: v1 }, { trustedKeys: pin, allowUnbound: true })).reason, "legacy_v1_rejected");
  assert.match(verifyArtifactOffline({ proof: p, attestation: v1, trustedKeys: pin, allowUnbound: true }).errors.join(), /legacy_v1_rejected/);
  const device = await sdk({ role: "device", signingKeys: undefined, trustedSigningKeys: pin });
  assert.equal(device.verifyLocalAttestation(p, v1).reason, "legacy_v1_rejected");
  assert.equal(device.verifyLocalAttestation(p, signLocalPayload(p, { hmacSecret: SECRET, secretKeyB64: k.secret_key_b64, publicKeyB64: k.public_key_b64 })).valid, true);
  const server = await sdk();
  assert.equal(server.verifyLocalAttestation(p, v1).reason, "legacy_v1_rejected", "2.0.2: server role default rejects v1");
  assert.equal((await sdk({ rejectLegacyV1: false })).verifyLocalAttestation(p, v1).valid, true, "server opt-in accepts v1");
  assert.equal(server.verifyLocalAttestation(p, v1, { rejectLegacyV1: true }).reason, "legacy_v1_rejected");
});

test("3: decision is bound (B14) and proof + proof_digest must both match (B7)", async () => {
  const s = await sdk();
  const yes = prove("0x1", "yes");
  assert.equal(yes.decision ?? "yes", "yes");
  const noEnv = env({ proof: yes.proof, circuit_id: "simple_yesno", decision: "no" });
  const r = await s.verifyLocal("simple_yesno", yes.proof, { envelope: noEnv });
  assert.equal(r.valid, false); assert.equal(r.envelope_reason, "envelope_decision_mismatch");
  const B = prove("0x2").proof;
  const mixed = env({ proof: yes.proof, proof_digest: proofDigest(B, "simple_yesno", true), circuit_id: "simple_yesno" });
  assert.equal((await s.verifyLocal("simple_yesno", yes.proof, { envelope: mixed })).envelope_reason, "envelope_proof_digest_mismatch");
  const both = env({ proof: yes.proof, proof_digest: proofDigest(yes.proof, "simple_yesno", true), circuit_id: "simple_yesno", decision: "yes" });
  assert.equal((await s.verifyLocal("simple_yesno", yes.proof, { envelope: both })).valid, true);
  assert.equal(checkEnvelopeBinding({ proof: "aa", circuit_id: "c", decision: "no" }, { proof: "aa", circuitId: "c", decision: "yes" }).reason, "envelope_decision_mismatch");
  assert.equal((await verifyPublicEnvelope(noEnv, { trustedKeys: pin, proof: yes.proof, circuitId: "simple_yesno", decision: "yes" })).reason, "envelope_decision_mismatch");
  assert.equal((await verifyPublicEnvelope(mixed, { trustedKeys: pin, proof: yes.proof, circuitId: "simple_yesno" })).reason, "envelope_proof_digest_mismatch");
  assert.match(verifyArtifactOffline({ proof: noEnv.payload, attestation: noEnv.attestation, trustedKeys: pin, proofHex: yes.proof, circuitId: "simple_yesno", decision: "yes" }).errors.join(), /envelope_decision_mismatch/);
});

test("3b: non-string proof field never falls through to the digest path (attacks4 B13)", async () => {
  const s = await sdk();
  const A = prove("0x1").proof;
  const arr = env({ proof: [A], proof_digest: proofDigest(A, "simple_yesno", true), circuit_id: "simple_yesno" });
  assert.equal((await s.verifyLocal("simple_yesno", A, { envelope: arr })).envelope_reason, "envelope_proof_mismatch");
  assert.equal((await verifyPublicEnvelope(arr, { trustedKeys: pin, proof: A, circuitId: "simple_yesno" })).reason, "envelope_proof_mismatch");
});
