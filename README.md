# AffixIO SDK

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)
[![FIPS 204](https://img.shields.io/badge/FIPS%20204-ML--DSA-blue)](https://csrc.nist.gov/pubs/fips/204/final)
[![ZK](https://img.shields.io/badge/zero--knowledge-Noir%20%2B%20Barretenberg-8b5cf6)](https://noir-lang.org/)

Node.js SDK for **privacy-preserving zero-knowledge proofs** with **post-quantum attestation**. Prove eligibility, KYC outcomes, age checks, residency, and other predicates without exposing raw credentials. Verify proofs locally or via the AffixIO API.

Built for developers working with [Noir](https://noir-lang.org/) circuits, [Barretenberg](https://github.com/AztecProtocol/barretenberg) (UltraHonk), verifiable credentials, and [NIST post-quantum standards](https://csrc.nist.gov/projects/post-quantum-cryptography) ([FIPS 204 ML-DSA](https://csrc.nist.gov/pubs/fips/204/final)).

## Why AffixIO

Classical signatures (ECDSA, EdDSA, RSA) are vulnerable to future quantum attacks via Shor's algorithm. NIST finalised ML-KEM, ML-DSA, and SLH-DSA in 2024. AffixIO combines:

- **Zero-knowledge SNARK proving** over Noir attestation circuits (115+ templates)
- **ML-DSA-65 (FIPS 204)** signatures on proof payloads and credentials
- **Merkle audit anchoring** for tamper-evident proof history
- **Offline-first queue** for unreliable networks

You get prove, verify, storage, and a CLI without running a proving cluster locally.

## Install

```bash
npm install @affix-io/sdk
```

Or clone this repository (compiled `dist/` only):

```bash
git clone https://github.com/AffixIO/SDK.git
cd SDK
npm install
cp .env.example .env
```

Requires Node.js 18+.

## Quick start

```typescript
import { AffixSDK, defaultContext } from "@affix-io/sdk";

const sdk = new AffixSDK();

const result = await sdk.prove({
  circuitId: "attested_boolean",
  credential: {
    schema_id: "eligibility_v1",
    issuer_id: "issuer_abc",
    issuer_pubkey_hash: "0x...",
    credential_id: "0x...",
    claim_value: "approved",
    valid_from: 1700000000,
    valid_until: 1800000000,
  },
  context: defaultContext({ required_claim_hash: "approved" }),
});

console.log(result.valid, result.decision);
```

```bash
npx affix-sdk health
npx affix-sdk prove --circuit attested_boolean --claim approved
npx affix-sdk verify <proof-id>
```

## API key

A public-tier key ships in `.env.example` (6 requests/second per IP). Copy to `.env`:

```bash
cp .env.example .env
```

| Variable | Required | Default |
|---|---|---|
| `AFFIX_API_KEY` | Yes | Public tier key in `.env.example` |
| `AFFIX_API_BASE` | No | `https://api.affix-io.com` |

Commercial keys with higher throughput: [affix-io.com](https://affix-io.com).

## Prove input modes

`prove()` accepts one of three shapes.

### 1. Credential + context (recommended)

Credentials are normalised to BN254 field elements, witness-prepared server-side, then proved.

```typescript
await sdk.prove({ circuitId, credential, context });
```

### 2. Pre-built witness

Call `buildWitness()` (`POST /v1/witness/prepare`) then prove:

```typescript
const witness = await sdk.buildWitness(circuitId, credential, context);
await sdk.prove({ circuitId, witness });
```

### 3. Raw circuit fields

For Merkle batch proofs and custom Noir inputs:

```typescript
await sdk.prove({
  circuitId: "merkle_batch",
  fields: { leaf: "0x...", sibling0: "0x...", index: "0", expected_root: "0x..." },
});
```

## SDK methods

| Method | Description |
|---|---|
| `prove(input)` | Generate a zero-knowledge proof |
| `verify(circuitId, proof)` | Verify a proof string |
| `proveAndVerify(input)` | Prove then verify in one call |
| `buildWitness(...)` | Server-side witness preparation |
| `isOnline()` | API health check |
| `flushOfflineQueue()` | Replay queued prove jobs |
| `listQueuedJobs()` | Inspect offline queue |
| `listStoredProofs()` | Local proof store (last 500) |

## CLI

```bash
npx affix-sdk config
npx affix-sdk health
npx affix-sdk circuits
npx affix-sdk prove [--circuit <id>] [--claim <value>]
npx affix-sdk verify <proof-id-or-path> [--circuit <id>]
npx affix-sdk list
npx affix-sdk flush
```

## Post-quantum attestation

Proof responses can include **ML-DSA-65** attestations (FIPS 204, CRYSTALS-Dilithium family). Credentials carry `mldsa_signature_b64` for issuer binding. This aligns with the migration path described in [NIST IR 8547](https://csrc.nist.gov/pubs/ir/8547/final) toward quantum-resistant cryptography.

The proving backend uses Noir compiled to ACIR with Barretenberg UltraHonk, the same stack documented in the [Noir web app guide](https://noir-lang.org/docs/dev/guides/building_a_web_app).

## Circuit library

115+ attested Noir circuits including:

| Domain | Examples |
|---|---|
| Identity / KYC | `kyc`, `attested_boolean`, `attested_membership` |
| Age / health | `health_age`, `health_vaccination_status` |
| Residency / travel | `ticket_local_resident`, `travel_visa_eligibility` |
| Education | `edu_attendance_threshold`, `edu_enrollment_verification` |
| Merkle / audit | `merkle_batch`, `audit_proof`, `quantum_safe_token` |
| Governance | `govt_voting_eligibility`, `zk_voting` |

Run `npx affix-sdk circuits` for the full list from the live API.

## Offline queue

When `prove()` fails and `queueOnFailure` is not `false`:

1. **Witness or fields** bodies queue as-is for `flushOfflineQueue()`.
2. **Credential-based** queueing requires the private `@affix-io/sdk-witness` add-on (commercial).
3. Online witness prep always uses `POST /v1/witness/prepare`.

Local paths: `.affix/offline-queue.json`, `.affix/proofs.json`.

## API endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Service health |
| `GET /v1/circuits` | Circuit catalogue |
| `POST /v1/witness/prepare` | Witness preparation |
| `POST /v1/circuits/:id/prove` | SNARK proof generation |
| `POST /v1/circuits/:id/verify` | Proof verification |
| `GET /v1/merkle/root` | Audit Merkle root |
| `POST /v1/merkle/audit` | Anchor proof to audit log |

## Use cases

- **Privacy-preserving KYC**: prove eligibility without revealing PII
- **Age verification**: `health_age`, `ent_age_restriction`, `hosp_checkin_age`
- **Local residency / ticketing**: `ticket_local_resident`, `ticket_student_discount`
- **Verifiable credentials**: ML-DSA-signed claims with ZK predicates
- **Compliance audit trails**: Merkle-anchored proof history
- **Quantum-safe token validation**: `quantum_safe_token` circuit

## Related projects

- [noir-lang/noir](https://github.com/noir-lang/noir) — ZK domain-specific language
- [@aztec/bb.js](https://www.npmjs.com/package/@aztec/bb.js) — Barretenberg proving backend
- [@noble/post-quantum](https://www.npmjs.com/package/@noble/post-quantum) — ML-DSA / SLH-DSA primitives
- [NIST PQC standards](https://csrc.nist.gov/projects/post-quantum-cryptography) — FIPS 203, 204, 205

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Security

Report vulnerabilities via [SECURITY.md](SECURITY.md).

---

Maintained by [AffixIO](https://github.com/AffixIO). See [AUTHORS](AUTHORS).
