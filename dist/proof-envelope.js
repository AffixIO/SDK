/* Credit: @paparichens */
import { signLocalPayload, verifyLocalPayload } from "./local-signing.js";
export function wrapProofEnvelope(payload, options) {
    const attestation = signLocalPayload(payload, {
        hmacSecret: options.hmacSecret,
        secretKeyB64: options.signingKeys.secret_key_b64,
        publicKeyB64: options.signingKeys.public_key_b64,
    });
    return { payload, attestation };
}
export function verifyProofEnvelope(envelope, hmacSecret) {
    if (!envelope?.payload || !envelope?.attestation) {
        return false;
    }
    return verifyLocalPayload(envelope.payload, envelope.attestation, hmacSecret);
}
