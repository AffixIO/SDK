// 2.0.3 (attest-kind): verifyAffixioAttestation must not accept a validly signed object of one kind
// as another. Proof attestations need domain affixio.attest.verified-proof.v1 + server_verified:true.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { verifyAffixioAttestation, signedVerifyPayload, VERIFIED_PROOF_DOMAIN, CLIENT_PAYLOAD_DOMAIN } from "../dist/index.js";

const pair = ml_dsa65.keygen(randomBytes(32));
const keySet = { keys: [{ key_id: "mldsa65-test", algorithm: "ML-DSA-65", use: "affixio-attestation", public_key_b64: Buffer.from(pair.publicKey).toString("base64"), status: "active" }] };
const sign = (core) => {
  const digest = createHash("sha256").update(JSON.stringify(core)).digest("hex");
  return { payload_digest: digest, mldsa_signature_b64: Buffer.from(ml_dsa65.sign(pair.secretKey, Buffer.from(digest, "hex"))).toString("base64"), algorithm: "ML-DSA-65", key_id: "mldsa65-test" };
};
const proofCore = { domain: VERIFIED_PROOF_DOMAIN, server_verified: true, valid: true, verified: true, decision: "yes", circuit_id: "simple_yesno", circuit_binding: "server_prove_record", proof_digest: "ab".repeat(32), spent: false };
const verifyCore = { proof_id: "pf_1", valid: true, verified: true, decision: "yes", circuit_id: "simple_yesno", engine: "noir+barretenberg", circuit_binding: "server_prove_record", bound_circuit_id: "simple_yesno" };

test("kind proof (default) accepts a verified-proof.v1 core with server_verified:true", async () => {
  const r = await verifyAffixioAttestation(proofCore, sign(proofCore), { trustedKeys: keySet });
  assert.equal(r.valid, true, r.reason);
  assert.equal((await verifyAffixioAttestation(proofCore, sign(proofCore), { trustedKeys: keySet, kind: "proof", expectedCircuitId: "simple_yesno" })).valid, true);
});

test("kind proof rejects a signed verify core, a missing domain, and server_verified !== true", async () => {
  assert.equal((await verifyAffixioAttestation(verifyCore, sign(verifyCore), { trustedKeys: keySet })).reason, "not_verified_proof_attestation");
  const noSv = { ...proofCore, server_verified: false };
  assert.equal((await verifyAffixioAttestation(noSv, sign(noSv), { trustedKeys: keySet })).reason, "not_server_verified");
  const svString = { ...proofCore, server_verified: "true" };
  assert.equal((await verifyAffixioAttestation(svString, sign(svString), { trustedKeys: keySet })).reason, "not_server_verified");
  const otherDomain = { ...proofCore, domain: "affixio.attest.verified-proof.v2" };
  assert.equal((await verifyAffixioAttestation(otherDomain, sign(otherDomain), { trustedKeys: keySet })).valid, false);
});

test("kind proof rejects client-payload (/api/attest) signatures, wrapped or bare", async () => {
  const wrapped = { domain: CLIENT_PAYLOAD_DOMAIN, server_verified: false, signed_at: "2026-10-11T00:00:00Z", payload: proofCore };
  assert.equal((await verifyAffixioAttestation(wrapped, sign(wrapped), { trustedKeys: keySet })).reason, "client_payload_not_proof");
  // even an (old-style raw) signature over a payload that names the proof domain must still check the signature
  const forged = { ...proofCore };
  const att = sign({ ...proofCore, circuit_id: "attested_boolean" });
  assert.equal((await verifyAffixioAttestation(forged, att, { trustedKeys: keySet })).reason, "digest_mismatch");
});

test("kind proof rejects pre-binding cores (no or unknown circuit_binding)", async () => {
  const { circuit_binding, ...old } = proofCore;
  assert.equal((await verifyAffixioAttestation(old, sign(old), { trustedKeys: keySet })).reason, "circuit_not_bound");
  const vkOnly = { ...proofCore, circuit_binding: "vk_only" };
  assert.equal((await verifyAffixioAttestation(vkOnly, sign(vkOnly), { trustedKeys: keySet })).reason, "circuit_not_bound");
});

test("expectedCircuitId binds the attestation to the circuit the relying party wanted", async () => {
  const r = await verifyAffixioAttestation(proofCore, sign(proofCore), { trustedKeys: keySet, expectedCircuitId: "attested_boolean" });
  assert.equal(r.valid, false); assert.equal(r.reason, "circuit_mismatch");
  assert.equal((await verifyAffixioAttestation(verifyCore, sign(verifyCore), { trustedKeys: keySet, kind: "verify", expectedCircuitId: "attested_boolean" })).reason, "circuit_mismatch");
});

test("kind verify / prove keep existing flows working, but refuse domain-carrying payloads", async () => {
  assert.equal((await verifyAffixioAttestation(verifyCore, sign(verifyCore), { trustedKeys: keySet, kind: "verify" })).valid, true);
  assert.equal((await verifyAffixioAttestation(verifyCore, sign(verifyCore), { trustedKeys: keySet, kind: "prove" })).valid, true);
  assert.equal((await verifyAffixioAttestation(proofCore, sign(proofCore), { trustedKeys: keySet, kind: "verify" })).reason, "unexpected_domain");
  const wrapped = { domain: CLIENT_PAYLOAD_DOMAIN, server_verified: false, payload: verifyCore };
  assert.equal((await verifyAffixioAttestation(wrapped, sign(wrapped), { trustedKeys: keySet, kind: "verify" })).reason, "client_payload_not_proof");
  assert.equal((await verifyAffixioAttestation(verifyCore, sign(verifyCore), { trustedKeys: keySet, kind: "any" })).valid, true);
  assert.equal((await verifyAffixioAttestation(verifyCore, sign(verifyCore), { trustedKeys: keySet, kind: "bogus" })).reason, "unknown_attestation_kind");
});

test("signedVerifyPayload returns the server's exact signed_payload when present (/prove)", async () => {
  const core = { proof_id: "pf_2", valid: true, merkle_root: "r", merkle_index: 3 };
  const resp = { ...core, signed_payload: core, attestation: sign(core) };
  assert.deepEqual(signedVerifyPayload(resp), core);
  assert.equal((await verifyAffixioAttestation(signedVerifyPayload(resp), resp.attestation, { trustedKeys: keySet, kind: "prove" })).valid, true);
  // without signed_payload the old rule (strip attestation + merkle fields) still applies
  assert.deepEqual(Object.keys(signedVerifyPayload({ a: 1, attestation: {}, merkle_root: "x", b: 2 })), ["a", "b"]);
});
