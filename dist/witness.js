import { randomBytes } from "node:crypto";
import { normalizeCredential } from "./credential-normalize.js";
const FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
function reduceField(value) {
    return ((value % FR_MODULUS) + FR_MODULUS) % FR_MODULUS;
}
export function randomFieldHex() {
    const bytes = randomBytes(32);
    let acc = 0n;
    for (const byte of bytes) {
        acc = (acc << 8n) + BigInt(byte);
    }
    return `0x${reduceField(acc).toString(16)}`;
}
export function defaultContext(overrides = {}) {
    return {
        secret: overrides.secret ?? randomFieldHex(),
        context_id: overrides.context_id ?? randomFieldHex(),
        ...overrides,
    };
}
export async function prepareWitness(client, circuitId, credential, context) {
    const response = await client.prepareWitness({
        circuit_id: circuitId,
        credential: normalizeCredential(credential),
        context,
    });
    const witness = response.witness;
    if (!witness?.inputs) {
        throw new Error("witness_prepare_empty");
    }
    return witness;
}
export function witnessFromInputs(circuitId, inputs) {
    return { circuit_id: circuitId, inputs };
}
