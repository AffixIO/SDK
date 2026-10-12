import type { DataCheckQuery, DataCheckResult, DataCheckSource } from "../types.js";
/**
 * Legacy CSV / TSV table (first row = headers). Classic extract style.
 * Default delimiter auto-detects tab vs comma.
 */
export declare class CsvTableStore implements DataCheckSource {
    readonly name = "csv_table";
    readonly style: "legacy";
    private rows;
    private idColumn;
    constructor(rows: Array<Record<string, string>>, idColumn?: string);
    static fromFile(path: string, options?: {
        delimiter?: string;
        idColumn?: string;
    }): CsvTableStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
/** Minimal CSV line parser with quotes. */
export declare function parseCsvLine(line: string, delimiter?: string): string[];
