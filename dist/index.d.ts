import { AffixApiClient } from "./client.js";
import { type DataCheckQuery, type DataCheckResult, type DataCheckSource, type ProveFromCheckInput } from "./data-check/index.js";
import { LicenceError } from "./licence.js";
import { type MerkleBatch } from "./merkle.js";
import { CodeUseStore, type GenerateCodeFromProveInput, type GenerateCodeInput, type GeneratedCode, type ReadCodeInput, type ReadCodeResult } from "./codes/index.js";
import type { AffixCredential, AffixSdkConfig, HsmProfile, ProveResult, SyncFlushResult, VerifyResult, WitnessContext, WitnessPackage } from "./types.js";
import type { HsmProbeResult, HsmSummary } from "./hsm.js";
import type { AffixStats } from "./stats.js";
import type { SpendHead, SpendIntegrity } from "./spend-journal.js";
import type { OperatorConfig, OperatorPaths } from "./operator-config.js";
import type { ProofEnvelope } from "./proof-envelope.js";
export type ProveInput = {
    circuitId?: string;
    credential?: AffixCredential;
    context?: Partial<WitnessContext>;
    witness?: WitnessPackage;
    fields?: Record<string, string | number | boolean>;
    /** Override the configured proof mode for this call. */
    proofMode?: "hmac" | "ultrahonk";
    /** Force a decision for HMAC proofs. Ignored by UltraHonk (circuit decides). */
    decision?: "yes" | "no" | boolean;
    /**
     * auto: use network for licence when possible, else offline local prove.
     * offline: force offline local prove + queue (no Affix RTT).
     * online: require live licence; still local ZK prove.
     */
    mode?: "auto" | "offline" | "online";
    /** When true (default from config), enqueue for Affix verify/merkle audit later. */
    queueForSync?: boolean;
    /** One host request → one proof. Auto-generated if omitted. */
    request_id?: string;
    origin?: "manual" | "data_check" | string;
    record_id?: string;
    meta?: Record<string, string>;
    /** Policy object (or AgenticPaymentPolicy) hashed into envelope.payload.policy_hash. */
    policy?: unknown;
    /** Alternate policy rules object hashed when `policy` is omitted. */
    policyRules?: unknown;
    /** Precomputed sha256 hex (64 chars); used as-is when provided. */
    policyHash?: string;
    /** Snake alias for policyHash. */
    policy_hash?: string;
};
/** Prove result bound to an exact data-check field map (immutable echo). */
export type ProveFromCheckResult = ProveResult & {
    /** Exact field strings from the store check (must match proof decision mapping). */
    fields: DataCheckResult["fields"];
    check: DataCheckResult;
    /** true when decision === "yes" ⇔ check.pass ⇔ claim === required */
    field_aligned: boolean;
};
/** Data-check prove + Affix verify (same contract as proveAndVerify). */
export type ProveFromCheckVerifyResult = {
    prove: ProveFromCheckResult;
    verify: VerifyResult;
};
/**
 * AffixIO SDK: local prove for bundled yesno circuits; AffixIO verifies and attests remotely.
 * Offline local proofs + Merkle batch for bulk sync; licence heartbeat against Affix API key.
 * By default, pending proofs auto-flush to Affix every 5 seconds when the queue is non-empty.
 */
export declare class AffixSDK {
    readonly client: AffixApiClient;
    /** Affix API base URL for verify/attest (default https://api.affix-io.com). */
    readonly apiBase: string;
    /** Optional customer presentment base for QR/barcode links. Unset = raw carrier only. */
    readonly presentmentBase?: string;
    private readonly store;
    private readonly queue;
    private readonly licence;
    private readonly config;
    readonly codeUses: CodeUseStore;
    private autoFlushTimer;
    private autoFlushIntervalCurrentMs;
    /** Serialises manual + auto flush so batches never overlap. */
    private flushChain;
    private lastAutoFlushAt;
    private lastAutoFlushError;
    private lastAutoFlushResult;
    constructor(config: Partial<AffixSdkConfig> & {
        apiKey: string;
    });
    /** Whether the 5s (configurable) auto-flush timer is running. */
    isAutoFlushActive(): boolean;
    autoFlushStatus(): Promise<{
        active: boolean;
        interval_ms: number;
        last_at: string | null;
        last_error: string | null;
        last_result: SyncFlushResult | null;
        pending: number;
    }>;
    /**
     * Start periodic flush of pending proofs (default every 5s, up to 50_000 leaves).
     * Safe to call more than once. Timer is unref'd so it does not keep Node alive alone.
     */
    startAutoFlush(intervalMs?: number): void;
    /** Stop the auto-flush timer (manual flushOfflineQueue still works). */
    stopAutoFlush(): void;
    /** Stop timers; call when tearing down a long-lived host process. */
    dispose(): void;
    private autoFlushTick;
    private runExclusiveFlush;
    /** Forced licence ping (also used by random schedule). */
    checkLicence(force?: boolean): Promise<boolean>;
    licenceState(): import("./types.js").LicenceState;
    isOnline(): Promise<boolean>;
    listStoredProofs(): Promise<import("./proof-store.js").StoredProof[]>;
    listPendingSync(): Promise<import("./offline-queue.js").QueuedSyncJob[]>;
    listOfflineQueue(): Promise<import("./offline-queue.js").QueuedSyncJob[]>;
    /**
     * Enqueue a local proof for Affix verify + attestation on flushOfflineQueue.
     * Used when a scan admits offline and still needs Affix signing later.
     */
    queueProofForAffix(input: {
        proof_id: string;
        circuit_id: string;
        proof: string;
        proof_digest: string;
        valid?: boolean;
        decision?: "yes" | "no";
        origin?: string;
        request_id?: string;
        meta?: Record<string, string>;
    }): Promise<void>;
    buildWitness(circuitId: string, credential: AffixCredential, context?: Partial<WitnessContext>): WitnessPackage;
    private resolveWitness;
    /**
     * Persist the Affix API key under `.affix/secrets/api.key` (mode 0600).
     * The key is never written into config.json.
     */
    setApiKey(apiKey: string): {
        path: string;
        key_hint: string;
    };
    apiKeyStatus(): {
        configured: boolean;
        stored: boolean;
        key_hint: string | null;
    };
    /** Current HSM profile summary (no secret material). */
    hsmStatus(): HsmSummary;
    /** Persist a hardware or cloud HSM profile. Credentials stay in environment variables. */
    setHsmProfile(profile: HsmProfile): Promise<HsmSummary>;
    clearHsmProfile(): Promise<{
        configured: false;
    }>;
    testHsm(): Promise<HsmProbeResult>;
    /** Local operational counters. */
    statsSnapshot(): Promise<AffixStats>;
    /** Tamper-evident spend journal status. */
    spendStatus(): {
        integrity: SpendIntegrity;
        head: SpendHead;
        journal_path: string;
    };
    verifySpendJournal(): SpendIntegrity;
    /** Deployment-owned ML-DSA-65 public key used to sign every proof. */
    exportLocalPublicKey(): {
        algorithm: "ML-DSA-65";
        key_id: string;
        public_key_b64: string;
    };
    /** Operator configuration and paths. Secret values are replaced by presence flags. */
    operatorConfig(): {
        config: OperatorConfig;
        paths: OperatorPaths;
        secrets: {
            hmac_secret_present: boolean;
            api_key_present: boolean;
            signing_key_id: string | null;
        };
    };
    saveOperatorConfig(config: OperatorConfig): Promise<void>;
    /** Probe licence, internal/external data APIs, and the HSM when configured. */
    testConnections(): Promise<{
        licence: unknown;
        internal: unknown;
        external: unknown;
        hsm: HsmProbeResult | null;
    }>;
    /**
     * Verify a proof locally. Handles HMAC (`affix-light-v1`) and UltraHonk,
     * with an optional ML-DSA-65 envelope check.
     */
    verifyLocal(circuitId: string, proofHex: string, options?: {
        proofId?: string;
        envelope?: ProofEnvelope;
        /** Override pinned keys for this envelope check. */
        trustedKeys?: import("./local-signing.js").TrustedKeysInput;
        /** Skip the HMAC part of the envelope check (ML-DSA only). */
        skipHmac?: boolean;
        /** Accept an envelope that omits the decision (2.0.2 rejects with envelope_decision_missing). Not recommended. */
        allowMissingDecision?: boolean;
        /** TESTS ONLY. */
        insecureTrustEmbeddedKey?: boolean;
        /** Accept v1 envelopes (unsigned signed_at) when a key window applies. Insecure; migration only. */
        allowLegacyUnsignedTime?: boolean;
        rejectLegacyV1?: boolean;
    }): Promise<{
        proof_id: string;
        valid: boolean;
        verified: boolean;
        decision: "yes" | "no";
        circuit_id: string;
        proof_digest: string;
        proof_mode: "hmac" | "ultrahonk" | "unknown";
        source: "local";
        /** Proof check alone; `valid` also requires envelope_ok when an envelope is supplied. */
        proof_valid?: boolean;
        envelope_ok?: boolean;
        envelope_reason?: string;
        envelope_key_id?: string | null;
        reason?: string;
    }>;
    /** verifyLocalAttestation using this instance's role defaults (pinned keys, rejectLegacyV1, HMAC policy). */
    verifyLocalAttestation(payload: unknown, attestation: import("./local-signing.js").LocalAttestation, options?: import("./local-signing.js").LocalVerifyOptions): import("./local-signing.js").LocalVerifyResult;
    /** Public keys pinned for local envelope verification. */
    trustedKeys(): { algorithm: "ML-DSA-65"; key_id: string; public_key_b64: string }[];
    /**
     * Generate a ZK proof locally (never Affix prove).
     * Works offline (mode offline/auto when network down) and online.
     */
    prove(input: ProveInput): Promise<ProveResult>;
    /**
     * Build a digests Merkle batch (≤ 50_000) for client packing + Affix leaf validation.
     * Pass `items` to override the offline queue / stored proofs source.
     */
    buildMerkleBatch(itemsOrOptions?: Array<{
        proof_id: string;
        circuit_id: string;
        proof_digest: string;
        proof?: string;
    }> | {
        maxItems?: number;
        includeProofBytes?: boolean;
    }, maybeOptions?: {
        maxItems?: number;
        includeProofBytes?: boolean;
    }): Promise<MerkleBatch>;
    /**
     * Verify via AffixIO API (same contract as @affix-io/sdk verify).
     * Online only. On failure with queueOnFailure, enqueues proof for later flush.
     */
    verify(circuitId: string, proof: string, requestAttestation?: boolean, opts?: {
        queueOnFailure?: boolean;
        proofId?: string;
        proofDigest?: string;
        affixioKeys?: unknown;
        expectedKeys?: { key_id: string; public_key_hash: string }[];
        expectedKeySetHash?: string;
        allowLegacyUnsignedTime?: boolean;
        /** Throw unless the API attestation verifies against pinned AffixIO keys. */
        requireValidAttestation?: boolean;
        /** 2.0.3: accept attestations whose circuit_binding is vk_only or missing. Not recommended. */
        allowVkOnly?: boolean;
    }): Promise<VerifyResult>;
    /**
     * Lookup a record via a data-check adapter (JSON, KV, CSV, fixed-width, pipe).
     * Returns exact string fields; pass ⇔ fields.claim === fields.required.
     */
    check(source: DataCheckSource, query: DataCheckQuery): Promise<DataCheckResult | null>;
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
    proveFromCheck(input: ProveFromCheckInput): Promise<ProveFromCheckResult>;
    /**
     * Data check → local prove → Affix verify + attest (same as proveAndVerify).
     * One request → one proof → one Affix verify round-trip.
     * On verify failure the proof is re-queued for flush (like other proofs).
     */
    proveFromCheckAndVerify(input: ProveFromCheckInput): Promise<ProveFromCheckVerifyResult>;
    /**
     * Convenience: lookup + prove in one call (each invocation = one Affix-bound proof).
     */
    checkAndProve(source: DataCheckSource, query: DataCheckQuery, opts?: Omit<ProveFromCheckInput, "check">): Promise<ProveFromCheckResult>;
    /** Generate a PII-free QR or barcode carrying a local ZK proof (standard scanner readable). */
    generateCode(input: GenerateCodeInput): Promise<GeneratedCode>;
    /** Prove locally then render a QR or barcode (no PII in the scannable payload). */
    generateCodeFromProve(input: GenerateCodeFromProveInput): Promise<GeneratedCode>;
    /**
     * Data check → local prove → QR/barcode. Sidecar holds full proof; carrier has no patient fields.
     */
    generateCodeFromCheck(input: Omit<ProveFromCheckInput, "verifyRemote"> & GenerateCodeInput): Promise<GeneratedCode & {
        check: DataCheckResult;
    }>;
    /** Scan QR/barcode online or offline; Affix signs when reachable, else local + queue. */
    readCode(input: ReadCodeInput): Promise<ReadCodeResult>;
    /** Local prove then remote Affix verify + attest (online). */
    proveAndVerify(input: ProveInput): Promise<{
        prove: ProveResult;
        verify: VerifyResult;
    }>;
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
    flushOfflineQueue(options?: {
        maxItems?: number;
        requestAttestation?: boolean;
        /**
         * Skip ZK verify; ML-DSA-attest digests and Merkle-audit only.
         * Not for production admits (no Affix ZK check).
         */
        digestsOnly?: boolean;
    }): Promise<SyncFlushResult>;
    private doFlushOfflineQueue;
    /**
     * Register digests as Affix Merkle leaves and ML-DSA-attest each payload (no ZK).
     * Prefer flushOfflineQueue for production (ZK + ML-DSA + Merkle on verify).
     */
    anchorPendingLeaves(options?: {
        maxItems?: number;
        requestAttestation?: boolean;
    }): Promise<{
        attempted: number;
        anchored: number;
        attested: number;
        merkle_root?: string;
        merkle_leaf_count?: number;
        leaves_per_sec?: number;
        batches: number;
    }>;
}
/** Thrown when a remote Affix operation is attempted while licence-only mode is active. */
export declare class LicenceOnlyError extends Error {
    constructor(message?: string);
}
export { LicenceError };
export { defaultContext, buildYesNoWitness, isAffixCircuit, normaliseWitnessInputs, normaliseWitnessPackage, } from "./witness.js";
export { buildMerkleTree, buildProofMerkleBatch, verifyBatchInclusions, verifyMerkleProof, merkleAuditItemsFromBatch, normalizeMerkleAuditLeaf, MAX_MERKLE_LEAVES, } from "./merkle.js";
export type { MerkleBatch, MerkleProofStep, BatchLeaf } from "./merkle.js";
export { runDataCheck, fieldsExactMatch, exactFieldString, stringsEqualExact, buildCheckResult, JsonDocumentStore, KeyValueStore, CsvTableStore, FixedWidthStore, PipeDelimitedStore, SqlStore, prepareLookupSql, InMemorySqlDatabase, MongoDocumentStore, XmlDocumentStore, DbaseStore, LdifStore, DelimitedTableStore, IniSectionStore, RedisExportStore, openDataStore, DATA_STORE_KINDS, SqlLookupError, classifySqlError, wrapSqlExecutor, withQueryTimeout, createPrimaryReplicaExecutor, createPgExecutor, createMysqlExecutor, createOdbcExecutor, resolveSqlConnectionConfig, } from "./data-check/index.js";
export type { DataCheckFields, DataCheckQuery, DataCheckResult, DataCheckSource, DataCheckStyle, ProveFromCheckInput, FixedFieldDef, SqlExecutor, SqlDialect, DataStoreKind, OpenDataStoreOptions, SqlErrorCode, SqlLookupOutcome, SqlConnectionConfig, SqlStoreOptions, PrimaryReplicaOptions, } from "./data-check/index.js";
export type { CodeKind, CodeFormat, CodeCarrierMode, MaxUsesOption, ZkCodeHeader, GenerateCodeInput, GenerateCodeFromProveInput, GeneratedCode, ReadCodeInput, ReadCodeResult, } from "./codes/index.js";
export { ZK_CARRIER_PREFIX, packCarrier, unpackCarrier, isZkCarrier, renderQrSvg, renderBarcodeSvg, CodeUseStore, } from "./codes/index.js";
export { DEFAULT_AFFIX_API_BASE, DEFAULT_PRESENTMENT_PATH, buildPresentmentLink, extractCarrierFromScan, normaliseApiBase, normalisePresentmentBase, } from "./constants.js";
export { STORAGE_KEYS, PathMappedJsonStore, JsonFileDocumentStore, createDefaultJsonDocumentStore, MemoryDocumentStore, createMemoryDocumentStore, docGet, docSet, docDelete, } from "./storage/index.js";
export type { AffixDocumentStore, AffixStorageConfig, MaybePromise, StorageKey, } from "./storage/index.js";
export { localVerify, unpackProof, proofDigest } from "./local-prove.js";
export { canonicalLocalPayload, createLocalSigningKeyPair, signLocalPayload, verifyLocalPayload, verifyLocalAttestation, normalizeTrustedKeys, AffixTrustError, } from "./local-signing.js";
export type { LocalAttestation, LocalSigningKeyPair, TrustedKeysInput, TrustedKeyEntry, LocalVerifyOptions, LocalVerifyResult, } from "./local-signing.js";
export { AFFIXIO_KEYS_URL, AFFIXIO_KEYS_WELL_KNOWN_URL, affixioKeysUrl, signedVerifyPayload, fetchAffixioKeys, clearAffixioKeyCache, verifyAffixioAttestation, computeKeySetHash, publicKeyHash, VERIFIED_PROOF_DOMAIN, CLIENT_PAYLOAD_DOMAIN } from "./affixio-keys.js";
export { LOCAL_SIGNATURE_SCHEMA_V1, LOCAL_SIGNATURE_SCHEMA_V2, localSignatureMessage } from "./local-signing.js";
export type { AffixioKeySet, AffixioPublicKey } from "./affixio-keys.js";
export { createReplayGuard, MemoryReplayStore } from "./replay-guard.js";
export { checkEnvelopeBinding } from "./envelope-binding.js";
export { LOCAL_SIGNATURE_V2_PREFIX } from "./local-signing.js";
export type { ReplayGuard, ReplayStore, ReplayCheckResult } from "./replay-guard.js";
export declare class AffixHmacRoleError extends Error { code: "hmac_verify_refused_for_role"; role: string; constructor(role: string); }
export { lightProve, lightVerify, packLightProof, unpackLightProof, isLightProof, LIGHT_SCHEME, LIGHT_ALGORITHM, } from "./light-prove.js";
export type { LightProofBody, LightProveResult, LightVerifyResult, } from "./light-prove.js";
export { wrapProofEnvelope, verifyProofEnvelope, verifyProofEnvelopeDetailed } from "./proof-envelope.js";
export type { ProofEnvelope } from "./proof-envelope.js";
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
export type { VersionBinding } from "./policy-binding.js";
export { SpendJournal } from "./spend-journal.js";
export type { SpendEvent, SpendHead, SpendIntegrity, SpendAdmission, SpendConsumeResult, } from "./spend-journal.js";
export { StatsStore, emptyStats } from "./stats.js";
export type { AffixStats } from "./stats.js";
export { loadOperatorConfig, saveOperatorConfig, ensureSecrets, defaultOperatorConfig, defaultPaths, mergeConfigWithEnv, loadApiKey, saveApiKey, apiKeyHint, } from "./operator-config.js";
export type { OperatorConfig, OperatorPaths } from "./operator-config.js";
export { HttpDataStore, createHttpDataStore, testHttpProfile } from "./http-data-store.js";
export { HSM_PROVIDERS, defaultHsmProfile, validateHsmProfile, testHsmConnection, summariseHsmProfile, } from "./hsm.js";
export type { HsmProbeResult, HsmSummary, HsmValidation } from "./hsm.js";
export { withFileLock } from "./file-lock.js";
export { runInteractive, runSetupWizard } from "./interactive.js";
export type { AffixCredential, Attestation, AffixSdkConfig, ProveResult, SyncFlushResult, VerifyResult, WitnessContext, WitnessPackage, LicenceState, LicenceEntitlements, HttpDataProfile, HsmProfile, HsmProvider, } from "./types.js";
export {
  AgentTrust,
  CapabilityPolicy,
  ENROLLED_CLAIM,
  identityBinding,
  issueAgentCredential,
  KYA_CIRCUIT,
  verifyAgentCredential,
  DEFAULT_API_BASE as KYA_DEFAULT_API_BASE,
  DEFAULT_HUB_URL as KYA_DEFAULT_HUB_URL,
} from "./agent-trust/index.js";
/** Create a Know Your Agent control plane (defaults to api.affix-io.com). */
export declare function createAgentTrust(options?: {
    apiKey?: string;
    sdk?: AffixSDK;
    apiBase?: string;
    hubUrl?: string;
    storageDir?: string;
    operatorBaseDir?: string;
    licenceOnly?: boolean;
}): InstanceType<typeof AgentTrust>;
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
