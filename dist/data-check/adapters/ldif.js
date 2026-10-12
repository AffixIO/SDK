import { readFileSync, existsSync } from "node:fs";
import { buildCheckResult } from "../map-check.js";
/**
 * LDAP / AD LDIF export (historic directory style person records).
 * dn: uid=P-1,ou=patients
 * status: in_ed
 * ward: A&E
 */
export class LdifStore {
    name = "ldif";
    style = "legacy";
    records;
    idAttr;
    constructor(records, idAttr = "uid") {
        this.records = records;
        this.idAttr = idAttr;
    }
    static fromFile(path, options) {
        if (!existsSync(path))
            throw new Error(`ldif_missing:${path}`);
        const text = readFileSync(path, "utf8");
        const records = parseLdif(text);
        return new LdifStore(records, options?.idAttr ?? "uid");
    }
    async lookup(query) {
        const row = this.records.find((r) => r[this.idAttr] === query.id ||
            r.id === query.id ||
            (r.dn ?? "").includes(`=${query.id},`) ||
            (r.dn ?? "").includes(`=${query.id}`));
        if (!row)
            return null;
        return buildCheckResult({
            row: { ...row },
            query,
            source: this.name,
            style: this.style,
            record_id: query.id,
            meta: { format: "ldif" },
        });
    }
}
function parseLdif(text) {
    const blocks = text.split(/\n\s*\n/);
    const out = [];
    for (const block of blocks) {
        const lines = block.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
        if (!lines.length)
            continue;
        const row = {};
        for (const line of lines) {
            const idx = line.indexOf(":");
            if (idx <= 0)
                continue;
            const key = line.slice(0, idx).trim();
            let val = line.slice(idx + 1).trim();
            if (val.startsWith(":")) {
                // Base64 is optional. Keep it encoded for exact field tests using plain text.
                val = val.slice(1).trim();
            }
            if (row[key] !== undefined)
                row[key] = `${row[key]};${val}`;
            else
                row[key] = val;
        }
        if (Object.keys(row).length)
            out.push(row);
    }
    return out;
}
