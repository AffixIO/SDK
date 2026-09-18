/* Credit: @paparichens */
import type { AffixDocumentStore } from "./types.js";
/** In-memory AffixDocumentStore for tests and single-process hosts. */
export class MemoryDocumentStore {
    data = new Map();
    get(key: string): string | null {
        return this.data.has(key) ? this.data.get(key) : null;
    }
    set(key: string, value: string): void {
        this.data.set(key, value);
    }
    delete(key: string): void {
        this.data.delete(key);
    }
    clear(): void {
        this.data.clear();
    }
    keys(): string[] {
        return [...this.data.keys()];
    }
}
export function createMemoryDocumentStore(): MemoryDocumentStore {
    return new MemoryDocumentStore();
}
