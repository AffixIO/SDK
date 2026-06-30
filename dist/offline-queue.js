import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
export class OfflineQueue {
    path;
    constructor(path) {
        this.path = path;
    }
    read() {
        if (!existsSync(this.path)) {
            return { jobs: [] };
        }
        try {
            const raw = JSON.parse(readFileSync(this.path, "utf8"));
            return { jobs: raw.jobs ?? [] };
        }
        catch {
            return { jobs: [] };
        }
    }
    write(data) {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify(data, null, 2));
    }
    enqueue(job) {
        const data = this.read();
        const full = {
            ...job,
            created_at: new Date().toISOString(),
            attempts: 0,
        };
        data.jobs.push(full);
        this.write(data);
        return full;
    }
    list() {
        return this.read().jobs;
    }
    remove(id) {
        const data = this.read();
        data.jobs = data.jobs.filter((job) => job.id !== id);
        this.write(data);
    }
    bumpAttempt(id) {
        const data = this.read();
        for (const job of data.jobs) {
            if (job.id === id) {
                job.attempts += 1;
            }
        }
        this.write(data);
    }
}
