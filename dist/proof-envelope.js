/* Credit: @paparichens */
import { signLocalPayload, verifyLocalAttestation } from "./local-signing.js";

export function wrapProofEnvelope(payload, options) {
    const attestation = signLocalPayload(payload, {
        hmacSecret: options.hmacSecret,
        secretKeyB64: options.signingKeys.secret_key_b64,
        publicKeyB64: options.signingKeys.public_key_b64,
    });
    return { payload, attestation };
}

function envelopeOptions(hmacSecretOrOptions, maybeOptions = {}) {
    return typeof hmacSecretOrOptions === "object" && hmacSecretOrOptions !== null
        ? hmacSecretOrOptions
        : { ...maybeOptions, hmacSecret: hmacSecretOrOptions };
}

/** Detailed envelope verification against pinned keys (see verifyLocalAttestation). */
export function verifyProofEnvelopeDetailed(envelope, hmacSecretOrOptions, maybeOptions) {
    const options = envelopeOptions(hmacSecretOrOptions, maybeOptions);
    if (!envelope?.payload || !envelope?.attestation) {
        // Still fail closed on missing trust before reporting shape problems.
        verifyLocalAttestation(null, null, options);
        return { valid: false, reason: "malformed_envelope", key_id: null, hmacVerified: false, signatureVerified: false };
    }
    return verifyLocalAttestation(envelope.payload, envelope.attestation, options);
}

/**
 * verifyProofEnvelope(envelope, hmacSecret, { trustedKeys }) or
 * verifyProofEnvelope(envelope, { trustedKeys, hmacSecret? }).
 * Throws AffixTrustError when no trusted key is configured (2.0.0-beta.2).
 */
export function verifyProofEnvelope(envelope, hmacSecretOrOptions, maybeOptions) {
    return verifyProofEnvelopeDetailed(envelope, hmacSecretOrOptions, maybeOptions).valid;
}
