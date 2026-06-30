# AffixIO SDK

[![npm](https://img.shields.io/npm/v/@affix-io/sdk)](https://www.npmjs.com/package/@affix-io/sdk)
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

## Get the SDK

| Source | Best for |
|---|---|
| **[npm](https://www.npmjs.com/package/@affix-io/sdk)** `@affix-io/sdk` | Production apps, CI, Docker images, `package.json` dependencies |
| **[GitHub](https://github.com/AffixIO/SDK)** `AffixIO/SDK` | Source review, Apache 2.0 audit, pinning a commit, air-gapped installs from tarball |

**npm** is what most teams use day to day. Install once, import in code, ship with your service:

```bash
npm install @affix-io/sdk
```

**GitHub** is the same compiled package (pre-built `dist/`, no TypeScript source in the public tree). Clone when you need to inspect exactly what ships, vendor the repo, or run the CLI without adding a registry dependency:

```bash
git clone https://github.com/AffixIO/SDK.git
cd SDK
cp .env.example .env
npx affix-sdk health
```

Neither path runs `npm install` per proof. Both give you a library you call at runtime.

## Where it fits in your stack

The SDK is a Node.js client. Proving and verification run on the AffixIO API; your app sends credentials or witnesses and receives proof strings back.

```
Your service                    AffixIO API
┌─────────────────┐            ┌──────────────────────┐
│ Express / Fastify│  HTTPS    │ witness/prepare      │
│ Next.js API route│ ────────► │ circuits/:id/prove   │
│ BullMQ worker    │           │ circuits/:id/verify  │
│ LangChain tool   │           │ merkle/audit         │
│ MCP server       │           └──────────────────────┘
│ Cron / batch job │
└────────┬─────────┘
         │ optional local
         ▼
   .affix/proofs.json
   .affix/offline-queue.json
```

Typical integration points:

- **API middleware**: prove a predicate before a sensitive route runs (payout, account change, data export).
- **Background workers**: batch eligibility checks; `flushOfflineQueue()` when connectivity returns.
- **LLM orchestration**: gate tool calls, model tiers, or retrieval scopes with a proof instead of passing raw KYC or HR data into the prompt.
- **Agent and MCP servers**: return a `proof_id` alongside tool results so downstream systems can verify without seeing credentials.
- **Webhooks and event pipelines**: attach a proof digest to an audit log entry via Merkle anchoring.

Install the package in the service that holds secrets and talks to AffixIO. Do not embed API keys in browser bundles or client-side LLM prompts.

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

### AI, LLMs, and agents

Large language models should not receive passports, medical records, or full KYC payloads just to answer "is this user allowed?". The SDK lets a **trusted backend** prove a yes/no predicate and hand the model (or tool runtime) only the outcome.

| Scenario | Circuit examples | What you prove without exposing |
|---|---|---|
| Tool gating before expensive calls | `attested_boolean`, `kyc`, `govt_security_clearance` | User tier, account standing, or clearance level |
| RAG and document access | `attested_membership`, `govt_professional_license`, `edu_enrollment_verification` | Group membership or role without employee/student IDs |
| Age and consent checks for restricted advice | `health_age`, `ent_age_restriction`, `hosp_checkin_age` | Age threshold met, not date of birth |
| Healthcare-adjacent assistants | `health_consent_verification`, `health_prescription_auth`, `health_clinical_trial_eligibility` | Consent or trial eligibility, not PHI |
| Cross-border or policy-bound models | `travel_visa_eligibility`, `travel_restriction_check`, `govt_immigration_status` | Eligibility flag, not passport number |
| Agent audit trail | `audit_proof`, `merkle_batch` | That a decision was proved at a point in time |

Example pattern for an LLM tool router:

```typescript
import { AffixSDK, defaultContext } from "@affix-io/sdk";

const sdk = new AffixSDK();

export async function beforeToolRun(userCredential: Record<string, unknown>) {
  const { valid, proof_id } = await sdk.prove({
    circuitId: "govt_security_clearance",
    credential: userCredential,
    context: defaultContext({ required_claim_hash: "cleared" }),
  });
  if (!valid) throw new Error("tool_access_denied");
  return proof_id; // pass to logs or Merkle audit, not to the model context
}
```

The model sees tool output. It does not need the credential or the witness.

### Identity, KYC, and compliance

- **Onboarding**: `kyc`, `attested_boolean`, `consent_verification`
- **PEP and sanctions-style gates**: `govt_criminal_record`, `cross_data_consent`
- **Professional and licence checks**: `govt_professional_license`, `hosp_agent_credentials`

### Fintech and lending

- **Credit and income bands**: `cross_credit_score_range`, `cross_income_bracket`, `govt_tax_bracket`
- **Mortgage and motor finance**: `mortgage_engine`, `motor_finance_eligibility`, `motor_ownership_verification`
- **Insurance validity**: `motor_insurance_proof`, `travel_insurance_coverage`

### Health and life sciences

- **Age-gated services**: `health_age`, `health_age_verification`
- **Vaccination and trial eligibility**: `health_vaccination_status`, `health_clinical_trial_eligibility`
- **Prescription and insurance predicates**: `health_prescription_auth`, `health_insurance_eligibility`

### Travel, hospitality, and ticketing

- **Residency and local rates**: `ticket_local_resident`, `travel_residency_proof`, `hosp_longstay_resident`
- **Passport and visa windows**: `travel_passport_validity`, `travel_visa_eligibility`
- **Venue access**: `ticket_student_discount`, `ticket_vip_access`, `ticket_disability_access`

### Education and workforce

- **Admissions and attendance**: `edu_age_admission`, `edu_attendance_threshold`, `edu_prerequisites_met`
- **Alumni and library access**: `edu_alumni_status`, `edu_library_access`
- **Employment proofs**: `cross_employment_status`, `edu_degree_completion`

### Government and civic

- **Voting and benefits**: `govt_voting_eligibility`, `govt_benefit_entitlement`, `zk_voting`
- **Residency duration and property**: `govt_residency_duration`, `govt_property_ownership`
- **Military and immigration**: `govt_military_service`, `govt_immigration_status`

### Security, tokens, and audit

- **Post-quantum token checks**: `quantum_safe_token`, `token_validation`
- **Tamper-evident history**: `audit_proof`, `merkle_batch`
- **Offline and edge**: queue failed `prove()` calls, replay with `flushOfflineQueue()` when the API is reachable again

Run `npx affix-sdk circuits` for the live catalogue (115+ templates). Circuit IDs map to Noir attestation templates on the API.

## Related projects

- [noir-lang/noir](https://github.com/noir-lang/noir): ZK domain-specific language
- [@aztec/bb.js](https://www.npmjs.com/package/@aztec/bb.js): Barretenberg proving backend
- [@noble/post-quantum](https://www.npmjs.com/package/@noble/post-quantum): ML-DSA / SLH-DSA primitives
- [NIST PQC standards](https://csrc.nist.gov/projects/post-quantum-cryptography): FIPS 203, 204, 205

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Security

Report vulnerabilities via [SECURITY.md](SECURITY.md).

---

Maintained by [AffixIO](https://github.com/AffixIO). See [AUTHORS](AUTHORS).
