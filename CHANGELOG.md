# Changelog

## Unreleased

- Docs: README starts with an offline hello world (real output), "Gate any tool call", HMAC vs UltraHonk table, CLI table and free proofs links. Security notes moved lower.
- Examples: `examples/hello`, `examples/gate/{openai-agents,langchain,mcp-server,crewai}`.
- Templates: Express, Fastify and Next.js routes that gate a tool call.
- package.json: more discovery keywords. No code changes.

## 2.0.3 (unreleased) - circuit binding on /verify (vk_only)

- **High: `kind: "verify"` rejects unbound cores.** `verifyAffixioAttestation(..., { kind: "verify" })` (and so
  `sdk.verify()`) now returns `circuit_not_bound` unless the signed core has `circuit_binding`
  `server_prove_record` or `unique_vk`. Cores with `vk_only`, or with no `circuit_binding` (signed before the
  2026-10-11 server fix), may name a circuit the proof was not made for. Opt out with `allowVkOnly: true`
  (not recommended). `bound_circuit_id` is also checked against `expectedCircuitId`.
- **High: `sdk.verify()` reports the server's circuit.** `circuit_id` is the server's `bound_circuit_id`
  (null when unbound), with new `requested_circuit_id`, `circuit_binding` and `vk_hash`. `signed_payload` is the
  server's exact signed core; `expectedCircuitId` is pinned to the circuit you asked for.
- **High: `prove()` envelopes always sign `decision`.** UltraHonk proofs used to omit it, so
  `verifyLocal(..., { envelope })` rejected the SDK's own envelopes with `envelope_decision_missing`.
- Docs: "Server mode" (prove on the server, attest with `POST /v1/attest/proof`, check with `kind: "proof"`).

## 2.0.3 (unreleased) - attestation kinds

- `verifyAffixioAttestation` now checks what a signed payload claims to be, via `kind` (default `"proof"`):
  `"proof"` requires domain `affixio.attest.verified-proof.v1`, `server_verified: true` and a bound
  `circuit_binding` (`server_prove_record` or `unique_vk`); `expectedCircuitId` pins the circuit.
  Pass `kind: "verify"` or `kind: "prove"` for /verify and /prove response cores (these refuse any
  payload with a `domain`); `kind: "any"` is signature-only. `sdk.verify()` uses `kind: "verify"`.
  **Breaking vs 2.0.2** for direct callers on verify/prove responses: add `kind: "verify"`.
- `signedVerifyPayload()` returns the server's `signed_payload` when present (fixes /prove digest_mismatch).
- Exports `VERIFIED_PROOF_DOMAIN`, `CLIENT_PAYLOAD_DOMAIN`.

## 2.0.3 - 2026-10-10 (not published)

Fixes for Articus's CitrineOS integration findings F1–F6.

### Security / behaviour changes

- **F2 (critical): the configured API base is always honoured.** Precedence is `config.apiBase`, then `AFFIX_API_BASE`, then `apiBase` in `<operatorBaseDir>/config.json`, then `https://api.affix-io.com`. Before 2.0.3, the default operator config (production) overrode an explicit `apiBase` whenever `proofMode` was not passed, so a dummy key could reach the live licence endpoint. If `config.apiBase` and `AFFIX_API_BASE` are both set and differ, the constructor throws `affixio_api_base_conflict`. A `config.json` value that differs from an explicit base is ignored with an `AFFIXIO_API_BASE_FILE_IGNORED` warning. `fetchAffixioKeys()` defaults to `${AFFIX_API_BASE}/v1/keys` (new `apiBase` option, `affixioKeysUrl()` helper), and `sdk.verify()` fetches keys from `${sdk.apiBase}/v1/keys`. Every other URL builder (licence, quota, client, agent-trust, dashboard, CLI, extensions) already used the resolved base and was audited.
- **F1 (high), BEHAVIOUR CHANGE: secrets are no longer written by default.** Supplied `hmacSecret` / `signingKeys` (or `AFFIX_LOCAL_HMAC_SECRET`) are never persisted, and they now take precedence over files. Existing files in `<operatorBaseDir>/secrets/` are still read, so hosts set up by 2.0.2 or earlier keep their keys. Anything still missing is generated **in memory** for this process, with an `AFFIXIO_EPHEMERAL_SECRETS` warning. To keep generated secrets, pass `persistSecrets: true` with an explicit `operatorBaseDir`; the directory is 0700 and the files are 0600. `persistSecrets` without `operatorBaseDir` throws `persist_secrets_requires_explicit_path`. Default data paths (proofs, licence, queue, stats, spend journal, key paths) now follow `operatorBaseDir` instead of always using `./.affix`. `sdk.secretSources` reports where each secret came from (`supplied`, `file`, `generated-persisted`, `generated-ephemeral`). The spend journal accepts the key object, so supplied keys work without a key file.
- **F3 (high): `sdk.verify()` keeps the signed response and checks the attestation.** The result now includes `engine`, `proof_ref`, `return_value`, `policy_version`, `signed_payload` (exactly what the API signed: the response as received, minus `attestation` and the Merkle fields) and `raw`. When an attestation is present it is checked with `verifyAffixioAttestation` against pinned AffixIO keys (`affixioKeys`, `affixioExpectedKeys` or `affixioExpectedKeySetHash` in the config or per call; otherwise fetched from `${apiBase}/v1/keys`), and `attestation_valid`, `attestation_reason` and `attestation_key_id` are returned. `requireValidAttestation: true` makes it throw instead. New export: `signedVerifyPayload()`.
- **F4 (high): `MemoryStore` and `FileStore` are incremental.** A transaction clones only the records it reads, and writes only the records that changed. A throw still rolls back everything. `FileStore` keeps the 2.0.2 snapshot format (`{ schema, records }`, plus `generation`) and adds an append-only, fsynced log `<path>.log` holding one line per transaction. The log is folded into the snapshot atomically (temp file, fsync, rename) every 1,000 transactions or 8 MB (`compactEvery`, `compactBytes`). A torn final line from a crash mid-append is discarded. A 2.0.2 file loads unchanged. Call `store.compact()` before downgrading to 2.0.2. Budget and session scans read only `budget:` and `action:` records.
- **F5 (medium), BEHAVIOUR CHANGE: the local proof store is bounded.** By default it keeps the newest 1,000 proofs (`proofStoreMaxRecords`) and drops proofs older than 7 days (`proofStoreTtlMs`; 0 disables). It used to keep up to 50,000 in one growing document that was rewritten on every `prove()`. With the default file storage, each save now appends one line to `proofs.json.log`. The log is folded into `proofs.json` (atomic temp + rename, 0600) once it holds `max / 2` records, so `proofs.json` stays a plain newest-first array that 2.0.2 can read. Custom document stores keep the single-document format, bounded by the same cap and TTL. Pending sync work lives in the offline queue, so `flushOfflineQueue` is unaffected. The `merkleBatch()` fallback over stored proofs now sees at most the cap.
- **F6 (low-medium): published key ids.** `verifyAffixioAttestation` (and so `sdk.verify()`) returns the published id from `/v1/keys` (for example `mldsa65-1bf342d458b982b2`) as `key_id`. It also returns `key_id_alias` (the hash-derived 16-hex id reported before 2.0.3) and `public_key_hash`. API attestations carry no `key_id` of their own. Local envelopes are signed by the host's own key, which is a different key, and keep their own hash-derived `key_id`.
- **H1 (medium): budgets are indexed.** Each account and currency has one aggregate record (`budgetidx:*`) holding its open (held or executing) reservations and committed totals per day (kept for 7 days). A reservation, transition or `summary()` now touches O(1) records instead of re-reading every earlier reservation. The index changes in the same store transaction as the reservation, so atomicity, idempotent `requestId`/reservation ids and cross-process `FileStore` locking are unchanged. Stores from before the index existed are scanned once, on first use, to build it.
- **H2 (medium): stale lock recovery.** Lock files now record `pid`, `host`, process start time, `acquiredAt`, `leaseMs` and a token. A lock is broken when its holder is on this host and the pid is dead or now belongs to a different process (start time differs), or when the holder is on another host (or the lock is unreadable) and the lease (default 30 s, `leaseMs`) has expired. 2.0.2-style `pid` locks with a dead pid are also broken. Locks are created atomically (the full body goes to a temp file, which is then hard-linked into place), so a SIGKILL can never leave an empty lock. A live holder on this host is never broken. Breaking is race-safe: the lock is renamed aside and checked, and if another process won the race its lock is put back. The release step removes the lock only if it still holds our token. A warning (`AFFIXIO_STALE_LOCK_BROKEN`) is emitted.
- **H3 (low), BEHAVIOUR CHANGE: no CWD writes by default.** Without `operatorBaseDir` (and without `persistSecrets` or the new `persistData: true`), proofs, stats, licence state and the offline queue are kept in memory. A path you pass explicitly (for example `proofStorePath`) is still used. The spend journal for single-use code gates needs durable storage, so in this mode it throws `spend_journal_requires_operatorBaseDir` instead of writing. Whenever files are written they are 0600 in a 0700 directory, which includes `stats.json` (it was 0644). This matches F1: nothing touches disk unless you give a path. Note that licence state no longer survives restarts in this mode, so each process re-checks the licence on start.
- **Docs and warnings.** Accepting a v1 envelope (`rejectLegacyV1: false`) now emits `AFFIXIO_LEGACY_V1_ACCEPTED` once per process. Offline and browser integrators should pass `decision` (and `proof`, `circuitId`) to `verifyArtifactOffline` / `verifyPublicEnvelope`. Without `decision` the B17 check cannot run.

### Not changed

The API, the published key set, envelope formats, `prove()` output, and the obfuscated `extensions/core.js` and `cli-ext-core.js`. F4 and F5 were in readable source (`src/runtime/store.js`, `dist/proof-store.js`), so no obfuscated code was touched.

### Tests

`tests/security-2.0.3.test.mjs` adds 13 regression tests covering F1–F6 and the v1 warning. `tests/security-2.0.3b.test.mjs` adds 9 for H1–H3, including a real SIGKILLed lock holder. One older assertion, that a device with `generateSigningKey: true` writes its key file, was updated to the opt-in behaviour.

## 2.0.2 - 2026-10-10

### Security / behaviour changes

- **Decision binding without a signed decision (B17).** When the verifier knows the proof's decision (`verifyLocal` always does; standalone verifiers when you pass `decision`), an envelope whose payload has no `decision` now fails with `envelope_decision_missing` instead of binding. A non-string `decision` fails with `envelope_decision_mismatch`. Envelopes made by `prove()` in 2.0.x always sign `decision`, so they still verify. Opt out per call with `allowMissingDecision: true` (not recommended). Applies to `verifyLocal`, `checkEnvelopeBinding`, `verifyPublicEnvelope` (`affixio/browser`, `affixio/workflows`) and `verifyArtifactOffline`.
- **BEHAVIOUR CHANGE: `rejectLegacyV1` now defaults to `true` for every role, including `server` and `trusted-party`.** Legacy v1 envelopes (unsigned `signed_at`) are rejected by `verifyLocal` and `sdk.verifyLocalAttestation` unless you construct the SDK with `rejectLegacyV1: false` (or pass it per call). Servers that must verify stored v1 envelopes need to opt in explicitly. Standalone verifiers already rejected v1 by default since 2.0.0.

### Tests

- `tests/security-2.0.2.test.mjs` covers both changes; older tests updated to the new server default.

## 2.0.1 - 2026-10-10

Documentation and example fixes only; no runtime or API changes.

- Examples renamed: `examples/workflow.mjs` and `examples/mcp-workflow.mjs` (were `*-2.0.0-beta.1.mjs`). `workflow.mjs` now signs its evidence bundle and verifies it against a pinned public key (it previously printed `unsigned_manifest`).
- `docs/2.0.0-beta.1.md` is marked historical; it no longer calls itself an unpublished candidate.
- README: budget and intent amounts are major currency units (stored as integer minor units); `propose()` requires `intent.amount`/`currency` to match the budget.
- README: evidence signing `hmacSecret` must be at least 16 characters.
- README: approval binding (action, amount, policy) is enforced by the caller's `authorizeReview` callback.

## 2.0.0 - 2026-10-10

First stable 2.x release, published as `latest`. Same code as 2.0.0-beta.5, which was never published. Includes every security change below: ML-DSA signer pinning (fail closed), signed signing-time (v2 envelopes with domain prefix), envelope-to-proof/circuit/decision binding, key-set byte pinning, HMAC limited to trusted parties, and verifier roles that neither create nor trust their own key. 1.x is deprecated (its local verify trusts the key embedded in the envelope); 2.0.0-beta.1 is deprecated too.

## 2.0.0-beta.5 - not published (became 2.0.0)

### Security (BREAKING)

- **Binding required.** `verifyArtifactOffline` (with an attestation) and `verifyPublicEnvelope` require proof + circuit binding unless `allowUnbound: true`, which marks the result unbound and warns. Results always carry `bound` and `binding` ("checked" | "skipped" | "missing").
- **v1 rejected by default** in every standalone verifier (`rejectLegacyV1: false` to opt in). New `sdk.verifyLocalAttestation()` inherits role defaults.
- **Decision binding**, and proof + proof_digest must both match when both are present.

### Added

- CLI flags: `affix-sdk-ext verify-offline --proof-hex --circuit-id --allow-unbound --accept-legacy-v1`, and `affixio-evidence verify --accept-legacy-v1 yes`.

## 2.0.0-beta.4 - not published

### Security (BREAKING)

- **Envelope ↔ proof binding (V5).** `envelope_ok` (and so `valid`) requires the envelope to commit to the supplied proof (`proof` or `proof_digest`) and circuit (or `proof_mode`). Applies to `verifyLocal`, `verifyPublicEnvelope` (when `proof` is given) and `verifyArtifactOffline` (when `proofHex` is given). New export `checkEnvelopeBinding`.
- **v1/v2 domain separation (X1).** The v2 signed bytes are prefixed with `"affix.sdk.local-signature.v2\n"`, so beta.3 v2 envelopes do not verify. `legacyV1` signing refuses v2-shaped payloads; v1 verification rejects them. New `rejectLegacyV1` option, default true for device, edge and offline-verifier roles.
- **Key byte pinning (K4/K5).** `fetchAffixioKeys({ expectedKeys: [{ key_id, public_key_hash }] })` rejects extra keys and swapped bytes. `expectedKeyIds` is documented as presence-only and warns when used alone.

### Changed

- `allowLegacyUnsignedTime` emits a warning.

## 2.0.0-beta.3 - not published

### Security (BREAKING)

- **Signed signing-time.** New `affix.local-signature.v2` (default) puts `signed_at` and `key_id` inside the ML-DSA/HMAC message, so key validity windows can no longer be bypassed by editing or deleting `signed_at`. Missing or unparseable `signed_at` fails closed. Legacy v1 envelopes fail with `unsigned_timestamp` when a window applies, unless `allowLegacyUnsignedTime`.
- `verifyAffixioAttestation` no longer uses the server's unsigned `signed_at`. Retired keys and keys with `not_after` are rejected by default; `not_before` is checked against the verifier's clock; new `requireSignedTime` option. No server change.
- `trustOwnSigningKey: false` is honoured. Device, edge and offline-verifier roles default to not trusting, and not generating, a local signing key (`generateSigningKey`).
- `verifyLocal` `valid` / `verified` / `decision` now require `envelope_ok` when an envelope is supplied. New `proof_valid` field.

### Added

- `localSignatureMessage`, `LOCAL_SIGNATURE_SCHEMA_V1/V2`, `signLocalPayload({ legacyV1, signedAt })`, and the `key_revoked` / `invalid_signed_at` / `unsigned_timestamp` reasons.
- `computeKeySetHash`, `publicKeyHash`, and `fetchAffixioKeys({ expectedKeySetHash, expectedKeyIds })` for offline pinning.
- Docs covering the device pattern, key_id aliases, TLS trust-on-first-use and replay store scope (docs/2.0.0-beta.3.md).
- Regression tests for each beta.2 hole (tests/security-beta3.test.mjs).

## 2.0.0-beta.2 - not published

### Security (BREAKING)

- **ML-DSA signer pinning.** Envelope/attestation verification previously trusted the public key embedded in the envelope and only checked that `key_id` matched it, so any self-generated ML-DSA-65 key pair could produce envelopes that verified. All verify paths now check against pinned keys and fail closed (`AffixTrustError`, `code: "no_trusted_keys"`) when none is configured: `verifyLocalPayload`, `verifyProofEnvelope`, `AffixSDK.verifyLocal` envelope checks, `affixio/offline` `verifyArtifactOffline`, `affixio/sth` `verifySignedRoot`, `affixio/browser` / `affixio/workflows` `verifyPublicEnvelope` and `verifyEvidenceBundle`, `affixio-evidence verify` and `affix-sdk-ext verify-offline`. Reported by Articus (Zenoh forged-signer test). Affects 1.x and 2.0.0-beta.1.
- **HMAC is trusted-party only.** `verifyLocal` warns once on `affix-light-v1` proofs and throws `AffixHmacRoleError` for `role: "device" | "edge" | "offline-verifier"`. Server-side HMAC use is unchanged.

### Added

- `verifyLocalAttestation`, `verifyProofEnvelopeDetailed`, `normalizeTrustedKeys`, `AffixTrustError`.
- SDK options `role`, `trustedSigningKeys`, `trustOwnSigningKey`, `insecureTrustEmbeddedKey` (tests only, warns), `silenceHmacWarning`; `sdk.trustedKeys()`; `verifyLocal` results gain `envelope_reason` and `envelope_key_id`.
- `fetchAffixioKeys` (cached), `verifyAffixioAttestation`, `AFFIXIO_KEYS_URL` for the new public `GET https://api.affix-io.com/v1/keys` key set.
- `createReplayGuard` / `MemoryReplayStore` (nonce/command-id cache with time window and pluggable store), exported from `affixio` and `affixio/workflows`.
- `--trusted-keyset` for `affixio-evidence verify`; `--trusted-key`/`--trusted-keyset` for `affix-sdk-ext verify-offline`.
- Regression tests: forged signer, pinned pass, tamper, missing trust, HMAC device refusal, key set cache, replay guard.

### Migration

- Pass `{ trustedKeys }` to the low-level verify functions. `AffixSDK` pins its own signing key automatically, so a host verifying its own envelopes needs no change.
- Pin peers with `trustedSigningKeys`, and pin AffixIO with the `/v1/keys` key set.

## 2.0.0-beta.1 - 2026-10-05 (npm beta; deprecated)

### Added

- Durable workflow sessions, parent lineage, authorized review and uncertainty reconciliation.
- Transactional daily budgets with integer currency units and cross-process file locking.
- Multi-source policy evaluation, source freshness, change monitoring and deterministic replay.
- Pipeline proof commitments bind the exact input, decision result and policy inside the existing signed envelope.
- Portable signed evidence bundles, a browser verifier and an evidence/report CLI.
- Express, Fastify, MCP, x402, AP2 and A2A integration adapters with explicit transport contracts.
- Optional OpenTelemetry-compatible instrumentation and a Python API client.
- Typed workflow/browser exports, selected stronger legacy extension types, examples and regression tests.

### Changed

- Daily-capped legacy policies now fail closed without a ledger. This is an intentional behavioral correction.
- Repeated legacy payment request IDs do not issue a new allowed result.
- Merchant/category allowlists reject missing inputs; invalid expiry and fractional minor units are rejected.
- Existing extension entry points now include their TypeScript declarations in package exports.
- Runtime build and test scripts reference files actually included in the package.

### Release Boundaries

- No production API, licence rule, price, ZK circuit or npm publication changed.
- Payment transport tests use fixtures; real signing/settlement providers and AP2 verification remain application integrations.
- The server-only MCP helper and CLI routing have been reconciled with the server copy and included in the package.

## 1.4.1 — 2026-09-24 (Europe/London)

### Added

- **Policy / version binding** in every local ML-DSA proof envelope payload:
  - `policy_hash` — sha256 hex of canonical (stable key-sorted) policy JSON
  - `version_binding` — `{ sdk_version, circuit_id, attestation_schema, envelope_schema, policy_revision }`
- Helpers: `canonicalPolicyHash`, `buildVersionBinding`, `resolvePolicyHash`, `bindPolicyIntoPayload`
- Constants: `EMPTY_POLICY_HASH`, `EMPTY_POLICY_SENTINEL` (`{"affix.policy":null}`), `ATTESTATION_SCHEMA`, `ENVELOPE_SCHEMA`
- `prove()` accepts optional `policy` / `policyRules` / `policyHash`
- Agentic pay path passes active `AgenticPaymentPolicy.toJSON()` so the signed hash matches the rules that decided allow/deny

### Notes

- Binding is inside the signed payload; tampering `policy_hash` fails `verifyProofEnvelope`
- Empty/missing policy → well-defined sentinel hash (documented constant)
- Offline-first; no Affix API key required for this feature

## 1.4.0 — 2026-09-24 (Europe/London)

### Added (first-party feature pack)

- **Signed tree head (STH)** — ML-DSA-65 verify (`verifySignedRoot`), mock signer for offline tests, optional `fetchSignedRoot` helper
- **Consistency proofs** — `proveConsistency` / `verifyConsistency` for Affix `sha256-sorted-pairs` Merkle trees
- **Offline verify kit** — `verifyArtifactOffline` for inclusion + STH + local attestation without network
- **SpendJournal portable** — `exportSpendJournal` / `verifySpendJournalArtifact`
- **Operator modes** — `createAffixClient({ mode: "local"|"licence"|"anchored" })`
- **Doctor CLI** — offline diagnostics by default; `--live` = heartbeat + proof counts only

### Package surface

- New export paths: `affixio/extensions`, `affixio/sth`, `affixio/offline`
- New bin: `affix-sdk-ext` (also wired as `affix-sdk doctor|verify-offline|verify-spend|verify-sth`)
- Feature modules ship **obfuscated/minified** (no clear feature source, no source maps)

### API key policy (unchanged product rule)

Affix API keys are **only** for heartbeats and proof counts/quota. Core STH, consistency, offline verify, spend-journal portable, and operator `local` mode work fully offline.

### Notes

- Additive to existing prove/verify/dashboard surface — existing `affixio` / `affix-sdk` commands preserved
- Residual: obfuscated JS remains inspectable; raises the bar for casual reverse engineering
