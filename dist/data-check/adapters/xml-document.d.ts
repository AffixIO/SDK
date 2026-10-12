import type { DataCheckQuery, DataCheckResult, DataCheckSource } from "../types.js";
/**
 * XML document / message dump (HL7 CDA fragments, PAS XML extracts, SOAP bodies).
 * Finds elements matching recordTag (default "record" | "patient" | "row").
 * Child element text becomes string fields.
 */
export declare class XmlDocumentStore implements DataCheckSource {
    readonly name = "xml_document";
    readonly style: "modern" | "legacy";
    private records;
    private idField;
    constructor(records: Array<Record<string, string>>, options?: {
        idField?: string;
        style?: "modern" | "legacy";
    });
    static fromFile(path: string, options?: {
        idField?: string;
        recordTag?: string;
        style?: "modern" | "legacy";
    }): XmlDocumentStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
