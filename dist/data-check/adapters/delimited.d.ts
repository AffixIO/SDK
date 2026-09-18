import type { DataCheckQuery, DataCheckResult } from "../types.js";
/**
 * Generic character-delimited table (semicolon European extracts, colon dumps, etc.).
 * Complements CsvTableStore (comma/tab) and PipeDelimitedStore.
 */
export declare class DelimitedTableStore {
    name: any;
    style: any;
    rows: any;
    idColumn: any;
    constructor(rows: Array<Record<string, string>>, options: {
        delimiter: string;
        idColumn?: string;
        name?: string;
        style?: "modern" | "legacy";
    });
    static fromFile(path: any, options: any): DelimitedTableStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
