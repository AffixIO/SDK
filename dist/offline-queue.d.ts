import type { QueuedProveJob } from "./types.js";
export declare class OfflineQueue {
    private readonly path;
    constructor(path: string);
    private read;
    private write;
    enqueue(job: Omit<QueuedProveJob, "created_at" | "attempts">): QueuedProveJob;
    list(): QueuedProveJob[];
    remove(id: string): void;
    bumpAttempt(id: string): void;
}
