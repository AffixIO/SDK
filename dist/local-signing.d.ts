export type LocalSigningKeyPair = {
    algorithm: "ML-DSA-65";
    public_key_b64: string;
    secret_key_b64: string;
    key_id: string;
};

export type LocalAttestation = {
    schema: "affix.local-signature.v1" | "affix.local-signature.v2";
    algorithm: "HMAC-SHA256+ML-DSA-65";
    signed_at: string;
    payload_digest: string;
    key_id: string;
    hmac_b64: string;
    mldsa_signature_b64: string;
    mldsa_public_key_b64: string;
};

export declare function canonicalLocalPayload(payload: unknown): string;
export declare function createLocalSigningKeyPair(seedB64?: string): LocalSigningKeyPair;
export declare function signLocalPayload(payload: unknown, options: {
    hmacSecret: string;
    secretKeyB64: string;
    publicKeyB64: string;
    /** Emit a legacy v1 attestation (signed_at NOT signed). Default false (v2). */
    legacyV1?: boolean;
    signedAt?: string;
}): LocalAttestation;
export declare const LOCAL_SIGNATURE_SCHEMA_V1: "affix.local-signature.v1";
export declare const LOCAL_SIGNATURE_SCHEMA_V2: "affix.local-signature.v2";
export declare function localSignatureMessage(payload: unknown, attestation: Pick<LocalAttestation, "schema" | "key_id" | "signed_at">): Uint8Array;
export type TrustedKeyEntry = string | Uint8Array | { key_id?: string; public_key_b64?: string; public_key_hex?: string; algorithm?: string; status?: string; not_before?: string | null; not_after?: string | null };
export type TrustedKeysInput = TrustedKeyEntry | TrustedKeyEntry[] | Record<string, string> | Map<string, TrustedKeyEntry> | { keys: TrustedKeyEntry[] };
export interface LocalVerifyOptions {
    /** Pinned ML-DSA-65 key(s). Required unless insecureTrustEmbeddedKey. */
    trustedKeys?: TrustedKeysInput;
    /** Also check the HMAC. Only for trusted parties that hold the shared secret. */
    hmacSecret?: string;
    requireHmac?: boolean;
    /** TESTS ONLY. Trust the key embedded in the attestation. Emits a warning. */
    insecureTrustEmbeddedKey?: boolean;
    /** Accept v1 envelopes (unsigned signed_at) when a key validity window applies. Insecure; migration only. */
    allowLegacyUnsignedTime?: boolean;
    /** Reject legacy v1 attestations. Standalone default: true (pass false to accept v1). Via an AffixSDK instance: the role default (true for verifier roles, false for server). */
    rejectLegacyV1?: boolean;
}
export declare const LOCAL_SIGNATURE_V2_PREFIX: "affix.sdk.local-signature.v2\n";
export interface LocalVerifyResult { valid: boolean; reason: string; key_id: string | null; hmacVerified: boolean; signatureVerified: boolean; }
export declare class AffixTrustError extends Error { code: string; constructor(code: string, message?: string); }
export declare function normalizeTrustedKeys(input: TrustedKeysInput | undefined | null): Map<string, { bytes: Uint8Array; key_id: string; status?: string; not_before?: string; not_after?: string }>;
export declare function verifyLocalAttestation(payload: unknown, attestation: LocalAttestation, options: LocalVerifyOptions): LocalVerifyResult;
export declare function verifyLocalPayload(payload: unknown, attestation: LocalAttestation, hmacSecret: string | undefined, options: LocalVerifyOptions): boolean;
export declare function verifyLocalPayload(payload: unknown, attestation: LocalAttestation, options: LocalVerifyOptions): boolean;
