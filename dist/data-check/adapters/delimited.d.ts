import type { DataCheckQuery, DataCheckResult, DataCheckSource } from "../types.js";
/**
 * Generic character-delimited table (semicolon European extracts, colon dumps, etc.).
 * Complements CsvTableStore (comma/tab) and PipeDelimitedStore.
 */
export declare class DelimitedTableStore implements DataCheckSource {
    readonly name: string;
    readonly style: "modern" | "legacy";
    private rows;
    private idColumn;
    constructor(rows: Array<Record<string, string>>, options: {
        delimiter: string;
        idColumn?: string;
        name?: string;
        style?: "modern" | "legacy";
    });
    static fromFile(path: string, options: {
        delimiter: string;
        idColumn?: string;
        name?: string;
        style?: "modern" | "legacy";
    }): DelimitedTableStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
