import type { DataCheckQuery, DataCheckResult } from "../types.js";
/**
 * XML document / message dump (HL7 CDA fragments, PAS XML extracts, SOAP bodies).
 * Finds elements matching recordTag (default "record" | "patient" | "row").
 * Child element text becomes string fields.
 */
export declare class XmlDocumentStore {
    name: string;
    style: any;
    records: any;
    idField: any;
    constructor(records: Array<Record<string, string>>, options?: {
        idField?: string;
        style?: "modern" | "legacy";
    });
    static fromFile(path: any, options: any): XmlDocumentStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
