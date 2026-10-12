export interface ReplayStore { putIfAbsent(id: string, expiresAtMs: number, nowMs: number): boolean | Promise<boolean>; }
export declare class MemoryReplayStore implements ReplayStore {
    constructor(options?: { maxEntries?: number });
    putIfAbsent(id: string, expiresAtMs: number, nowMs?: number): Promise<boolean>;
    prune(now?: number): void;
}
export interface ReplayCheckResult { ok: boolean; reason: "fresh" | "replay" | "expired" | "timestamp_in_future" | "missing_id" | "missing_timestamp"; }
export interface ReplayGuard { windowMs: number; store: ReplayStore; check(input: { id: string; issuedAtMs: number }): Promise<ReplayCheckResult>; }
export declare function createReplayGuard(options?: { windowMs?: number; clockSkewMs?: number; store?: ReplayStore; now?: () => number }): ReplayGuard;
