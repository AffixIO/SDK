import { readFileSync, existsSync } from "node:fs";
import { buildCheckResult } from "../map-check.js";
/**
 * Legacy CSV / TSV table (first row = headers). Classic extract style.
 * Default delimiter auto-detects tab vs comma.
 */
export class CsvTableStore {
    name = "csv_table";
    style = "legacy";
    rows;
    idColumn;
    constructor(rows, idColumn = "id") {
        this.rows = rows;
        this.idColumn = idColumn;
    }
    static fromFile(path, options) {
        if (!existsSync(path))
            throw new Error(`csv_store_missing:${path}`);
        const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
        const delimiter = options?.delimiter ??
            (text.includes("\t") && text.indexOf("\t") < text.indexOf("\n") ? "\t" : ",");
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2)
            throw new Error("csv_store_empty");
        const headers = parseCsvLine(lines[0], delimiter).map((h) => h.trim());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = parseCsvLine(lines[i], delimiter);
            const row = {};
            headers.forEach((h, idx) => {
                row[h] = cols[idx] ?? "";
            });
            rows.push(row);
        }
        return new CsvTableStore(rows, options?.idColumn ?? "id");
    }
    async lookup(query) {
        const row = this.rows.find((r) => r[this.idColumn] === query.id);
        if (!row)
            return null;
        return buildCheckResult({
            row: { ...row },
            query,
            source: this.name,
            style: this.style,
            record_id: query.id,
            meta: { id_column: this.idColumn },
        });
    }
}
/** Minimal CSV line parser with quotes. */
export function parseCsvLine(line, delimiter = ",") {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    cur += '"';
                    i++;
                }
                else {
                    inQuotes = false;
                }
            }
            else {
                cur += ch;
            }
        }
        else if (ch === '"') {
            inQuotes = true;
        }
        else if (ch === delimiter) {
            out.push(cur);
            cur = "";
        }
        else {
            cur += ch;
        }
    }
    out.push(cur);
    return out;
}
