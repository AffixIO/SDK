import type { DataCheckQuery, DataCheckResult, DataCheckSource } from "../types.js";
/**
 * Modern key-value document map (Redis-like / JSON object):
 * {
 *   "p1": { "status": "approved", "site": "GGH" },
 *   "p2": "in_ed"
 * }
 * Bare string value becomes { value: "..." }.
 */
export declare class KeyValueStore implements DataCheckSource {
    readonly name = "key_value";
    readonly style: "modern";
    private map;
    constructor(map: Record<string, unknown>);
    static fromFile(path: string): KeyValueStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
