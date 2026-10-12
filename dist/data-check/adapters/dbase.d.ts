import type { DataCheckQuery, DataCheckResult, DataCheckSource } from "../types.js";
type DbfField = {
    name: string;
    type: string;
    length: number;
    offset: number;
};
/**
 * Historic dBASE III/IV / FoxPro / Clipper style .dbf files (read-only).
 * Common in older PAS / GP system exports.
 */
export declare class DbaseStore implements DataCheckSource {
    readonly name = "dbase";
    readonly style: "legacy";
    private rows;
    private idField;
    constructor(rows: Array<Record<string, string>>, idField?: string);
    static fromFile(path: string, options?: {
        idField?: string;
    }): DbaseStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
export declare function parseDbf(buf: Buffer): {
    rows: Array<Record<string, string>>;
    fields: DbfField[];
};
export {};
