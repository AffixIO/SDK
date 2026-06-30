import { createHash } from "node:crypto";
const FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
function reduceField(value) {
    return ((value % FR_MODULUS) + FR_MODULUS) % FR_MODULUS;
}
function bytesToField(bytes) {
    let acc = 0n;
    for (const byte of bytes) {
        acc = (acc << 8n) + BigInt(byte);
    }
    return reduceField(acc);
}
function fieldToBigInt(value) {
    if (typeof value === "bigint")
        return reduceField(value);
    if (typeof value === "number")
        return reduceField(BigInt(value));
    const raw = String(value).trim();
    if (!raw)
        return 0n;
    if (raw.startsWith("0x") || raw.startsWith("0X")) {
        return reduceField(BigInt(raw));
    }
    if (/^[0-9]+$/.test(raw)) {
        return reduceField(BigInt(raw));
    }
    return bytesToField(createHash("sha256").update(raw, "utf8").digest());
}
function fieldToHex(value) {
    return `0x${reduceField(value).toString(16)}`;
}
/** Map labels or hex to BN254 field elements (matches api.affix-io.com encoding). */
export function fieldInputHex(value) {
    return fieldToHex(fieldToBigInt(value));
}
