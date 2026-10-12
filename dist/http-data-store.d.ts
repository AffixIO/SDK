import type { DataCheckQuery, DataCheckResult } from "./data-check/index.js";
import type { HttpDataProfile } from "./types.js";

export declare class HttpDataStore {
    readonly name: string;
    readonly style: string;
    constructor(profile: HttpDataProfile, name?: string);
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
