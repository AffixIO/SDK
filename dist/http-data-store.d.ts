import type { DataCheckQuery, DataCheckResult } from "./data-check/index.js";
import type { HttpDataProfile } from "./types.js";
/**
 * HTTP profile for internal/external customer data APIs (not Affix licence).
 */
export declare class HttpDataStore {
    name: any;
    style: any;
    profile: any;
    constructor(profile: HttpDataProfile, name?: string);
    headers(): Record<string, string>;
    urlFor(id: string): string;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
export declare function createHttpDataStore(profile: HttpDataProfile, name?: string): HttpDataStore;
export declare function testHttpProfile(profile: HttpDataProfile): Promise<{
    ok: boolean;
    status?: number;
    url?: string;
    error?: string;
}>;
