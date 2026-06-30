import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
export class ProofStore {
    path;
    constructor(path) {
        this.path = path;
    }
    read() {
        if (!existsSync(this.path)) {
            return { proofs: [] };
        }
        try {
            return JSON.parse(readFileSync(this.path, "utf8"));
        }
        catch {
            return { proofs: [] };
        }
    }
    write(data) {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify(data, null, 2));
    }
    save(proof) {
        const data = this.read();
        data.proofs.unshift(proof);
        data.proofs = data.proofs.slice(0, 500);
        this.write(data);
    }
    list() {
        return this.read().proofs;
    }
    markSynced(proof_id, merkle_root) {
        const data = this.read();
        for (const proof of data.proofs) {
            if (proof.proof_id === proof_id) {
                proof.synced = true;
                if (merkle_root) {
                    proof.merkle_root = merkle_root;
                }
            }
        }
        this.write(data);
    }
}
