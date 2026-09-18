/* Credit: @paparichens */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { WitnessPackage } from "./types.js";

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

export const LIGHT_SCHEME = "affix-light-v1";
export const LIGHT_ALGORITHM = "HMAC-SHA256";
export const PRESENTMENT_PREFIX = "AFX.LW1.";

function bytesToHex(bytes) {
    return Buffer.from(bytes).toString("hex");
}

function hexToBytes(value) {
    if (!/^(?:[0-9a-f]{2})+$/i.test(value)) {
        throw new TypeError("Expected an even-length hexadecimal string.");
    }
    return Buffer.from(value, "hex");
}

function canonicalInputs(inputs) {
    return Object.keys(inputs)
        .sort()
        .map((key) => `${key}=${inputs[key]}`)
        .join("|");
}

function publicInputsFor(circuitId, inputs, returnValue) {
    if (circuitId === "simple_yesno") {
        return [
            inputs.issuer_pubkey_hash,
            inputs.schema_id,
            inputs.required_claim_hash,
            inputs.context_id,
            inputs.credential_id,
            inputs.payload_digest,
            inputs.nullifier,
            returnValue,
        ].filter((value) => value !== undefined);
    }
    if (circuitId === "yesno") {
        return [
            inputs.issuer_pubkey_hash,
            inputs.schema_id,
            inputs.required_a_hash,
            inputs.required_b_hash,
            inputs.required_c_hash,
            inputs.logic_mode ?? "0x0",
            inputs.context_id,
            inputs.credential_id,
            inputs.payload_digest,
            inputs.nullifier,
            returnValue,
        ].filter((value) => value !== undefined);
    }
    return [returnValue];
}

function statementDigest(input) {
    const statement = [
        LIGHT_SCHEME,
        input.circuitId,
        input.decision,
        String(input.timestamp),
        input.nonce,
        canonicalInputs(input.inputs),
    ].join("\n");
    return createHash("sha256").update(statement, "utf8").digest("hex");
}

function hmacKey(secret) {
    const material = typeof secret === "string"
        ? createHash("sha256").update(`${LIGHT_SCHEME}:${secret}`, "utf8").digest()
        : createHash("sha256").update(secret).digest();
    return material;
}

function hmacHex(secret, digestHex) {
    return createHmac("sha256", hmacKey(secret))
        .update(digestHex, "utf8")
        .digest("hex");
}

export function packLightProof(body: LightProofBody): string {
    return bytesToHex(Buffer.from(JSON.stringify(body), "utf8"));
}

export function unpackLightProof(proofHex: string): LightProofBody {
    const parsed = JSON.parse(hexToBytes(proofHex).toString("utf8"));
    if (parsed.scheme !== LIGHT_SCHEME || parsed.alg !== LIGHT_ALGORITHM) {
        throw new Error("unsupported_light_proof");
    }
    return parsed;
}

export function isLightProof(proofHex: string): boolean {
    try {
        unpackLightProof(proofHex);
        return true;
    }
    catch {
        return false;
    }
}

/**
 * Affix Light HMAC prove (default). Uses witness inputs from yes/no circuits.
 */
export function lightProve(witness: WitnessPackage, secret: string | Uint8Array, options?: {
    decision?: "yes" | "no" | boolean;
    nonce?: string;
    timestamp?: number;
    publicInputs?: string[];
}): LightProveResult {
    if (!secret || (typeof secret === "string" && secret.length < 16)) {
        throw new TypeError("hmac_secret_must_be_at_least_16_characters");
    }
    const decision: "yes" | "no" = options.decision === "no" || options.decision === false ? "no" : "yes";
    const returnValue = decision === "yes" ? "1" : "0";
    const nonce = options.nonce ?? randomBytes(16).toString("hex");
    const timestamp = options.timestamp ?? Date.now();
    const stmt = statementDigest({
        circuitId: witness.circuit_id,
        inputs: witness.inputs,
        decision,
        nonce,
        timestamp,
    });
    const body: LightProofBody = {
        scheme: LIGHT_SCHEME,
        alg: LIGHT_ALGORITHM,
        circuit_id: witness.circuit_id,
        decision,
        return_value: returnValue,
        public_inputs: options.publicInputs ??
            publicInputsFor(witness.circuit_id, witness.inputs, returnValue),
        statement_digest: stmt,
        mac: hmacHex(secret, stmt),
        nonce,
        ts: timestamp,
        witness_commitment: createHash("sha256")
            .update(canonicalInputs(witness.inputs), "utf8")
            .digest("hex"),
        inputs: witness.inputs,
    };
    const proof = packLightProof(body);
    const proofDigestHex = createHash("sha256")
        .update(`${witness.circuit_id}:${decision === "yes"}:${proof}`)
        .digest("hex");
    return {
        proof,
        returnValue,
        valid: decision === "yes",
        proofDigest: proofDigestHex,
        decision,
        proofMode: "hmac",
    };
}

export function lightVerify(circuitId: string, proofHex: string, secret: string | Uint8Array): LightVerifyResult {
    let body;
    try {
        body = unpackLightProof(proofHex);
    }
    catch {
        return { valid: false, authenticated: false, decision: "no", reason: "malformed_proof" };
    }
    if (body.circuit_id !== circuitId) {
        return { valid: false, authenticated: false, decision: "no", reason: "circuit_mismatch" };
    }
    const stmt = statementDigest({
        circuitId: body.circuit_id,
        inputs: body.inputs,
        decision: body.decision,
        nonce: body.nonce,
        timestamp: body.ts,
    });
    const witnessCommitment = createHash("sha256")
        .update(canonicalInputs(body.inputs), "utf8")
        .digest("hex");
    const expectedMac = Buffer.from(hmacHex(secret, stmt), "hex");
    let suppliedMac;
    try {
        suppliedMac = Buffer.from(body.mac, "hex");
    }
    catch {
        suppliedMac = Buffer.alloc(0);
    }
    const authenticated = stmt === body.statement_digest &&
        witnessCommitment === body.witness_commitment &&
        expectedMac.length === suppliedMac.length &&
        timingSafeEqual(expectedMac, suppliedMac);
    if (!authenticated) {
        return { valid: false, authenticated: false, decision: "no", reason: "authentication_failed" };
    }
    const claimedYes = body.decision === "yes" && body.return_value === "1";
    return {
        valid: authenticated && claimedYes,
        authenticated,
        decision: body.decision,
        returnValue: body.return_value,
        proofMode: "hmac",
    };
}
