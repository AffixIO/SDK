/* Credit: @paparichens */
import type { DataCheckQuery, DataCheckResult } from "./types.js";
/** Stringify store values exactly. Numbers and booleans become stable decimal/true/false. */
export function exactFieldString(value: unknown): string {
    if (value === null || value === undefined)
        return "";
    if (typeof value === "string")
        return value;
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (typeof value === "number") {
        if (!Number.isFinite(value))
            return String(value);
        return String(value);
    }
    if (typeof value === "bigint")
        return value.toString(10);
    return String(value);
}
export function stringsEqualExact(a: string, b: string): boolean {
    return a === b;
}
export function resolveClaimField(row: Record<string, unknown>, claimField?: string): {
    key: string;
    value: string;
} | null {
    const candidates = claimField
        ? [claimField]
        : ["claim", "status", "value", "decision", "flag"];
    for (const key of candidates) {
        if (Object.prototype.hasOwnProperty.call(row, key) && row[key] !== undefined && row[key] !== null) {
            return { key, value: exactFieldString(row[key]) };
        }
    }
    return null;
}
/**
 * Build DataCheckResult from a row. Field map is the single source of truth:
 * pass ⇔ fields.claim === fields.required (exact).
 */
export function buildCheckResult(opts: {
    row: Record<string, unknown>;
    query: DataCheckQuery;
    source: string;
    style: "modern" | "legacy";
    record_id?: string;
    meta?: Record<string, string>;
}): DataCheckResult {
    const claimHit = resolveClaimField(opts.row, opts.query.claimField);
    if (!claimHit) {
        throw new Error(`data_check_claim_field_missing:${opts.query.claimField ?? "claim|status|value"}`);
    }
    const required = exactFieldString(opts.query.required);
    const fields = {
        claim: claimHit.value,
        required,
    };
    const select = opts.query.select ?? [];
    for (const col of select) {
        if (col === "claim" || col === "required")
            continue;
        if (Object.prototype.hasOwnProperty.call(opts.row, col)) {
            fields[col] = exactFieldString(opts.row[col]);
        }
    }
    // Also mirror claim source column under its real name when different
    if (claimHit.key !== "claim" && fields[claimHit.key] === undefined) {
        fields[claimHit.key] = claimHit.value;
    }
    const pass = stringsEqualExact(fields.claim, fields.required);
    return {
        pass,
        fields,
        source: opts.source,
        style: opts.style,
        record_id: opts.record_id ?? opts.query.id,
        meta: opts.meta,
    };
}
/** Deep equality for field maps (order-independent keys). */
export function fieldsExactMatch(a: Record<string, string>, b: Record<string, string>): boolean {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length)
        return false;
    for (let i = 0; i < keysA.length; i++) {
        if (keysA[i] !== keysB[i])
            return false;
        if (a[keysA[i]] !== b[keysB[i]])
            return false;
    }
    return true;
}
