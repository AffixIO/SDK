# AffixIO SDK

[![npm affixio](https://img.shields.io/npm/v/affixio?label=npm%20affixio)](https://www.npmjs.com/package/affixio)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![FIPS 204](https://img.shields.io/badge/FIPS%20204-ML--DSA-blue)](https://csrc.nist.gov/pubs/fips/204/final)
[![ZK](https://img.shields.io/badge/zero--knowledge-Noir%20%2B%20Barretenberg-8b5cf6)](https://noir-lang.org/)

Node.js SDK for **privacy-preserving proofs** with **post-quantum attestation**. Prove eligibility, KYC outcomes, age checks, residency, and other predicates without exposing raw credentials. Proofs are generated locally on your host, ML-DSA-65 signed, and verifiable locally or through the AffixIO API.

Also in the package: **Know Your Agent (KYA)** enrolment and the **Agentic Pay Kit** (`agenticPay`, `x402BeforePay`, `mcpToolGate`, payment mandates) — host-side signed ACTION attestation for agent spend. Not person KYC.

Built for developers working with [Noir](https://noir-lang.org/) circuits, [Barretenberg](https://github.com/AztecProtocol/barretenberg) (UltraHonk), verifiable credentials, and [NIST post-quantum standards](https://csrc.nist.gov/projects/post-quantum-cryptography) ([FIPS 204 ML-DSA](https://csrc.nist.gov/pubs/fips/204/final)).

## Install

Primary package on npm:

```bash
npm i affixio
```

Package: [affixio](https://www.npmjs.com/package/affixio) · Source: [AffixIO/SDK](https://github.com/AffixIO/SDK) · Docs: [affix-io.com/agent-trust](https://www.affix-io.com/agent-trust/)

> The older `@affix-io/sdk` scope was unpublished on 2026-08-17. Use `affixio`.

## Why AffixIO

Classical signatures (ECDSA, EdDSA, RSA) are vulnerable to future quantum attacks via Shor's algorithm. NIST finalised ML-KEM, ML-DSA, and SLH-DSA in 2024. AffixIO combines:

- **Local proof generation** over bundled Noir circuits (`simple_yesno`, `yesno`), with UltraHonk zero-knowledge proving available as a proof mode
- **ML-DSA-65 (FIPS 204)** signatures on every proof, plus an HMAC envelope verified before the proof is returned
- **Remote verification and Merkle anchoring** through the AffixIO API when your host is online
- **Offline-first queue** for unreliable networks

Your witnesses and credentials never leave the host unless you explicitly verify or flush through the API.

## Get the SDK

| Source | Best for |
|---|---|
| **[npm](https://www.npmjs.com/package/affixio)** `affixio` | **Primary.** Production apps, CI, Docker, `package.json`. Prefer `npm i affixio`. |
| **[GitHub](https://github.com/AffixIO/SDK)** `AffixIO/SDK` | Source review, Apache 2.0 audit, pinning a commit, air-gapped installs from tarball |

```bash
npm i affixio
```

Or clone when you need to inspect exactly what ships, vendor the repo, or run the CLI without adding a registry dependency:

```bash
git clone https://github.com/AffixIO/SDK.git
cd SDK
npm install
node dist/cli.js set-key --api-key aio_live_...
node dist/cli.js health
```

Requires Node.js 20+ (`package.json` `engines.node`).

## Where it fits in your stack

The SDK is a Node.js client. Proving runs in your process; the API is used for the licence heartbeat, quota, remote verification, and Merkle anchoring.

```
Your service                      affixio (in-process)          AffixIO API
┌─────────────────┐               ┌────────────────────┐        ┌───────────────────────┐
│ Express / Fastify│   import      │ prove()            │ HTTPS  │ GET /v1/auth/check    │
│ Next.js API route│ ────────────► │ verifyLocal()      │ ────► │ GET /v1/quota/consume │
│ BullMQ worker    │               │ ML-DSA-65 envelope │        │ POST /v1/circuits/    │
│ LangChain tool   │               │ QR / barcode       │        │      :id/verify       │
│ MCP server       │               │ data-check → prove │        │ POST /v1/merkle/audit │
│ Cron / batch job │               └─────────┬──────────┘        └───────────────────────┘
└────────┬─────────┘                         │
         │                                   ▼
         │                        .affix/proofs.json
         │                        .affix/offline-queue.json
```

Typical integration points:

- **API middleware**: prove a predicate before a sensitive route runs (payout, account change, data export).
- **Background workers**: batch eligibility checks; `flushOfflineQueue()` when connectivity returns.
- **LLM orchestration**: gate tool calls, model tiers, or retrieval scopes with a proof instead of passing raw KYC or HR data into the prompt.
- **Agent and MCP servers**: return a `proof_id` alongside tool results so downstream systems can verify without seeing credentials.
- **Webhooks and event pipelines**: attach a proof digest to an audit log entry via Merkle anchoring.

Install the package in the service that holds secrets and talks to AffixIO. Do not embed API keys in browser bundles or client-side LLM prompts.

## Quick start

Save your key once (mode `0600`, stored at `.affix/secrets/api.key`), or export `AFFIX_API_KEY`:

```bash
npx affix-sdk set-key --api-key aio_live_...
```

```typescript
import { AffixSDK, defaultContext } from "affixio";

const sdk = new AffixSDK({ apiKey: process.env.AFFIX_API_KEY });

const credential = {
  schema_id: "eligibility_v1",
  issuer_id: "issuer_abc",
  issuer_pubkey_hash: "0x1",
  credential_id: "0x2",
  claim_value: "approved",
  valid_from: 1700000000,
  valid_until: 1800000000,
};

const required = "approved";
const decision = credential.claim_value === required ? "yes" : "no"; // hmac mode: bind the outcome your policy computed

const result = await sdk.prove({
  circuitId: "simple_yesno", // bundled circuits: simple_yesno | yesno
  decision,
  credential,
  context: defaultContext({ required_claim_hash: required }),
});

console.log(result.proof_id, result.valid, result.decision);
// afx_7f77be0a071ce0ba5469997731d58e65 true yes

const check = await sdk.verifyLocal("simple_yesno", result.proof, {
  proofId: result.proof_id,
  envelope: result.envelope,
});
console.log(check.valid, check.proof_mode, check.envelope_ok);
// true hmac true
```

`new AffixSDK()` requires an API key: pass `apiKey`, export `AFFIX_API_KEY`, or store it with `affix-sdk set-key`.

```bash
npx affix-sdk health                      # API health + the circuit catalogue
npx affix-sdk prove --claim approved      # local proof (--offline skips the licence RTT)
npx affix-sdk list                        # stored local proofs
npx affix-sdk verify-local <proof-hex>    # verify locally
```

## Demo

Three runnable demos ship in `examples/`. They import the package by name (`affixio`), which Node resolves to this repo when you run them from a clone.

### 1. Yes/No web demo (`examples/yesno-demo`)

An Express app that proves `simple_yesno` and verifies the result in the browser. Needs a Hub licence key (`aio_live_...`).

```bash
cd examples/yesno-demo
npm install
cp env.example .env      # paste your aio_live_... key from Hub
npm start                # http://127.0.0.1:3847
```

```
$ curl -s localhost:3847/api/health
{"ok":true,"mode":"auto","circuit":"simple_yesno",
 "licence":{"active":true,"message":"Licence active.","key_hint":"aio_li…"}, ...}

$ curl -s -X POST localhost:3847/api/prove -H 'Content-Type: application/json' \
    -d '{"claim":"approved","required":"approved"}'
{"decision":"yes","valid":true,"pass":true,"offline":false,
 "proof_id":"afx_bc92e04595d9e81fa6d57b1ef7186d8e",
 "proof_digest":"e52c8fdfef2d6bd092abf546d35ddb3dbc825d6e2a659c82f590bc805824c685", ...}
```

`POST /api/verify` with that `proof` and `envelope` returns `{"valid":true,"verified":true,"envelope_ok":true,"source":"local"}`.

### 2. Agentic pay, x402, and MCP gates

```bash
node examples/agentic-pay/agentic-pay.mjs          # shopping agent checkout decision
node examples/mcp-tool-gate/tool-call.mjs          # gate a paid MCP tool
PORT=8799 node examples/x402-before-pay/server.mjs # x402-style paid endpoint
curl -s -H 'x-agent-id: agent://research-runner' http://127.0.0.1:8799/paid-report
```

Each call returns an `allowed` decision and a signed receipt carrying `proof_id` and `proof_digest`; the x402 server answers `402` when policy denies.

### 3. Prove before the LLM (tool router)

Verified pattern: the model sees the outcome, never the credential.

```typescript
import { AffixSDK, defaultContext } from "affixio";

const sdk = new AffixSDK({ apiKey: process.env.AFFIX_API_KEY });

// credential comes from your KYC / HR store, not from the prompt
export async function beforeToolRun(claimValue: string, required: string) {
  const allowed = claimValue === required; // your policy decides for hmac proofs
  const { valid, proof_id } = await sdk.prove({
    circuitId: "simple_yesno",
    decision: allowed ? "yes" : "no",
    credential: {
      schema_id: "eligibility_v1",
      issuer_id: "issuer_abc",
      issuer_pubkey_hash: "0x1",
      credential_id: "0x5",
      claim_value: claimValue,
      valid_from: 1700000000,
      valid_until: 1800000000,
    },
    context: defaultContext({ required_claim_hash: required }),
  });
  if (!allowed || !valid) throw new Error("tool_access_denied");
  return proof_id; // pass to logs or Merkle audit, not to the model context
}
```

Calling `beforeToolRun("cleared", "cleared")` returns `tool allowed, proof_id=afx_...`; `beforeToolRun("not_cleared", "cleared")` throws `tool_access_denied`, and the model never sees the credential. For a decision made inside the proof instead of by your caller, pass `proofMode: "ultrahonk"` and drop `decision`.

## API key

Keys are issued at [hub.affix-io.com](https://hub.affix-io.com/):

| Key | Looks like | Used for |
|---|---|---|
| Licence key | `aio_live_...` | Licence heartbeat, quota, local proving, KYA |
| API key | `aio_...` | Remote verify, aggregate verify, Merkle audit (issued per integration) |

Store it once (recommended) or export it:

```bash
npx affix-sdk set-key --api-key aio_live_...   # writes .affix/secrets/api.key, mode 0600
```

| Variable | Required | Default |
|---|---|---|
| `AFFIX_API_KEY` | Yes | None — pass `apiKey`, export `AFFIX_API_KEY`, or store it with `set-key` |
| `AFFIX_API_BASE` | No | `https://api.affix-io.com` |

The SDK does not read `.env` files itself: use `set-key`, an exported variable, or load `.env` in your host app (the yes/no demo uses `dotenv`). `.env.example` is a template — replace the sample value with your own key.

Commercial keys with higher throughput: [affix-io.com](https://affix-io.com).

## Prove input modes

`prove()` accepts one of three shapes.

### 1. Credential + context (recommended)

Credentials are normalised to BN254 field elements locally and proved in-process.

```typescript
await sdk.prove({ circuitId, credential, context });
```

### 2. Pre-built witness

Build the witness yourself (`buildWitness()` is local and synchronous) then prove:

```typescript
const witness = sdk.buildWitness(circuitId, credential, context);
await sdk.prove({ circuitId, witness });
```

### 3. Raw circuit fields

For hand-built inputs matching the compiled circuit's ABI:

```typescript
await sdk.prove({
  circuitId: "simple_yesno",
  fields: { secret: "0x1", claim_hash: "0x...", required_claim_hash: "0x..." },
});
```

## Proof modes

| Mode | Use it for | Speed |
|------|------------|-------|
| `hmac` (default) | High-throughput yes/no checks with an authenticated, ML-DSA-65 signed result | sub-millisecond |
| `ultrahonk` | Real zero-knowledge proofs over bundled Noir circuits (`circuits/compiled/simple_yesno.json`, `yesno.json`) | ~1s |

```typescript
const zk = await sdk.prove({
  circuitId: "simple_yesno",
  proofMode: "ultrahonk",
  credential,
  context: defaultContext({ required_claim_hash: "approved" }),
});
```

**How the decision is reached**

| Mode | Who decides | Notes |
|---|---|---|
| `hmac` | Your caller, via `decision: "yes" \| "no"` | The decision is bound into the HMAC statement, the proof digest, and the ML-DSA-65 envelope, so it cannot be changed after the fact. Omit `decision` and the proof defaults to `yes`. |
| `ultrahonk` | The Noir circuit | The claim/required comparison runs inside the proof; `decision` is ignored. Verified: `claim_value: "approved"` with `required_claim_hash: "denied"` returns `valid: false, decision: "no"`. |

UltraHonk proofs are the ones the AffixIO API can re-verify (`POST /v1/circuits/:id/verify`) and anchor to its Merkle tree. HMAC proofs are verified locally with `verifyLocal()` / the shared `AFFIX_LOCAL_HMAC_SECRET`. Verification fails closed: a truncated, tampered, or forged carrier returns `valid: false` with a reason.

Remote `verify()` / `flushOfflineQueue()` are disabled while `licenceOnly` is true (the default). Opt in per client or per process:

```typescript
const sdk = new AffixSDK({ apiKey, licenceOnly: false, autoFlush: true });
```

```bash
AFFIX_LICENCE_ONLY=0 npx affix-sdk flush
```

Or set it once for the host in `.affix/config.json`:

```json
{ "version": 1, "licenceOnly": false, "autoFlush": true }
```

## SDK methods

| Method | Description |
|---|---|
| `prove(input)` | Generate a proof locally (HMAC or UltraHonk) |
| `verifyLocal(circuitId, proof, opts?)` | Verify a proof locally, with optional ML-DSA-65 envelope check |
| `verify(circuitId, proof, requestAttestation?, opts?)` | Verify through the AffixIO API (online, `licenceOnly:false`) |
| `proveAndVerify(input)` | Prove locally, then verify through the API |
| `buildWitness(circuitId, credential, context?)` | Build a witness package locally (synchronous) |
| `isOnline()` | API reachability check |
| `checkLicence(force?)` / `licenceState()` | Licence heartbeat and current state (quota, plan tier) |
| `flushOfflineQueue(opts?)` | Verify, ML-DSA-attest, and Merkle-anchor queued proofs |
| `anchorPendingLeaves(opts?)` | Anchor digests only (no ZK re-verify) |
| `queueProofForAffix(input)` | Enqueue a local proof for a later flush |
| `listPendingSync()` / `listOfflineQueue()` | Inspect the offline queue |
| `listStoredProofs()` | Local proof store |
| `buildMerkleBatch(itemsOrOptions?)` | Client-side Merkle batch (up to 50 000 leaves) |
| `generateCode(input)` / `generateCodeFromProve(input)` | PII-free QR or barcode carrier |
| `readCode(input)` | Read a scanned carrier, online or offline |
| `check(source, query)` | Lookup via a data adapter (JSON, KV, CSV, SQL, …) |
| `proveFromCheck(input)` / `checkAndProve(...)` | Data check → proof in one call |
| `statsSnapshot()` | Local operational counters |
| `spendStatus()` / `verifySpendJournal()` | Tamper-evident double-spend journal |
| `exportLocalPublicKey()` | Deployment ML-DSA-65 public key |
| `hsmStatus()` / `setHsmProfile()` / `testHsm()` | HSM and cloud KMS profiles |
| `setApiKey(key)` / `apiKeyStatus()` | Store and inspect the API key |
| `operatorConfig()` / `saveOperatorConfig(config)` | Operator config (secrets reported as presence flags) |
| `dispose()` | Stop timers in a long-lived host |

## CLI

```bash
npx affix-sdk help
npx affix-sdk set-key --api-key aio_live_...   # or: A / set-key
npx affix-sdk config                           # operator config (no secrets)
npx affix-sdk health                           # API health + circuit catalogue
npx affix-sdk licence                          # force a licence ping
npx affix-sdk prove [--claim <value>] [--required <value>] [--circuit <id>] [--proof-mode hmac|ultrahonk] [--offline]
npx affix-sdk verify-local <proof-hex> [--circuit <id>]
npx affix-sdk verify <proof-hex> [--circuit <id>]   # remote; disabled in licence-only mode
npx affix-sdk list                             # stored local proofs
npx affix-sdk queue                            # pending offline proofs
npx affix-sdk flush [--max <n>]                # push queue; disabled in licence-only mode
npx affix-sdk stats
npx affix-sdk spend-status
npx affix-sdk pubkey                           # local ML-DSA-65 public key
npx affix-sdk qr --claim approved --scans 1 --out ./codes
npx affix-sdk barcode --claim approved --scans 5 --out ./codes
npx affix-sdk read <payload> --sidecar ./codes --consume
npx affix-sdk hsm status | hsm test
npx affix-sdk dashboard                        # local ops UI on 127.0.0.1:8787
npx affix-sdk menu                             # interactive operator terminal
```

`verify` and `verify-local` take proof hex, not a `proof_id`. There is no `circuits` subcommand — `health` prints the catalogue.

## Post-quantum attestation

Every proof is signed with **ML-DSA-65** (FIPS 204, CRYSTALS-Dilithium family) by a key owned by your deployment, and wrapped in an HMAC envelope that is re-checked before `prove()` returns. Proof responses from the API can also carry ML-DSA-65 attestations. This aligns with the migration path described in [NIST IR 8547](https://csrc.nist.gov/pubs/ir/8547/final) toward quantum-resistant cryptography.

```typescript
proof.signature;             // { algorithm: "ML-DSA-65", key_id, signature_b64, ... }
sdk.exportLocalPublicKey();  // publish this so verifiers can check your signatures
```

The proving backend uses Noir compiled to ACIR, with Barretenberg UltraHonk for `ultrahonk` mode — the same stack documented in the [Noir web app guide](https://noir-lang.org/docs/dev/guides/building_a_web_app).

## Circuit library

`npx affix-sdk health` returns the live catalogue. It currently lists **115 attested Noir circuits**; the SDK's bundled local proving covers `simple_yesno` and `yesno`, and the other IDs are the API catalogue's templates.

| Domain | Examples |
|---|---|
| Identity / KYC | `kyc`, `attested_boolean`, `attested_membership` |
| Age / health | `health_age`, `health_vaccination_status` |
| Residency / travel | `ticket_local_resident`, `travel_visa_eligibility` |
| Education | `edu_attendance_threshold`, `edu_enrollment_verification` |
| Merkle / audit | `merkle_batch`, `audit_proof`, `quantum_safe_token` |
| Governance | `govt_voting_eligibility`, `zk_voting` |

Run `npx affix-sdk health` for the full list from the live API.

## Offline queue

Proofs are produced locally, so an API outage does not stop you proving. What changes is when verification, attestation, and anchoring happen.

1. A proof created while offline is stored with `offline: true` and `pending_sync: true`.
2. With `licenceOnly: false` and `queueUnsyncedProofs: true`, or by calling `queueProofForAffix()`, it is enqueued in `.affix/offline-queue.json`.
3. `flushOfflineQueue()` then verifies each proof through the API, collects the ML-DSA-65 attestation, and anchors the digest in the API Merkle tree. With `autoFlush: true` this runs roughly every 5 seconds while the queue is non-empty.

```typescript
const sdk = new AffixSDK({ apiKey, licenceOnly: false, autoFlush: true });
await sdk.flushOfflineQueue();
sdk.dispose();
```

Local paths: `.affix/proofs.json`, `.affix/offline-queue.json`, `.affix/spend/`, `.affix/secrets/` (mode `0600`).

## API endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Service health, engine, catalogue count (public) |
| `GET /v1/circuits` | Circuit catalogue |
| `GET /v1/auth/check`, `GET /v1/auth/pulse` | Licence key check and heartbeat |
| `POST /v1/quota/consume` | Proof quota accounting |
| `POST /v1/circuits/:id/verify` | Proof verification, ML-DSA attestation, Merkle anchor |
| `POST /v1/aggregate/verify` | Bulk verify (1–25 proofs, no attestation) |
| `POST /api/attest` | ML-DSA-65 signature over a JSON payload |
| `GET /v1/merkle/root` | Audit Merkle root (public) |
| `POST /v1/merkle/audit`, `POST /v1/merkle/audit/batch`, `POST /v1/merkle/verify-proof` | Anchor and verify audit leaves |

Licence keys (`aio_live_...`) authenticate the licence and quota routes. Verify, attest, and Merkle routes need an API key issued for your integration — the `aio_...` keys from Hub.

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

The circuit names above are API catalogue templates. Locally provable today are `simple_yesno` and `yesno`, so a tool gate looks like the verified example in [Demo](#3-prove-before-the-llm-tool-router): prove `simple_yesno` with `defaultContext({ required_claim_hash: "cleared" })`, then hand `proof_id` to logs or a Merkle audit — never to the model context. Use `decision` when your own policy made the call, or `proofMode: "ultrahonk"` when the proof should decide.

### Agent spend (KYA and Agentic Pay)

- **Know Your Agent**: enrol an agent with a capability spec and authorise every tool call with `createAgentTrust()`
- **Agentic Pay**: `agenticPay()`, `verifyAgentSpend()`, `createPaymentMandate()`
- **x402 and paid APIs**: `x402BeforePay()`, `paidApiAgentPolicy()`
- **MCP tool calls that create cost**: `mcpToolGate()`
- **Receipts for finance and support**: `createAgentCheckoutReceipt()`

```bash
node examples/agentic-pay/agentic-pay.mjs
node examples/mcp-tool-gate/tool-call.mjs
```

## Related projects

- [noir-lang/noir](https://github.com/noir-lang/noir): ZK domain-specific language
- [@aztec/bb.js](https://www.npmjs.com/package/@aztec/bb.js): Barretenberg proving backend
- [@noble/post-quantum](https://www.npmjs.com/package/@noble/post-quantum): ML-DSA / SLH-DSA primitives
- [NIST PQC standards](https://csrc.nist.gov/projects/post-quantum-cryptography): FIPS 203, 204, 205

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Security

Report vulnerabilities via [SECURITY.md](SECURITY.md).

Secrets live under `.affix/secrets/` with mode `0600`, and `.affix/` is never published. `operatorConfig()` and `affixio config` report presence flags only; HSM profiles store environment variable names, never PINs or tokens. The bundled `.env.example` placeholder is not a working key — replace it with your own.

---

Maintained by [AffixIO](https://github.com/AffixIO). See [AUTHORS](AUTHORS).
