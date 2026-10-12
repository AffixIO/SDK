import type { DataCheckQuery, DataCheckResult, DataCheckSource } from "../types.js";
/**
 * Historic .ini / sectioned property store (old config + small PAS property bags).
 *
 * [P-1001]
 * status=in_ed
 * ward=A&E
 */
export declare class IniSectionStore implements DataCheckSource {
    readonly name = "ini_section";
    readonly style: "legacy";
    private sections;
    constructor(sections: Map<string, Record<string, string>>);
    static fromFile(path: string): IniSectionStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
