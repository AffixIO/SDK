import type { DataCheckQuery, DataCheckResult, DataCheckSource } from "../types.js";
/**
 * Modern document store: JSON array of objects, or { records: [...] }.
 * Example:
 * [
 *   { "id": "p1", "status": "in_ed", "ward": "A&E" }
 * ]
 */
export declare class JsonDocumentStore implements DataCheckSource {
    readonly name = "json_document";
    readonly style: "modern";
    private records;
    constructor(records: Array<Record<string, unknown>>);
    static fromFile(path: string): JsonDocumentStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
