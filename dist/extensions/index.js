/* Credit: @paparichens */
// 2.0.0-beta.2: signer pinning wrappers over the extension pack (core.js).
export * from "./core.js";
import {
    verifyArtifactOffline as coreVerifyArtifactOffline,
    verifySignedRoot as coreVerifySignedRoot,
} from "./core.js";
import { AffixTrustError, normalizeTrustedKeys, verifyLocalAttestation } from "../local-signing.js";
import { checkEnvelopeBinding } from "../envelope-binding.js";

let unboundWarned = false;
function warnUnbound() {
    if (unboundWarned)
        return;
    unboundWarned = true;
    process.emitWarning?.("AffixIO: verifyArtifactOffline allowUnbound: attestation checked, but NOT bound to a proof.", { code: "AFFIXIO_UNBOUND_ENVELOPE" });
}

function isKeySet(value) {
    return value instanceof Map || Array.isArray(value) ||
        (value && typeof value === "object" && !(value instanceof Uint8Array) &&
            (Array.isArray(value.keys) || (!value.public_key_b64 && !value.publicKey && !value.public_key_hex)));
}

function candidateKeys(trust, keyId) {
    const map = normalizeTrustedKeys(trust);
    if (keyId && map.has(String(keyId)))
        return [map.get(String(keyId))];
    return [...new Set(map.values())];
}

/**
 * verifySignedRoot(sth, trusted): trusted is one pinned public key (as before) or a pinned
 * key set ({ keys: [...] }, list, or { key_id: b64 } map). Never pass a key taken from the
 * STH or the same response; pin it from config or the published key set.
 */
export function verifySignedRoot(sth, trusted, options) {
    if (trusted === undefined || trusted === null)
        throw new AffixTrustError("no_trusted_keys", "STH verification needs a pinned public key or key set (see GET https://api.affix-io.com/v1/keys)");
    if (!isKeySet(trusted))
        return coreVerifySignedRoot(sth, trusted, options);
    const keys = candidateKeys(trusted, sth?.key_id);
    if (keys.length === 0)
        throw new AffixTrustError("no_trusted_keys", "Pinned key set is empty");
    let lastErr;
    for (const record of keys) {
        try {
            if (coreVerifySignedRoot(sth, record.bytes, options))
                return true;
        }
        catch (err) {
            lastErr = err;
        }
    }
    if (lastErr && keys.length === 1)
        throw lastErr;
    return false;
}

/**
 * verifyArtifactOffline(input). The attestation check now uses pinned keys:
 * input.trustedKeys (or trustedPublicKey) is required whenever input.attestation is present.
 * With hmacSecret it also checks the HMAC (trusted parties only). insecureTrustEmbeddedKey: tests only.
 * input.publicKey (STH) may also be a pinned key set.
 */
export function verifyArtifactOffline(input = {}) {
    const { attestation, attestationPayload, trustedKeys, trustedPublicKey, insecureTrustEmbeddedKey, allowLegacyUnsignedTime, rejectLegacyV1, proofHex, circuitId, proofMode, decision, allowMissingDecision, allowUnbound, ...rest } = input ?? {};
    const checks = [];
    const errors = [];
    let binding = null;
    const push = (name, ok, detail) => {
        checks.push({ name, ok, detail });
        if (!ok)
            errors.push(`${name}: ${detail}`);
    };
    if (attestation) {
        const payload = attestationPayload ?? rest.proof ?? null;
        if (payload === null || payload === undefined) {
            push("attestation", false, "attestation payload missing (pass proof or attestationPayload)");
        }
        else {
            try {
                const r = verifyLocalAttestation(payload, attestation, {
                    trustedKeys: trustedKeys ?? trustedPublicKey,
                    hmacSecret: rest.hmacSecret,
                    insecureTrustEmbeddedKey,
                    allowLegacyUnsignedTime,
                    rejectLegacyV1: rejectLegacyV1 ?? true,
                });
                // 2.0.0-beta.5: binding is required (proofHex + circuitId/proofMode) unless allowUnbound.
                if (proofHex !== undefined) {
                    const b = r.valid ? checkEnvelopeBinding(payload, { proof: proofHex, circuitId, proofMode, decision, allowMissingDecision }) : { bound: false, reason: "attestation_invalid" };
                    binding = { bound: b.bound, binding: "checked" };
                    push("proof_binding", b.bound, b.bound ? "attestation commits to the supplied proof" : b.reason);
                }
                else if (allowUnbound) {
                    warnUnbound();
                    binding = { bound: false, binding: "skipped", unbound: true };
                }
                else {
                    binding = { bound: false, binding: "missing" };
                    push("proof_binding", false, "binding_required: pass proofHex and circuitId, or allowUnbound: true");
                }
                push("attestation", r.valid, r.valid
                    ? `pinned ML-DSA-65 signer ${r.key_id} verified${r.hmacVerified ? " + HMAC" : ""}`
                    : `attestation rejected: ${r.reason}`);
            }
            catch (err) {
                push("attestation", false, err instanceof AffixTrustError ? `${err.code}: ${err.message}` : "attestation check failed");
            }
        }
    }
    if (rest.sth && isKeySet(rest.publicKey)) {
        const keys = candidateKeys(rest.publicKey, rest.sth?.key_id);
        rest.publicKey = keys.find((record) => {
            try { return coreVerifySignedRoot(rest.sth, record.bytes); }
            catch { return false; }
        })?.bytes ?? keys[0]?.bytes;
    }
    const hasOther = rest.proof !== undefined || rest.inclusion !== undefined || rest.sth !== undefined;
    if (hasOther || checks.length === 0) {
        const core = coreVerifyArtifactOffline(rest);
        checks.push(...(core.checks ?? []));
        errors.push(...(core.errors ?? []));
    }
    return { ok: errors.length === 0 && checks.every((c) => c.ok), checks, errors, ...(binding ?? {}) };
}
