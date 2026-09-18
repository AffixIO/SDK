/* Credit: @paparichens */
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
    /** Override stats blob only. */
    stats?: AffixDocumentStore;
};

export const STORAGE_KEYS = {
    proofs: "proofs",
    offlineQueue: "offline-queue",
    codeUses: "code-uses",
    licence: "licence",
    stats: "stats",
} as const;
export async function docGet(store: AffixDocumentStore, key: string): Promise<string | null> {
    return Promise.resolve(store.get(key));
}
export async function docSet(store: AffixDocumentStore, key: string, value: string): Promise<void> {
    await Promise.resolve(store.set(key, value));
}
export async function docDelete(store: AffixDocumentStore, key: string): Promise<void> {
    if (store.delete) {
        await Promise.resolve(store.delete(key));
        return;
    }
    await Promise.resolve(store.set(key, ""));
}
