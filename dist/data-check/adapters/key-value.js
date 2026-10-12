import { readFileSync, existsSync } from "node:fs";
import { buildCheckResult, exactFieldString } from "../map-check.js";
/**
 * Modern key-value document map (Redis-like / JSON object):
 * {
 *   "p1": { "status": "approved", "site": "GGH" },
 *   "p2": "in_ed"
 * }
 * Bare string value becomes { value: "..." }.
 */
export class KeyValueStore {
    name = "key_value";
    style = "modern";
    map;
    constructor(map) {
        this.map = map;
    }
    static fromFile(path) {
        if (!existsSync(path))
            throw new Error(`kv_store_missing:${path}`);
        const raw = JSON.parse(readFileSync(path, "utf8"));
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new Error("kv_store_invalid_shape");
        }
        return new KeyValueStore(raw);
    }
    async lookup(query) {
        if (!Object.prototype.hasOwnProperty.call(this.map, query.id))
            return null;
        const raw = this.map[query.id];
        let row;
        if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
            row = { ...raw, id: query.id };
        }
        else {
            row = { id: query.id, value: exactFieldString(raw), claim: exactFieldString(raw) };
        }
        return buildCheckResult({
            row,
            query,
            source: this.name,
            style: this.style,
            record_id: query.id,
        });
    }
}
