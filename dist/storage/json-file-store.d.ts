import type { AffixDocumentStore } from "./types.js";
/**
 * Maps storage keys to local JSON files (default Affix behaviour).
 */
export declare class PathMappedJsonStore {
    paths: any;
    fileMode: any;
    constructor(paths: Record<string, string>, fileMode?: number | undefined);
    get(key: string): string | null;
    set(key: string, value: string): void;
    delete(key: string): void;
}
/** Single JSON file as one document key (value is the whole file body). */
export declare class JsonFileDocumentStore {
    path: any;
    fileMode: any;
    constructor(path: string, fileMode?: number | undefined);
    get(_key: any): string;
    set(_key: any, value: any): void;
    delete(_key: any): void;
}
export declare function createDefaultJsonDocumentStore(paths: {
    proofs: string;
    offlineQueue: string;
    codeUses: string;
    licence: string;
    stats?: string;
}): AffixDocumentStore;
