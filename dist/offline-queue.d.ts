import { type AffixDocumentStore } from "./storage/index.js";
export type QueuedSyncJob = {
    id: string;
    proof_id: string;
    circuit_id: string;
    proof: string;
    proof_digest: string;
    valid: boolean;
    decision: "yes" | "no";
    created_at: string;
    attempts: number;
    last_error?: string;
    status: "pending" | "synced" | "failed";
    /** One host request → one Affix sync job. */
    request_id?: string;
    origin?: string;
    record_id?: string;
    meta?: Record<string, string>;
};
export declare class OfflineQueue {
    private readonly docs;
    private readonly maxJobs;
    private readonly key;
    constructor(docs: AffixDocumentStore, maxJobs?: number, key?: string);
    private read;
    private write;
    enqueue(job: Omit<QueuedSyncJob, "created_at" | "attempts" | "status"> & {
        status?: QueuedSyncJob["status"];
    }): Promise<QueuedSyncJob>;
    listPending(): Promise<QueuedSyncJob[]>;
    listAll(): Promise<QueuedSyncJob[]>;
    markSynced(id: string): Promise<void>;
    markSyncedMany(ids: string[]): Promise<void>;
    markFailed(id: string, error: string): Promise<void>;
    markFailedMany(items: Array<{
        id: string;
        error: string;
    }>): Promise<void>;
    bumpAttempt(id: string, error?: string): Promise<void>;
    remove(id: string): Promise<void>;
    clearSynced(): Promise<number>;
}
