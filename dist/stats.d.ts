import type { AffixDocumentStore } from "./storage/types.js";

export declare const STATS_KEY: "stats";

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

export declare function emptyStats(): AffixStats;

export declare class StatsStore {
    constructor(docs: AffixDocumentStore, key?: string);
    read(): Promise<AffixStats>;
    write(stats: AffixStats): Promise<void>;
    bump(path: string, amount?: number): Promise<AffixStats>;
    snapshot(): Promise<AffixStats>;
}
