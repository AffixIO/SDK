/** In-memory AffixDocumentStore for tests and single-process hosts. */
export declare class MemoryDocumentStore {
    data: Map<any, any>;
    get(key: string): string | null;
    set(key: string, value: string): void;
    delete(key: string): void;
    clear(): void;
    keys(): string[];
}
export declare function createMemoryDocumentStore(): MemoryDocumentStore;
