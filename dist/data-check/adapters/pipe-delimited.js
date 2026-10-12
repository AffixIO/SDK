import { readFileSync, existsSync } from "node:fs";
import { buildCheckResult } from "../map-check.js";
/**
 * Legacy pipe-delimited extract (classic PAS dump style).
 * Header optional: #id|status|ward
 * Records: p01|in_ed|AE01
 */
export class PipeDelimitedStore {
    name = "pipe_delimited";
    style = "legacy";
    rows;
    idColumn;
    constructor(rows, idColumn = "id") {
        this.rows = rows;
        this.idColumn = idColumn;
    }
    static fromFile(path, options) {
        if (!existsSync(path))
            throw new Error(`pipe_store_missing:${path}`);
        const lines = readFileSync(path, "utf8")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && !l.startsWith("//"));
        let headers = options?.headers;
        let start = 0;
        if (!headers && lines[0]?.startsWith("#")) {
            headers = lines[0].slice(1).split("|").map((h) => h.trim());
            start = 1;
        }
        if (!headers) {
            headers = ["id", "status", "ward", "extra"];
        }
        const rows = [];
        for (let i = start; i < lines.length; i++) {
            const cols = lines[i].split("|");
            const row = {};
            headers.forEach((h, idx) => {
                row[h] = (cols[idx] ?? "").trim();
            });
            rows.push(row);
        }
        return new PipeDelimitedStore(rows, options?.idColumn ?? headers[0] ?? "id");
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
            meta: { delimiter: "|" },
        });
    }
}
