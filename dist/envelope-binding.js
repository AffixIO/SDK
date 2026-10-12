/* Credit: @paparichens */
// 2.0.0-beta.4: an envelope only vouches for the proof it actually commits to.
import { proofDigest } from "./local-prove.js";

/**
 * checkEnvelopeBinding(payload, { proof, circuitId, proofMode }) -> { bound, reason }
 * Bound when (payload.proof === proof, or payload.proof_digest equals the digest computed
 * from the supplied proof) AND (payload.circuit_id === circuitId, or, when the payload has
 * no circuit_id, payload.proof_mode === proofMode). A payload carrying a different proof
 * is never bound, even if its digest field were made to match.
 * 2.0.2: when expected.decision is given, a payload without a decision fails with
 * envelope_decision_missing (opt out with expected.allowMissingDecision: true).
 */
export function checkEnvelopeBinding(payload, expected = {}) {
    if (!payload || typeof payload !== "object")
        return { bound: false, reason: "envelope_not_bound" };
    const proof = typeof expected.proof === "string" ? expected.proof : null;
    if (proof === null)
        return { bound: false, reason: "envelope_binding_needs_proof" };
    let proofOk = false;
    if (payload.proof !== undefined && typeof payload.proof !== "string")
        return { bound: false, reason: "envelope_proof_mismatch" }; // e.g. [proof] must not fall through to the digest path
    if (payload.proof_digest !== undefined && typeof payload.proof_digest !== "string")
        return { bound: false, reason: "envelope_proof_digest_mismatch" };
    if (typeof payload.proof === "string") {
        proofOk = payload.proof === proof;
    }
    else if (typeof payload.proof_digest === "string" && expected.circuitId) {
        const d = payload.proof_digest.toLowerCase();
        proofOk = d === proofDigest(proof, expected.circuitId, true) || d === proofDigest(proof, expected.circuitId, false);
    }
    if (!proofOk)
        return { bound: false, reason: "envelope_proof_mismatch" };
    if (typeof payload.circuit_id === "string") {
        if (!expected.circuitId || payload.circuit_id !== expected.circuitId)
            return { bound: false, reason: "envelope_circuit_mismatch" };
    }
    else if (typeof payload.proof_mode === "string") {
        if (!expected.proofMode || payload.proof_mode !== expected.proofMode)
            return { bound: false, reason: "envelope_proof_mode_mismatch" };
    }
    else {
        return { bound: false, reason: "envelope_circuit_mismatch" };
    }
    // 2.0.0-beta.5: when both proof and proof_digest are present, both must match.
    if (typeof payload.proof === "string" && typeof payload.proof_digest === "string") {
        const d = payload.proof_digest.toLowerCase();
        if (!expected.circuitId || (d !== proofDigest(proof, expected.circuitId, true) && d !== proofDigest(proof, expected.circuitId, false)))
            return { bound: false, reason: "envelope_proof_digest_mismatch" };
    }
    // 2.0.0-beta.5: the signed decision must agree with the proof's decision.
    if (typeof expected.decision === "string" && typeof payload.decision === "string" && payload.decision !== expected.decision)
        return { bound: false, reason: "envelope_decision_mismatch" };
    // 2.0.2 (B17): when the verifier knows the proof's decision, the envelope must carry one.
    // 2.0.x prove() always signs `decision`, so this only rejects envelopes that drop it.
    if (typeof expected.decision === "string" && payload.decision === undefined && !expected.allowMissingDecision)
        return { bound: false, reason: "envelope_decision_missing" };
    if (payload.decision !== undefined && typeof payload.decision !== "string")
        return { bound: false, reason: "envelope_decision_mismatch" };
    return { bound: true, reason: "bound" };
}
