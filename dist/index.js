import { normaliseApiBase } from "./constants.js";
import { SpendJournal as SpendJournalImpl } from "./spend-journal.js";
import { verifyAffixioAttestation as verifyAffixioAttestationFn, affixioKeysUrl, signedVerifyPayload } from "./affixio-keys.js";
import { randomUUID } from "node:crypto";
import { AffixApiClient } from "./client.js";
import { resolveConfig, resolveStorageDrivers } from "./config.js";
import { fieldsExactMatch, runDataCheck, stringsEqualExact, } from "./data-check/index.js";
import { claimDigestField } from "./field-crypto.js";
import { createHttpDataStore, testHttpProfile } from "./http-data-store.js";
import { LicenceLease, LicenceError } from "./licence.js";
import { lightProve, lightVerify, isLightProof } from "./light-prove.js";
import { localProve, localVerify, makeProofId, proofDigest } from "./local-prove.js";
import { buildProofMerkleBatch, MAX_MERKLE_LEAVES, normalizeMerkleAuditLeaf, verifyBatchInclusions, } from "./merkle.js";
import { ensureSecrets, resolveSecrets, loadOperatorConfig, saveOperatorConfig, saveApiKey, loadApiKey, apiKeyHint, defaultOperatorConfig, } from "./operator-config.js";
import { HSM_PROVIDERS, defaultHsmProfile, validateHsmProfile, testHsmConnection, summariseHsmProfile, } from "./hsm.js";
import { OfflineQueue } from "./offline-queue.js";
import { wrapProofEnvelope, verifyProofEnvelope, verifyProofEnvelopeDetailed } from "./proof-envelope.js";
import { AffixTrustError, normalizeTrustedKeys, verifyLocalAttestation as verifyLocalAttestationFn } from "./local-signing.js";
import { checkEnvelopeBinding } from "./envelope-binding.js";
import { bindPolicyIntoPayload, canonicalPolicyHash, buildVersionBinding, resolvePolicyHash, EMPTY_POLICY_HASH, EMPTY_POLICY_SENTINEL, ATTESTATION_SCHEMA, ENVELOPE_SCHEMA, } from "./policy-binding.js";
import { ProofStore } from "./proof-store.js";
import { CodeUseStore, generateZkCode, generateZkCodeFromProve, readZkCode, } from "./codes/index.js";
import { buildYesNoWitness, defaultContext, isAffixCircuit, normaliseWitnessPackage, } from "./witness.js";
import { StatsStore } from "./stats.js";

export class LicenceOnlyError extends Error {
    constructor(message = "licence_only_mode: remote verify, attest, merkle audit, and queue flush are disabled") {
        super(message);
        this.name = "LicenceOnlyError";
    }
}

function assertRemoteAllowed(config) {
    if (config.licenceOnly !== false) {
        throw new LicenceOnlyError();
    }
}

/**
 * AffixIO SDK: licence-only local prove by default (HMAC + ML-DSA envelope).
 * Optional UltraHonk. Affix network limited to API-key heartbeat in licence-only mode.
 */
const DEVICE_ROLES = new Set(["device", "edge", "offline-verifier"]);
let hmacWarned = false;
function warnHmacTrustedPartyOnly(silenced) {
    if (silenced || hmacWarned)
        return;
    hmacWarned = true;
    process.emitWarning?.("AffixIO: verifying an HMAC (affix-light-v1) proof. HMAC verification needs the shared secret, so any verifier can also forge proofs. Use it only on servers / trusted parties. Devices and offline verifiers should use ML-DSA-65 envelope verification with pinned keys, or UltraHonk.", { code: "AFFIXIO_HMAC_TRUSTED_PARTY_ONLY" });
}
function ownKeyOnly(signingKeys) {
    return [{ key_id: signingKeys.key_id, public_key_b64: signingKeys.public_key_b64 }];
}
export class AffixHmacRoleError extends Error {
    code = "hmac_verify_refused_for_role";
    role;
    constructor(role) {
        super(`HMAC (affix-light-v1) verification refused for role="${role}": the shared secret would let this verifier forge proofs. Verify the ML-DSA-65 envelope with pinned keys (verifyLocal(..., { envelope })) or use UltraHonk proofs.`);
        this.name = "AffixHmacRoleError";
        this.role = role;
    }
}
export class AffixSDK {
    client;
    /** Affix API base URL (licence heartbeat only in licence-only mode). */
    apiBase;
    /** Optional customer presentment base for QR/barcode links. Unset = raw carrier only. */
    presentmentBase;
    store;
    queue;
    licence;
    config;
    codeUses;
    stats;
    hmacSecret;
    signingKeys;
    internalStore;
    externalStore;
    autoFlushTimer = null;
    autoFlushIntervalCurrentMs = 5_000;
    /** Serialises manual + auto flush so batches never overlap. */
    flushChain = Promise.resolve();
    lastAutoFlushAt = null;
    lastAutoFlushError = null;
    lastAutoFlushResult = null;
    constructor(config) {
        this.config = resolveConfig(config ?? {});
        const operator = loadOperatorConfig(this.config.operatorBaseDir);
        // 2.0.3 (F2): the operator file's apiBase is only a fallback. It never overrides an explicit
        // config.apiBase or AFFIX_API_BASE, whatever proofMode is.
        const fileApiBase = operator.exists && typeof operator.fileConfig?.apiBase === "string" && operator.fileConfig.apiBase.trim()
            ? normaliseApiBase(operator.fileConfig.apiBase) : null;
        if (fileApiBase && this.config.apiBaseSource === "default") {
            this.config.apiBase = fileApiBase;
            this.config.apiBaseSource = "operator-config";
        }
        else if (fileApiBase && fileApiBase !== this.config.apiBase) {
            process.emitWarning?.(`AffixIO: ${this.config.operatorBaseDir}/config.json apiBase (${fileApiBase}) ignored; using ${this.config.apiBase} from ${this.config.apiBaseSource}.`, { code: "AFFIXIO_API_BASE_FILE_IGNORED" });
        }
        if (operator.exists && config?.proofMode === undefined) {
            this.config.proofMode = operator.config.proofMode ?? this.config.proofMode;
            this.config.licenceOnly = config?.licenceOnly ?? operator.config.licenceOnly ?? this.config.licenceOnly;
            this.config.connections = operator.config.connections ?? this.config.connections;
            if (operator.config.hsm !== undefined)
                this.config.hsm = operator.config.hsm;
            if (operator.config.presentmentBase)
                this.config.presentmentBase = operator.config.presentmentBase;
        }
        const requestedRole = config?.role ?? "server";
        const deviceLike = DEVICE_ROLES.has(requestedRole);
        // 2.0.3 (F1): never persist supplied secrets; writing generated ones is opt-in.
        const persistSecrets = config?.persistSecrets === true;
        if (persistSecrets && !config?.operatorBaseDir)
            throw new Error("persist_secrets_requires_explicit_path: pass operatorBaseDir (an absolute path outside the web root) with persistSecrets: true");
        const secrets = resolveSecrets(this.config.operatorBaseDir, {
            hmacSecret: this.config.hmacSecret,
            signingKeys: this.config.signingKeys,
            existing: operator.secrets,
            persist: persistSecrets,
            signingSeedB64: config?.signingSeedB64,
            // 2.0.0-beta.3: verifier roles do not mint a local signing key unless asked.
            generateSigningKey: config?.generateSigningKey ?? !deviceLike,
            warn: !deviceLike,
        });
        this.secretSources = secrets.sources;
        const storedKey = operator.secrets.apiKey ?? loadApiKey(this.config.operatorBaseDir ?? ".affix");
        if ((!this.config.apiKey || this.config.apiKey === "setup_pending" || this.config.apiKey === "local_operator") && storedKey) {
            this.config.apiKey = storedKey;
        }
        this.hmacSecret = secrets.hmacSecret;
        this.signingKeys = secrets.signingKeys;
        // 2.0.0-beta.2 signer pinning. Local envelopes are signed by this host's own key, so
        // the host's own public key is the default pin. Add peers' keys via trustedSigningKeys.
        this.role = config?.role ?? "server";
        if (!["server", "trusted-party", "device", "edge", "offline-verifier"].includes(this.role))
            throw new TypeError(`invalid_role:${this.role} (use server, trusted-party, device, edge or offline-verifier)`);
        this.insecureTrustEmbeddedKey = config?.insecureTrustEmbeddedKey === true;
        this.silenceHmacWarning = config?.silenceHmacWarning === true;
        // 2.0.0-beta.4: verifier roles reject legacy v1 envelopes by default (they verify v2 gateways).
        // 2.0.2: v1 is rejected for every role by default; servers with stored v1 envelopes opt in with rejectLegacyV1: false.
        this.rejectLegacyV1 = config?.rejectLegacyV1 ?? true;
        const ownKey = this.signingKeys?.public_key_b64
            ? [{ key_id: this.signingKeys.key_id, public_key_b64: this.signingKeys.public_key_b64 }]
            : [];
        // 2.0.0-beta.3: trustOwnSigningKey is always honoured. Verifier roles default to false,
        // so a readable .affix/secrets/mldsa65.json on a device cannot mint accepted envelopes.
        const trustOwn = config?.trustOwnSigningKey ?? !DEVICE_ROLES.has(this.role);
        const extra = config?.trustedSigningKeys;
        const peers = extra === undefined ? [] : [...normalizeTrustedKeys(extra).entries()].map(([id, r]) => ({ key_id: id, public_key_b64: Buffer.from(r.bytes).toString("base64"), status: r.status, not_before: r.not_before, not_after: r.not_after }));
        this.trustedSigningKeys = (trustOwn ? ownKey : []).concat(peers);
        this.apiBase = this.config.apiBase;
        this.presentmentBase = this.config.presentmentBase;
        this.client = new AffixApiClient(this.config);
        const drivers = resolveStorageDrivers(this.config);
        this.store = new ProofStore(drivers.proofs, config?.proofStoreMaxRecords ?? 1000, undefined, { ttlMs: config?.proofStoreTtlMs });
        this.queue = new OfflineQueue(drivers.queue, this.config.maxMerkleLeaves ?? MAX_MERKLE_LEAVES);
        this.licence = new LicenceLease(this.config, drivers.licence);
        this.stats = new StatsStore(drivers.stats);
        // Supplied or in-memory keys are passed as an object; only file-backed keys are passed by path.
        const fileKeys = secrets.sources.signingKeys === "file" || secrets.sources.signingKeys === "generated-persisted";
        this.codeUses = this.config.ephemeralData && !this.config.explicitPaths?.spend
            ? new CodeUseStore(new SpendJournalImpl(null, this.signingKeys ?? null))
            : new CodeUseStore(this.config.spendDir, fileKeys ? (config?.signingKeysPath ?? secrets.paths.signingKeysPath) : (this.signingKeys ?? this.config.signingKeysPath));
        if (this.config.connections?.internal) {
            this.internalStore = createHttpDataStore(this.config.connections.internal, "internal");
        }
        if (this.config.connections?.external) {
            this.externalStore = createHttpDataStore(this.config.connections.external, "external");
        }
        void this.licence.hydrate();
        this.autoFlushIntervalCurrentMs = this.config.autoFlushIntervalMs ?? 5_000;
        if (this.config.autoFlush && this.config.licenceOnly === false) {
            this.startAutoFlush();
        }
    }
    /** Whether the 5s (configurable) auto-flush timer is running. */
    isAutoFlushActive() {
        return this.autoFlushTimer != null;
    }
    async autoFlushStatus() {
        const pending = await this.queue.listPending();
        return {
            active: this.isAutoFlushActive(),
            interval_ms: this.autoFlushIntervalCurrentMs,
            last_at: this.lastAutoFlushAt,
            last_error: this.lastAutoFlushError,
            last_result: this.lastAutoFlushResult,
            pending: pending.length,
        };
    }
    /**
     * Start periodic flush of pending proofs (default every 5s, up to 50_000 leaves).
     * Safe to call more than once. Timer is unref'd so it does not keep Node alive alone.
     */
    startAutoFlush(intervalMs) {
        const ms = Math.max(1000, intervalMs ?? this.config.autoFlushIntervalMs ?? 5_000);
        this.autoFlushIntervalCurrentMs = ms;
        this.stopAutoFlush();
        this.autoFlushTimer = setInterval(() => {
            void this.autoFlushTick();
        }, ms);
        if (typeof this.autoFlushTimer.unref === "function") {
            this.autoFlushTimer.unref();
        }
    }
    /** Stop the auto-flush timer (manual flushOfflineQueue still works). */
    stopAutoFlush() {
        if (this.autoFlushTimer) {
            clearInterval(this.autoFlushTimer);
            this.autoFlushTimer = null;
        }
    }
    /** Stop timers; call when tearing down a long-lived host process. */
    dispose() {
        this.stopAutoFlush();
    }
    async autoFlushTick() {
        const pending = await this.queue.listPending();
        if (pending.length === 0)
            return;
        try {
            const result = await this.flushOfflineQueue();
            this.lastAutoFlushAt = new Date().toISOString();
            this.lastAutoFlushResult = result;
            this.lastAutoFlushError = null;
        }
        catch (err) {
            this.lastAutoFlushAt = new Date().toISOString();
            this.lastAutoFlushError = err instanceof Error ? err.message : String(err);
        }
    }
    runExclusiveFlush(fn) {
        const run = this.flushChain.then(fn, fn);
        this.flushChain = run.then(() => undefined, () => undefined);
        return run;
    }
    /**
     * Persist Affix API key under `.affix/secrets/api.key` (mode 0600) and apply it live.
     * Never written into config.json.
     */
    setApiKey(apiKey) {
        const baseDir = this.config.operatorBaseDir ?? ".affix";
        saveApiKey(baseDir, apiKey);
        this.config.apiKey = apiKey.trim();
        const state = this.licence.refreshKeyHint();
        return { path: `${baseDir}/secrets/api.key`, key_hint: state.key_hint };
    }
    apiKeyStatus() {
        const hint = apiKeyHint(this.config.apiKey);
        const stored = Boolean(loadApiKey(this.config.operatorBaseDir ?? ".affix"));
        const configured = Boolean(this.config.apiKey &&
            this.config.apiKey !== "setup_pending" &&
            this.config.apiKey !== "local_operator");
        return { configured, stored, key_hint: configured ? hint : null };
    }
    hsmStatus() {
        return summariseHsmProfile(this.config.hsm ?? null);
    }
    /**
     * Persist HSM/KMS connection profile (no PINs or cloud secrets in config).
     * Credentials stay in environment variables named by the profile.
     */
    async setHsmProfile(profile) {
        this.licence.assertEntitlement("hsm_integration");
        const validation = validateHsmProfile(profile);
        if (!validation.ok) {
            throw new Error(validation.error ?? "invalid_hsm_profile");
        }
        const next = { ...defaultHsmProfile(profile.provider), ...profile, enabled: profile.enabled !== false };
        this.config.hsm = next;
        const { config } = loadOperatorConfig(this.config.operatorBaseDir ?? ".affix");
        const merged = { ...defaultOperatorConfig(), ...config, hsm: next };
        saveOperatorConfig(this.config.operatorBaseDir ?? ".affix", merged);
        await this.stats.bump("hsm.configured");
        return summariseHsmProfile(next);
    }
    async clearHsmProfile() {
        this.config.hsm = null;
        const { config } = loadOperatorConfig(this.config.operatorBaseDir ?? ".affix");
        const merged = { ...defaultOperatorConfig(), ...config, hsm: null };
        saveOperatorConfig(this.config.operatorBaseDir ?? ".affix", merged);
        return { configured: false };
    }
    async testHsm() {
        if (!this.config.hsm) {
            return { ok: false, error: "hsm_not_configured" };
        }
        const result = await testHsmConnection(this.config.hsm);
        await this.stats.bump(result.ok ? "hsm.probe_ok" : "hsm.probe_fail");
        return result;
    }
    /** Forced licence ping (also used by random schedule). */
    async checkLicence(force = true) {
        return this.licence.check(force);
    }
    /** Instant policy pulse after Hub plan or quota changes. */
    async pulseLicence(force = true) {
        return this.licence.pulse(force);
    }
    licenceState() {
        return this.licence.getState();
    }
    async isOnline() {
        if (this.config.licenceOnly !== false) {
            const state = this.licence.getState();
            return state.ok;
        }
        try {
            const health = await this.client.health();
            return health.status === "ok";
        }
        catch {
            return false;
        }
    }
    async statsSnapshot() {
        return this.stats.snapshot();
    }
    spendStatus() {
        return this.codeUses.spendJournal().status();
    }
    verifySpendJournal() {
        return this.codeUses.spendJournal().verifyIntegrity();
    }
    /**
     * verifyLocalAttestation with this instance's role defaults: pinned keys, rejectLegacyV1
     * (true for verifier roles), HMAC only for trusted-party roles, insecure flag. Options override.
     */
    verifyLocalAttestation(payload, attestation, options = {}) {
        const deviceRole = DEVICE_ROLES.has(this.role);
        return verifyLocalAttestationFn(payload, attestation, {
            trustedKeys: this.trustedSigningKeys,
            hmacSecret: deviceRole ? undefined : this.hmacSecret,
            insecureTrustEmbeddedKey: this.insecureTrustEmbeddedKey,
            rejectLegacyV1: this.rejectLegacyV1,
            ...options,
        });
    }
    /** Public keys this SDK pins for local envelope verification (no secret material). */
    trustedKeys() {
        const seen = new Set();
        return this.trustedSigningKeys.filter((k) => !seen.has(k.public_key_b64) && seen.add(k.public_key_b64))
            .map((k) => ({ algorithm: "ML-DSA-65", key_id: k.key_id, public_key_b64: k.public_key_b64 }));
    }
    exportLocalPublicKey() {
        if (!this.signingKeys)
            throw new Error("no_local_signing_key: this SDK has no local ML-DSA key (verifier role). Pass generateSigningKey: true or signingKeys to sign.");
        return {
            algorithm: "ML-DSA-65",
            key_id: this.signingKeys.key_id,
            public_key_b64: this.signingKeys.public_key_b64,
        };
    }
    /**
     * Operator configuration and paths. Secret material is never returned,
     * only presence flags, so this is safe to log or display.
     */
    operatorConfig() {
        const { config, paths, secrets } = loadOperatorConfig(this.config.operatorBaseDir ?? ".affix");
        return {
            config,
            paths,
            secrets: {
                hmac_secret_present: Boolean(secrets.hmacSecret),
                api_key_present: Boolean(secrets.apiKey),
                signing_key_id: secrets.signingKeys?.key_id ?? null,
            },
        };
    }
    async saveOperatorConfig(config) {
        saveOperatorConfig(this.config.operatorBaseDir ?? ".affix", config);
    }
    async testConnections() {
        const out = { licence: null, internal: null, external: null, hsm: null };
        try {
            const ok = await this.checkLicence(true);
            out.licence = { ok, state: this.licenceState() };
            await this.stats.bump(ok ? "licence.ok" : "licence.expired");
        }
        catch (err) {
            out.licence = { ok: false, error: err instanceof Error ? err.message : String(err) };
            await this.stats.bump("licence.unreachable");
        }
        if (this.config.connections?.internal) {
            out.internal = await testHttpProfile(this.config.connections.internal);
            await this.stats.bump(out.internal.ok ? "connections.internal_ok" : "connections.internal_fail");
        }
        if (this.config.connections?.external) {
            out.external = await testHttpProfile(this.config.connections.external);
            await this.stats.bump(out.external.ok ? "connections.external_ok" : "connections.external_fail");
        }
        if (this.config.hsm) {
            out.hsm = await this.testHsm();
        }
        return out;
    }
    async listStoredProofs() {
        return this.store.list();
    }
    async listPendingSync() {
        return this.queue.listPending();
    }
    async listOfflineQueue() {
        return this.queue.listAll();
    }
    /**
     * Enqueue a local proof for Affix verify + attestation on flushOfflineQueue.
     * Used when a scan admits offline and still needs Affix signing later.
     */
    async queueProofForAffix(input) {
        assertRemoteAllowed(this.config);
        await this.queue.enqueue({
            id: randomUUID(),
            proof_id: input.proof_id,
            circuit_id: input.circuit_id,
            proof: input.proof,
            proof_digest: input.proof_digest,
            valid: input.valid ?? true,
            decision: input.decision ?? "yes",
            origin: input.origin ?? "code_scan",
            request_id: input.request_id,
            meta: input.meta,
        });
    }
    buildWitness(circuitId, credential, context) {
        return buildYesNoWitness(circuitId, credential, defaultContext(context));
    }
    resolveWitness(input, circuitId) {
        let witness;
        if (input.witness) {
            witness = input.witness;
        }
        else if (input.credential) {
            witness = this.buildWitness(circuitId, input.credential, input.context);
        }
        else if (input.fields) {
            const mapped = {};
            for (const [k, v] of Object.entries(input.fields)) {
                mapped[k] = String(v);
            }
            witness = { circuit_id: circuitId, inputs: mapped };
        }
        else {
            throw new Error("prove_requires_witness_or_credential_or_fields");
        }
        if (witness.circuit_id !== circuitId) {
            witness = { ...witness, circuit_id: circuitId };
        }
        return normaliseWitnessPackage(witness);
    }
    /**
     * Generate a ZK proof locally (never Affix prove).
     * Works offline (mode offline/auto when network down) and online.
     */
    async prove(input) {
        const mode = input.mode ?? "auto";
        let offline = mode === "offline";
        if (mode === "online") {
            await this.licence.assertLicensed();
            offline = false;
        }
        else if (mode === "offline") {
            if (!this.config.allowOfflineProve) {
                throw new LicenceError("Offline prove disabled (allowOfflineProve=false).");
            }
            offline = true;
        }
        else {
            const gate = await this.licence.assertForLocalProve();
            offline = gate.offline;
        }
        await this.licence.ensureFreshPolicy();
        const circuitId = input.circuitId ?? "simple_yesno";
        if (!isAffixCircuit(circuitId)) {
            throw new Error(`unsupported_circuit:${circuitId}. Use yesno or simple_yesno.`);
        }
        const proofMode = input.proofMode ?? this.config.proofMode ?? "hmac";
        if (proofMode === "ultrahonk") {
            this.licence.assertEntitlement("ultrahonk_zkp");
        }
        const witness = this.resolveWitness(input, circuitId);
        let proved;
        if (proofMode === "ultrahonk") {
            proved = await localProve(witness);
            proved.proofMode = "ultrahonk";
        }
        else {
            proved = lightProve(witness, this.hmacSecret, {
                decision: input.decision,
            });
            proved.proofMode = "hmac";
        }
        const digest = proofDigest(proved.proof, circuitId, proved.valid);
        const request_id = input.request_id ?? randomUUID();
        const origin = input.origin ?? "manual";
        const proof_id = makeProofId();
        const licenceState = this.licence.getState?.() ?? {};
        const policyRevision =
            licenceState.policy_revision ??
            licenceState.quota?.policy_revision ??
            null;
        if (!this.signingKeys)
            throw new Error("no_local_signing_key: verifier roles (device/edge/offline-verifier) do not sign by default. Pass generateSigningKey: true or signingKeys.");
        const envelopePayload = bindPolicyIntoPayload({
            proof_id,
            circuit_id: circuitId,
            proof: proved.proof,
            proof_digest: digest,
            valid: proved.valid,
            // 2.0.3: always sign the decision (UltraHonk localProve returns none), matching
            // result.decision, so verifyLocal(..., { envelope }) accepts the SDK's own envelopes.
            decision: typeof proved.decision === "string" ? proved.decision : (proved.valid ? "yes" : "no"),
            proof_mode: proofMode,
            request_id,
            origin,
        }, {
            policy: input.policy,
            policyRules: input.policyRules,
            policyHash: input.policyHash ?? input.policy_hash,
            circuitId,
            policyRevision,
        });
        const envelope = wrapProofEnvelope(envelopePayload, {
            hmacSecret: this.hmacSecret,
            signingKeys: this.signingKeys,
        });
        if (!verifyProofEnvelope(envelope, this.hmacSecret, { trustedKeys: ownKeyOnly(this.signingKeys) })) {
            await this.stats.bump("proofs.mldsa65_sign_failures");
            throw new Error("mldsa65_proof_signature_verification_failed");
        }
        const signature = {
            signed: true,
            algorithm: "ML-DSA-65",
            key_id: envelope.attestation.key_id,
            signed_at: envelope.attestation.signed_at,
            signature_b64: envelope.attestation.mldsa_signature_b64,
            public_key_b64: envelope.attestation.mldsa_public_key_b64,
        };
        const pendingSync = this.config.licenceOnly === false &&
            (input.queueForSync ?? this.config.queueUnsyncedProofs ?? false);
        const result = {
            proof_id,
            circuit_id: circuitId,
            proof: proved.proof,
            valid: proved.valid,
            decision: proved.valid ? "yes" : "no",
            proof_digest: digest,
            return_value: proved.returnValue,
            source: "local",
            offline,
            pending_sync: pendingSync,
            proof_mode: proofMode,
            envelope,
            signature,
            witness,
            request_id,
            origin,
            record_id: input.record_id,
            meta: input.meta,
        };
        await this.stats.bump(`proofs.${proofMode}`);
        await this.stats.bump(proved.valid ? "proofs.yes" : "proofs.no");
        await this.stats.bump("proofs.mldsa65_signed");
        try {
            await this.licence.consumeQuota(1);
        }
        catch (err) {
            await this.stats.bump("quota.consume_failures");
            throw err;
        }
        await this.store.save({
            proof_id: result.proof_id,
            circuit_id: result.circuit_id,
            proof: result.proof,
            proof_digest: result.proof_digest,
            valid: result.valid,
            decision: result.decision,
            proof_mode: proofMode,
            envelope,
            signature,
            created_at: new Date().toISOString(),
            offline,
            synced: !pendingSync,
            request_id,
            origin,
            record_id: input.record_id,
            meta: input.meta,
        });
        if (pendingSync) {
            await this.queue.enqueue({
                id: randomUUID(),
                proof_id: result.proof_id,
                circuit_id: result.circuit_id,
                proof: result.proof,
                proof_digest: result.proof_digest,
                valid: result.valid,
                decision: result.decision,
                request_id,
                origin,
                record_id: input.record_id,
                meta: input.meta,
            });
        }
        return result;
    }
    /**
     * Verify a proof locally (HMAC or UltraHonk) with optional ML-DSA envelope check.
     */
    async verifyLocal(circuitId, proofHex, options = {}) {
        if (!isAffixCircuit(circuitId)) {
            throw new Error(`unsupported_circuit:${circuitId}`);
        }
        const light = isLightProof(proofHex);
        const deviceRole = DEVICE_ROLES.has(this.role);
        if (light && deviceRole) {
            // affix-light-v1 is a shared-secret MAC: anyone able to verify it can also forge it.
            throw new AffixHmacRoleError(this.role);
        }
        if (light)
            warnHmacTrustedPartyOnly(this.silenceHmacWarning);
        let result;
        try {
            result = light
                ? lightVerify(circuitId, proofHex, this.hmacSecret)
                : await localVerify(circuitId, proofHex);
        }
        catch {
            // A tampered or truncated carrier must fail closed, never surface a parser error.
            result = { valid: false, decision: "no", reason: "malformed_proof", proofMode: "unknown" };
        }
        if (options.envelope) {
            const trustedKeys = options.trustedKeys ?? this.trustedSigningKeys;
            const env = verifyProofEnvelopeDetailed(options.envelope, {
                trustedKeys,
                // Devices verify the ML-DSA signature only; the HMAC is for trusted parties.
                hmacSecret: deviceRole ? undefined : this.hmacSecret,
                requireHmac: !deviceRole && !options.skipHmac,
                insecureTrustEmbeddedKey: options.insecureTrustEmbeddedKey ?? this.insecureTrustEmbeddedKey,
                allowLegacyUnsignedTime: options.allowLegacyUnsignedTime,
                rejectLegacyV1: options.rejectLegacyV1 ?? this.rejectLegacyV1,
            });
            // 2.0.0-beta.4: the envelope must commit to THIS proof and circuit.
            const binding = env.valid
                ? checkEnvelopeBinding(options.envelope.payload, { proof: proofHex, circuitId, proofMode: result.proofMode ?? (light ? "hmac" : "ultrahonk"), decision: typeof result.decision === "string" && result.valid ? result.decision : undefined, allowMissingDecision: options.allowMissingDecision === true })
                : { bound: false, reason: env.reason };
            result.envelope_ok = env.valid && binding.bound;
            result.envelope_reason = env.valid && !binding.bound ? binding.reason : env.reason;
            result.envelope_key_id = env.key_id;
        }
        const overallValid = result.valid === true && (options.envelope ? result.envelope_ok === true : true);
        await this.stats.bump(overallValid ? "verify.local_ok" : "verify.local_fail");
        return {
            proof_id: options.proofId ?? "",
            // 2.0.0-beta.3: a supplied envelope must verify for the result to be valid.
            valid: overallValid,
            verified: overallValid,
            proof_valid: result.valid,
            decision: overallValid && (result.decision === "yes" || result.valid) ? "yes" : "no",
            circuit_id: circuitId,
            proof_digest: proofDigest(proofHex, circuitId, result.valid),
            proof_mode: result.proofMode ?? (light ? "hmac" : "ultrahonk"),
            source: "local",
            envelope_ok: result.envelope_ok,
            envelope_reason: result.envelope_reason,
            envelope_key_id: result.envelope_key_id,
            reason: result.reason,
        };
    }
    /**
     * Build a digests Merkle batch (≤ 50_000) for client packing + Affix leaf validation.
     * Pass `items` to override the offline queue / stored proofs source.
     */
    async buildMerkleBatch(itemsOrOptions, maybeOptions) {
        let items;
        let options;
        if (Array.isArray(itemsOrOptions)) {
            items = itemsOrOptions;
            options = maybeOptions;
        }
        else {
            options = itemsOrOptions;
        }
        if (items && items.length > 0) {
            return buildProofMerkleBatch(items, {
                maxLeaves: this.config.maxMerkleLeaves ?? MAX_MERKLE_LEAVES,
                includeProofBytes: options?.includeProofBytes ?? items.length <= 1_000,
            });
        }
        const maxItems = options?.maxItems ?? this.config.maxMerkleLeaves ?? MAX_MERKLE_LEAVES;
        const pending = (await this.queue.listPending()).slice(0, maxItems);
        if (pending.length === 0) {
            const stored = (await this.store.list()).slice(0, maxItems);
            if (stored.length === 0) {
                throw new Error("merkle_batch_empty");
            }
            return buildProofMerkleBatch(stored.map((j) => ({
                proof_id: j.proof_id,
                circuit_id: j.circuit_id,
                proof_digest: j.proof_digest,
                proof: j.proof,
            })), {
                maxLeaves: this.config.maxMerkleLeaves ?? MAX_MERKLE_LEAVES,
                includeProofBytes: options?.includeProofBytes ?? stored.length <= 1_000,
            });
        }
        return buildProofMerkleBatch(pending.map((j) => ({
            proof_id: j.proof_id,
            circuit_id: j.circuit_id,
            proof_digest: j.proof_digest,
            proof: j.proof,
        })), {
            maxLeaves: this.config.maxMerkleLeaves ?? MAX_MERKLE_LEAVES,
            includeProofBytes: options?.includeProofBytes ?? pending.length <= 1_000,
        });
    }
    /**
     * Verify via AffixIO API (same contract as @affix-io/sdk verify).
     * Online only. On failure with queueOnFailure, enqueues proof for later flush.
     */
    async verify(circuitId, proof, requestAttestation = true, opts) {
        assertRemoteAllowed(this.config);
        await this.licence.assertLicensed();
        if (!isAffixCircuit(circuitId)) {
            throw new Error(`unsupported_circuit:${circuitId}`);
        }
        try {
            const data = await this.client.verify(circuitId, {
                proof,
                requestAttestation: requestAttestation ?? this.config.requestAttestation,
                sector: this.config.sector,
            });
            // 2.0.3 (F3): keep the response exactly as received and check the API attestation
            // here, against pinned AffixIO keys. The signed fields are never normalised away.
            const signed = signedVerifyPayload(data);
            let attestation_valid = null;
            let attestation_reason = "not_requested";
            let attestation_key_id = null;
            if (data.attestation) {
                try {
                    const r = await verifyAffixioAttestationFn(signed, data.attestation, {
                        kind: "verify",
                        expectedCircuitId: circuitId,
                        allowVkOnly: opts?.allowVkOnly === true,
                        trustedKeys: opts?.affixioKeys ?? this.config.affixioKeys,
                        url: affixioKeysUrl(this.apiBase),
                        expectedKeys: opts?.expectedKeys ?? this.config.affixioExpectedKeys,
                        expectedKeySetHash: opts?.expectedKeySetHash ?? this.config.affixioExpectedKeySetHash,
                        allowLegacyUnsignedTime: opts?.allowLegacyUnsignedTime,
                    });
                    attestation_valid = r.valid;
                    attestation_reason = r.reason;
                    attestation_key_id = r.key_id ?? null;
                }
                catch (err) {
                    attestation_valid = false;
                    attestation_reason = err?.code ?? "attestation_check_failed";
                }
            }
            else if (requestAttestation ?? this.config.requestAttestation) {
                attestation_valid = false;
                attestation_reason = "attestation_missing";
            }
            if (opts?.requireValidAttestation && attestation_valid !== true)
                throw new Error(`affixio_attestation_invalid:${attestation_reason}`);
            return {
                proof_id: String(data.proof_id ?? opts?.proofId ?? ""),
                valid: Boolean(data.valid),
                verified: Boolean(data.verified ?? data.valid),
                decision: data.decision === "yes" ? "yes" : "no",
                // 2.0.3: the server's view of the circuit, not the caller's argument. null when the
                // server could not bind the proof to one circuit (circuit_binding "vk_only").
                circuit_id: data.bound_circuit_id !== undefined ? data.bound_circuit_id : (typeof data.circuit_id === "string" ? data.circuit_id : null),
                requested_circuit_id: circuitId,
                circuit_binding: typeof data.circuit_binding === "string" ? data.circuit_binding : null,
                vk_hash: typeof data.vk_hash === "string" ? data.vk_hash : null,
                proof_digest: String(data.proof_digest ?? opts?.proofDigest ?? ""),
                merkle_root: typeof data.merkle_root === "string" ? data.merkle_root : undefined,
                merkle_leaf_hash: typeof data.merkle_leaf_hash === "string" ? data.merkle_leaf_hash : undefined,
                engine: data.engine,
                proof_ref: data.proof_ref,
                return_value: data.return_value,
                policy_version: data.policy_version,
                attestation: data.attestation,
                attestation_valid,
                attestation_reason,
                attestation_key_id,
                /** Exactly the object the API signed (pass to verifyAffixioAttestation yourself if you like). */
                signed_payload: signed,
                /** The full response as received. */
                raw: data,
            };
        }
        catch (err) {
            if (opts?.queueOnFailure !== false && opts?.proofDigest && opts?.proofId) {
                await this.queue.enqueue({
                    id: randomUUID(),
                    proof_id: opts.proofId,
                    circuit_id: circuitId,
                    proof,
                    proof_digest: opts.proofDigest,
                    valid: true,
                    decision: "yes",
                });
            }
            throw err;
        }
    }
    /**
     * Lookup a record via a data-check adapter (JSON, KV, CSV, fixed-width, pipe).
     * Returns exact string fields; pass ⇔ fields.claim === fields.required.
     */
    async check(source, query) {
        this.licence.assertEntitlement("db_adapters");
        if (source === "internal" && this.internalStore) {
            return this.internalStore.lookup(query);
        }
        if (source === "external" && this.externalStore) {
            return this.externalStore.lookup(query);
        }
        return runDataCheck(source, query);
    }
    /**
     * Data check → one local yes/no proof per request, Affix-bound like any other prove.
     *
     * - Fresh `request_id` + `proof_id` every call (never shared across requests).
     * - Unique credential_id / context_id so nullifiers differ per request.
     * - Queued for Affix verify + merkle audit by default (`queueForSync` / config).
     * - Set `verifyRemote: true` (online) to hit Affix verify immediately (proveAndVerify path).
     *
     * claim → credential.claim_value; required → required_claim_hash.
     * decision is "yes" only when those strings are equal (same as check.pass).
     */
    async proveFromCheck(input) {
        if (input.verifyRemote) {
            const both = await this.proveFromCheckAndVerify(input);
            return both.prove;
        }
        const check = typeof input.check === "function" ? await input.check() : input.check;
        if (!check) {
            throw new Error("data_check_record_not_found");
        }
        const pass = stringsEqualExact(check.fields.claim, check.fields.required);
        if (pass !== check.pass) {
            throw new Error("data_check_pass_fields_mismatch");
        }
        const circuitId = input.circuitId ?? "simple_yesno";
        const now = Math.floor(Date.now() / 1000);
        const claim = check.fields.claim;
        const required = check.fields.required;
        const request_id = input.request_id ?? randomUUID();
        // Per-request uniqueness for witness/nullifier (same claim string can be proved many times)
        const credential_id = input.credential_id ?? `dc:${check.record_id ?? "row"}:${request_id}`;
        const context_id = input.context_id ?? claimDigestField(`data_check_ctx:${request_id}`);
        const secret = input.secret ?? claimDigestField(`data_check_sec:${request_id}`);
        const credential = {
            schema_id: input.schema_id ?? "affix_data_check",
            issuer_id: input.issuer_id ?? "local_store",
            issuer_pubkey_hash: input.issuer_pubkey_hash ?? "0x1",
            credential_id,
            claim_value: claim,
            valid_from: input.valid_from ?? now - 60,
            valid_until: input.valid_until ?? now + 86_400 * 30,
            fields: { ...check.fields },
        };
        const meta = {
            source: check.source,
            style: check.style,
            pass: pass ? "true" : "false",
            ...(check.meta ?? {}),
        };
        const prove = await this.prove({
            circuitId,
            mode: input.mode ?? "auto",
            queueForSync: input.queueForSync,
            request_id,
            origin: "data_check",
            record_id: check.record_id,
            meta,
            credential,
            context: {
                secret,
                context_id,
                required_claim_hash: required,
            },
        });
        const expectYes = pass;
        const decisionOk = expectYes ? prove.decision === "yes" : prove.decision === "no";
        const fieldsCopy = { ...check.fields };
        if (!fieldsExactMatch(fieldsCopy, check.fields)) {
            throw new Error("data_check_fields_copy_failed");
        }
        return {
            ...prove,
            fields: fieldsCopy,
            check: {
                ...check,
                fields: { ...check.fields },
            },
            field_aligned: decisionOk && pass === (prove.decision === "yes"),
        };
    }
    /**
     * Data check → local prove → Affix verify + attest (same as proveAndVerify).
     * One request → one proof → one Affix verify round-trip.
     * On verify failure the proof is re-queued for flush (like other proofs).
     */
    async proveFromCheckAndVerify(input) {
        assertRemoteAllowed(this.config);
        const mode = input.mode === "offline" ? "offline" : "online";
        const prove = await this.proveFromCheck({
            ...input,
            mode,
            verifyRemote: false,
            queueForSync: false,
        });
        if (prove.offline && input.mode !== "online") {
            // Still enqueue so flush can attach it to Affix later
            await this.queue.enqueue({
                id: randomUUID(),
                proof_id: prove.proof_id,
                circuit_id: prove.circuit_id,
                proof: prove.proof,
                proof_digest: prove.proof_digest,
                valid: prove.valid,
                decision: prove.decision,
                request_id: prove.request_id,
                origin: "data_check",
                record_id: prove.record_id,
                meta: prove.meta,
            });
            throw new Error("prove_from_check_and_verify_requires_online");
        }
        const verify = await this.verify(prove.circuit_id, prove.proof, input.requestAttestation ?? true, {
            proofId: prove.proof_id,
            proofDigest: prove.proof_digest,
            queueOnFailure: true,
        });
        await this.queue.markSynced(prove.proof_id);
        await this.store.save({
            proof_id: prove.proof_id,
            circuit_id: prove.circuit_id,
            proof: prove.proof,
            proof_digest: prove.proof_digest,
            valid: prove.valid,
            decision: prove.decision,
            created_at: new Date().toISOString(),
            offline: false,
            synced: true,
            request_id: prove.request_id,
            origin: "data_check",
            record_id: prove.record_id,
            meta: prove.meta,
        });
        return {
            prove: { ...prove, offline: false, pending_sync: false },
            verify,
        };
    }
    /**
     * Convenience: lookup + prove in one call (each invocation = one Affix-bound proof).
     */
    async checkAndProve(source, query, opts) {
        const check = await this.check(source, query);
        if (!check) {
            throw new Error("data_check_record_not_found");
        }
        return this.proveFromCheck({ ...opts, check });
    }
    /** Generate a PII-free QR or barcode carrying a local ZK proof (standard scanner readable). */
    generateCode(input) {
        this.licence.assertEntitlement("qr_carriers");
        return generateZkCode(this, input);
    }
    /** Prove locally then render a QR or barcode (no PII in the scannable payload). */
    generateCodeFromProve(input) {
        this.licence.assertEntitlement("qr_carriers");
        return generateZkCodeFromProve(this, input);
    }
    /**
     * Data check → local prove → QR/barcode. Sidecar holds full proof; carrier has no patient fields.
     */
    async generateCodeFromCheck(input) {
        const { kind, symbology, format, embedProof, maxUses, exp, validFrom, ecLevel, label, save, ...proveInput } = input;
        const proved = await this.proveFromCheck({ ...proveInput, verifyRemote: false });
        const code = await generateZkCode(this, {
            prove: proved,
            kind,
            symbology,
            format,
            embedProof,
            maxUses,
            exp,
            validFrom,
            ecLevel,
            label,
            save,
        });
        return { ...code, check: proved.check };
    }
    /** Scan QR/barcode online or offline; Affix signs when reachable, else local + queue. */
    readCode(input) {
        return readZkCode(this, input, this.codeUses);
    }
    /** Local prove then remote Affix verify + attest (online). */
    async proveAndVerify(input) {
        assertRemoteAllowed(this.config);
        const prove = await this.prove({ ...input, mode: input.mode === "offline" ? "offline" : "online", queueForSync: false });
        if (prove.offline && input.mode !== "online") {
            // Offline prove path: cannot verify until flush
            throw new Error("prove_and_verify_requires_online");
        }
        const verify = await this.verify(input.circuitId ?? "simple_yesno", prove.proof, true, {
            proofId: prove.proof_id,
            proofDigest: prove.proof_digest,
            queueOnFailure: true,
        });
        await this.queue.markSynced(prove.proof_id);
        return { prove, verify };
    }
    /**
     * Push pending offline proofs to AffixIO:
     * 1) Build client Merkle batch over digests (up to 50_000 leaves)
     * 2) Affix circuit verify each proof with ML-DSA-65 attestation (parallel workers)
     * 3) Affix anchors each admitted digest into the API Merkle tree on verify
     *
     * Every synced proof must carry an Affix ML-DSA attestation when requestAttestation
     * is true (default). Aggregate-only verify is not used for production admits.
     *
     * With autoFlush (default), this also runs about every 5 seconds when the queue is non-empty.
     * Manual and auto flushes share one lock so batches never overlap.
     */
    async flushOfflineQueue(options) {
        return this.runExclusiveFlush(() => this.doFlushOfflineQueue(options));
    }
    async doFlushOfflineQueue(options) {
        assertRemoteAllowed(this.config);
        const pendingEarly = await this.queue.listPending();
        if (pendingEarly.length === 0) {
            return { online: true, attempted: 0, synced: 0, failed: 0, attested: 0, results: [] };
        }
        const online = await this.isOnline();
        if (!online) {
            return {
                online: false,
                attempted: 0,
                synced: 0,
                failed: 0,
                attested: 0,
                results: [],
            };
        }
        await this.licence.assertLicensed();
        const maxItems = Math.min(options?.maxItems ?? this.config.maxMerkleLeaves ?? MAX_MERKLE_LEAVES, this.config.maxMerkleLeaves ?? MAX_MERKLE_LEAVES);
        const pending = (await this.queue.listPending()).slice(0, maxItems);
        if (pending.length === 0) {
            return { online: true, attempted: 0, synced: 0, failed: 0, attested: 0, results: [] };
        }
        const wantAttest = options?.requestAttestation ?? this.config.requestAttestation ?? true;
        const includeProofBytes = pending.length <= 1_000;
        const batch = buildProofMerkleBatch(pending.map((j) => ({
            proof_id: j.proof_id,
            circuit_id: j.circuit_id,
            proof_digest: j.proof_digest,
            proof: j.proof,
        })), {
            maxLeaves: this.config.maxMerkleLeaves ?? MAX_MERKLE_LEAVES,
            includeProofBytes,
        });
        const selfOk = batch.leaf_count <= 5_000
            ? verifyBatchInclusions(batch)
            : verifyBatchInclusions(batch, {
                sampleIndices: [
                    0,
                    1,
                    Math.floor(batch.leaf_count / 2),
                    batch.leaf_count - 2,
                    batch.leaf_count - 1,
                ].filter((i) => i >= 0 && i < batch.leaf_count),
            });
        if (!selfOk) {
            throw new Error("merkle_batch_self_check_failed");
        }
        const concurrency = this.config.flushConcurrency ?? 4;
        const results = [];
        const admitted = [];
        let failed = 0;
        let attested = 0;
        let merkle_api_root;
        let merkle_leaves_synced = 0;
        const leafT0 = Date.now();
        if (!options?.digestsOnly) {
            // Production path: every proof → Affix circuit verify + ML-DSA + Merkle leaf.
            let next = 0;
            const self = this;
            async function worker() {
                while (next < pending.length) {
                    const ji = next++;
                    const job = pending[ji];
                    try {
                        const v = await self.verify(job.circuit_id, job.proof, wantAttest, {
                            proofId: job.proof_id,
                            proofDigest: job.proof_digest,
                            queueOnFailure: false,
                        });
                        if (!v.verified) {
                            failed += 1;
                            await self.queue.markFailed(job.id, "VERIFY_DENY");
                            results.push({ proof_id: job.proof_id, ok: false, error: "verify_deny", verify: v });
                            continue;
                        }
                        if (wantAttest && !v.attestation?.mldsa_signature_b64) {
                            failed += 1;
                            await self.queue.markFailed(job.id, "ATTEST_MISSING");
                            results.push({
                                proof_id: job.proof_id,
                                ok: false,
                                error: "attest_missing",
                                verify: v,
                            });
                            continue;
                        }
                        if (v.attestation?.mldsa_signature_b64)
                            attested += 1;
                        if (v.merkle_root)
                            merkle_api_root = v.merkle_root;
                        if (v.merkle_leaf_hash)
                            merkle_leaves_synced += 1;
                        admitted.push(job);
                        results.push({
                            proof_id: job.proof_id,
                            ok: true,
                            verify: v,
                            merkle_audit: v.merkle_root
                                ? {
                                    merkle_root: v.merkle_root,
                                    merkle_leaf_hash: v.merkle_leaf_hash,
                                    mode: "verify",
                                }
                                : undefined,
                        });
                    }
                    catch (err) {
                        failed += 1;
                        await self.queue.bumpAttempt(job.id, err instanceof Error ? err.message : String(err));
                        results.push({
                            proof_id: job.proof_id,
                            ok: false,
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
            }
            await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, pending.length)) }, () => worker()));
        }
        else {
            // Digests-only: still ML-DSA-sign each digest payload, then Merkle audit.
            for (const job of pending) {
                try {
                    const payload = {
                        proof_id: job.proof_id,
                        circuit_id: job.circuit_id,
                        proof_digest: job.proof_digest.replace(/^0x/, "").toLowerCase(),
                        valid: job.valid,
                        verified: true,
                        decision: job.decision,
                        event: "verified",
                        mode: "digests_only",
                    };
                    let attestation;
                    if (wantAttest) {
                        const signed = await this.client.attest(payload);
                        attestation = signed.attestation;
                        if (!attestation?.mldsa_signature_b64) {
                            failed += 1;
                            await this.queue.markFailed(job.id, "ATTEST_MISSING");
                            results.push({ proof_id: job.proof_id, ok: false, error: "attest_missing" });
                            continue;
                        }
                        attested += 1;
                    }
                    const one = await this.client.merkleAudit({
                        digest: payload.proof_digest,
                        circuit_id: job.circuit_id,
                        proof_id: job.proof_id,
                        event: "verified",
                    });
                    const leaf = normalizeMerkleAuditLeaf(one);
                    merkle_leaves_synced += 1;
                    merkle_api_root = leaf.merkle_root ?? merkle_api_root;
                    admitted.push(job);
                    results.push({
                        proof_id: job.proof_id,
                        ok: true,
                        verify: {
                            proof_id: job.proof_id,
                            valid: job.valid,
                            verified: true,
                            decision: job.decision,
                            circuit_id: job.circuit_id,
                            proof_digest: job.proof_digest,
                            merkle_root: leaf.merkle_root,
                            merkle_leaf_hash: leaf.merkle_leaf_hash,
                            attestation,
                        },
                        merkle_audit: one,
                    });
                }
                catch (err) {
                    failed += 1;
                    await this.queue.bumpAttempt(job.id, err instanceof Error ? err.message : String(err));
                    results.push({
                        proof_id: job.proof_id,
                        ok: false,
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        }
        const leafElapsed = Date.now() - leafT0;
        const merkle_leaves_per_sec = merkle_leaves_synced > 0 && leafElapsed > 0
            ? Math.round((merkle_leaves_synced / leafElapsed) * 1000)
            : undefined;
        await this.queue.markSyncedMany(admitted.map((j) => j.id));
        const synced = admitted.length;
        const resultByProof = new Map(results.filter((r) => r.ok).map((r) => [r.proof_id, r]));
        const attestedAt = new Date().toISOString();
        for (const job of admitted) {
            const row = resultByProof.get(job.proof_id);
            const attestation = row?.verify?.attestation;
            await this.store.save({
                proof_id: job.proof_id,
                circuit_id: job.circuit_id,
                proof: job.proof,
                proof_digest: job.proof_digest,
                valid: job.valid,
                decision: job.decision,
                created_at: job.created_at,
                offline: false,
                synced: true,
                merkle_root: row?.verify?.merkle_root,
                merkle_leaf_hash: row?.verify?.merkle_leaf_hash,
                attestation,
                attested_at: attestation?.mldsa_signature_b64 ? attestedAt : undefined,
                request_id: job.request_id,
                origin: job.origin,
                record_id: job.record_id,
                meta: job.meta,
            });
        }
        return {
            online: true,
            attempted: pending.length,
            synced,
            failed,
            attested,
            merkle_batch_root: batch.root,
            merkle_batch_id: batch.batch_id,
            merkle_leaf_count: batch.leaf_count,
            merkle_api_root,
            merkle_leaves_synced,
            merkle_leaves_per_sec,
            verify_chunks: pending.length,
            results,
        };
    }
    /**
     * Register digests as Affix Merkle leaves and ML-DSA-attest each payload (no ZK).
     * Prefer flushOfflineQueue for production (ZK + ML-DSA + Merkle on verify).
     */
    async anchorPendingLeaves(options) {
        assertRemoteAllowed(this.config);
        await this.licence.assertLicensed();
        const maxItems = Math.min(options?.maxItems ?? MAX_MERKLE_LEAVES, this.config.maxMerkleLeaves ?? MAX_MERKLE_LEAVES);
        const pending = (await this.queue.listPending()).slice(0, maxItems);
        if (pending.length === 0) {
            return { attempted: 0, anchored: 0, attested: 0, batches: 0 };
        }
        const wantAttest = options?.requestAttestation ?? this.config.requestAttestation ?? true;
        let anchored = 0;
        let attested = 0;
        let merkle_root;
        let merkle_leaf_count;
        const t0 = Date.now();
        for (const job of pending) {
            const digest = job.proof_digest.replace(/^0x/, "").toLowerCase();
            if (wantAttest) {
                const signed = await this.client.attest({
                    proof_id: job.proof_id,
                    circuit_id: job.circuit_id,
                    proof_digest: digest,
                    valid: job.valid,
                    verified: true,
                    decision: job.decision,
                    event: "verified",
                    mode: "anchor_pending_leaves",
                });
                const attestation = signed.attestation;
                if (!attestation?.mldsa_signature_b64) {
                    throw new Error(`attest_missing:${job.proof_id}`);
                }
                attested += 1;
            }
            const one = await this.client.merkleAudit({
                digest,
                circuit_id: job.circuit_id,
                proof_id: job.proof_id,
                event: "verified",
            });
            anchored += 1;
            merkle_root = String(one.merkle_root ?? merkle_root ?? "");
            merkle_leaf_count = Number(one.merkle_leaf_count ?? merkle_leaf_count ?? 0);
        }
        const elapsed = Date.now() - t0;
        return {
            attempted: pending.length,
            anchored,
            attested,
            merkle_root,
            merkle_leaf_count,
            leaves_per_sec: elapsed > 0 ? Math.round((anchored / elapsed) * 1000) : anchored,
            batches: pending.length,
        };
    }
}
export { LicenceError };
export { defaultContext, buildYesNoWitness, isAffixCircuit, normaliseWitnessInputs, normaliseWitnessPackage, } from "./witness.js";
export { buildMerkleTree, buildProofMerkleBatch, verifyBatchInclusions, verifyMerkleProof, merkleAuditItemsFromBatch, normalizeMerkleAuditLeaf, MAX_MERKLE_LEAVES, } from "./merkle.js";
export { runDataCheck, fieldsExactMatch, exactFieldString, stringsEqualExact, buildCheckResult, JsonDocumentStore, KeyValueStore, CsvTableStore, FixedWidthStore, PipeDelimitedStore, SqlStore, prepareLookupSql, InMemorySqlDatabase, MongoDocumentStore, XmlDocumentStore, DbaseStore, LdifStore, DelimitedTableStore, IniSectionStore, RedisExportStore, openDataStore, DATA_STORE_KINDS, SqlLookupError, classifySqlError, wrapSqlExecutor, withQueryTimeout, createPrimaryReplicaExecutor, createPgExecutor, createMysqlExecutor, createOdbcExecutor, resolveSqlConnectionConfig, } from "./data-check/index.js";
export { ZK_CARRIER_PREFIX, packCarrier, unpackCarrier, isZkCarrier, renderQrSvg, renderBarcodeSvg, CodeUseStore, } from "./codes/index.js";
export { DEFAULT_AFFIX_API_BASE, DEFAULT_PRESENTMENT_PATH, buildPresentmentLink, extractCarrierFromScan, normaliseApiBase, normalisePresentmentBase, } from "./constants.js";
export { STORAGE_KEYS, PathMappedJsonStore, JsonFileDocumentStore, createDefaultJsonDocumentStore, MemoryDocumentStore, createMemoryDocumentStore, docGet, docSet, docDelete, } from "./storage/index.js";
export { localVerify, unpackProof, proofDigest } from "./local-prove.js";
export { lightProve, lightVerify, packLightProof, unpackLightProof, isLightProof, LIGHT_SCHEME, LIGHT_ALGORITHM, } from "./light-prove.js";
export { canonicalLocalPayload, createLocalSigningKeyPair, signLocalPayload, verifyLocalPayload, verifyLocalAttestation, normalizeTrustedKeys, AffixTrustError, } from "./local-signing.js";
export { wrapProofEnvelope, verifyProofEnvelope, verifyProofEnvelopeDetailed } from "./proof-envelope.js";
export { AFFIXIO_KEYS_URL, AFFIXIO_KEYS_WELL_KNOWN_URL, affixioKeysUrl, signedVerifyPayload, fetchAffixioKeys, clearAffixioKeyCache, verifyAffixioAttestation, computeKeySetHash, publicKeyHash, VERIFIED_PROOF_DOMAIN, CLIENT_PAYLOAD_DOMAIN } from "./affixio-keys.js";
export { LOCAL_SIGNATURE_SCHEMA_V1, LOCAL_SIGNATURE_SCHEMA_V2, localSignatureMessage } from "./local-signing.js";
export { createReplayGuard, MemoryReplayStore } from "./replay-guard.js";
export { checkEnvelopeBinding } from "./envelope-binding.js";
export { LOCAL_SIGNATURE_V2_PREFIX } from "./local-signing.js";
export {
    canonicalPolicyHash,
    buildVersionBinding,
    resolvePolicyHash,
    bindPolicyIntoPayload,
    EMPTY_POLICY_HASH,
    EMPTY_POLICY_SENTINEL,
    ATTESTATION_SCHEMA,
    ENVELOPE_SCHEMA,
} from "./policy-binding.js";
export { SpendJournal } from "./spend-journal.js";
export { StatsStore, emptyStats } from "./stats.js";
export { loadOperatorConfig, saveOperatorConfig, ensureSecrets, defaultOperatorConfig, defaultPaths, mergeConfigWithEnv, loadApiKey, saveApiKey, apiKeyHint, } from "./operator-config.js";
export { HttpDataStore, createHttpDataStore, testHttpProfile } from "./http-data-store.js";
export { HSM_PROVIDERS, defaultHsmProfile, validateHsmProfile, testHsmConnection, summariseHsmProfile, } from "./hsm.js";
export { withFileLock } from "./file-lock.js";
import {
  AgentTrust,
  CapabilityPolicy,
  DEFAULT_API_BASE as KYA_DEFAULT_API_BASE,
  DEFAULT_HUB_URL as KYA_DEFAULT_HUB_URL,
  ENROLLED_CLAIM,
  identityBinding,
  issueAgentCredential,
  KYA_CIRCUIT,
  verifyAgentCredential,
} from "./agent-trust/index.js";
export {
  AgentTrust,
  CapabilityPolicy,
  KYA_DEFAULT_API_BASE,
  KYA_DEFAULT_HUB_URL,
  ENROLLED_CLAIM,
  identityBinding,
  issueAgentCredential,
  KYA_CIRCUIT,
  verifyAgentCredential,
};

export { runDashboard } from "./dashboard/server.js";
export {
  AgenticPaymentPolicy,
  agenticPay,
  createAgentCheckoutReceipt,
  createAgenticPayKit,
  createPaymentMandate,
  mcpToolGate,
  paidApiAgentPolicy,
  shoppingAgentPolicy,
  spendingPolicy,
  verifyAgentSpend,
  x402BeforePay,
} from "./agentic-pay-kit.js";

/**
 * Create a Know Your Agent control plane bound to api.affix-io.com by default.
 * Credit: @paparichens
 */
export function createAgentTrust(options = {}) {
  if (!options.apiKey && !options.sdk) {
    throw new Error("createAgentTrust requires apiKey or sdk");
  }
  const apiBase = options.apiBase ?? process.env.AFFIX_API_BASE ?? "https://api.affix-io.com";
  const sdk =
    options.sdk ??
    new AffixSDK({
      apiKey: options.apiKey,
      apiBase,
      proofMode: "hmac",
      licenceOnly: options.licenceOnly ?? true,
      autoFlush: false,
      queueUnsyncedProofs: false,
      operatorBaseDir: options.storageDir ?? options.operatorBaseDir ?? ".affix-kya",
    });
  return new AgentTrust({
    sdk,
    ownsSdk: !options.sdk,
    apiKey: options.apiKey ?? null,
    apiBase,
    hubUrl: options.hubUrl,
  });
}
