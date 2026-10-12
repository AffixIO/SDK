/* 2.0.3 (vk_only fix): decision in envelopes, kind:verify binding, sdk.verify server circuit fields. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa";
import { createHash, randomBytes } from "node:crypto";
import { AffixSDK, verifyAffixioAttestation, createLocalSigningKeyPair, clearAffixioKeyCache } from "../dist/index.js";

const kp = ml_dsa65.keygen(randomBytes(32));
const pub = Buffer.from(kp.publicKey).toString("base64");
const keySet = { schema: "affix.keys.v1", keys: [{ key_id: "k1", algorithm: "ML-DSA-65", public_key_b64: pub, status: "active", not_before: null, not_after: null }] };
const sign = (core) => { const d = createHash("sha256").update(JSON.stringify(core)).digest("hex"); return { payload_digest: d, algorithm: "ML-DSA-65", key_id: "k1", mldsa_signature_b64: Buffer.from(ml_dsa65.sign(kp.secretKey, Buffer.from(d, "hex"))).toString("base64") }; };
const base = { proof_id: "pf_1", valid: true, verified: true, decision: "yes", circuit_id: "attested_boolean", engine: "noir+barretenberg" };

test("kind verify rejects vk_only and pre-binding cores unless allowVkOnly", async () => {
  for (const core of [{ ...base, circuit_binding: "vk_only", bound_circuit_id: null }, base]) {
    assert.equal((await verifyAffixioAttestation(core, sign(core), { kind: "verify", trustedKeys: keySet })).reason, "circuit_not_bound");
    assert.equal((await verifyAffixioAttestation(core, sign(core), { kind: "verify", trustedKeys: keySet, allowVkOnly: true })).valid, true);
  }
  const bound = { ...base, circuit_binding: "unique_vk", bound_circuit_id: "attested_boolean" };
  assert.equal((await verifyAffixioAttestation(bound, sign(bound), { kind: "verify", trustedKeys: keySet })).valid, true);
  assert.equal((await verifyAffixioAttestation(bound, sign(bound), { kind: "verify", trustedKeys: keySet, expectedCircuitId: "simple_yesno" })).reason, "circuit_mismatch");
});

test("sdk.verify reports the server's circuit and binding, and rejects vk_only attestations", async () => {
  let core = { ...base, circuit_id: "simple_yesno", requested_circuit_id: "simple_yesno", bound_circuit_id: "simple_yesno", circuit_binding: "server_prove_record", vk_hash: "ab" };
  const srv = createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.startsWith("/v1/keys")) return res.end(JSON.stringify(keySet));
      if (req.url.includes("/verify")) { const sp = JSON.parse(JSON.stringify(core)); return res.end(JSON.stringify({ ...sp, signed_payload: sp, attestation: sign(sp), merkle_root: "r", unsigned: { merkle_root: "r" } })); }
      res.end(JSON.stringify({ status: "active", ok: true }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "afx-d-"));
  try {
    clearAffixioKeyCache();
    const sdk = new AffixSDK({ apiKey: "test-key-1234", apiBase: `http://127.0.0.1:${srv.address().port}`, licenceOnly: false, autoFlush: false, operatorBaseDir: dir, hmacSecret: "s".repeat(32), signingKeys: createLocalSigningKeyPair(), silenceHmacWarning: true, affixioKeys: keySet });
    const r = await sdk.verify("simple_yesno", "0x" + "11".repeat(64), true, { queueOnFailure: false });
    assert.equal(r.attestation_valid, true, r.attestation_reason);
    assert.equal(r.circuit_id, "simple_yesno"); assert.equal(r.circuit_binding, "server_prove_record");
    assert.deepEqual(r.signed_payload, core);
    core = { ...base, circuit_id: "simple_yesno", requested_circuit_id: "simple_yesno", bound_circuit_id: null, circuit_binding: "vk_only" };
    const v = await sdk.verify("simple_yesno", "0x" + "11".repeat(64), true, { queueOnFailure: false });
    assert.equal(v.attestation_valid, false); assert.equal(v.attestation_reason, "circuit_not_bound"); assert.equal(v.circuit_id, null);
    sdk.dispose?.();
  } finally { clearAffixioKeyCache(); srv.close(); rmSync(dir, { recursive: true, force: true }); }
});
