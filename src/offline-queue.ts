/* Credit: @paparichens */
import { docGet, docSet, STORAGE_KEYS, type AffixDocumentStore } from "./storage/index.js";
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
export class OfflineQueue {
    docs;
    maxJobs;
    key;
    constructor(docs: AffixDocumentStore, maxJobs?: number, key?: string) {
        this.docs = docs;
        this.maxJobs = maxJobs;
        this.key = key;
    }
    async read() {
        const raw = await docGet(this.docs, this.key);
        if (!raw)
            return { jobs: [] };
        try {
            const parsed = JSON.parse(raw);
            return { jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
        }
        catch {
            return { jobs: [] };
        }
    }
    async write(data) {
        await docSet(this.docs, this.key, JSON.stringify(data, null, 2));
    }
    async enqueue(job: Omit<QueuedSyncJob, "created_at" | "attempts" | "status"> & {
        status?: QueuedSyncJob["status"];
    }): Promise<QueuedSyncJob> {
        const data = await this.read();
        data.jobs = data.jobs.filter((j) => j.proof_id !== job.proof_id);
        const full = {
            ...job,
            created_at: new Date().toISOString(),
            attempts: 0,
            status: job.status ?? "pending",
        };
        data.jobs.push(full);
        if (data.jobs.length > this.maxJobs) {
            data.jobs.sort((a, b) => a.created_at.localeCompare(b.created_at));
            const synced = data.jobs.filter((j) => j.status === "synced");
            const rest = data.jobs.filter((j) => j.status !== "synced");
            while (synced.length + rest.length > this.maxJobs && synced.length > 0) {
                synced.shift();
            }
            while (synced.length + rest.length > this.maxJobs && rest.length > 0) {
                rest.shift();
            }
            data.jobs = [...rest, ...synced];
        }
        await this.write(data);
        return full;
    }
    async listPending(): Promise<QueuedSyncJob[]> {
        return (await this.read()).jobs.filter((j) => j.status === "pending");
    }
    async listAll(): Promise<QueuedSyncJob[]> {
        return (await this.read()).jobs;
    }
    async markSynced(id: string): Promise<void> {
        await this.markSyncedMany([id]);
    }
    async markSyncedMany(ids: string[]): Promise<void> {
        if (ids.length === 0)
            return;
        const set = new Set(ids);
        const data = await this.read();
        for (const job of data.jobs) {
            if (set.has(job.id) || set.has(job.proof_id)) {
                job.status = "synced";
                job.last_error = undefined;
            }
        }
        await this.write(data);
    }
    async markFailed(id: string, error: string): Promise<void> {
        await this.markFailedMany([{ id, error }]);
    }
    async markFailedMany(items: Array<{
        id: string;
        error: string;
    }>): Promise<void> {
        if (items.length === 0)
            return;
        const map = new Map(items.map((i) => [i.id, i.error]));
        const data = await this.read();
        for (const job of data.jobs) {
            const err = map.get(job.id) ?? map.get(job.proof_id);
            if (err !== undefined) {
                job.status = "failed";
                job.attempts += 1;
                job.last_error = err;
            }
        }
        await this.write(data);
    }
    async bumpAttempt(id: string, error?: string): Promise<void> {
        const data = await this.read();
        for (const job of data.jobs) {
            if (job.id === id || job.proof_id === id) {
                job.attempts += 1;
                if (error)
                    job.last_error = error;
            }
        }
        await this.write(data);
    }
    async remove(id: string): Promise<void> {
        const data = await this.read();
        data.jobs = data.jobs.filter((j) => j.id !== id && j.proof_id !== id);
        await this.write(data);
    }
    async clearSynced(): Promise<number> {
        const data = await this.read();
        const before = data.jobs.length;
        data.jobs = data.jobs.filter((j) => j.status !== "synced");
        await this.write(data);
        return before - data.jobs.length;
    }
}
