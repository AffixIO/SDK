/* Credit: @paparichens */
import { signLocalPayload, verifyLocalPayload } from "./local-signing.js";
import type { LocalAttestation, LocalSigningKeyPair } from "./local-signing.js";

export type ProofEnvelope = {
    payload: Record<string, unknown>;
    attestation: LocalAttestation;
};

export function wrapProofEnvelope(payload: Record<string, unknown>, options: {
    hmacSecret: string;
    signingKeys: LocalSigningKeyPair;
}): ProofEnvelope {
    const attestation = signLocalPayload(payload, {
        hmacSecret: options.hmacSecret,
        secretKeyB64: options.signingKeys.secret_key_b64,
        publicKeyB64: options.signingKeys.public_key_b64,
    });
    return { payload, attestation };
}

export function verifyProofEnvelope(envelope: ProofEnvelope | undefined | null, hmacSecret: string): boolean {
    if (!envelope?.payload || !envelope?.attestation) {
        return false;
    }
    return verifyLocalPayload(envelope.payload, envelope.attestation, hmacSecret);
}
