import type { DataCheckQuery, DataCheckResult } from "../types.js";
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
export declare class DbaseStore {
    name: string;
    style: "legacy";
    rows: any;
    idField: any;
    constructor(rows: Array<Record<string, string>>, idField?: string);
    static fromFile(path: any, options: any): DbaseStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
export declare function parseDbf(buf: Buffer): {
    rows: Array<Record<string, string>>;
    fields: DbfField[];
};
export {};
