import { docGet, docSet, STORAGE_KEYS } from "./storage/index.js";
export class OfflineQueue {
    docs;
    maxJobs;
    key;
    constructor(docs, maxJobs = 50_000, key = STORAGE_KEYS.offlineQueue) {
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
    async enqueue(job) {
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
    async listPending() {
        return (await this.read()).jobs.filter((j) => j.status === "pending");
    }
    async listAll() {
        return (await this.read()).jobs;
    }
    async markSynced(id) {
        await this.markSyncedMany([id]);
    }
    async markSyncedMany(ids) {
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
    async markFailed(id, error) {
        await this.markFailedMany([{ id, error }]);
    }
    async markFailedMany(items) {
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
    async bumpAttempt(id, error) {
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
    async remove(id) {
        const data = await this.read();
        data.jobs = data.jobs.filter((j) => j.id !== id && j.proof_id !== id);
        await this.write(data);
    }
    async clearSynced() {
        const data = await this.read();
        const before = data.jobs.length;
        data.jobs = data.jobs.filter((j) => j.status !== "synced");
        await this.write(data);
        return before - data.jobs.length;
    }
}
