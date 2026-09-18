import type { DataCheckQuery, DataCheckResult } from "../types.js";
/**
 * Legacy CSV / TSV table (first row = headers). Classic extract style.
 * Default delimiter auto-detects tab vs comma.
 */
export declare class CsvTableStore {
    name: string;
    style: "legacy";
    rows: any;
    idColumn: any;
    constructor(rows: Array<Record<string, string>>, idColumn?: string);
    static fromFile(path: any, options: any): CsvTableStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
/** Minimal CSV line parser with quotes. */
export declare function parseCsvLine(line: string, delimiter?: string): string[];
