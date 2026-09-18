import { type AffixDocumentStore } from "./storage/index.js";
import type { LicenceState, AffixSdkConfig } from "./types.js";
export declare class LicenceError extends Error {
    code: string;
    constructor(message: string);
}
/**
 * Random licence recheck roughly every couple of days.
 * Pings GET /v1/circuits with the configured API key (auth check only; one light call).
 */
export declare class LicenceLease {
    config: any;
    state: any;
    checkPromise: any;
    hydrated: boolean;
    docs: any;
    key: any;
    constructor(config: AffixSdkConfig, docs: AffixDocumentStore, key?: string);
    hydrate(): Promise<void>;
    persist(): Promise<void>;
    getState(): LicenceState;
    refreshKeyHint(): LicenceState;
    applyPolicyBody(body: any): void;
    needsPulse(): boolean;
    /**
     * Instant policy pulse for Hub-driven plan changes.
     */
    pulse(force?: boolean): Promise<boolean>;
    ensureFreshPolicy(): Promise<void>;
    consumeQuota(count?: number): Promise<void>;
    scheduleNext(): void;
    needsCheck(): boolean;
    withinGrace(): boolean;
    /**
     * Lightweight auth ping. Does not call prove. Safe for periodic checks.
     */
    check(force?: boolean): Promise<boolean>;
    /** Gate prove / verify when brickWithoutLicence is enabled. */
    assertLicensed(): Promise<void>;
    /**
     * Local prove may continue offline when configured, or within licence grace.
     * Returns whether this prove should be treated as offline (no live licence RTT).
     */
    assertForLocalProve(): Promise<{
        offline: boolean;
    }>;
    /**
     * Paid-plan gates. Missing entitlements (legacy cloud keys) stay open.
     */
    assertEntitlement(feature: "qr_carriers" | "mldsa65" | "db_adapters" | "ultrahonk_zkp" | "hsm_integration"): void;
}
