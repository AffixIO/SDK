import { readFileSync, existsSync } from "node:fs";
import { buildCheckResult } from "../map-check.js";
/**
 * Modern document store: JSON array of objects, or { records: [...] }.
 * Example:
 * [
 *   { "id": "p1", "status": "in_ed", "ward": "A&E" }
 * ]
 */
export class JsonDocumentStore {
    name = "json_document";
    style = "modern";
    records;
    constructor(records) {
        this.records = records;
    }
    static fromFile(path) {
        if (!existsSync(path))
            throw new Error(`json_store_missing:${path}`);
        const raw = JSON.parse(readFileSync(path, "utf8"));
        const list = Array.isArray(raw)
            ? raw
            : Array.isArray(raw?.records)
                ? raw.records
                : Array.isArray(raw?.data)
                    ? raw.data
                    : null;
        if (!list)
            throw new Error("json_store_invalid_shape");
        return new JsonDocumentStore(list);
    }
    async lookup(query) {
        const id = String(query.id);
        const row = this.records.find((r) => String(r.id ?? r.ID ?? r.patient_id ?? r.pk ?? "") === id);
        if (!row)
            return null;
        return buildCheckResult({
            row,
            query,
            source: this.name,
            style: this.style,
            record_id: id,
        });
    }
}
