/**
 * SQL lookup failure taxonomy.
 * null from lookup = no row (record missing). These errors = infrastructure / engine faults.
 */
export type SqlErrorCode = "timeout" | "pool" | "connection" | "query" | "readonly" | "unknown";
export declare class SqlLookupError extends Error {
    readonly code: SqlErrorCode;
    readonly dialect?: string;
    readonly role?: "primary" | "replica";
    readonly cause?: unknown;
    readonly retriable: boolean;
    constructor(message: string, opts: {
        code: SqlErrorCode;
        dialect?: string;
        role?: "primary" | "replica";
        cause?: unknown;
        retriable?: boolean;
    });
    /** True when the database layer is unreachable (not "no row"). */
    get isDbDown(): boolean;
    toJSON(): Record<string, unknown>;
}
/** Map driver / libpq / mysql2 / odbc style errors into SqlLookupError. */
export declare function classifySqlError(err: unknown, context?: {
    dialect?: string;
    role?: "primary" | "replica";
    timeoutMs?: number;
}): SqlLookupError;
/** Distinguish lookup outcomes for host apps. */
export type SqlLookupOutcome = {
    kind: "row";
    result: import("./types.js").DataCheckResult;
} | {
    kind: "no_row";
    id: string;
} | {
    kind: "db_error";
    error: SqlLookupError;
};
export declare function outcomeFromLookup(result: import("./types.js").DataCheckResult | null, id: string): Extract<SqlLookupOutcome, {
    kind: "row" | "no_row";
}>;
