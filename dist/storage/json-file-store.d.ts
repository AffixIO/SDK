import type { AffixDocumentStore } from "./types.js";
/**
 * Maps storage keys to local JSON files (default Affix behaviour).
 */
export declare class PathMappedJsonStore implements AffixDocumentStore {
    private readonly paths;
    private readonly fileMode?;
    constructor(paths: Record<string, string>, fileMode?: number | undefined);
    get(key: string): string | null;
    set(key: string, value: string): void;
    delete(key: string): void;
}
/** Single JSON file as one document key (value is the whole file body). */
export declare class JsonFileDocumentStore implements AffixDocumentStore {
    private readonly path;
    private readonly fileMode?;
    constructor(path: string, fileMode?: number | undefined);
    get(_key: string): string | null;
    set(_key: string, value: string): void;
    delete(_key: string): void;
}
export declare function createDefaultJsonDocumentStore(paths: {
    proofs: string;
    offlineQueue: string;
    codeUses: string;
    licence: string;
}): AffixDocumentStore;
