import type { DataCheckQuery, DataCheckResult } from "../types.js";
/**
 * Legacy pipe-delimited extract (classic PAS dump style).
 * Header optional: #id|status|ward
 * Records: p01|in_ed|AE01
 */
export declare class PipeDelimitedStore {
    name: string;
    style: "legacy";
    rows: any;
    idColumn: any;
    constructor(rows: Array<Record<string, string>>, idColumn?: string);
    static fromFile(path: any, options: any): PipeDelimitedStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
