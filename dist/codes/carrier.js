import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { isAffixCircuit } from "../witness.js";
const PREFIX = "AFX.ZK1.";
export { PREFIX as ZK_CARRIER_PREFIX };
const MAGIC = Buffer.from("AFX1");
const VERSION = 1;
const CIRCUIT_CODES = { simple_yesno: 0, yesno: 1 };
const CODE_TO_CIRCUIT = {
    0: "simple_yesno",
    1: "yesno",
};
const HEADER_BYTES = 64;
/** QR version 40 ECC-L binary capacity (conservative). */
export const QR_MAX_BINARY_BYTES = 2953;
/** PDF417 level 8 binary capacity (conservative). */
export const PDF417_MAX_BINARY_BYTES = 1800;
/** Data Matrix ECC200 max binary (conservative). */
export const DATAMATRIX_MAX_BINARY_BYTES = 2335;
export function normaliseMaxUses(value) {
    if (value === undefined || value === "unlimited")
        return 0;
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 0) {
        throw new Error("maxUses must be 0, unlimited, or 1–255");
    }
    if (n > 255) {
        throw new Error("maxUses cannot exceed 255");
    }
    return n;
}
export function defaultExp() {
    return Math.floor(Date.now() / 1000) + 86400 * 30;
}
function circuitToCode(circuitId) {
    const code = CIRCUIT_CODES[circuitId];
    if (code === undefined)
        throw new Error(`unsupported_circuit:${circuitId}`);
    return code;
}
function writeHeader(buf, offset, header) {
    MAGIC.copy(buf, offset);
    offset += 4;
    buf.writeUInt8(VERSION, offset++);
    const flags = (header.mode === "compact" ? 0x01 : 0x00) | (header.decision === "yes" ? 0x02 : 0x00);
    buf.writeUInt8(flags, offset++);
    buf.writeUInt8(circuitToCode(header.circuit_id), offset++);
    buf.writeUInt8(header.max_uses, offset++);
    buf.writeUInt32BE(header.exp, offset);
    offset += 4;
    buf.writeUInt32BE(header.valid_from, offset);
    offset += 4;
    const codeId = Buffer.from(header.code_id.replace(/-/g, ""), "hex");
    if (codeId.length !== 16) {
        throw new Error("code_id must be 32 hex chars");
    }
    codeId.copy(buf, offset);
    offset += 16;
    const digest = Buffer.from(header.proof_digest, "hex");
    if (digest.length !== 32) {
        throw new Error("proof_digest must be 64 hex chars");
    }
    digest.copy(buf, offset);
    offset += 32;
    return offset;
}
function readHeader(buf, offset) {
    if (buf.length < offset + HEADER_BYTES) {
        throw new Error("carrier_truncated");
    }
    const magic = buf.subarray(offset, offset + 4);
    if (!magic.equals(MAGIC)) {
        throw new Error("carrier_bad_magic");
    }
    offset += 4;
    const version = buf.readUInt8(offset++);
    if (version !== VERSION) {
        throw new Error(`carrier_unsupported_version:${version}`);
    }
    const flags = buf.readUInt8(offset++);
    const mode = flags & 0x01 ? "compact" : "full";
    const decision = flags & 0x02 ? "yes" : "no";
    const circuitCode = buf.readUInt8(offset++);
    const circuit_id = CODE_TO_CIRCUIT[circuitCode];
    if (!circuit_id)
        throw new Error(`carrier_unknown_circuit:${circuitCode}`);
    const max_uses = buf.readUInt8(offset++);
    const exp = buf.readUInt32BE(offset);
    offset += 4;
    const valid_from = buf.readUInt32BE(offset);
    offset += 4;
    const code_id = buf.subarray(offset, offset + 16).toString("hex");
    offset += 16;
    const proof_digest = buf.subarray(offset, offset + 32).toString("hex");
    offset += 32;
    return {
        header: {
            version: 1,
            mode,
            circuit_id,
            decision,
            max_uses,
            exp,
            valid_from,
            code_id,
            proof_digest,
        },
        offset,
    };
}
function packBody(proofData) {
    if (!proofData)
        return Buffer.alloc(0);
    const pubJson = Buffer.from(JSON.stringify(proofData.publicInputs ?? []), "utf8");
    const proofGz = gzipSync(Buffer.from(proofData.proof));
    const body = Buffer.alloc(2 + pubJson.length + 4 + proofGz.length);
    let o = 0;
    body.writeUInt16BE(pubJson.length, o);
    o += 2;
    pubJson.copy(body, o);
    o += pubJson.length;
    body.writeUInt32BE(proofGz.length, o);
    o += 4;
    proofGz.copy(body, o);
    return body;
}
function unpackBody(buf, offset) {
    if (buf.length < offset + 2) {
        throw new Error("carrier_body_truncated");
    }
    const pubLen = buf.readUInt16BE(offset);
    offset += 2;
    if (buf.length < offset + pubLen + 4) {
        throw new Error("carrier_body_truncated");
    }
    const pubJson = buf.subarray(offset, offset + pubLen).toString("utf8");
    offset += pubLen;
    const gzLen = buf.readUInt32BE(offset);
    offset += 4;
    if (buf.length < offset + gzLen) {
        throw new Error("carrier_proof_truncated");
    }
    const proofGz = buf.subarray(offset, offset + gzLen);
    offset += gzLen;
    const publicInputs = JSON.parse(pubJson);
    const proof = gunzipSync(proofGz);
    return { proofData: { proof, publicInputs }, offset };
}
export function buildHeader(input) {
    if (!isAffixCircuit(input.circuitId)) {
        throw new Error(`unsupported_circuit:${input.circuitId}`);
    }
    return {
        version: 1,
        mode: input.mode,
        circuit_id: input.circuitId,
        decision: input.decision,
        max_uses: normaliseMaxUses(input.maxUses),
        exp: input.exp ?? defaultExp(),
        valid_from: input.validFrom ?? 0,
        code_id: input.codeId ?? randomBytes(16).toString("hex"),
        proof_digest: input.proofDigest,
        proof_id: input.proofId,
    };
}
export function packCarrier(header, proofData) {
    const body = header.mode === "full" ? packBody(proofData) : Buffer.alloc(0);
    const buf = Buffer.alloc(HEADER_BYTES + body.length);
    writeHeader(buf, 0, header);
    body.copy(buf, HEADER_BYTES);
    const tag = header.mode === "compact" ? "C" : "F";
    return PREFIX + tag + "." + buf.toString("base64url");
}
export function unpackCarrier(text) {
    const raw = String(text).trim();
    if (!raw.startsWith(PREFIX)) {
        throw new Error("carrier_not_zk_code");
    }
    const rest = raw.slice(PREFIX.length);
    const dot = rest.indexOf(".");
    if (dot < 1)
        throw new Error("carrier_malformed");
    const tag = rest.slice(0, dot);
    const b64 = rest.slice(dot + 1);
    const buf = Buffer.from(b64, "base64url");
    const { header, offset } = readHeader(buf, 0);
    if (tag === "C") {
        if (header.mode !== "compact") {
            header.mode = "compact";
        }
        return { ...header };
    }
    if (tag === "F") {
        const { proofData } = unpackBody(buf, offset);
        const proofHex = Buffer.from(JSON.stringify({
            proof: Array.from(proofData.proof),
            publicInputs: proofData.publicInputs,
        })).toString("hex");
        return {
            ...header,
            mode: "full",
            proof_hex: proofHex,
            public_inputs: proofData.publicInputs,
        };
    }
    throw new Error(`carrier_unknown_tag:${tag}`);
}
export function isZkCarrier(text) {
    return String(text).trim().startsWith(PREFIX);
}
export function proofDataFromHex(proofHex) {
    const parsed = JSON.parse(Buffer.from(proofHex, "hex").toString("utf8"));
    return {
        proof: Uint8Array.from(parsed.proof),
        publicInputs: parsed.publicInputs ?? [],
    };
}
export function carrierBinarySize(mode, proofData) {
    const header = HEADER_BYTES;
    if (mode === "compact")
        return header;
    return header + packBody(proofData).length;
}
export function selectSymbology(kind, byteSize, symbology) {
    if (kind === "qr" && byteSize <= QR_MAX_BINARY_BYTES) {
        return { kind: "qr", symbology: "qrcode", mode: "full" };
    }
    if (byteSize <= PDF417_MAX_BINARY_BYTES) {
        return { kind: "barcode", symbology: symbology ?? "pdf417", mode: "full" };
    }
    if (byteSize <= DATAMATRIX_MAX_BINARY_BYTES) {
        return { kind: "barcode", symbology: "datamatrix", mode: "full" };
    }
    if (kind === "qr") {
        return { kind: "qr", symbology: "qrcode", mode: "compact" };
    }
    return { kind: "barcode", symbology: symbology ?? "pdf417", mode: "compact" };
}
export function digestProofHex(proofHex, circuitId = "simple_yesno", valid = true) {
    return createHash("sha256")
        .update(`${circuitId}:${valid}:${proofHex}`)
        .digest("hex");
}
