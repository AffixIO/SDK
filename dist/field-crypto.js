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
export function fieldToBigInt(value) {
    if (typeof value === "bigint")
        return reduceField(value);
    if (typeof value === "number")
        return reduceField(BigInt(value));
    const raw = String(value).trim();
    if (!raw)
        return 0n;
    if (raw.startsWith("0x") || raw.startsWith("0X")) {
        try {
            return reduceField(BigInt(raw));
        }
        catch {
            return bytesToField(createHash("sha256").update(raw, "utf8").digest());
        }
    }
    if (/^[0-9]+$/.test(raw)) {
        return reduceField(BigInt(raw));
    }
    return bytesToField(createHash("sha256").update(raw, "utf8").digest());
}
export function fieldToHex(value) {
    return `0x${reduceField(value).toString(16)}`;
}
export function fieldInputHex(value) {
    return fieldToHex(fieldToBigInt(value));
}
export function claimDigestField(value) {
    return fieldToHex(bytesToField(createHash("sha256").update(String(value), "utf8").digest()));
}
export function claimAsCircuitField(value) {
    const raw = String(value).trim();
    if (/^[0-9]+$/.test(raw)) {
        return fieldToHex(fieldToBigInt(raw));
    }
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
        return fieldToHex(fieldToBigInt(value));
    }
    return claimDigestField(value);
}
export function credentialPayloadFingerprint(input) {
    const issuer = fieldToBigInt(input.issuer_pubkey_hash);
    const schema = fieldToBigInt(input.schema_id);
    const claim = fieldToBigInt(input.claim_hash);
    const from = fieldToBigInt(input.valid_from);
    const until = fieldToBigInt(input.valid_until);
    return fieldToHex(issuer + schema * 2n + claim * 4n + from * 8n + until * 16n);
}
export function deriveNullifierField(input) {
    const secret = fieldToBigInt(input.secret);
    const context = fieldToBigInt(input.context_id);
    const credential = fieldToBigInt(input.credential_id);
    return fieldToHex(secret + context * 2n + credential * 4n);
}
export function normalizeCredentialFields(credential) {
    return {
        ...credential,
        schema_id: fieldInputHex(credential.schema_id),
        issuer_pubkey_hash: fieldInputHex(credential.issuer_pubkey_hash),
        credential_id: fieldInputHex(credential.credential_id),
    };
}
