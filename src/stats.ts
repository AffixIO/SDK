/* Credit: @paparichens */
import { docGet, docSet } from "./storage/index.js";
import type { AffixDocumentStore } from "./storage/types.js";

export type AffixStats = {
    started_at: string;
    updated_at: string;
    proofs: {
        hmac: number;
        ultrahonk: number;
        yes: number;
        no: number;
        mldsa65_signed: number;
        mldsa65_sign_failures: number;
    };
    verify: { local_ok: number; local_fail: number };
    codes: { issued: number; admitted: number; denied: number };
    spend: { consumed: number; double_spend_blocked: number; journal_errors: number };
    licence: { checks: number; ok: number; expired: number; unreachable: number };
    connections: {
        internal_ok: number;
        internal_fail: number;
        external_ok: number;
        external_fail: number;
    };
    hsm: { configured: number; probe_ok: number; probe_fail: number };
};

export const STATS_KEY = "stats";

export function emptyStats(): AffixStats {
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
    constructor(docs: AffixDocumentStore, key?: string) {
        this.docs = docs;
        this.key = key;
    }
    async read(): Promise<AffixStats> {
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
    async write(stats: AffixStats): Promise<void> {
        stats.updated_at = new Date().toISOString();
        await docSet(this.docs, this.key, JSON.stringify(stats, null, 2));
    }
    async bump(path: string, amount?: number): Promise<AffixStats> {
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
    async snapshot(): Promise<AffixStats> {
        return this.read();
    }
}
