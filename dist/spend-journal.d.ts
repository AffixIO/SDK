export type SpendEvent = {
    seq: number;
    prev_hash: string;
    gate_id: string;
    proof_digest: string;
    action: "consume";
    max_uses: number;
    ts: string;
    event_hash: string;
    mldsa_signature_b64: string;
    key_id: string;
};

export type SpendHead = {
    seq: number;
    last_hash: string;
    updated_at: string | null;
};

export type SpendIntegrity = {
    ok: boolean;
    error?: string;
    seq?: number;
    last_hash?: string;
    count?: number;
};

export type SpendAdmission = {
    admitted: boolean;
    uses: number;
    remaining: number | null;
    reason?: string;
};

export type SpendConsumeResult = SpendAdmission & {
    consumed: boolean;
};

/**
 * Append-only, hash-chained spend journal. Every event is ML-DSA-65 signed and
 * bound to the previous event hash. Reads fail closed when the chain is broken.
 */
export declare class SpendJournal {
    constructor(baseDir: string, keysPath: string);
    journalPath(): string;
    headPath(): string;
    readHead(): SpendHead;
    readEvents(): SpendEvent[];
    verifyIntegrity(): SpendIntegrity;
    countUses(gateId: string, proofDigest: string): number;
    checkAdmission(gateId: string, proofDigest: string, maxUses: number): SpendAdmission;
    consume(gateId: string, proofDigest: string, maxUses: number): SpendConsumeResult;
    status(): {
        integrity: SpendIntegrity;
        head: SpendHead;
        journal_path: string;
    };
}
