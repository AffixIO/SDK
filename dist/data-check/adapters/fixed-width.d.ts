import type { DataCheckQuery, DataCheckResult } from "../types.js";
export type FixedFieldDef = {
    name: string;
    start: number;
    length: number;
};
/**
 * Legacy fixed-width / mainframe-style export.
 * Each line is one record; columns cut by absolute character positions.
 */
export declare class FixedWidthStore {
    name: string;
    style: "legacy";
    lines: any;
    fields: any;
    idField: any;
    constructor(lines: string[], fields: FixedFieldDef[], idField?: string);
    static fromFile(path: any, fields: any, options: any): FixedWidthStore;
    parseLine(line: any): {};
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
