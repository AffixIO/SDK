import { readFileSync, existsSync } from "node:fs";
import { buildCheckResult } from "../map-check.js";
/**
 * Historic dBASE III/IV / FoxPro / Clipper style .dbf files (read-only).
 * Common in older PAS / GP system exports.
 */
export class DbaseStore {
    name = "dbase";
    style = "legacy";
    rows;
    idField;
    constructor(rows, idField = "ID") {
        this.rows = rows;
        this.idField = idField;
    }
    static fromFile(path, options) {
        if (!existsSync(path))
            throw new Error(`dbase_missing:${path}`);
        const buf = readFileSync(path);
        const { rows, fields } = parseDbf(buf);
        const idField = options?.idField ??
            fields.find((f) => f.name.toUpperCase() === "ID")?.name ??
            fields[0]?.name ??
            "ID";
        return new DbaseStore(rows, idField);
    }
    async lookup(query) {
        const row = this.rows.find((r) => r[this.idField] === query.id ||
            r[this.idField.toUpperCase()] === query.id ||
            r[this.idField.toLowerCase()] === query.id);
        if (!row)
            return null;
        // Normalise keys to field names as stored; also lower-case aliases for claimField "status"
        const normalised = { ...row };
        for (const [k, v] of Object.entries(row)) {
            normalised[k.toLowerCase()] = v;
        }
        return buildCheckResult({
            row: normalised,
            query,
            source: this.name,
            style: this.style,
            record_id: query.id,
            meta: { id_field: this.idField, format: "dbf" },
        });
    }
}
export function parseDbf(buf) {
    if (buf.length < 32)
        throw new Error("dbf_too_short");
    const headerLen = buf.readUInt16LE(8);
    const recordLen = buf.readUInt16LE(10);
    const fields = [];
    let offset = 1; // skip deletion flag
    let pos = 32;
    while (pos < headerLen - 1 && buf[pos] !== 0x0d) {
        const nameBytes = buf.subarray(pos, pos + 11);
        const name = nameBytes.toString("ascii").replace(/\0.*$/, "").trim();
        const type = String.fromCharCode(buf[pos + 11]);
        const length = buf[pos + 16];
        fields.push({ name, type, length, offset });
        offset += length;
        pos += 32;
    }
    const numRecords = buf.readUInt32LE(4);
    const rows = [];
    let recPos = headerLen;
    for (let i = 0; i < numRecords && recPos + recordLen <= buf.length; i++) {
        if (buf[recPos] === 0x2a) {
            // deleted
            recPos += recordLen;
            continue;
        }
        const row = {};
        for (const f of fields) {
            const raw = buf.subarray(recPos + f.offset, recPos + f.offset + f.length).toString("ascii");
            row[f.name] = raw.trim();
        }
        rows.push(row);
        recPos += recordLen;
    }
    return { rows, fields };
}
