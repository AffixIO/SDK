import type { DataCheckQuery, DataCheckResult } from "../types.js";
/**
 * Modern document store: JSON array of objects, or { records: [...] }.
 * Example:
 * [
 *   { "id": "p1", "status": "in_ed", "ward": "A&E" }
 * ]
 */
export declare class JsonDocumentStore {
    name: string;
    style: "modern";
    records: any;
    constructor(records: Array<Record<string, unknown>>);
    static fromFile(path: any): JsonDocumentStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
