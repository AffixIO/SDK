# ML-DSA-65 interoperability vector

This example produces a deterministic, synthetic AffixIO local-attestation vector. It is suitable for testing a verifier or provider integration such as OpenSSL or Luna. It contains no production key, customer data, API credential, or private prompt.

## Generate and verify

From the repository root, after installing dependencies:

```bash
npm ci
node examples/interoperability/mldsa65-vector.mjs > /tmp/affixio-mldsa65-vector.json
```

The script verifies the vector with the pinned public ML-DSA-65 key before printing it. The output includes:

- the canonical test payload;
- the v2 signed timestamp and key identifier;
- the ML-DSA-65 public key and signature;
- the expected verification result.

The synthetic seed and HMAC secret are intentionally not printed. A provider-level test should verify the ML-DSA signature over the SDK's v2 signature message, not over an ad-hoc JSON serialization. The exact domain-separated message is exposed by `localSignatureMessage()` and is covered by the SDK tests.

## Provider test boundary

This fixture tests signature interoperability only. It does not claim that a provider has validated the policy, the external source data, or the safety of the requested action. A complete integration should separately test malformed payloads, altered timestamps, wrong key identifiers, unknown keys, expired or revoked keys, replayed decisions, and a changed policy fingerprint.

The seed is fixed only for reproducibility. It must never be used outside this test.
