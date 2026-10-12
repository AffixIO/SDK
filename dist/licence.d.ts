import { type AffixDocumentStore } from "./storage/index.js";
import type { LicenceState, AffixSdkConfig } from "./types.js";
export declare class LicenceError extends Error {
    readonly code = "affix_sdk_licence_invalid";
    constructor(message: string);
}
/**
 * Random licence recheck roughly every couple of days.
 * Pings GET /v1/auth/check with the configured API key.
 * Definitive API denials expire the local lease immediately; network errors may use grace.
 */
export declare class LicenceLease {
    private readonly config;
    private state;
    private checkPromise;
    private hydrated;
    private readonly docs;
    private readonly key;
    constructor(config: AffixSdkConfig, docs: AffixDocumentStore, key?: string);
    hydrate(): Promise<void>;
    private persist;
    getState(): LicenceState;
    private applyPolicyBody;
    private needsPulse;
    /**
     * Instant policy pulse. Use after Hub plan changes or before prove when quota matters.
     */
    pulse(force?: boolean): Promise<boolean>;
    ensureFreshPolicy(): Promise<void>;
    consumeQuota(count?: number): Promise<void>;
    private scheduleNext;
    private needsCheck;
    private withinGrace;
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
