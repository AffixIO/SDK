import type { AffixDocumentStore } from "./types.js";
/** In-memory AffixDocumentStore for tests and single-process hosts. */
export declare class MemoryDocumentStore implements AffixDocumentStore {
    private readonly data;
    get(key: string): string | null;
    set(key: string, value: string): void;
    delete(key: string): void;
    clear(): void;
    keys(): string[];
}
export declare function createMemoryDocumentStore(): MemoryDocumentStore;
