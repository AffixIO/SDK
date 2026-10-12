/** Well-defined empty-policy sentinel object: `{"affix.policy":null}`. */
export declare const EMPTY_POLICY_SENTINEL: Readonly<{ "affix.policy": null }>;
/** SHA-256 hex of canonical EMPTY_POLICY_SENTINEL. */
export declare const EMPTY_POLICY_HASH: string;
export declare const ATTESTATION_SCHEMA: "affix.local-signature.v2";
export declare const ENVELOPE_SCHEMA: "affix.proof-envelope.v1";

export type VersionBinding = {
    sdk_version: string;
    circuit_id: string | null;
    attestation_schema: string;
    envelope_schema: string;
    policy_revision: number | null;
};

/** SHA-256 hex of stable-key-sorted canonical JSON. Empty/missing → EMPTY_POLICY_HASH. */
export declare function canonicalPolicyHash(policy: unknown): string;

/** Resolve policy_hash from prove input (policyHash | policy | policyRules | sentinel). */
export declare function resolvePolicyHash(input?: {
    policyHash?: string;
    policy_hash?: string;
    policy?: unknown;
    policyRules?: unknown;
}): string;

export declare function buildVersionBinding(options?: {
    circuitId?: string | null;
    policyRevision?: number | null;
    sdkVersion?: string;
}): VersionBinding;

export declare function bindPolicyIntoPayload(
    payload: Record<string, unknown> | null | undefined,
    options?: {
        policy?: unknown;
        policyRules?: unknown;
        policyHash?: string;
        policy_hash?: string;
        circuitId?: string | null;
        policyRevision?: number | null;
        sdkVersion?: string;
    },
): Record<string, unknown>;
