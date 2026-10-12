export type { AffixDocumentStore, AffixStorageConfig, MaybePromise, StorageKey, } from "./types.js";
export { STORAGE_KEYS, docGet, docSet, docDelete } from "./types.js";
export { PathMappedJsonStore, JsonFileDocumentStore, createDefaultJsonDocumentStore, } from "./json-file-store.js";
export { MemoryDocumentStore, createMemoryDocumentStore } from "./memory-store.js";
