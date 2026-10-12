/* Credit: @paparichens
 * Canonical policy / version binding for ML-DSA proof envelopes.
 * Empty/missing policy → sha256 of canonical {"affix.policy":null}.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { canonicalLocalPayload } from "./local-signing.js";

/** Well-defined empty-policy object (stable key order via canonicalLocalPayload). */
export const EMPTY_POLICY_SENTINEL = Object.freeze({ "affix.policy": null });

export const ATTESTATION_SCHEMA = "affix.local-signature.v2";
export const ENVELOPE_SCHEMA = "affix.proof-envelope.v1";

const HEX64 = /^[0-9a-f]{64}$/i;

function readSdkVersion() {
    try {
        const require = createRequire(import.meta.url);
        const pkg = require("../package.json");
        return typeof pkg?.version === "string" ? pkg.version : "0.0.0";
    }
    catch {
        return "0.0.0";
    }
}

/** Precomputed sentinel hash of EMPTY_POLICY_SENTINEL (documented constant). */
export const EMPTY_POLICY_HASH = createHash("sha256")
    .update(canonicalLocalPayload(EMPTY_POLICY_SENTINEL), "utf8")
    .digest("hex");

/**
 * SHA-256 hex of stable-key-sorted canonical JSON for a policy object.
 * null / undefined / empty object → EMPTY_POLICY_HASH.
 * Objects with toJSON() (e.g. AgenticPaymentPolicy) are serialised via toJSON().
 */
export function canonicalPolicyHash(policy) {
    if (policy == null)
        return EMPTY_POLICY_HASH;
    let value = policy;
    if (typeof value?.toJSON === "function")
        value = value.toJSON();
    if (value == null)
        return EMPTY_POLICY_HASH;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
        return EMPTY_POLICY_HASH;
    return createHash("sha256")
        .update(canonicalLocalPayload(value), "utf8")
        .digest("hex");
}

/**
 * Resolve policy_hash for a prove() input.
 * Prefer explicit policyHash (64-hex); else hash policy / policyRules; else sentinel.
 */
export function resolvePolicyHash(input = {}) {
    const raw = input?.policyHash ?? input?.policy_hash;
    if (typeof raw === "string" && HEX64.test(raw.trim()))
        return raw.trim().toLowerCase();
    if (input?.policy != null)
        return canonicalPolicyHash(input.policy);
    if (input?.policyRules != null)
        return canonicalPolicyHash(input.policyRules);
    return EMPTY_POLICY_HASH;
}

/**
 * Version / schema binding stamped into every signed proof envelope payload.
 */
export function buildVersionBinding({ circuitId, policyRevision = null, sdkVersion } = {}) {
    const rev = policyRevision === undefined ? null : policyRevision;
    return {
        sdk_version: sdkVersion ?? readSdkVersion(),
        circuit_id: circuitId ?? null,
        attestation_schema: ATTESTATION_SCHEMA,
        envelope_schema: ENVELOPE_SCHEMA,
        policy_revision: rev === null || rev === undefined || Number.isNaN(Number(rev))
            ? null
            : Number(rev),
    };
}

/**
 * Enrich a proof envelope payload with policy_hash + version_binding (in-place fields).
 * Existing keys win if already set; used by AffixSDK.prove before wrapProofEnvelope.
 */
export function bindPolicyIntoPayload(payload, options = {}) {
    const out = payload && typeof payload === "object" ? { ...payload } : {};
    if (out.policy_hash == null)
        out.policy_hash = resolvePolicyHash(options);
    if (out.version_binding == null) {
        out.version_binding = buildVersionBinding({
            circuitId: options.circuitId ?? out.circuit_id ?? null,
            policyRevision: options.policyRevision ?? null,
            sdkVersion: options.sdkVersion,
        });
    }
    return out;
}
