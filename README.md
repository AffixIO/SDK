# AffixIO SDK

Local decisions. Verifiable evidence. Controlled actions.

AffixIO helps services check conditions before acting and produce evidence that other systems can verify. The SDK includes local proof generation, ML-DSA-65 signatures, optional remote verification and Merkle audit tools. Version 2.0.0 adds durable decision workflows, spending budgets, human review and portable evidence, and makes ML-DSA signer pinning mandatory (breaking security change, see below).

**affixio 2.0.3** is the current release. Install with `npm install affixio`.

| Start here | |
| --- | --- |
| Package | [affixio on npm](https://www.npmjs.com/package/affixio) |
| Source | [AffixIO/SDK](https://github.com/AffixIO/SDK) |
| Account and API access | [AffixIO Studio](https://www.affix-io.com/studio/) |
| 2.0.0 security notes | [Required binding, v1 default, decision binding](docs/2.0.0.md) (history: beta.2 to beta.5 notes in docs/) |
| 2.0.0-beta.4 security notes | [Envelope-proof binding, v1/v2 domain separation, key byte pinning](docs/2.0.0-beta.4.md) |
| 2.0.0-beta.3 security notes | [Signed signing-time, verifier roles, device pattern, key pinning](docs/2.0.0-beta.3.md) |
| 2.0.0-beta.2 security notes | [Signer pinning, HMAC roles, replay guard](docs/2.0.0-beta.2.md) |
| 2.0.0-beta.1 guide | [Capabilities, migration and limitations](docs/2.0.0-beta.1.md) |
| Existing core reference | [1.4.1 reference, retained for compatibility](docs/1.4.1-reference.md) |
| Licence | Apache-2.0 |
| Runtime | Node.js 20 or later |

## Security: Signer Pinning (2.0.0-beta.2, breaking)

ML-DSA-65 verification no longer trusts the public key carried inside an envelope. Every verify path checks the signature against a key you pinned, and fails closed when none is configured.

| Signer | Where the pin comes from |
| --- | --- |
| Local SDK envelopes (`prove()` output, evidence bundles, spend journals) | Your host's own config: the SDK pins its own `signingKeys` public key by default. Add peers with `trustedSigningKeys`. |
| AffixIO API attestations | The published key set: `GET https://api.affix-io.com/v1/keys` (also `/.well-known/affixio-keys.json`). `fetchAffixioKeys()` loads it once and caches it; save it to disk to pin it on offline devices. |

```js
import { AffixSDK, verifyLocalAttestation, fetchAffixioKeys, verifyAffixioAttestation } from "affixio";

// Gateway signs; device verifies with the gateway's public key only (no HMAC secret on the device).
const device = new AffixSDK({ apiKey, role: "device", trustedSigningKeys: [gatewayPublicKey] });
const r = await device.verifyLocal("simple_yesno", proofHex, { envelope }); // HMAC proofs are refused on devices
// r.envelope_ok, r.envelope_reason ("trusted_mldsa_signature" | "untrusted_signer" | ...)

verifyLocalAttestation(payload, attestation, { trustedKeys: gatewayPublicKey }); // low-level
await verifyAffixioAttestation(payload, apiAttestation);                         // uses cached /v1/keys
```

Pinned keys may be a base64 key, `{ key_id, public_key_b64 }`, a list, a `{ key_id: b64 }` map, or a key set document (`{ keys: [...] }`, with `status`, `not_before` and `not_after` honoured). With no trusted key, verification throws `AffixTrustError` (`code: "no_trusted_keys"`). `insecureTrustEmbeddedKey: true` restores the old behaviour for tests only and emits a warning.

**HMAC (`affix-light-v1`) is for servers and trusted parties only.** Verifying it needs the shared secret, so any verifier could also forge proofs. `verifyLocal` warns once on HMAC proofs and throws `AffixHmacRoleError` when `role` is `"device"`, `"edge"` or `"offline-verifier"`. Devices should verify the ML-DSA envelope with pinned keys, or use UltraHonk.

**2.0.0-beta.3:** envelopes are `affix.local-signature.v2`, so `signed_at` is signed and key validity windows can't be bypassed. Verifier roles (`device`, `edge`, `offline-verifier`) neither create nor trust a local key by default. `verifyLocal().valid` requires `envelope_ok` when an envelope is supplied. On a device, verify with `verifyLocalAttestation`, then check the decision **and** the command binding. Pin the AffixIO key set offline, or by hash (`expectedKeySetHash`, or `expectedKeys: [{ key_id, public_key_hash }]`; `expectedKeyIds` alone is not a pin).

**2.0.0-beta.4:** an envelope only validates the proof it commits to (`proof` / `proof_digest` + `circuit_id`). v2 signed bytes carry a fixed domain prefix. Verifier roles reject legacy v1 envelopes (`rejectLegacyV1`).

**2.0.0:** `verifyPublicEnvelope` and `verifyArtifactOffline` require proof + circuit binding (`allowUnbound: true` marks the result unbound). Standalone verifiers reject v1 unless `rejectLegacyV1: false`. Use `sdk.verifyLocalAttestation()` for role defaults. Decisions are bound.

**2.0.2:** an envelope that omits `decision` no longer binds a proof whose decision is known (`envelope_decision_missing`; opt out with `allowMissingDecision: true`). `rejectLegacyV1` defaults to `true` for every role, including servers; pass `rejectLegacyV1: false` to verify stored v1 envelopes. See [docs/2.0.0-beta.3.md](docs/2.0.0-beta.3.md).

Replay protection: `createReplayGuard({ windowMs, store })` (from `affixio` or `affixio/workflows`) accepts each command id once inside a time window. The default `MemoryReplayStore` is per process; supply a shared store (`putIfAbsent(id, expiresAtMs, nowMs)`) when several processes verify.

## 2.0.3: Configuration, Secrets And Stores

- **API base.** `apiBase` (or `AFFIX_API_BASE`) is always used. If the two disagree, the constructor throws. `.affix/config.json` is only a fallback.
- **Secrets.** Keys you pass are never written to disk. Existing `<operatorBaseDir>/secrets/*` files are read. Otherwise the SDK generates in-memory keys and warns. To keep generated keys across restarts:

```js
new AffixSDK({ apiKey, operatorBaseDir: "/var/lib/myapp/affix", persistSecrets: true }); // dir 0700, files 0600
```

  **Migration:** if you relied on 2.0.2 creating `./.affix/secrets` on first run, either keep that directory (it is still read), or pass `persistSecrets: true` with an explicit `operatorBaseDir`, or supply `hmacSecret` / `signingKeys` from your secret manager.
- **Attested verify.** `sdk.verify()` returns `attestation_valid`, `attestation_reason`, `attestation_key_id` (the published `/v1/keys` id) and `signed_payload`. Pin the key set with `affixioExpectedKeys: [{ key_id, public_key_hash }]`, or pass `requireValidAttestation: true` to throw on failure.
- **Which key signs what.** AffixIO API attestations are signed by the AffixIO server key, which is published at `GET /v1/keys` and reported by its published id. Local envelopes and evidence are signed by your host's own ML-DSA key, which keeps its own hash-derived `key_id`.
- **Offline and browser verifiers:** pass `proof`, `circuitId` **and `decision`**. Without `decision` the decision binding cannot run.
- **`rejectLegacyV1: false`** is a migration aid only. It warns (`AFFIXIO_LEGACY_V1_ACCEPTED`) the first time a v1 envelope is accepted.
- **Data files.** Without `operatorBaseDir`, nothing is written to the working directory: proofs, stats, licence state and the queue live in memory, and single-use code gates (spend journal) refuse to run. Pass `operatorBaseDir` (or `persistData: true`) to persist; files are 0600 in a 0700 directory.
- **Budgets and locks.** Budget reservations are O(1) (one aggregate record per account and currency). Lock files left by a crashed process (dead pid on this host, or an expired lease from another host) are recovered automatically.
- **Stores.** `MemoryStore` and `FileStore` are incremental (`FileStore` = snapshot plus append-only log, compacted atomically). The local proof store keeps the newest 1,000 proofs for 7 days (`proofStoreMaxRecords`, `proofStoreTtlMs`).

## Server Mode: Server-Verified Proof Attestations (2.0.3)

Use this when a relying party needs AffixIO itself to vouch that a proof is valid **for a named circuit**.
Many circuits share one verification key, so a proof made locally can verify under several circuit ids.
The API only signs a circuit it can bind: either it made the proof (`server_prove_record`) or no other
circuit shares the key (`unique_vk`). Otherwise it returns `422 circuit_not_bound` and signs nothing.

```js
import { verifyAffixioAttestation } from "affixio";
const api = "https://api.affix-io.com", headers = { "content-type": "application/json", "x-api-key": process.env.AFFIX_API_KEY };

// 1. Prove on the server (the server keeps a 7-day record of which circuit it proved).
const proved = await (await fetch(`${api}/v1/circuits/simple_yesno/prove`, { method: "POST", headers,
  body: JSON.stringify({ fields: { claim: "1" } }) })).json();

// 2. Attest it. This verifies, binds the circuit, signs, and spends the proof (one proof, one use).
const att = await (await fetch(`${api}/v1/attest/proof`, { method: "POST", headers,
  body: JSON.stringify({ circuit_id: "simple_yesno", proof: proved.proof_id }) })).json();

// 3. Anyone checks it against pinned AffixIO keys (/v1/keys). kind "proof" is the default.
const r = await verifyAffixioAttestation(att.signed_payload, att.attestation, { expectedCircuitId: "simple_yesno" });
// r.valid === true only for domain affixio.attest.verified-proof.v1, server_verified, bound circuit.
```

- Locally made proofs for circuits that share a key cannot be attested or attested-verified: prove on the server.
- `sdk.verify(circuitId, proof)` uses `kind: "verify"` and rejects `vk_only` attestations
  (`attestation_reason: "circuit_not_bound"`); its `circuit_id` is the server's bound circuit, not your argument.
- Fields outside `signed_payload` (Merkle `merkle_*`, `unsigned`) are **not** covered by the signature.

## What Is New

- Durable, scoped workflow sessions with restart recovery and parent-action lineage.
- Daily spend reservations with integer currency units, commit, release and reconciliation.
- Multi-source rules returning allow, deny or review, with freshness checks and content fingerprints.
- Human approval tied to the exact action and policy, plus deterministic policy replay.
- Portable evidence manifests, trusted-key ML-DSA verification and readable reports.
- Express, Fastify and MCP gate adapters; A2A evidence handover; optional OpenTelemetry hooks.
- x402 HTTP v2 and AP2 integration boundaries with explicit provider-verification requirements.
- A browser verification-only entry point and a standard-library Python API client.

No new ZK circuits are claimed. A signed decision is not the same as a zero-knowledge proof of policy execution. A valid signature or proof does not by itself establish that external source material is true.

## Install

```bash
npm install affixio
```

Requires Node.js 20 or later. 1.x releases are deprecated: their local verify trusts the key embedded in an envelope. Upgrade to 2.0.0 and read the security notes and migration notes below.

To build from source: `npm ci && npm run build && npm test && npm run test:types`.

The existing `affixio`, `affix-sdk` and `affix-sdk-ext` commands remain available. The new report and replay command is `affixio-evidence`. The server's MCP configuration helper is now packaged too: `affixio mcp print` prints configuration, while `affixio mcp install --dry-run` previews changes without writing them.

## Evaluate Before Acting

```js
import { DecisionPipeline } from "affixio/workflows";

const policy = {
  id: "recipient-consent",
  version: "1",
  mode: "all",
  rules: [
    { source: "consent", operator: "truthy", maxAgeMs: 60000 },
    { source: "account", operator: "eq", value: "active", maxAgeMs: 60000 }
  ]
};

const pipeline = new DecisionPipeline({
  sources: {
    consent: async ({ recipientRef }) => ({
      value: await consentService.hasPermission(recipientRef)
    }),
    account: async ({ accountRef }) => ({
      value: await accountService.status(accountRef)
    })
  }
});

const decision = await pipeline.evaluate(policy, {
  recipientRef: "recipient-123",
  accountRef: "account-456"
});
```

`consentService` and `accountService` are your existing data sources. A missing, failed or stale source returns review, not an allowed result. Decision records contain check fingerprints instead of source values. Do not persist raw personal data inside the intent or policy.

For a complete offline example using simulated source values and no external services:

```bash
node examples/workflow.mjs
node examples/mcp-workflow.mjs
```

Both examples explicitly simulate the action. Neither sends a message, charges a card or invokes a shell command.

## Keep Actions Durable

```js
import { FileStore, WorkflowSession } from "affixio/workflows";

const session = new WorkflowSession({
  store: new FileStore("./runtime-data/actions.json"),
  scope: "account-456",
  sessionId: "checkout-session-1",
  authorizeReview: async ({ actor }) => reviewService.isAuthorized(actor)
});

const purchaseIntent = {
  action: "purchase", amount: 19, currency: "GBP",
  recipientRef: "recipient-123", accountRef: "account-456"
};
const purchaseDecision = await pipeline.evaluate(policy, purchaseIntent);

session.propose({
  id: "purchase-1",
  intent: purchaseIntent,
  policy,
  result: purchaseDecision,
  budget: { account: "purchasing", amount: 19, currency: "GBP", limit: 100 }
});

const outcome = await session.execute("purchase-1", async (intent, context) => {
  return paymentProvider.purchase(intent, {
    idempotencyKey: context.idempotencyKey
  });
});
```

`reviewService` and `paymentProvider` are your server-side integrations. Execute only an allowed or explicitly approved decision. Authenticate reviewers independently; the callback must not trust a role or username sent by the agent. For human review, set `requireReview: true` in the policy and call `session.review()` after authenticating the human.

**Amounts.** `budget.amount`, `BudgetLedger.reserve({ amount, limit })` and the intent's `amount` are in major currency units (e.g. `12.5` for £12.50), not minor units. They are converted with `minorUnits()` and stored as integer `amountMinor`/`limitMinor`; values finer than the currency's precision (e.g. `1.005` GBP) are rejected, not rounded. `propose()` requires `intent.amount` and `intent.currency` to equal `budget.amount` and `budget.currency` (error `Budget must match intent`).

**Approval binding is the caller's job.** `session.review(id, { actor, decision })` carries no approval artefact. The SDK refuses reviews of stale or changed actions, but checking that the human approved *this* action, amount and policy is up to your `authorizeReview` callback. It receives `{ actor, decision, action }`; compare `action.id`, `action.binding`, `action.intent` and `action.result.policyDigest` against the approval your server recorded for that authenticated reviewer, and return `true` only on an exact match.

An execution failure is recorded as unknown. It cannot be run again automatically, and its budget stays reserved until an authorized operator reconciles against provider evidence. This is conservative recovery, not a guarantee that an external payment system supports exactly-once execution.

FileStore is intended for a small, single-host deployment on a local filesystem. Use an application-owned transactional store for multiple hosts or high-throughput processing.

## Sign A Decision With The Existing SDK

```js
import { AffixSDK } from "affixio";

const sdk = new AffixSDK({ apiKey: process.env.AFFIX_API_KEY });
try {
  const result = await pipeline.prove(sdk, policy, {
    recipientRef: "recipient-123",
    accountRef: "account-456"
  }, { requestId: "decision-1" });
  console.log(result.result.decision);
} finally {
  sdk.dispose();
}
```

This path uses the existing HMAC decision proof and local signed envelope. Review returns no proof. Existing licence rules apply. Select and verify the existing UltraHonk path separately when a zero-knowledge circuit relation is required.

Keep the returned `binding` alongside the proof. Its policy, input digest and decision digest are committed in the signed envelope's `policy_hash`. Verification must check that commitment against the expected action as well as verifying the signature with an independently trusted key. The `meta` fields alone are not signed evidence. See [decision binding](docs/2.0.0-beta.1.md) for the verification contract.

## Independent Evidence Verification

```js
import { createEvidenceBundle, verifyEvidenceBundle } from "affixio/workflows";

const bundle = createEvidenceBundle([
  { name: "decision", data: decision },
  { name: "workflow", data: outcome.record }
], { signing: trustedLocalSigningOptions });

const verified = await verifyEvidenceBundle(bundle, { // v1-signed manifests need rejectLegacyV1: false
  trustedPublicKeys: [independentlyObtainedPublicKey] // or trustedKeys: keySetDocument
}); // reason "no_trusted_keys" when nothing is pinned
```

Signing options contain the existing local `hmacSecret` (at least 16 characters, otherwise `local_hmac_secret_must_be_at_least_16_characters` is thrown; use e.g. 32 random bytes as hex), `secretKeyB64` and `publicKeyB64` (from `createLocalSigningKeyPair()`). Keep them server-side. Verification-only code may import `verifyEvidenceBundle` and `renderEvidenceSummary` from `affixio/browser`. No API key is needed to verify a supplied signed bundle.

Do not trust an embedded key as its own authority. Obtain or pin the signer key independently. The manifest verifier checks content integrity and the trusted ML-DSA signature, not every attached proof's circuit relation or remote attestation.

```bash
affixio-evidence verify bundle.json --trusted-key trusted-public-key.txt --report report.html
affixio-evidence verify bundle.json --trusted-keyset keys.json
affix-sdk-ext verify-offline --attestation envelope.json --trusted-key signer.pub.json
affixio-evidence replay policy.json historical-cases.json
```

## Integration Boundaries

| Import | Use |
| --- | --- |
| `affixio` | Existing prove, verify, data-check, Agent Trust and Agentic Pay APIs |
| `affixio/workflows` | Durable decisions, budgets, workflow state and adapters |
| `affixio/browser` | Public-key evidence verification and summary rendering |
| `affixio/extensions` | Existing offline, Merkle and operator feature pack |
| `affixio/sth` | Existing signed tree-head tools |
| `affixio/offline` | Existing offline verification tools |

MCP tools are checked both at discovery and invocation. Web middleware does not replace authentication or transactional action handling. The x402 adapter requires your authorization, signer and settlement verifier. The AP2 adapter requires your signed-mandate verifier and consumes normalized mandate IDs once. Neither adapter establishes a payment-provider relationship or claims protocol certification.

The Python client in `python/affixio_client.py` uses routes already present in the Node SDK. It sends credentials in headers, refuses redirects and does not automatically retry writes. It is an API interoperability client, not a Python proving engine.

## Migration Notes

`maxPerDay` now fails closed without a ledger. Previously the field did not aggregate spend. `verifyAgentSpend` accepts `budgetLedger`, `budgetAccount` and a stable `requestId`, and returns the held reservation. Commit or release it through the ledger, or use WorkflowSession for lifecycle coordination. Repeated request IDs cannot issue a fresh allowed result.

Configured merchant/category restrictions now reject missing values. Invalid policy expiry and fractional minor-unit amounts are rejected. Existing signature and proof formats remain unchanged. Version bindings automatically record 2.0.0.

2.0.0-beta.2: `verifyLocalPayload`, `verifyProofEnvelope`, `verifyArtifactOffline` (with an attestation), `verifySignedRoot` and the evidence CLI need a pinned key. Pass `{ trustedKeys }`. See [docs/2.0.0-beta.2.md](docs/2.0.0-beta.2.md).

Read the [full 2.0.0-beta.1 guide](docs/2.0.0-beta.1.md) before moving a payment workflow into production. The new code is testable offline, but a real API licence check, UltraHonk run and live payment-provider integration still need their respective environments.

Maintained by AffixIO. Contributor: @PapaRichens.
