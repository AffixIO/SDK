import { claimAsCircuitField, claimDigestField, credentialPayloadFingerprint, deriveNullifierField, fieldInputHex, fieldToBigInt, fieldToHex, normalizeCredentialFields, } from "./field-crypto.js";
const SUPPORTED = new Set(["yesno", "simple_yesno"]);
export function isAffixCircuit(circuitId) {
    return SUPPORTED.has(circuitId);
}
function strField(value) {
    return String(value);
}
/**
 * Coerce every witness value into a canonical field element.
 * Arbitrary text is reduced by hash, so callers are never required to supply hex.
 * Idempotent: re-normalising a normalised witness yields the same values.
 */
export function normaliseWitnessInputs(inputs) {
    const out = {};
    for (const [key, value] of Object.entries(inputs)) {
        if (value === undefined || value === null) {
            throw new Error(`witness_field_missing:${key}`);
        }
        out[key] = fieldInputHex(value);
    }
    return out;
}
export function normaliseWitnessPackage(witness) {
    if (!witness || typeof witness !== "object") {
        throw new Error("witness_package_required");
    }
    if (!isAffixCircuit(witness.circuit_id)) {
        throw new Error(`unsupported_circuit:${witness.circuit_id}`);
    }
    if (!witness.inputs || typeof witness.inputs !== "object") {
        throw new Error("witness_inputs_required");
    }
    return {
        circuit_id: witness.circuit_id,
        inputs: normaliseWitnessInputs(witness.inputs),
    };
}
function claimFieldFromCredential(credential, fieldKey, fallback) {
    const fromFields = credential.fields?.[fieldKey];
    if (fromFields !== undefined && fromFields !== null) {
        return claimDigestField(fromFields);
    }
    return claimDigestField(fallback);
}
/**
 * Build witness for bundled yes/no circuits (matches Affix API witness layout).
 */
export function buildYesNoWitness(circuitId, credential, context) {
    if (!isAffixCircuit(circuitId)) {
        throw new Error(`unsupported_circuit:${circuitId}`);
    }
    const cred = normalizeCredentialFields(credential);
    const secret = context.secret;
    const contextId = context.context_id;
    if (circuitId === "simple_yesno") {
        const claimHash = claimDigestField(cred.claim_value);
        const required = context.required_claim_hash
            ? claimDigestField(context.required_claim_hash)
            : claimHash;
        const payloadDigest = credentialPayloadFingerprint({
            issuer_pubkey_hash: cred.issuer_pubkey_hash,
            schema_id: cred.schema_id,
            claim_hash: claimHash,
            valid_from: cred.valid_from,
            valid_until: cred.valid_until,
        });
        const nullifier = deriveNullifierField({
            secret,
            context_id: contextId,
            credential_id: cred.credential_id,
        });
        return {
            circuit_id: circuitId,
            inputs: normaliseWitnessInputs({
                secret,
                claim_hash: claimHash,
                valid_from: strField(cred.valid_from),
                valid_until: strField(cred.valid_until),
                issuer_pubkey_hash: cred.issuer_pubkey_hash,
                schema_id: cred.schema_id,
                required_claim_hash: required,
                context_id: contextId,
                credential_id: cred.credential_id,
                payload_digest: payloadDigest,
                nullifier,
            }),
        };
    }
    // yesno (three claim AND/OR)
    const claimA = claimFieldFromCredential(cred, "claim_a", cred.claim_value);
    const claimB = claimFieldFromCredential(cred, "claim_b", context.claim_b ?? cred.claim_value);
    const claimC = claimFieldFromCredential(cred, "claim_c", context.claim_c ?? cred.claim_value);
    const combined = fieldToHex(fieldToBigInt(claimA) + fieldToBigInt(claimB) + fieldToBigInt(claimC));
    const requiredA = context.required_a_hash
        ? claimDigestField(context.required_a_hash)
        : claimA;
    const requiredB = context.required_b_hash
        ? claimDigestField(context.required_b_hash)
        : claimB;
    const requiredC = context.required_c_hash
        ? claimDigestField(context.required_c_hash)
        : claimC;
    const logicMode = context.logic_mode !== undefined ? claimAsCircuitField(context.logic_mode) : "0x0";
    const payloadDigest = credentialPayloadFingerprint({
        issuer_pubkey_hash: cred.issuer_pubkey_hash,
        schema_id: cred.schema_id,
        claim_hash: combined,
        valid_from: cred.valid_from,
        valid_until: cred.valid_until,
    });
    const nullifier = deriveNullifierField({
        secret,
        context_id: contextId,
        credential_id: cred.credential_id,
    });
    return {
        circuit_id: circuitId,
        inputs: normaliseWitnessInputs({
            secret,
            claim_a_hash: claimA,
            claim_b_hash: claimB,
            claim_c_hash: claimC,
            valid_from: strField(cred.valid_from),
            valid_until: strField(cred.valid_until),
            issuer_pubkey_hash: cred.issuer_pubkey_hash,
            schema_id: cred.schema_id,
            required_a_hash: requiredA,
            required_b_hash: requiredB,
            required_c_hash: requiredC,
            logic_mode: logicMode,
            context_id: contextId,
            credential_id: cred.credential_id,
            payload_digest: payloadDigest,
            nullifier,
        }),
    };
}
export function defaultContext(partial) {
    return {
        secret: partial?.secret ?? "0x1",
        context_id: partial?.context_id ?? "0x1",
        required_claim_hash: partial?.required_claim_hash,
        claim_b: partial?.claim_b,
        claim_c: partial?.claim_c,
        required_a_hash: partial?.required_a_hash,
        required_b_hash: partial?.required_b_hash,
        required_c_hash: partial?.required_c_hash,
        logic_mode: partial?.logic_mode,
    };
}
