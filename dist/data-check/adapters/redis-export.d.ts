import type { DataCheckQuery, DataCheckResult, DataCheckSource } from "../types.js";
/**
 * Redis RESP bulk dump / simple KEY=VALUE line redis-export style.
 * Also accepts JSON objects (same as KeyValueStore) when file is JSON.
 *
 * SET P-1001 "{\"status\":\"in_ed\",\"ward\":\"A&E\"}"
 * or plain lines:
 * P-1001 status=in_ed ward=A&E
 */
export declare class RedisExportStore implements DataCheckSource {
    readonly name = "redis_export";
    readonly style: "modern";
    private map;
    constructor(map: Map<string, Record<string, unknown>>);
    static fromFile(path: string): RedisExportStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
