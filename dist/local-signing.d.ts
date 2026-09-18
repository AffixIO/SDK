export type LocalSigningKeyPair = {
    algorithm: "ML-DSA-65";
    public_key_b64: string;
    secret_key_b64: string;
    key_id: string;
};
export type LocalAttestation = {
    schema: "affix.local-signature.v1";
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
}): LocalAttestation;
export declare function verifyLocalPayload(payload: unknown, attestation: LocalAttestation, hmacSecret: string): boolean;
