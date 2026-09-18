import type { DataCheckQuery, DataCheckResult } from "../types.js";
/**
 * LDAP / AD LDIF export (historic directory style person records).
 * dn: uid=P-1,ou=patients
 * status: in_ed
 * ward: A&E
 */
export declare class LdifStore {
    name: string;
    style: "legacy";
    records: any;
    idAttr: any;
    constructor(records: Array<Record<string, string>>, idAttr?: string);
    static fromFile(path: any, options: any): LdifStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
