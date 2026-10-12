// 2.0.2 regressions: B17 (decision binding when the envelope omits decision) and the v1 default for server roles.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AffixSDK, createLocalSigningKeyPair, signLocalPayload, wrapProofEnvelope, lightProve, checkEnvelopeBinding } from "../dist/index.js";
import { verifyPublicEnvelope as browserVerify } from "../dist/runtime/browser.js";
import { verifyArtifactOffline } from "../dist/extensions/index.js";
import { normaliseWitnessInputs } from "../dist/witness.js";

const SECRET = "regression-test-shared-secret-0123";
const k = createLocalSigningKeyPair();
const pin = [{ key_id: k.key_id, public_key_b64: k.public_key_b64 }];
const prove = (a, decision = "yes") => lightProve({ circuit_id: "simple_yesno", inputs: normaliseWitnessInputs({ a }) }, SECRET, { decision });
const env = (payload) => wrapProofEnvelope(payload, { hmacSecret: SECRET, signingKeys: k });
async function sdk(extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), "affix-202-"));
  return new AffixSDK({ apiKey: "local_operator", apiBase: "http://127.0.0.1:9", hmacSecret: SECRET, signingKeys: k, operatorBaseDir: join(dir, ".affix"),
    licenceStatePath: join(dir, "l.json"), proofStorePath: join(dir, "p.json"), statsPath: join(dir, "s.json"), offlineQueuePath: join(dir, "q.json"),
    spendDir: join(dir, "spend"), silenceHmacWarning: true, ...extra });
}

test("B17: verifyLocal rejects an envelope that drops the decision (re-signed)", async () => {
  const s = await sdk();
  const A = prove("0x1", "yes");
  const r = await s.verifyLocal("simple_yesno", A.proof, { envelope: env({ proof: A.proof, circuit_id: "simple_yesno", proof_mode: "hmac" }) });
  assert.equal(r.valid, false); assert.equal(r.envelope_ok, false); assert.equal(r.envelope_reason, "envelope_decision_missing");
  const ok = await s.verifyLocal("simple_yesno", A.proof, { envelope: env({ proof: A.proof, circuit_id: "simple_yesno", proof_mode: "hmac", decision: A.decision ?? "yes" }) });
  assert.equal(ok.envelope_ok, true, ok.envelope_reason); assert.equal(ok.valid, true);
  const opt = await s.verifyLocal("simple_yesno", A.proof, { allowMissingDecision: true, envelope: env({ proof: A.proof, circuit_id: "simple_yesno" }) });
  assert.equal(opt.envelope_ok, true);
  s.dispose?.();
});

test("B17: prove() envelopes from 2.0.x carry the decision and still verify", async () => {
  const s = await sdk();
  const out = await s.prove({ circuitId: "simple_yesno", proofMode: "hmac", mode: "offline", decision: "yes", fields: { a: "0x1" } }).catch(e => ({ err: e.message }));
  if (out.err) { assert.ok(/licen|offline|quota/i.test(out.err), out.err); s.dispose?.(); return; } // licence-gated hosts: covered by verifyLocal test above
  assert.equal(typeof out.envelope.payload.decision, "string");
  const r = await s.verifyLocal("simple_yesno", out.proof_hex ?? out.proof, { envelope: out.envelope });
  assert.equal(r.envelope_ok, true, r.envelope_reason);
  s.dispose?.();
});

test("B17: standalone verifiers fail with envelope_decision_missing when a decision is expected", async () => {
  const A = prove("0x1").proof;
  const e = env({ proof: A, circuit_id: "simple_yesno" });
  assert.equal(checkEnvelopeBinding(e.payload, { proof: A, circuitId: "simple_yesno", decision: "yes" }).reason, "envelope_decision_missing");
  assert.equal(checkEnvelopeBinding(e.payload, { proof: A, circuitId: "simple_yesno" }).bound, true, "no expected decision: unchanged");
  assert.equal(checkEnvelopeBinding(e.payload, { proof: A, circuitId: "simple_yesno", decision: "yes", allowMissingDecision: true }).bound, true);
  const ne = env({ proof: A, circuit_id: "simple_yesno", decision: ["yes"] });
  assert.equal(checkEnvelopeBinding(ne.payload, { proof: A, circuitId: "simple_yesno" }).reason, "envelope_decision_mismatch");
  const b = await browserVerify(e, { trustedKeys: pin, proof: A, circuitId: "simple_yesno", decision: "yes" });
  assert.equal(b.valid, false); assert.equal(b.reason, "envelope_decision_missing");
  const b2 = await browserVerify(env({ proof: A, circuit_id: "simple_yesno", decision: "yes" }), { trustedKeys: pin, proof: A, circuitId: "simple_yesno", decision: "yes" });
  assert.equal(b2.valid, true);
  const o = verifyArtifactOffline({ proof: e.payload, attestation: e.attestation, trustedKeys: pin, proofHex: A, circuitId: "simple_yesno", decision: "yes" });
  assert.equal(o.ok, false); assert.match(o.errors.join(), /envelope_decision_missing/);
});

test("v1 default: server and trusted-party roles reject legacy v1 unless rejectLegacyV1:false", async () => {
  const A = prove("0x1");
  const payload = { proof: A.proof, circuit_id: "simple_yesno", decision: A.decision ?? "yes" };
  const legacy = { payload, attestation: signLocalPayload(payload, { hmacSecret: SECRET, secretKeyB64: k.secret_key_b64, publicKeyB64: k.public_key_b64, legacyV1: true }) };
  for (const role of ["server", "trusted-party"]) {
    const s = await sdk({ role });
    assert.equal(s.verifyLocalAttestation(payload, legacy.attestation).reason, "legacy_v1_rejected", role);
    const r = await s.verifyLocal("simple_yesno", A.proof, { envelope: legacy });
    assert.equal(r.envelope_ok, false, role); assert.equal(r.envelope_reason, "legacy_v1_rejected");
    const optIn = await sdk({ role, rejectLegacyV1: false });
    assert.equal(optIn.verifyLocalAttestation(payload, legacy.attestation).valid, true, role + " opt-in");
    assert.equal((await optIn.verifyLocal("simple_yesno", A.proof, { envelope: legacy })).envelope_ok, true);
    s.dispose?.(); optIn.dispose?.();
  }
});
