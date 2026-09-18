import { SpendJournal } from "../spend-journal.js";
/**
 * Tamper-evident spend journal adapter with the same async surface as the legacy store.
 */
export declare class CodeUseStore {
    journal: any;
    constructor(journalOrPath?: SpendJournal | string, keysPath?: string);
    spendJournal(): any;
    getUses(gateId: string, proofDigest: string): Promise<number>;
    checkAdmission(gateId: string, proofDigest: string, maxUses: number): Promise<{
        admitted: boolean;
        uses: number;
        remaining: number | null;
        reason?: string;
    }>;
    consume(gateId: string, proofDigest: string, maxUses: number): Promise<{
        admitted: boolean;
        uses: number;
        remaining: number | null;
        reason?: string;
    }>;
    reset(gateId?: string, proofDigest?: string): Promise<void>;
    status(): Promise<any>;
    verifyIntegrity(): Promise<any>;
}
export { resolveSidecarPath } from "./spent-store-legacy.js";
