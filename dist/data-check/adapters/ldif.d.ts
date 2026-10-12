import type { DataCheckQuery, DataCheckResult, DataCheckSource } from "../types.js";
/**
 * LDAP / AD LDIF export (historic directory style person records).
 * dn: uid=P-1,ou=patients
 * status: in_ed
 * ward: A&E
 */
export declare class LdifStore implements DataCheckSource {
    readonly name = "ldif";
    readonly style: "legacy";
    private records;
    private idAttr;
    constructor(records: Array<Record<string, string>>, idAttr?: string);
    static fromFile(path: string, options?: {
        idAttr?: string;
    }): LdifStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
