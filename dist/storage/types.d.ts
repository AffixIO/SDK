/** Sync or async; hosts may back Affix state with Redis, SQL, S3, memory, etc. */
export type MaybePromise<T> = T | Promise<T>;
/**
 * Pluggable document store for Affix SDK local state.
 * Replace JSON files by implementing get/set (and optional delete).
 */
export interface AffixDocumentStore {
    get(key: string): MaybePromise<string | null>;
    set(key: string, value: string): MaybePromise<void>;
    delete?(key: string): MaybePromise<void>;
}
/** Well-known keys used by the SDK when a shared documentStore is configured. */
export declare const STORAGE_KEYS: {
    readonly proofs: "proofs";
    readonly offlineQueue: "offline-queue";
    readonly codeUses: "code-uses";
    readonly licence: "licence";
};
export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
/**
 * Optional per-domain stores. Any omitted domain falls back to `documentStore`
 * or the default JSON file paths.
 */
export type AffixStorageConfig = {
    /** Shared backend for all Affix local state keys. */
    documentStore?: AffixDocumentStore;
    /** Override proofs blob only. */
    proofs?: AffixDocumentStore;
    /** Override offline queue blob only. */
    queue?: AffixDocumentStore;
    /** Override code-use / spend counts only. */
    codeUses?: AffixDocumentStore;
    /** Override licence lease state only. */
    licence?: AffixDocumentStore;
};
export declare function docGet(store: AffixDocumentStore, key: string): Promise<string | null>;
export declare function docSet(store: AffixDocumentStore, key: string, value: string): Promise<void>;
export declare function docDelete(store: AffixDocumentStore, key: string): Promise<void>;
