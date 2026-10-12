/** Well-known keys used by the SDK when a shared documentStore is configured. */
export const STORAGE_KEYS = {
    proofs: "proofs",
    offlineQueue: "offline-queue",
    codeUses: "code-uses",
    licence: "licence",
    stats: "stats",
};
export async function docGet(store, key) {
    return Promise.resolve(store.get(key));
}
export async function docSet(store, key, value) {
    await Promise.resolve(store.set(key, value));
}
export async function docDelete(store, key) {
    if (store.delete) {
        await Promise.resolve(store.delete(key));
        return;
    }
    await Promise.resolve(store.set(key, ""));
}
