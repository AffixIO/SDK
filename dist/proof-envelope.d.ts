import type { LocalAttestation, LocalSigningKeyPair, LocalVerifyOptions, LocalVerifyResult } from "./local-signing.js";

export type ProofEnvelope = {
    payload: Record<string, unknown>;
    attestation: LocalAttestation;
};

export declare function wrapProofEnvelope(payload: Record<string, unknown>, options: {
    hmacSecret: string;
    signingKeys: LocalSigningKeyPair;
}): ProofEnvelope;

export declare function verifyProofEnvelope(envelope: ProofEnvelope | undefined | null, hmacSecret: string | undefined, options: LocalVerifyOptions): boolean;
export declare function verifyProofEnvelope(envelope: ProofEnvelope | undefined | null, options: LocalVerifyOptions): boolean;
export declare function verifyProofEnvelopeDetailed(envelope: ProofEnvelope | undefined | null, hmacSecret: string | undefined, options: LocalVerifyOptions): LocalVerifyResult;
export declare function verifyProofEnvelopeDetailed(envelope: ProofEnvelope | undefined | null, options: LocalVerifyOptions): LocalVerifyResult;
