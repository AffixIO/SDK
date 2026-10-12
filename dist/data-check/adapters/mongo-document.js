import { readFileSync, existsSync } from "node:fs";
import { buildCheckResult } from "../map-check.js";
/**
 * MongoDB-style / modern document collection.
 * Supports:
 * - JSON array of documents
 * - NDJSON (one JSON object per line)
 * - { "documents": [ … ] } or mongodump-ish exports with $oid ignored as text
 */
export class MongoDocumentStore {
    name = "mongo_document";
    style = "modern";
    docs;
    idField;
    constructor(docs, idField = "_id") {
        this.docs = docs;
        this.idField = idField;
    }
    static fromFile(path, options) {
        if (!existsSync(path))
            throw new Error(`mongo_store_missing:${path}`);
        const text = readFileSync(path, "utf8").trim();
        let docs;
        if (text.startsWith("[")) {
            docs = JSON.parse(text);
        }
        else if (text.startsWith("{")) {
            const obj = JSON.parse(text);
            if (Array.isArray(obj.documents))
                docs = obj.documents;
            else if (Array.isArray(obj.data))
                docs = obj.data;
            else
                docs = [obj];
        }
        else {
            docs = text
                .split(/\r?\n/)
                .filter((l) => l.trim())
                .map((l) => JSON.parse(l));
        }
        return new MongoDocumentStore(docs.map(flattenMongoIds), options?.idField ?? "_id");
    }
    async lookup(query) {
        const id = query.id;
        const doc = this.docs.find((d) => {
            const keys = [this.idField, "id", "_id", "pk", "patient_id"];
            return keys.some((k) => d[k] !== undefined && String(d[k]) === id);
        });
        if (!doc)
            return null;
        return buildCheckResult({
            row: doc,
            query,
            source: this.name,
            style: this.style,
            record_id: id,
            meta: { id_field: this.idField },
        });
    }
}
function flattenMongoIds(doc) {
    const out = { ...doc };
    for (const [k, v] of Object.entries(out)) {
        if (v && typeof v === "object" && !Array.isArray(v) && "$oid" in v) {
            out[k] = String(v.$oid);
        }
    }
    return out;
}
