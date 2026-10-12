import type { DataCheckQuery, DataCheckResult, DataCheckSource } from "../types.js";
/**
 * MongoDB-style / modern document collection.
 * Supports:
 * - JSON array of documents
 * - NDJSON (one JSON object per line)
 * - { "documents": [ … ] } or mongodump-ish exports with $oid ignored as text
 */
export declare class MongoDocumentStore implements DataCheckSource {
    readonly name = "mongo_document";
    readonly style: "modern";
    private docs;
    private idField;
    constructor(docs: Array<Record<string, unknown>>, idField?: string);
    static fromFile(path: string, options?: {
        idField?: string;
    }): MongoDocumentStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
