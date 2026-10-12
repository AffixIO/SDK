/* Credit: @paparichens */
import { SpendJournal } from "../spend-journal.js";

/**
 * Tamper-evident spend journal adapter with the same async surface as the legacy store.
 */
export class CodeUseStore {
    journal;
    constructor(journalOrPath, keysPath) {
        if (journalOrPath instanceof SpendJournal) {
            this.journal = journalOrPath;
        }
        else if (typeof journalOrPath === "object" && journalOrPath !== null && "get" in journalOrPath) {
            throw new Error("code_use_store_requires_spend_journal_in_licence_only_mode");
        }
        else {
            const baseDir = typeof journalOrPath === "string" ? journalOrPath : ".affix/spend";
            const keys = keysPath ?? ".affix/secrets/mldsa65.json";
            this.journal = new SpendJournal(baseDir, keys);
        }
    }
    spendJournal() {
        return this.journal;
    }
    async getUses(gateId, proofDigest) {
        return this.journal.countUses(gateId, proofDigest);
    }
    async checkAdmission(gateId, proofDigest, maxUses) {
        return this.journal.checkAdmission(gateId, proofDigest, maxUses);
    }
    async consume(gateId, proofDigest, maxUses) {
        return this.journal.consume(gateId, proofDigest, maxUses);
    }
    async reset() {
        throw new Error("spend_journal_reset_disabled: journal is append-only");
    }
    async status() {
        return this.journal.status();
    }
    async verifyIntegrity() {
        return this.journal.verifyIntegrity();
    }
}

export { resolveSidecarPath } from "./spent-store-legacy.js";
