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
export declare class SpendJournal {
    baseDir: any;
    keysPath: any;
    constructor(baseDir: string, keysPath: string);
    journalPath(): string;
    headPath(): string;
    lockPath(): string;
    ensureDir(): void;
    readHead(): SpendHead;
    writeHead(head: any): void;
    readEvents(): SpendEvent[];
    verifyChain(events: any): {
        ok: boolean;
        error: string;
        seq: any;
        last_hash?: undefined;
        count?: undefined;
    } | {
        ok: boolean;
        last_hash: string;
        count: any;
        error?: undefined;
        seq?: undefined;
    };
    verifyIntegrity(): SpendIntegrity;
    countUses(gateId: string, proofDigest: string): number;
    checkAdmission(gateId: string, proofDigest: string, maxUses: number): SpendAdmission;
    appendEvent(input: any): any;
    consume(gateId: string, proofDigest: string, maxUses: number): SpendConsumeResult;
    status(): {
        integrity: SpendIntegrity;
        head: SpendHead;
        journal_path: string;
    };
}
