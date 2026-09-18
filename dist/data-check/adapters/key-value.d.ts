import type { DataCheckQuery, DataCheckResult } from "../types.js";
/**
 * Modern key-value document map (Redis-like / JSON object):
 * {
 *   "p1": { "status": "approved", "site": "GGH" },
 *   "p2": "in_ed"
 * }
 * Bare string value becomes { value: "..." }.
 */
export declare class KeyValueStore {
    name: string;
    style: "modern";
    map: any;
    constructor(map: Record<string, unknown>);
    static fromFile(path: any): KeyValueStore;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
