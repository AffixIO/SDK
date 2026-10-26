# Evidence and assurance guide

This document explains what the AffixIO SDK can prove, what it records, and what it does not claim. It is intended for technical reviewers evaluating a proof-before-action integration.

## Scope

The SDK is a local-first Node.js library for checking a defined condition or policy before a host performs an action. A gate returns an allow, deny, or review decision. The host remains responsible for enforcing the result: if the decision is not allowed, the host must not call the protected tool.

AffixIO is not a compliance certification, an identity provider, a source-of-truth oracle, or a guarantee that an agent is safe. A valid signature proves that the signed payload was produced by a trusted signing key and was not altered. It does not prove that external source material is true or that a policy was correctly chosen.

## Decision lifecycle

```text
request action
  -> construct the exact policy input
  -> evaluate the local gate
  -> create a proof and signed envelope
  -> verify the proof, binding and trusted key
  -> execute only when the result is allow
  -> retain the receipt, digest and audit reference
```

The protected operation must be below the gate in the call path. A receipt created after the side effect is evidence of an event, not prevention of the event.

## Evidence carried by a decision

Depending on the integration, a receipt can include the proof identifier, decision, reason code, policy binding, content digest, signing algorithm, key identifier, signing time, and Merkle-audit information. Keep the receipt with the host's application log or transaction record.

The SDK's local signing path uses ML-DSA-65 for the envelope when the deployment has that entitlement. HMAC is the default proof mode and is not zero-knowledge. UltraHonk is the optional zero-knowledge path for the bundled circuits. The signature algorithm and proof mode must be reported separately.

## Threat boundaries

| Threat or failure | SDK behaviour or required host control |
| --- | --- |
| Tampered proof or envelope | Verification fails closed. Do not execute the action. |
| Replay of a one-time decision | Use the replay guard or spend journal and treat a double-spend result as a denial. |
| Wrong action or policy | Bind the proof to the exact action, resource, decision and policy fingerprint before execution. |
| Untrusted verifier | Use a pinned ML-DSA public key. Do not trust a key carried only inside an untrusted envelope. |
| HMAC verifier can forge | Use HMAC only between trusted parties. Devices and independent verifiers should use a pinned ML-DSA envelope or an independently verifiable proof. |
| Network outage | Local-only mode can continue for local proof and verification. Remote attestation and Merkle anchoring require the configured API path. |
| Key compromise | Revoke or replace the affected deployment key through the host's operational key-management process. Historical evidence must be evaluated against its signing time and the known compromise boundary. The SDK does not claim to provide an independent recovery authority. |
| Policy change | Version the policy and retain the policy fingerprint with each decision. Re-evaluate existing evidence when policy semantics change. |
| Source data is false | The SDK does not independently establish the truth of a host's input data. The source system remains accountable for that claim. |

## Review checklist

Before approving an integration, a reviewer should be able to answer yes to these questions:

1. Is the gate executed before the side effect?
2. Is the action, resource, agent or session, and policy version included in the signed input?
3. Does the host fail closed on a missing, invalid, expired, revoked, or mismatched result?
4. Are proof identifiers, request identifiers, reason codes, digests, and timestamps retained without unnecessary personal data?
5. Is replay protection enabled for every operation that can spend, publish, change state, or trigger an external call?
6. Are the verifier's public keys pinned or obtained from an authenticated, expected key set?
7. Are HMAC and zero-knowledge claims stated accurately?
8. Can an operator rotate or revoke the deployment signing material without treating the old key as trusted for new actions?
9. Are recovery, delegation, and policy changes tested as separate failure cases?
10. Are unsupported compliance, identity, safety, and certification claims excluded from the deployment documentation?

## Reproducible local check

The repository's examples and tests run without an external API key:

```bash
npm ci
npm run build
npm test
```

For a minimal gate demonstration, see [`examples/hello/hello.mjs`](../examples/hello/hello.mjs) and the framework adapters under [`examples/gate/`](../examples/gate/). Run the example with networking disabled when reviewing local-only behaviour. Use a persistent, protected signing configuration for any evidence that must remain verifiable after process restart.

## Interoperability notes

The envelope and verification key formats should be treated as versioned interfaces. A provider or HSM integration should document:

- the OpenSSL or provider version;
- ML-DSA-65 public-key and signature encoding;
- canonical payload and domain-separation rules;
- signing-time and key-identifier handling;
- failure behaviour for malformed, expired, revoked, or replayed evidence; and
- whether verification is local, remotely attested, or both.

An interoperability test should use synthetic data and publish the expected digest, public key, signature, and verification result. It must not contain production keys, customer records, API credentials, or private prompts.

The repository includes a deterministic synthetic fixture at [`examples/interoperability/`](../examples/interoperability/). It prints only public test material and verifies the generated vector before output. The fixture is for signature interoperability, not a certification or a complete policy-security assessment.

## Current limitations

This guide deliberately does not claim that AffixIO provides government certification, FIPS 140-3 validation, a complete external key-recovery authority, or truth about the data supplied by a host. Those are separate assurance questions and require independent review.
