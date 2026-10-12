/* Credit: @paparichens */
// Replay protection: accept each nonce / command id once inside a time window.

/** In-memory store. Use a shared store (Redis, DB) when several processes verify. */
export class MemoryReplayStore {
    seen = new Map();
    maxEntries;
    constructor({ maxEntries = 100_000 } = {}) {
        this.maxEntries = maxEntries;
    }
    /** Atomically record id if unseen. Returns true if newly recorded. */
    async putIfAbsent(id, expiresAtMs, nowMs = Date.now()) {
        const now = nowMs;
        const existing = this.seen.get(id);
        if (existing !== undefined && existing > now)
            return false;
        if (this.seen.size >= this.maxEntries)
            this.prune(now);
        if (this.seen.size >= this.maxEntries)
            throw new Error("replay_store_full");
        this.seen.set(id, expiresAtMs);
        return true;
    }
    prune(now = Date.now()) {
        for (const [id, exp] of this.seen)
            if (exp <= now)
                this.seen.delete(id);
    }
}

/**
 * createReplayGuard({ windowMs, clockSkewMs, store, now })
 * guard.check({ id, issuedAtMs }) -> { ok, reason }
 * Rejects: missing id, timestamps outside the window (or too far in the future), and reuse.
 * Ids are remembered until issuedAt + windowMs + clockSkewMs, so a replay can never
 * outlive its memory entry.
 */
export function createReplayGuard(options = {}) {
    const windowMs = options.windowMs ?? 5 * 60_000;
    const skewMs = options.clockSkewMs ?? 30_000;
    const store = options.store ?? new MemoryReplayStore();
    const now = options.now ?? (() => Date.now());
    if (typeof store.putIfAbsent !== "function")
        throw new TypeError("replay store must implement putIfAbsent(id, expiresAtMs, nowMs)");
    return {
        windowMs,
        store,
        async check({ id, issuedAtMs } = {}) {
            if (typeof id !== "string" || id.length === 0 || id.length > 512)
                return { ok: false, reason: "missing_id" };
            const t = Number(issuedAtMs);
            if (!Number.isFinite(t))
                return { ok: false, reason: "missing_timestamp" };
            const current = now();
            if (t > current + skewMs)
                return { ok: false, reason: "timestamp_in_future" };
            if (current - t > windowMs)
                return { ok: false, reason: "expired" };
            const fresh = await store.putIfAbsent(id, t + windowMs + skewMs, current);
            return fresh ? { ok: true, reason: "fresh" } : { ok: false, reason: "replay" };
        },
    };
}
