import { readFileSync, existsSync } from "node:fs";
import { buildCheckResult } from "../map-check.js";
/**
 * Redis RESP bulk dump / simple KEY=VALUE line redis-export style.
 * Also accepts JSON objects (same as KeyValueStore) when file is JSON.
 *
 * SET P-1001 "{\"status\":\"in_ed\",\"ward\":\"A&E\"}"
 * or plain lines:
 * P-1001 status=in_ed ward=A&E
 */
export class RedisExportStore {
    name = "redis_export";
    style = "modern";
    map;
    constructor(map) {
        this.map = map;
    }
    static fromFile(path) {
        if (!existsSync(path))
            throw new Error(`redis_export_missing:${path}`);
        const text = readFileSync(path, "utf8").trim();
        if (text.startsWith("{")) {
            const obj = JSON.parse(text);
            const map = new Map();
            for (const [k, v] of Object.entries(obj)) {
                if (v && typeof v === "object" && !Array.isArray(v)) {
                    map.set(k, v);
                }
                else {
                    map.set(k, { value: v, claim: v });
                }
            }
            return new RedisExportStore(map);
        }
        const map = new Map();
        for (const line of text.split(/\r?\n/)) {
            const t = line.trim();
            if (!t || t.startsWith("#"))
                continue;
            const setM = t.match(/^SET\s+(\S+)\s+(.+)$/i);
            if (setM) {
                const key = setM[1];
                let val = setM[2].trim();
                if ((val.startsWith('"') && val.endsWith('"')) ||
                    (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                try {
                    const parsed = JSON.parse(val);
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                        map.set(key, parsed);
                    }
                    else {
                        map.set(key, { value: parsed, claim: parsed });
                    }
                }
                catch {
                    map.set(key, { value: val, claim: val });
                }
                continue;
            }
            const parts = t.split(/\s+/);
            if (parts.length < 2)
                continue;
            const key = parts[0];
            const row = {};
            for (let i = 1; i < parts.length; i++) {
                const eq = parts[i].indexOf("=");
                if (eq > 0)
                    row[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
            }
            map.set(key, row);
        }
        return new RedisExportStore(map);
    }
    async lookup(query) {
        const row = this.map.get(query.id);
        if (!row)
            return null;
        return buildCheckResult({
            row: { id: query.id, ...row },
            query,
            source: this.name,
            style: this.style,
            record_id: query.id,
            meta: { format: "redis_export" },
        });
    }
}
