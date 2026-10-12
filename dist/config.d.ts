import type { AffixSdkConfig } from "./types.js";
import { STORAGE_KEYS, type AffixDocumentStore } from "./storage/index.js";
export { DEFAULT_AFFIX_API_BASE, normaliseApiBase, normalisePresentmentBase, } from "./constants.js";
export type ResolvedStorageDrivers = {
    proofs: AffixDocumentStore;
    queue: AffixDocumentStore;
    codeUses: AffixDocumentStore;
    licence: AffixDocumentStore;
};
export declare function resolveStorageDrivers(config: AffixSdkConfig): ResolvedStorageDrivers;
export declare function resolveConfig(partial: Partial<AffixSdkConfig> & {
    apiKey: string;
}): AffixSdkConfig;
export { STORAGE_KEYS };
