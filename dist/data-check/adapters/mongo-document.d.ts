import type { DataCheckQuery, DataCheckResult } from "../types.js";
/**
 * MongoDB-style / modern document collection.
 * Supports:
 * - JSON array of documents
 * - NDJSON (one JSON object per line)
 * - { "documents": [ … ] } or mongodump-ish exports with $oid ignored as text
 */
export declare class MongoDocumentStore {
    name: string;
    style: "modern";
    docs: any;
    idField: any;
    constructor(docs: Array<Record<string, unknown>>, idField?: string);
    static fromFile(path: any, options: any): MongoDocumentStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
