/* Credit: @paparichens */
import { SqlLookupError, classifySqlError } from "./sql-errors.js";
import type { SqlDialect, SqlExecutor } from "./types.js";

export type SqlExecutorWrapOptions = {
    /** Abort query after this many ms. Default: no SDK timeout (driver may still timeout). */
    timeoutMs?: number;
    dialect?: SqlDialect;
    role?: "primary" | "replica";
    /**
     * When true, records meta intent; wrappers may reject non-SELECT SQL on this path.
     * Does not force the RDBMS into RO mode by itself (use replica URL / RO user).
     */
    readOnly?: boolean;
    /** Optional label for errors. */
    name?: string;
};

export type PrimaryReplicaOptions = {
    primary: SqlExecutor;
    /** Optional replica / hot standby. Lookups prefer this when preferReplica is true. */
    replica?: SqlExecutor;
    /**
     * Prefer replica for lookups when available. Default true.
     * Failover to primary when replica returns connection/pool/timeout errors.
     */
    preferReplica?: boolean;
    /** Failover to primary on replica infra errors. Default true. */
    failoverToPrimary?: boolean;
    timeoutMs?: number;
    dialect?: SqlDialect;
    readOnly?: boolean;
};
/**
 * Race a promise against a deadline. On timeout, rejects with SqlLookupError code=timeout.
 * Note: underlying driver work may continue unless the driver supports cancellation.
 */
export function withQueryTimeout<T>(work: Promise<T>, timeoutMs: number, context?: {
    dialect?: string;
    role?: "primary" | "replica";
}): Promise<T> {
    if (!timeoutMs || timeoutMs <= 0)
        return work;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new SqlLookupError(`sql_lookup_timeout after ${timeoutMs}ms`, {
                code: "timeout",
                dialect: context?.dialect,
                role: context?.role,
                retriable: true,
            }));
        }, timeoutMs);
        work.then((v) => {
            clearTimeout(timer);
            resolve(v);
        }, (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
/** Guard: data-check path should only run SELECT (and WITH … SELECT). */
export function assertSelectOnly(sql: string, readOnly: boolean | undefined): void {
    if (!readOnly)
        return;
    const stripped = sql
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/--[^\n]*/g, " ")
        .trim()
        .toUpperCase();
    if (!(stripped.startsWith("SELECT") || stripped.startsWith("WITH"))) {
        throw new SqlLookupError("sql_readonly: non-SELECT blocked on readOnly executor", {
            code: "readonly",
            retriable: false,
        });
    }
}
/**
 * Wrap any SqlExecutor with timeout, readOnly SELECT guard, and error classification.
 */
export function wrapSqlExecutor(inner: SqlExecutor, options?: SqlExecutorWrapOptions): SqlExecutor {
    return {
        async query(sql, params) {
            try {
                assertSelectOnly(sql, options.readOnly);
                const work = inner.query(sql, params);
                const rows = options.timeoutMs
                    ? await withQueryTimeout(work, options.timeoutMs, {
                        dialect: options.dialect,
                        role: options.role,
                    })
                    : await work;
                return rows ?? [];
            }
            catch (err) {
                throw classifySqlError(err, {
                    dialect: options.dialect,
                    role: options.role,
                    timeoutMs: options.timeoutMs,
                });
            }
        },
    };
}
/**
 * Primary + optional read-replica executor for data-check lookups.
 * Does not invent multi-region logic: host supplies two pools (primary write URL, replica RO URL).
 */
export function createPrimaryReplicaExecutor(options: PrimaryReplicaOptions): SqlExecutor {
    const preferReplica = options.preferReplica !== false;
    const failover = options.failoverToPrimary !== false;
    const primary = wrapSqlExecutor(options.primary, {
        timeoutMs: options.timeoutMs,
        dialect: options.dialect,
        role: "primary",
        readOnly: options.readOnly,
    });
    const replica = options.replica
        ? wrapSqlExecutor(options.replica, {
            timeoutMs: options.timeoutMs,
            dialect: options.dialect,
            role: "replica",
            readOnly: true,
        })
        : null;
    return {
        async query(sql, params) {
            const useReplica = preferReplica && replica;
            if (useReplica) {
                try {
                    return await replica.query(sql, params);
                }
                catch (err) {
                    if (!failover)
                        throw err;
                    const classified = classifySqlError(err, {
                        dialect: options.dialect,
                        role: "replica",
                    });
                    if (classified.code === "timeout" ||
                        classified.code === "pool" ||
                        classified.code === "connection") {
                        return primary.query(sql, params);
                    }
                    throw classified;
                }
            }
            return primary.query(sql, params);
        },
    };
}
