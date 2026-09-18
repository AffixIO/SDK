import type { LocalAttestation, LocalSigningKeyPair } from "./local-signing.js";
export type ProofEnvelope = {
    payload: Record<string, unknown>;
    attestation: LocalAttestation;
};
export declare function wrapProofEnvelope(payload: Record<string, unknown>, options: {
    hmacSecret: string;
    signingKeys: LocalSigningKeyPair;
}): ProofEnvelope;
export declare function verifyProofEnvelope(envelope: ProofEnvelope | undefined | null, hmacSecret: string): boolean;
