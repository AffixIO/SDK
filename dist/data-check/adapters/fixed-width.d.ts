import type { DataCheckQuery, DataCheckResult, DataCheckSource } from "../types.js";
export type FixedFieldDef = {
    name: string;
    start: number;
    length: number;
};
/**
 * Legacy fixed-width / mainframe-style export.
 * Each line is one record; columns cut by absolute character positions.
 */
export declare class FixedWidthStore implements DataCheckSource {
    readonly name = "fixed_width";
    readonly style: "legacy";
    private lines;
    private fields;
    private idField;
    constructor(lines: string[], fields: FixedFieldDef[], idField?: string);
    static fromFile(path: string, fields: FixedFieldDef[], options?: {
        idField?: string;
        skipHeader?: boolean;
    }): FixedWidthStore;
    private parseLine;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
