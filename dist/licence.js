import { randomInt } from "node:crypto";
import { requestJson } from "./http.js";
import { docGet, docSet, STORAGE_KEYS } from "./storage/index.js";
export class LicenceError extends Error {
    code = "affix_sdk_licence_invalid";
    constructor(message) {
        super(message);
        this.name = "LicenceError";
    }
}
function keyHint(apiKey) {
    if (apiKey.length <= 10)
        return "***";
    return `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`;
}
function isLicenceBillingKey(apiKey) {
    return typeof apiKey === "string" && apiKey.startsWith("aio_live_");
}
function randomBetween(min, max) {
    return randomInt(Math.floor(min), Math.max(Math.floor(min) + 1, Math.floor(max)));
}
function formatTrialMessage(quota) {
    if (!quota?.is_trial)
        return null;
    const rem = Number(quota.remaining ?? 0);
    const lim = Number(quota.limit ?? 100);
    const exp = quota.trial_expires_at || quota.period_end;
    const expLabel = exp ? new Date(exp).toLocaleDateString("en-GB") : "30 days";
    return `Trial: ${rem} of ${lim} free proofs left (until ${expLabel}).`;
}
/**
 * Random licence recheck roughly every couple of days.
 * Pings GET /v1/circuits with the configured API key (auth check only; one light call).
 */
export class LicenceLease {
    config;
    state;
    checkPromise = null;
    hydrated = false;
    docs;
    key;
    constructor(config, docs, key = STORAGE_KEYS.licence) {
        this.config = config;
        this.docs = docs;
        this.key = key;
        this.state = {
            last_ok_at: null,
            last_check_at: null,
            next_check_at: null,
            last_pulse_at: null,
            ok: false,
            status: "unchecked",
            message: "Licence has not been checked.",
            key_hint: keyHint(this.config.apiKey),
            quota: null,
            policy_revision: null,
        };
    }
    async hydrate() {
        if (this.hydrated)
            return;
        this.hydrated = true;
        const empty = {
            last_ok_at: null,
            last_check_at: null,
            next_check_at: null,
            last_pulse_at: null,
            ok: false,
            status: "unchecked",
            message: "Licence has not been checked.",
            key_hint: keyHint(this.config.apiKey),
            quota: null,
            policy_revision: null,
        };
        const raw = await docGet(this.docs, this.key);
        if (!raw) {
            this.state = empty;
            return;
        }
        try {
            const parsed = JSON.parse(raw);
            this.state = { ...empty, ...parsed, key_hint: keyHint(this.config.apiKey) };
        }
        catch {
            this.state = empty;
        }
    }
    async persist() {
        await docSet(this.docs, this.key, JSON.stringify(this.state, null, 2));
    }
    getState() {
        return { ...this.state };
    }
    refreshKeyHint() {
        this.state.key_hint = keyHint(this.config.apiKey);
        this.state.ok = false;
        this.state.status = "unchecked";
        this.state.message = "Licence has not been checked.";
        this.state.last_error = undefined;
        return this.getState();
    }
    applyPolicyBody(body) {
        if (body.plan_tier)
            this.state.plan_tier = String(body.plan_tier);
        this.state.grace = Boolean(body.grace);
        this.state.grace_until = body.grace_until ?? null;
        if (body.entitlements && typeof body.entitlements === "object") {
            this.state.entitlements = body.entitlements;
        }
        if (body.quota && typeof body.quota === "object") {
            this.state.quota = body.quota;
        }
        const trialMsg = formatTrialMessage(body.quota);
        if (trialMsg && this.state.ok) {
            this.state.message = trialMsg;
        }
        if (body.policy_revision !== undefined && body.policy_revision !== null) {
            this.state.policy_revision = Number(body.policy_revision);
        }
    }
    needsPulse() {
        const minGap = this.config.quotaPulseMinMs ?? 15_000;
        if (this.state.policy_revision === null || this.state.policy_revision === undefined)
            return true;
        if (!this.state.last_pulse_at)
            return true;
        const age = Date.now() - new Date(this.state.last_pulse_at).getTime();
        return age >= minGap;
    }
    /**
     * Instant policy pulse for Hub-driven plan changes.
     */
    async pulse(force = false) {
        await this.hydrate();
        if (!isLicenceBillingKey(this.config.apiKey) || this.config.enforceProofQuota === false) {
            return this.state.ok || this.state.status === "unchecked";
        }
        if (!force && !this.needsPulse() && this.state.ok && this.state.quota) {
            return true;
        }
        if (this.checkPromise)
            return this.checkPromise;
        this.checkPromise = (async () => {
            this.state.last_pulse_at = new Date().toISOString();
            try {
                const res = await requestJson(`${this.config.apiBase}/v1/auth/pulse`, {
                    method: "GET",
                    headers: {
                        Accept: "application/json",
                        Authorization: `Bearer ${this.config.apiKey}`,
                        "X-API-Key": this.config.apiKey,
                        "User-Agent": "AffixIO-SDK/1.1",
                    },
                    timeoutMs: Math.min(this.config.timeoutMs ?? 30_000, 30_000),
                });
                const body = await res.json();
                if (!res.ok) {
                    this.state.ok = false;
                    const denied = res.status === 401 || res.status === 403 || res.status === 410;
                    this.state.status = denied ? "expired" : "unreachable";
                    this.state.message = denied
                        ? "Licence expired. The API key was removed, revoked, exhausted, or rejected."
                        : "Licence pulse could not be completed.";
                    this.state.last_error = String(body.message ?? body.error ?? `http_${res.status}`);
                    await this.persist();
                    return false;
                }
                if (body.status && body.status !== "active") {
                    this.state.ok = false;
                    this.state.status = "expired";
                    this.state.message = "Licence expired. The API key is no longer active.";
                    this.state.last_error = `api_key_${String(body.status)}`;
                    await this.persist();
                    return false;
                }
                this.state.ok = true;
                this.state.status = "active";
                this.state.message = formatTrialMessage(body.quota) || "Licence active.";
                this.state.last_ok_at = new Date().toISOString();
                this.state.last_check_at = this.state.last_ok_at;
                this.state.last_error = undefined;
                this.applyPolicyBody(body);
                await this.persist();
                return true;
            }
            catch (err) {
                this.state.ok = false;
                this.state.status = "unreachable";
                this.state.message = "Licence server unreachable. Cached grace rules apply.";
                this.state.last_error = err instanceof Error ? err.message : String(err);
                await this.persist();
                return false;
            }
            finally {
                this.checkPromise = null;
            }
        })();
        return this.checkPromise;
    }
    async ensureFreshPolicy() {
        if (!isLicenceBillingKey(this.config.apiKey) || this.config.enforceProofQuota === false)
            return;
        await this.pulse(false);
    }
    async consumeQuota(count = 1) {
        if (!isLicenceBillingKey(this.config.apiKey) || this.config.enforceProofQuota === false)
            return;
        await this.hydrate();
        try {
            const res = await requestJson(`${this.config.apiBase}/v1/quota/consume`, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.config.apiKey}`,
                    "X-API-Key": this.config.apiKey,
                    "User-Agent": "AffixIO-SDK/1.1",
                },
                body: JSON.stringify({ count }),
                timeoutMs: Math.min(this.config.timeoutMs ?? 30_000, 30_000),
            });
            const body = await res.json();
            if (!res.ok) {
                throw new LicenceError(String(body.message ?? body.error ?? "Quota consume rejected."));
            }
            if (body.quota)
                this.state.quota = body.quota;
            if (body.policy_revision !== undefined)
                this.state.policy_revision = Number(body.policy_revision);
            const trialMsg = formatTrialMessage(body.quota);
            if (trialMsg && this.state.ok)
                this.state.message = trialMsg;
            await this.persist();
        }
        catch (err) {
            if (err instanceof LicenceError)
                throw err;
            throw new LicenceError(err instanceof Error ? err.message : "Quota consume failed.");
        }
    }
    scheduleNext() {
        const delay = randomBetween(this.config.licenceMinIntervalMs, this.config.licenceMaxIntervalMs);
        this.state.next_check_at = new Date(Date.now() + delay).toISOString();
    }
    needsCheck() {
        if (!this.state.ok || !this.state.last_ok_at)
            return true;
        if (!this.state.next_check_at)
            return true;
        return Date.now() >= new Date(this.state.next_check_at).getTime();
    }
    withinGrace() {
        if (this.state.status === "expired")
            return false;
        if (!this.state.last_ok_at)
            return false;
        const age = Date.now() - new Date(this.state.last_ok_at).getTime();
        return age <= this.config.licenceMaxIntervalMs * 1.25;
    }
    /**
     * Lightweight auth ping. Does not call prove. Safe for periodic checks.
     */
    async check(force = false) {
        await this.hydrate();
        if (!force && !this.needsCheck() && this.state.ok) {
            return true;
        }
        if (this.checkPromise)
            return this.checkPromise;
        this.checkPromise = (async () => {
            this.state.last_check_at = new Date().toISOString();
            try {
                const res = await requestJson(`${this.config.apiBase}/v1/auth/check`, {
                    method: "GET",
                    headers: {
                        Accept: "application/json",
                        Authorization: `Bearer ${this.config.apiKey}`,
                        "X-API-Key": this.config.apiKey,
                        "User-Agent": "AffixIO-SDK/1.1",
                    },
                    timeoutMs: Math.min(this.config.timeoutMs ?? 30_000, 30_000),
                });
                const body = await res.json();
                if (!res.ok) {
                    this.state.ok = false;
                    const denied = res.status === 401 || res.status === 403 || res.status === 410;
                    this.state.status = denied ? "expired" : "unreachable";
                    this.state.message = denied
                        ? "Licence expired. The API key was removed, revoked, exhausted, or rejected."
                        : "Licence check could not be completed.";
                    this.state.last_error = String(body.message ?? body.error ?? `http_${res.status}`);
                    this.scheduleNext();
                    await this.persist();
                    return false;
                }
                if (body.status && body.status !== "active") {
                    this.state.ok = false;
                    this.state.status = "expired";
                    this.state.message = "Licence expired. The API key is no longer active.";
                    this.state.last_error = `api_key_${String(body.status)}`;
                    this.scheduleNext();
                    await this.persist();
                    return false;
                }
                this.state.ok = true;
                this.state.status = "active";
                this.state.message = formatTrialMessage(body.quota) || "Licence active.";
                this.state.last_ok_at = new Date().toISOString();
                this.state.last_error = undefined;
                this.applyPolicyBody(body);
                this.scheduleNext();
                await this.persist();
                return true;
            }
            catch (err) {
                this.state.ok = false;
                this.state.status = "unreachable";
                this.state.message = "Licence server unreachable. Cached grace rules apply.";
                this.state.last_error = err instanceof Error ? err.message : String(err);
                this.scheduleNext();
                await this.persist();
                return false;
            }
            finally {
                this.checkPromise = null;
            }
        })();
        return this.checkPromise;
    }
    /** Gate prove / verify when brickWithoutLicence is enabled. */
    async assertLicensed() {
        await this.hydrate();
        if (!this.config.brickWithoutLicence) {
            if (this.needsCheck())
                void this.check(false);
            return;
        }
        const ok = await this.check(false);
        if (ok)
            return;
        if (this.state.status === "expired") {
            throw new LicenceError(this.state.message);
        }
        if (this.withinGrace() && this.state.last_ok_at) {
            void this.check(true);
            return;
        }
        throw new LicenceError(`API licence invalid or unreachable (${this.state.last_error ?? "unknown"}). ` +
            `Confirm AFFIX_API_KEY against ${this.config.apiBase}.`);
    }
    /**
     * Local prove may continue offline when configured, or within licence grace.
     * Returns whether this prove should be treated as offline (no live licence RTT).
     */
    async assertForLocalProve() {
        await this.hydrate();
        if (!this.config.brickWithoutLicence) {
            if (this.needsCheck())
                void this.check(false);
            return { offline: false };
        }
        if (!this.needsCheck() && this.state.ok) {
            return { offline: false };
        }
        try {
            const ok = await this.check(false);
            if (ok)
                return { offline: false };
        }
        catch {
            // network failure falls through
        }
        if (this.state.status === "expired") {
            throw new LicenceError(this.state.message);
        }
        if (this.withinGrace() && this.state.last_ok_at) {
            return { offline: true };
        }
        if (this.config.allowOfflineProve) {
            return { offline: true };
        }
        throw new LicenceError(`API licence invalid or unreachable (${this.state.last_error ?? "unknown"}). ` +
            `Offline prove disabled. Confirm AFFIX_API_KEY against ${this.config.apiBase}.`);
    }
    /**
     * Paid-plan gates. Missing entitlements (legacy cloud keys) stay open.
     */
    assertEntitlement(feature) {
        const entitlements = this.state.entitlements;
        if (!entitlements)
            return;
        if (entitlements[feature] === true)
            return;
        throw new LicenceError(`Plan does not include ${feature}. Upgrade the SDK licence on hub.affix-io.com/billing.`);
    }
}
