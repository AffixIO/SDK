import { readFileSync, existsSync } from "node:fs";
import { buildCheckResult } from "../map-check.js";
/**
 * XML document / message dump (HL7 CDA fragments, PAS XML extracts, SOAP bodies).
 * Finds elements matching recordTag (default "record" | "patient" | "row").
 * Child element text becomes string fields.
 */
export class XmlDocumentStore {
    name = "xml_document";
    style;
    records;
    idField;
    constructor(records, options) {
        this.records = records;
        this.idField = options?.idField ?? "id";
        this.style = options?.style ?? "legacy";
    }
    static fromFile(path, options) {
        if (!existsSync(path))
            throw new Error(`xml_store_missing:${path}`);
        const xml = readFileSync(path, "utf8");
        const tags = options?.recordTag
            ? [options.recordTag]
            : ["record", "patient", "row", "item", "entry"];
        const records = [];
        for (const tag of tags) {
            const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
            let m;
            while ((m = re.exec(xml)) !== null) {
                records.push(parseElementFields(m[1]));
            }
            if (records.length)
                break;
        }
        return new XmlDocumentStore(records, {
            idField: options?.idField ?? "id",
            style: options?.style ?? "legacy",
        });
    }
    async lookup(query) {
        const row = this.records.find((r) => r[this.idField] === query.id);
        if (!row)
            return null;
        return buildCheckResult({
            row: { ...row },
            query,
            source: this.name,
            style: this.style,
            record_id: query.id,
            meta: { format: "xml" },
        });
    }
}
function parseElementFields(inner) {
    const row = {};
    const re = /<([A-Za-z_][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
    let m;
    while ((m = re.exec(inner)) !== null) {
        const name = m[1];
        const body = m[2].trim();
        if (/<[A-Za-z_]/.test(body)) {
            // nested: flatten first-level text only as joined, or store raw
            row[name] = body.replace(/<[^>]+>/g, "").trim();
        }
        else {
            row[name] = decodeXml(body);
        }
    }
    // attributes on self-closing rare; also id="…"
    const idAttr = inner.match(/\bid\s*=\s*["']([^"']+)["']/i);
    if (idAttr && row.id === undefined)
        row.id = idAttr[1];
    return row;
}
function decodeXml(s) {
    return s
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}
