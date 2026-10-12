import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Noir } from "@noir-lang/noir_js";
import { fieldInputHex } from "./field-crypto.js";
import { isAffixCircuit } from "./witness.js";
const __dir = dirname(fileURLToPath(import.meta.url));
const COMPILED_DIR = join(__dir, "../circuits/compiled");
const cache = new Map();
let bbModule = null;
function loadCompiled(circuitId) {
    const path = join(COMPILED_DIR, `${circuitId}.json`);
    if (!existsSync(path)) {
        throw new Error(`compiled_circuit_missing:${circuitId}`);
    }
    return JSON.parse(readFileSync(path, "utf8"));
}
async function getBb() {
    if (!bbModule) {
        bbModule = await import("@aztec/bb.js");
    }
    return bbModule;
}
function formatReturnValue(returnValue) {
    if (returnValue === null || returnValue === undefined)
        return "0";
    if (typeof returnValue === "string")
        return returnValue;
    if (typeof returnValue === "bigint")
        return returnValue.toString();
    if (typeof returnValue === "number")
        return String(returnValue);
    return String(returnValue);
}
function interpretFieldReturnValue(rv) {
    if (rv === null || rv === undefined)
        return false;
    const raw = String(rv).trim().toLowerCase();
    if (!raw)
        return false;
    const cleaned = raw.startsWith("0x") ? raw.slice(2) : raw;
    try {
        const isDigits = /^[0-9]+$/.test(cleaned);
        const isHex = /^[0-9a-f]+$/.test(cleaned);
        const asHexOk = isHex ? BigInt(`0x${cleaned}`) === 1n : false;
        const asDecOk = isDigits ? BigInt(cleaned) === 1n : false;
        return asHexOk || asDecOk;
    }
    catch {
        return false;
    }
}
export function packProof(proofData) {
    return Buffer.from(JSON.stringify({
        proof: Array.from(proofData.proof),
        publicInputs: proofData.publicInputs,
    })).toString("hex");
}
export function unpackProof(proofHex) {
    const parsed = JSON.parse(Buffer.from(proofHex, "hex").toString("utf8"));
    return {
        proof: Uint8Array.from(parsed.proof),
        publicInputs: parsed.publicInputs ?? [],
    };
}

/** Affix API digest: sha256(`${circuitId}:${valid}:${proofHex}`). */
export function proofDigest(proofHex, circuitId, valid) {
    return createHash("sha256")
        .update(`${circuitId}:${valid}:${proofHex}`)
        .digest("hex");
}
/**
 * Normalise witness fields for Noir execute (hex / decimal strings).
 * Values are already canonical when the witness came from buildYesNoWitness;
 * this guards hand-built witnesses so Noir never receives a non-field value.
 */
function fieldInputs(inputs) {
    const out = {};
    for (const [k, v] of Object.entries(inputs)) {
        if (v === undefined || v === null) {
            throw new Error(`witness_field_missing:${k}`);
        }
        out[k] = fieldInputHex(v);
    }
    return out;
}
async function getCircuit(circuitId) {
    if (!isAffixCircuit(circuitId)) {
        throw new Error(`unsupported_circuit:${circuitId}`);
    }
    if (cache.has(circuitId))
        return cache.get(circuitId);
    const circuit = loadCompiled(circuitId);
    const noir = new Noir(circuit);
    const { UltraHonkBackend, Barretenberg, BackendType } = await getBb();
    // Prefer WASM for portable npm installs; fall back to default auto backend.
    let api;
    try {
        api = await Barretenberg.new({ backend: BackendType.Wasm, threads: 1 });
    }
    catch {
        api = await Barretenberg.new({ threads: 1 });
    }
    const backend = new UltraHonkBackend(circuit.bytecode, api);
    const runtime = { noir, backend };
    cache.set(circuitId, runtime);
    return runtime;
}
/**
 * Barretenberg writes progress lines to stdout. Hosts and the CLI emit JSON on
 * stdout, so backend chatter is redirected to stderr for the duration of a call.
 */
async function withQuietBackend(fn) {
    const original = console.log;
    console.log = (...args) => console.error(...args);
    try {
        return await fn();
    }
    finally {
        console.log = original;
    }
}
export async function localProve(witness) {
    const { noir, backend } = await getCircuit(witness.circuit_id);
    const normalized = fieldInputs(witness.inputs);
    const { witness: witnessBytes, returnValue } = await noir.execute(normalized);
    const proofData = await withQuietBackend(() => backend.generateProof(witnessBytes));
    const proof = packProof(proofData);
    const rv = formatReturnValue(returnValue);
    const decisionPass = interpretFieldReturnValue(rv);
    const publicOk = (proofData.publicInputs?.length ?? 0) > 0
        ? interpretFieldReturnValue(proofData.publicInputs[proofData.publicInputs.length - 1])
        : decisionPass;
    const valid = decisionPass && publicOk;
    const digest = proofDigest(proof, witness.circuit_id, valid);
    return { proof, returnValue: rv, valid, proofDigest: digest, proofData };
}
export async function localVerify(circuitId, proofHex) {
    if (!isAffixCircuit(circuitId)) {
        throw new Error(`unsupported_circuit:${circuitId}`);
    }
    const { backend } = await getCircuit(circuitId);
    const proofData = unpackProof(proofHex);
    const proofVerified = await withQuietBackend(() => backend.verifyProof(proofData));
    const publicInputs = proofData.publicInputs ?? [];
    const rv = publicInputs.length > 0
        ? publicInputs[publicInputs.length - 1]
        : proofVerified
            ? "1"
            : "0";
    const decisionPass = interpretFieldReturnValue(rv);
    const valid = proofVerified && decisionPass;
    return {
        valid,
        decision: valid ? "yes" : "no",
        returnValue: rv,
    };
}
export function makeProofId() {
    return `afx_${randomBytes(16).toString("hex")}`;
}
