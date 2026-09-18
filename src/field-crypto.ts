/* Credit: @paparichens */
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
export function fieldToBigInt(value: string | number | bigint): bigint {
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
export function fieldToHex(value: bigint): string {
    return `0x${reduceField(value).toString(16)}`;
}
export function fieldInputHex(value: string | number | bigint): string {
    return fieldToHex(fieldToBigInt(value));
}
export function claimDigestField(value: string | number): string {
    return fieldToHex(bytesToField(createHash("sha256").update(String(value), "utf8").digest()));
}
export function claimAsCircuitField(value: string | number): string {
    const raw = String(value).trim();
    if (/^[0-9]+$/.test(raw)) {
        return fieldToHex(fieldToBigInt(raw));
    }
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
        return fieldToHex(fieldToBigInt(value));
    }
    return claimDigestField(value);
}
export function credentialPayloadFingerprint(input: {
    issuer_pubkey_hash: string | bigint;
    schema_id: string | bigint;
    claim_hash: string | bigint;
    valid_from: string | number | bigint;
    valid_until: string | number | bigint;
}): string {
    const issuer = fieldToBigInt(input.issuer_pubkey_hash);
    const schema = fieldToBigInt(input.schema_id);
    const claim = fieldToBigInt(input.claim_hash);
    const from = fieldToBigInt(input.valid_from);
    const until = fieldToBigInt(input.valid_until);
    return fieldToHex(issuer + schema * 2n + claim * 4n + from * 8n + until * 16n);
}
export function deriveNullifierField(input: {
    secret: string;
    context_id: string;
    credential_id: string;
}): string {
    const secret = fieldToBigInt(input.secret);
    const context = fieldToBigInt(input.context_id);
    const credential = fieldToBigInt(input.credential_id);
    return fieldToHex(secret + context * 2n + credential * 4n);
}
export function normalizeCredentialFields<T extends {
    schema_id: string;
    issuer_pubkey_hash: string;
    credential_id: string;
}>(credential: T): T {
    return {
        ...credential,
        schema_id: fieldInputHex(credential.schema_id),
        issuer_pubkey_hash: fieldInputHex(credential.issuer_pubkey_hash),
        credential_id: fieldInputHex(credential.credential_id),
    };
}
