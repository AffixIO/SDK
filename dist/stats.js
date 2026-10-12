/* Credit: @paparichens */
import { docGet, docSet } from "./storage/index.js";

export const STATS_KEY = "stats";

export function emptyStats() {
    return {
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        proofs: {
            hmac: 0,
            ultrahonk: 0,
            yes: 0,
            no: 0,
            mldsa65_signed: 0,
            mldsa65_sign_failures: 0,
        },
        verify: { local_ok: 0, local_fail: 0 },
        codes: { issued: 0, admitted: 0, denied: 0 },
        spend: { consumed: 0, double_spend_blocked: 0, journal_errors: 0 },
        licence: { checks: 0, ok: 0, expired: 0, unreachable: 0 },
        connections: { internal_ok: 0, internal_fail: 0, external_ok: 0, external_fail: 0 },
        hsm: { configured: 0, probe_ok: 0, probe_fail: 0 },
    };
}

export class StatsStore {
    docs;
    key;
    constructor(docs, key = STATS_KEY) {
        this.docs = docs;
        this.key = key;
    }
    async read() {
        const raw = await docGet(this.docs, this.key);
        if (!raw)
            return emptyStats();
        try {
            return { ...emptyStats(), ...JSON.parse(raw) };
        }
        catch {
            return emptyStats();
        }
    }
    async write(stats) {
        stats.updated_at = new Date().toISOString();
        await docSet(this.docs, this.key, JSON.stringify(stats, null, 2));
    }
    async bump(path, amount = 1) {
        const stats = await this.read();
        const parts = path.split(".");
        let node = stats;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (typeof node[p] !== "object" || node[p] === null)
                node[p] = {};
            node = node[p];
        }
        const leaf = parts[parts.length - 1];
        node[leaf] = (Number(node[leaf]) || 0) + amount;
        await this.write(stats);
        return stats;
    }
    async snapshot() {
        return this.read();
    }
}
