import type { TrustedKeysInput } from "./local-signing.js";
export declare const AFFIXIO_KEYS_URL: string;
export declare const AFFIXIO_KEYS_WELL_KNOWN_URL: string;
export interface AffixioPublicKey {
    key_id: string;
    algorithm: "ML-DSA-65";
    use?: string;
    public_key_b64: string;
    public_key_hex?: string;
    status: "active" | "retired" | "revoked";
    not_before?: string | null;
    not_after?: string | null;
}
export interface AffixioKeySet { schema: "affix.keys.v1"; issuer?: string; keys: AffixioPublicKey[]; }
export declare function fetchAffixioKeys(options?: { url?: string; ttlMs?: number; force?: boolean; timeoutMs?: number; fetch?: typeof fetch;
    /** Pin: computeKeySetHash() of the expected set. Mismatch throws affixio_keyset_pin_mismatch. */
    expectedKeySetHash?: string;
    /** Pin by key bytes: every fetched key must match one entry (key_id + SHA-256 of raw key). Extra keys are rejected. */
    expectedKeys?: { key_id: string; public_key_hash: string }[];
    /** Presence check only. NOT a security control on its own (warns when used alone). */
    expectedKeyIds?: string[]; apiBase?: string }): Promise<AffixioKeySet>;
export declare function computeKeySetHash(keySet: AffixioKeySet | AffixioPublicKey[]): string;
export declare function publicKeyHash(publicKeyB64: string): string;
export declare function clearAffixioKeyCache(): void;
export declare function affixioKeysUrl(apiBase?: string): string;
export declare function signedVerifyPayload(response: Record<string, unknown>): Record<string, unknown>;
export declare function verifyAffixioAttestation(payload: unknown, attestation: { payload_digest: string; mldsa_signature_b64: string; algorithm?: string; signed_at?: string; key_id?: string }, options?: { trustedKeys?: TrustedKeysInput; url?: string; fetch?: typeof fetch; expectedKeySetHash?: string; expectedKeys?: { key_id: string; public_key_hash: string }[]; expectedKeyIds?: string[]; requireSignedTime?: boolean; allowLegacyUnsignedTime?: boolean; now?: () => number; kind?: "proof" | "verify" | "prove" | "any"; expectedCircuitId?: string; /** kind "verify" only: accept cores whose circuit_binding is vk_only or missing. Not recommended. */ allowVkOnly?: boolean }): Promise<{ valid: boolean; reason: string; kind?: string; key_id: string | null; key_id_alias?: string; public_key_hash?: string; signed_time?: false }>;

export declare const VERIFIED_PROOF_DOMAIN = "affixio.attest.verified-proof.v1";
export declare const CLIENT_PAYLOAD_DOMAIN = "affixio.attest.client-payload.v1";
