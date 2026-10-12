import { SqlLookupError, classifySqlError } from "./sql-errors.js";
/**
 * Race a promise against a deadline. On timeout, rejects with SqlLookupError code=timeout.
 * Note: underlying driver work may continue unless the driver supports cancellation.
 */
export function withQueryTimeout(work, timeoutMs, context) {
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
export function assertSelectOnly(sql, readOnly) {
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
export function wrapSqlExecutor(inner, options = {}) {
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
export function createPrimaryReplicaExecutor(options) {
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
