import { createLocalSigningKeyPair, signLocalPayload, verifyLocalAttestation } from "../../dist/index.js";

// This is deliberately deterministic so reviewers can reproduce the same public
// vector. The seed is synthetic and must never be reused in production.
const seedB64 = Buffer.alloc(32, 0x42).toString("base64");
const hmacSecret = "synthetic-interoperability-secret-not-for-production";
const signingKeys = createLocalSigningKeyPair(seedB64);
const payload = {
  action: "commons.post",
  agent: "agent://synthetic-example",
  decision: "allow",
  policy_version: "demo-policy-v1",
  resource: "https://example.invalid/rooms/demo",
};

const attestation = signLocalPayload(payload, {
  hmacSecret,
  secretKeyB64: signingKeys.secret_key_b64,
  publicKeyB64: signingKeys.public_key_b64,
  signedAt: "2026-01-01T00:00:00.000Z",
});

const result = verifyLocalAttestation(payload, attestation, {
  trustedKeys: [{
    key_id: signingKeys.key_id,
    public_key_b64: signingKeys.public_key_b64,
    algorithm: "ML-DSA-65",
  }],
  hmacSecret,
});

if (!result.valid) {
  throw new Error(`synthetic vector did not verify: ${result.reason}`);
}

// Never print the synthetic secret key or HMAC secret. The output is safe to
// attach to an interoperability issue or use as provider test input.
console.log(JSON.stringify({
  format: "affixio-local-attestation-vector-v2",
  payload,
  attestation: {
    ...attestation,
    mldsa_public_key_b64: signingKeys.public_key_b64,
  },
  expected: {
    valid: true,
    algorithm: "ML-DSA-65",
    key_id: signingKeys.key_id,
    signature_verified: true,
  },
}, null, 2));
