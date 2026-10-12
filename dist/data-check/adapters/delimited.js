import { readFileSync, existsSync } from "node:fs";
import { buildCheckResult } from "../map-check.js";
import { parseCsvLine } from "./csv-table.js";
/**
 * Generic character-delimited table (semicolon European extracts, colon dumps, etc.).
 * Complements CsvTableStore (comma/tab) and PipeDelimitedStore.
 */
export class DelimitedTableStore {
    name;
    style;
    rows;
    idColumn;
    constructor(rows, options) {
        this.rows = rows;
        this.idColumn = options.idColumn ?? "id";
        this.name = options.name ?? `delimited_${options.delimiter === ";" ? "semicolon" : "custom"}`;
        this.style = options.style ?? "legacy";
    }
    static fromFile(path, options) {
        if (!existsSync(path))
            throw new Error(`delimited_missing:${path}`);
        const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2)
            throw new Error("delimited_empty");
        const headers = parseCsvLine(lines[0], options.delimiter).map((h) => h.trim());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = parseCsvLine(lines[i], options.delimiter);
            const row = {};
            headers.forEach((h, idx) => {
                row[h] = cols[idx] ?? "";
            });
            rows.push(row);
        }
        return new DelimitedTableStore(rows, options);
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
            meta: { delimiter: this.name },
        });
    }
}
