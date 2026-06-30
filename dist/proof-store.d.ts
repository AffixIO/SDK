import type { StoredProof } from "./types.js";
export declare class ProofStore {
    private readonly path;
    constructor(path: string);
    private read;
    private write;
    save(proof: StoredProof): void;
    list(): StoredProof[];
    markSynced(proof_id: string, merkle_root?: string): void;
}
