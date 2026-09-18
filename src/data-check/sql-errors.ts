/* Credit: @paparichens */
/**
 * SQL lookup failure taxonomy.
 * null from lookup = no row (record missing). These errors = infrastructure / engine faults.
 */
export type SqlErrorCode = "timeout" | "pool" | "connection" | "query" | "readonly" | "unknown";

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
/**
 * SQL lookup failure taxonomy.
 * null from lookup = no row (record missing). These errors = infrastructure / engine faults.
 */
export class SqlLookupError extends Error {
    code;
    dialect;
    role;
    cause;
    retriable;
    constructor(message: string, opts: {
        code: SqlErrorCode;
        dialect?: string;
        role?: "primary" | "replica";
        cause?: unknown;
        retriable?: boolean;
    }) {
        super(message);
        this.name = "SqlLookupError";
        this.code = opts.code;
        this.dialect = opts.dialect;
        this.role = opts.role;
        this.cause = opts.cause;
        this.retriable =
            opts.retriable ??
                (opts.code === "timeout" || opts.code === "pool" || opts.code === "connection");
    }
    /** True when the database layer is unreachable (not "no row"). */
    get isDbDown() {
        return this.code === "connection" || this.code === "pool" || this.code === "timeout";
    }
    toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            dialect: this.dialect,
            role: this.role,
            retriable: this.retriable,
            is_db_down: this.isDbDown,
        };
    }
}
/** Map driver / libpq / mysql2 / odbc style errors into SqlLookupError. */
export function classifySqlError(err: unknown, context?: {
    dialect?: string;
    role?: "primary" | "replica";
    timeoutMs?: number;
}): SqlLookupError {
    if (err instanceof SqlLookupError)
        return err;
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    const codeRaw = err && typeof err === "object"
        ? String((err as any).code ?? (err as any).errno ?? "")
        : "";
    const code = codeRaw.toLowerCase();
    // Timeouts (Node, pg, mysql2, generic)
    if (code === "etimedout" ||
        code === "err_timeout" ||
        code === "protocol_connection_lost" && lower.includes("timeout") ||
        lower.includes("query timeout") ||
        lower.includes("statement timeout") ||
        lower.includes("canceling statement due to statement timeout") ||
        lower.includes("operation timed out") ||
        lower.includes("sql_lookup_timeout")) {
        return new SqlLookupError(`sql_timeout: ${msg}`, {
            code: "timeout",
            dialect: context?.dialect,
            role: context?.role,
            cause: err,
            retriable: true,
        });
    }
    // Pool exhaustion / checkout wait
    if (lower.includes("timeout acquiring a connection") ||
        lower.includes("connection pool") ||
        lower.includes("too many connections") ||
        lower.includes("remaining connection slots") ||
        lower.includes("pool is closed") ||
        lower.includes("no free connections") ||
        lower.includes("er_con_count_error") ||
        code === "er_con_count_error" ||
        code === "53300") {
        return new SqlLookupError(`sql_pool: ${msg}`, {
            code: "pool",
            dialect: context?.dialect,
            role: context?.role,
            cause: err,
            retriable: true,
        });
    }
    // Connection / network / authentication down
    if (code === "econnrefused" ||
        code === "enotfound" ||
        code === "econnreset" ||
        code === "ehostunreach" ||
        code === "eai_again" ||
        code === "57p01" ||
        code === "57p03" ||
        code === "08001" ||
        code === "08006" ||
        code === "08s01" ||
        code === "er_access_denied_error" ||
        code === "28p01" ||
        lower.includes("connection refused") ||
        lower.includes("connect econnrefused") ||
        lower.includes("server closed the connection") ||
        lower.includes("connection terminated") ||
        lower.includes("can not connect") ||
        lower.includes("cannot connect") ||
        lower.includes("no such host") ||
        lower.includes("getaddrinfo") ||
        lower.includes("not connected") ||
        lower.includes("odbc") && lower.includes("im002") ||
        lower.includes("data source name not found")) {
        return new SqlLookupError(`sql_connection: ${msg}`, {
            code: "connection",
            dialect: context?.dialect,
            role: context?.role,
            cause: err,
            retriable: true,
        });
    }
    // Read-only violation (wrote to replica)
    if (lower.includes("read-only") ||
        lower.includes("read only") ||
        lower.includes("cannot execute") && lower.includes("recovery") ||
        code === "25006") {
        return new SqlLookupError(`sql_readonly: ${msg}`, {
            code: "readonly",
            dialect: context?.dialect,
            role: context?.role,
            cause: err,
            retriable: false,
        });
    }
    // Query / SQL syntax / missing relation (application bug, not infra down)
    if (code === "42p01" ||
        code === "42703" ||
        code === "er_no_such_table" ||
        code === "er_bad_field_error" ||
        lower.includes("syntax error") ||
        lower.includes("does not exist") ||
        lower.includes("unknown column") ||
        lower.includes("no such table")) {
        return new SqlLookupError(`sql_query: ${msg}`, {
            code: "query",
            dialect: context?.dialect,
            role: context?.role,
            cause: err,
            retriable: false,
        });
    }
    return new SqlLookupError(`sql_unknown: ${msg}`, {
        code: "unknown",
        dialect: context?.dialect,
        role: context?.role,
        cause: err,
        retriable: false,
    });
}
export function outcomeFromLookup(result: import("./types.js").DataCheckResult | null, id: string): Extract<SqlLookupOutcome, {
    kind: "row" | "no_row";
}> {
    if (!result)
        return { kind: "no_row", id };
    return { kind: "row", result };
}
