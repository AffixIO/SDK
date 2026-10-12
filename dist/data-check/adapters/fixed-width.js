import { readFileSync, existsSync } from "node:fs";
import { buildCheckResult } from "../map-check.js";
/**
 * Legacy fixed-width / mainframe-style export.
 * Each line is one record; columns cut by absolute character positions.
 */
export class FixedWidthStore {
    name = "fixed_width";
    style = "legacy";
    lines;
    fields;
    idField;
    constructor(lines, fields, idField = "id") {
        this.lines = lines;
        this.fields = fields;
        this.idField = idField;
    }
    static fromFile(path, fields, options) {
        if (!existsSync(path))
            throw new Error(`fixed_width_missing:${path}`);
        let lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.length > 0);
        if (options?.skipHeader && lines.length)
            lines = lines.slice(1);
        return new FixedWidthStore(lines, fields, options?.idField ?? "id");
    }
    parseLine(line) {
        const row = {};
        for (const f of this.fields) {
            row[f.name] = line.slice(f.start, f.start + f.length).trimEnd();
        }
        return row;
    }
    async lookup(query) {
        for (const line of this.lines) {
            const row = this.parseLine(line);
            if (row[this.idField] === query.id) {
                return buildCheckResult({
                    row,
                    query,
                    source: this.name,
                    style: this.style,
                    record_id: query.id,
                    meta: { layout: "fixed_width" },
                });
            }
        }
        return null;
    }
}
