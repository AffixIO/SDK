import { readFileSync, existsSync } from "node:fs";
import { buildCheckResult } from "../map-check.js";
/**
 * Historic .ini / sectioned property store (old config + small PAS property bags).
 *
 * [P-1001]
 * status=in_ed
 * ward=A&E
 */
export class IniSectionStore {
    name = "ini_section";
    style = "legacy";
    sections;
    constructor(sections) {
        this.sections = sections;
    }
    static fromFile(path) {
        if (!existsSync(path))
            throw new Error(`ini_missing:${path}`);
        return new IniSectionStore(parseIni(readFileSync(path, "utf8")));
    }
    async lookup(query) {
        const row = this.sections.get(query.id);
        if (!row)
            return null;
        return buildCheckResult({
            row: { id: query.id, ...row },
            query,
            source: this.name,
            style: this.style,
            record_id: query.id,
            meta: { format: "ini" },
        });
    }
}
function parseIni(text) {
    const map = new Map();
    let current = null;
    for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith(";") || t.startsWith("#"))
            continue;
        const sec = t.match(/^\[([^\]]+)\]$/);
        if (sec) {
            current = sec[1].trim();
            if (!map.has(current))
                map.set(current, {});
            continue;
        }
        if (!current)
            continue;
        const eq = t.indexOf("=");
        if (eq <= 0)
            continue;
        const k = t.slice(0, eq).trim();
        const v = t.slice(eq + 1).trim();
        map.get(current)[k] = v;
    }
    return map;
}
