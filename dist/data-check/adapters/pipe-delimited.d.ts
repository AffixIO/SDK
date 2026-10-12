import type { DataCheckQuery, DataCheckResult, DataCheckSource } from "../types.js";
/**
 * Legacy pipe-delimited extract (classic PAS dump style).
 * Header optional: #id|status|ward
 * Records: p01|in_ed|AE01
 */
export declare class PipeDelimitedStore implements DataCheckSource {
    readonly name = "pipe_delimited";
    readonly style: "legacy";
    private rows;
    private idColumn;
    constructor(rows: Array<Record<string, string>>, idColumn?: string);
    static fromFile(path: string, options?: {
        idColumn?: string;
        headers?: string[];
    }): PipeDelimitedStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
