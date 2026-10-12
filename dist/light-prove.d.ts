import type { WitnessPackage } from "./types.js";

export declare const LIGHT_SCHEME: "affix-light-v1";
export declare const LIGHT_ALGORITHM: "HMAC-SHA256";
export declare const PRESENTMENT_PREFIX: string;

export type LightProofBody = {
    scheme: string;
    alg: string;
    circuit_id: string;
    decision: "yes" | "no";
    return_value: string;
    public_inputs: string[];
    statement_digest: string;
    mac: string;
    nonce: string;
    ts: number;
    witness_commitment: string;
    inputs: Record<string, string>;
};

export type LightProveResult = {
    proof: string;
    returnValue: string;
    valid: boolean;
    proofDigest: string;
    decision: "yes" | "no";
    proofMode: "hmac";
};

export type LightVerifyResult = {
    valid: boolean;
    authenticated: boolean;
    decision: "yes" | "no";
    returnValue?: string;
    reason?: string;
    proofMode?: "hmac";
};

export declare function packLightProof(body: LightProofBody): string;
export declare function unpackLightProof(proofHex: string): LightProofBody;
export declare function isLightProof(proofHex: string): boolean;
export declare function lightProve(witness: WitnessPackage, secret: string | Uint8Array, options?: {
    decision?: "yes" | "no" | boolean;
    nonce?: string;
    timestamp?: number;
    publicInputs?: string[];
}): LightProveResult;
export declare function lightVerify(circuitId: string, proofHex: string, secret: string | Uint8Array): LightVerifyResult;
