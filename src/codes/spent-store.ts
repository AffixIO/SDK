/* Credit: @paparichens */
import { SpendJournal } from "../spend-journal.js";

/**
 * Tamper-evident spend journal adapter with the same async surface as the legacy store.
 */
export class CodeUseStore {
    journal;
    constructor(journalOrPath?: SpendJournal | string, keysPath?: string) {
        if (journalOrPath instanceof SpendJournal) {
            this.journal = journalOrPath;
        }
        else if (journalOrPath && typeof journalOrPath === "object" && "get" in (journalOrPath as object)) {
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
    async getUses(gateId: string, proofDigest: string): Promise<number> {
        return this.journal.countUses(gateId, proofDigest);
    }
    async checkAdmission(gateId: string, proofDigest: string, maxUses: number): Promise<{
        admitted: boolean;
        uses: number;
        remaining: number | null;
        reason?: string;
    }> {
        return this.journal.checkAdmission(gateId, proofDigest, maxUses);
    }
    async consume(gateId: string, proofDigest: string, maxUses: number): Promise<{
        admitted: boolean;
        uses: number;
        remaining: number | null;
        reason?: string;
    }> {
        return this.journal.consume(gateId, proofDigest, maxUses);
    }
    async reset(gateId?: string, proofDigest?: string): Promise<void> {
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
import { type AffixDocumentStore } from "../storage/index.js";
