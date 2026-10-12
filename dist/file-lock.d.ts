export declare function withFileLock<T>(lockPath: string, fn: () => T, options?: {
    timeoutMs?: number;
    pollMs?: number;
    /** Lease for locks held by another host or unreadable locks (ms, default 30000). */
    leaseMs?: number;
}): T;
export declare function lockStaleReason(text: string, mtimeMs: number, nowMs?: number, defaultLeaseMs?: number): string | null;
