import type { DataCheckQuery, DataCheckResult } from "../types.js";
/**
 * Redis RESP bulk dump / simple KEY=VALUE line redis-export style.
 * Also accepts JSON objects (same as KeyValueStore) when file is JSON.
 *
 * SET P-1001 "{\"status\":\"in_ed\",\"ward\":\"A&E\"}"
 * or plain lines:
 * P-1001 status=in_ed ward=A&E
 */
export declare class RedisExportStore {
    name: string;
    style: "modern";
    map: any;
    constructor(map: Map<string, Record<string, unknown>>);
    static fromFile(path: any): RedisExportStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
