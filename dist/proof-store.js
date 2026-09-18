/* Credit: @paparichens */
import { docGet, docSet } from "./storage/index.js";
export class ProofStore {
    docs;
    max;
    key;
    constructor(docs, max, key) {
        this.docs = docs;
        this.max = max;
        this.key = key;
    }
    async read() {
        const raw = await docGet(this.docs, this.key);
        if (!raw)
            return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    async write(items) {
        await docSet(this.docs, this.key, JSON.stringify(items.slice(0, this.max), null, 2));
    }
    async save(proof) {
        const items = (await this.read()).filter((p) => p.proof_id !== proof.proof_id);
        items.unshift(proof);
        await this.write(items);
    }
    async list() {
        return this.read();
    }
}
