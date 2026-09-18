import type { DataCheckQuery, DataCheckResult } from "../types.js";
/**
 * Historic .ini / sectioned property store (old config + small PAS property bags).
 *
 * [P-1001]
 * status=in_ed
 * ward=A&E
 */
export declare class IniSectionStore {
    name: string;
    style: "legacy";
    sections: any;
    constructor(sections: Map<string, Record<string, string>>);
    static fromFile(path: any): IniSectionStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
