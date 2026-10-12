export type Attestation = {
    signed_at: string;
    payload_digest: string;
    mldsa_signature_b64: string;
    algorithm: "ML-DSA-65";
};
export type AffixCredential = {
    schema_id: string;
    issuer_id: string;
    issuer_pubkey_hash: string;
    issuer_public_key_hex?: string;
    credential_id: string;
    claim_value: string | number;
    valid_from: number;
    valid_until: number;
    fields?: Record<string, unknown>;
    attestation?: Attestation;
};
export type WitnessContext = {
    secret: string;
    context_id: string;
    required_claim_hash?: string;
    claim_b?: string | number;
    claim_c?: string | number;
    required_a_hash?: string | number;
    required_b_hash?: string | number;
    required_c_hash?: string | number;
    logic_mode?: string | number;
};
export type WitnessPackage = {
    circuit_id: string;
    inputs: Record<string, string>;
};
export type ProveResult = {
    proof_id: string;
    circuit_id: string;
    proof: string;
    valid: boolean;
    decision: "yes" | "no";
    proof_digest: string;
    return_value?: string;
    source: "local";
    /** true when produced without a live Affix round-trip */
    offline: boolean;
    /** Queued for later Affix verify / merkle audit */
    pending_sync: boolean;
    /** hmac (default) or ultrahonk */
    proof_mode?: "hmac" | "ultrahonk";
    /** Required local ML-DSA-65 + HMAC envelope over proof metadata. */
    envelope: {
        payload: {
            proof_id?: string;
            circuit_id?: string;
            proof?: string;
            proof_digest?: string;
            valid?: boolean;
            decision?: string;
            proof_mode?: string;
            request_id?: string;
            origin?: string;
            /** sha256 hex of canonical policy JSON (or empty-policy sentinel). */
            policy_hash?: string;
            /** SDK / circuit / schema / licence revision binding. */
            version_binding?: {
                sdk_version: string;
                circuit_id: string | null;
                attestation_schema: string;
                envelope_schema: string;
                policy_revision: number | null;
            };
            [key: string]: unknown;
        };
        attestation: import("./local-signing.js").LocalAttestation;
    };
    /** Direct ML-DSA-65 signature summary. Proof creation fails if verification fails. */
    signature: {
        signed: true;
        algorithm: "ML-DSA-65";
        key_id: string;
        signed_at: string;
        signature_b64: string;
        public_key_b64: string;
    };
    witness?: WitnessPackage;
    /** Stable id for this host request (one request → one proof). */
    request_id?: string;
    origin?: "manual" | "data_check" | string;
    record_id?: string;
    meta?: Record<string, string>;
};
export type VerifyResult = {
    proof_id: string;
    valid: boolean;
    verified: boolean;
    decision: "yes" | "no";
    /** 2.0.3: the circuit the server bound the proof to (not the caller's argument). null when unbound (vk_only). */
    circuit_id: string | null;
    /** 2.0.3: the circuit_id the caller asked to verify. */
    requested_circuit_id: string;
    /** 2.0.3: server binding: "server_prove_record" | "unique_vk" | "vk_only"; null from older servers. */
    circuit_binding: string | null;
    vk_hash: string | null;
    proof_digest: string;
    merkle_root?: string;
    merkle_leaf_hash?: string;
    attestation?: Attestation;
    /** 2.0.3: fields the API signs, kept as received. */
    engine?: string;
    proof_ref?: string;
    return_value?: string | null;
    policy_version?: string;
    /** 2.0.3: the API attestation checked against pinned AffixIO keys. null when none was requested. */
    attestation_valid: boolean | null;
    attestation_reason: string;
    /** Published key id (as in GET /v1/keys) of the key that signed the attestation. */
    attestation_key_id: string | null;
    /** Exactly the object the attestation covers. */
    signed_payload: Record<string, unknown>;
    /** The response as received. */
    raw: Record<string, unknown>;
};
import type { AffixDocumentStore, AffixStorageConfig } from "./storage/types.js";

export type HttpDataProfile = {
    name?: string;
    baseUrl: string;
    pathTemplate?: string;
    method?: string;
    timeoutMs?: number;
    authEnv?: string;
    authScheme?: string;
    headers?: Record<string, string>;
    recordsPath?: string;
    sampleId?: string;
};

export type HsmProvider =
    | "pkcs11"
    | "softhsm"
    | "aws_cloudhsm"
    | "aws_kms"
    | "azure_key_vault"
    | "azure_managed_hsm"
    | "gcp_kms"
    | "google_cloud_hsm"
    | "thales"
    | "utimaco"
    | "ncipher"
    | "yubihsm"
    | "fortanix"
    | "generic_http"
    | "custom";

export type HsmProfile = {
    enabled?: boolean;
    provider: HsmProvider;
    label?: string;
    key_label?: string | null;
    key_id?: string | null;
    slot?: number | null;
    library_path?: string | null;
    endpoint?: string | null;
    region?: string | null;
    project_id?: string | null;
    vault_uri?: string | null;
    cluster_id?: string | null;
    pin_env?: string;
    password_env?: string;
    access_key_env?: string | null;
    secret_key_env?: string | null;
    token_env?: string;
    client_cert_path?: string | null;
    client_key_path?: string | null;
    ca_cert_path?: string | null;
    timeout_ms?: number;
    prefer_for_signing?: boolean;
    meta?: Record<string, string>;
};

export type AffixSdkConfig = {
    apiBase: string;
    apiKey: string;
    requestAttestation?: boolean;
    sector?: string;
    /** Default proof mode: hmac (default) or ultrahonk */
    proofMode?: "hmac" | "ultrahonk";
    /** Restrict Affix networking to licence heartbeat only. Default true. */
    licenceOnly?: boolean;
    proofStorePath?: string;
    licenceStatePath?: string;
    offlineQueuePath?: string;
    spendDir?: string;
    statsPath?: string;
    hmacSecret?: string;
    /**
     * Verifier role (2.0.0-beta.2). "server" (default) / "trusted-party" may verify HMAC proofs
     * (with a warning). "device" / "edge" / "offline-verifier" refuse HMAC proofs and check
     * envelopes by pinned ML-DSA-65 key only.
     */
    role?: "server" | "trusted-party" | "device" | "edge" | "offline-verifier";
    /** Extra pinned ML-DSA-65 keys for envelope verification (e.g. a gateway's local key). */
    trustedSigningKeys?: import("./local-signing.js").TrustedKeysInput;
    /** Pin this host's own signing key. Default true for server/trusted-party, false for device/edge/offline-verifier. Always honoured. */
    trustOwnSigningKey?: boolean;
    /** Create a local ML-DSA key if none exists. Default true for server roles, false for verifier roles. */
    generateSigningKey?: boolean;
    /** Reject legacy v1 envelopes. Default true for every role since 2.0.2; pass false to verify stored v1 envelopes. */
    rejectLegacyV1?: boolean;
    /** TESTS ONLY. Trust the key embedded in an envelope. Emits a warning. */
    insecureTrustEmbeddedKey?: boolean;
    /** Silence the one-time HMAC trusted-party warning on server roles. */
    silenceHmacWarning?: boolean;
    signingKeys?: {
        algorithm: string;
        public_key_b64: string;
        secret_key_b64: string;
        key_id: string;
    };
    signingKeysPath?: string;
    hmacSecretPath?: string;
    operatorBaseDir?: string;
    /** 2.0.3: write generated secrets to operatorBaseDir/secrets (dir 0700, files 0600). Requires an explicit operatorBaseDir. Supplied secrets are never written. Default false (in-memory, with a warning). */
    persistSecrets?: boolean;
    /** 2.0.3: with no operatorBaseDir, keep data in ./.affix (0700/0600) instead of memory. Default false. */
    persistData?: boolean;
    /** 2.0.3: pinned AffixIO keys for sdk.verify() attestation checks (key set document or list). Default: fetch `${apiBase}/v1/keys`. */
    affixioKeys?: unknown;
    /** 2.0.3: pin the fetched key set by key bytes. */
    affixioExpectedKeys?: { key_id: string; public_key_hash: string }[];
    affixioExpectedKeySetHash?: string;
    /** Max records in the local proof store (newest kept). Default 1000 since 2.0.3. */
    proofStoreMaxRecords?: number;
    /** Drop stored proofs older than this. Default 7 days since 2.0.3; 0 disables. */
    proofStoreTtlMs?: number;
    connections?: {
        internal?: HttpDataProfile | null;
        external?: HttpDataProfile | null;
    };
    /** Hardware or cloud HSM/KMS connection profile. Secrets via env vars only. */
    hsm?: HsmProfile | null;
    /**
     * Pluggable persistence for proofs, offline queue, code uses, and licence state.
     * Default: JSON files under `.affix/`. Pass `documentStore` (or per-domain stores)
     * to use Redis, SQL, memory, or any get/set backend.
     */
    storage?: AffixStorageConfig;
    /** @deprecated Prefer storage.documentStore. Shared AffixDocumentStore shortcut. */
    documentStore?: AffixDocumentStore;
    timeoutMs?: number;
    /** Min licence recheck interval (ms). Default ~36 hours. */
    licenceMinIntervalMs?: number;
    /** Max licence recheck interval (ms). Default ~60 hours. */
    licenceMaxIntervalMs?: number;
    /** Fail closed if licence cannot be confirmed after interval. Default true. */
    brickWithoutLicence?: boolean;
    /**
     * Allow local prove when Affix is unreachable (offline clinic mode).
     * Default true. Verify / flush still need network + licence.
     */
    allowOfflineProve?: boolean;
    /** Minimum gap between instant policy pulses (ms). Default 15s. */
    quotaPulseMinMs?: number;
    /** Report each local prove to api.affix-io.com quota consume. Default true. */
    enforceProofQuota?: boolean;
    /** Auto-enqueue offline proofs for later Affix sync. Default false in licence-only mode. */
    queueUnsyncedProofs?: boolean;
    /** Max leaves in a client Merkle batch (default 50000). */
    maxMerkleLeaves?: number;
    /** Chunk size when flushing verify to Affix aggregate API (max 25). Default 25. */
    flushChunkSize?: number;
    /**
     * Parallel aggregate-verify workers during flush (default 4).
     * Higher = faster bulk ZK check, more Affix load.
     */
    flushConcurrency?: number;
    /**
     * Digests per /v1/merkle/audit/batch call (default 1000, server max).
     * Leaf anchoring is cheap vs ZK and supports high throughput.
     */
    merkleAuditBatchSize?: number;
    /**
     * Automatically flush the offline queue on an interval (default false in licence-only mode).
     * Timer is unref'd so short CLI runs still exit; call stopAutoFlush() / dispose() in long-lived hosts if needed.
     */
    autoFlush?: boolean;
    /** Auto-flush interval in ms (default 5000). Batches up to maxMerkleLeaves pending proofs. */
    autoFlushIntervalMs?: number;
    /** Local path for multi-use scan counting per gate. */
    codeUsesPath?: string;
    /**
     * Optional customer base URL for QR/barcode presentment links (e.g. https://scan.example.com).
     * No AffixIO default. When unset, codes encode the raw AFX.ZK1… carrier only.
     */
    presentmentBase?: string;
};
export type SyncFlushResult = {
    online: boolean;
    attempted: number;
    synced: number;
    failed: number;
    /** Proofs that received Affix ML-DSA-65 attestation. */
    attested?: number;
    merkle_batch_root?: string;
    merkle_batch_id?: string;
    merkle_leaf_count?: number;
    merkle_api_root?: string;
    merkle_api_leaf_count?: number;
    merkle_leaves_synced?: number;
    merkle_leaves_per_sec?: number;
    verify_chunks?: number;
    results: Array<{
        proof_id: string;
        ok: boolean;
        error?: string;
        verify?: VerifyResult;
        merkle_audit?: Record<string, unknown>;
    }>;
};
export type LicenceEntitlements = {
    qr_carriers?: boolean;
    mldsa65?: boolean;
    db_adapters?: boolean;
    ultrahonk_zkp?: boolean;
    hsm_integration?: boolean;
};
export type ProofQuotaState = {
    limit: number;
    used: number;
    remaining: number;
    overage: number;
    overage_rate_gbp: number;
    overage_cost_gbp: number;
    period_start: string;
    period_end: string;
    plan_tier?: string | null;
    policy_revision: number;
    unlimited?: boolean;
    is_trial?: boolean;
    trial_expires_at?: string | null;
};
export type LicenceState = {
    last_ok_at: string | null;
    last_check_at: string | null;
    next_check_at: string | null;
    last_pulse_at: string | null;
    ok: boolean;
    status: "unchecked" | "active" | "expired" | "unreachable";
    /** Human-readable state for operators and status screens. */
    message: string;
    last_error?: string;
    key_hint: string;
    plan_tier?: string;
    grace?: boolean;
    grace_until?: string | null;
    entitlements?: LicenceEntitlements;
    quota?: ProofQuotaState | null;
    policy_revision?: number | null;
};
