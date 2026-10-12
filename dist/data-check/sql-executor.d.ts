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
/**
 * Race a promise against a deadline. On timeout, rejects with SqlLookupError code=timeout.
 * Note: underlying driver work may continue unless the driver supports cancellation.
 */
export declare function withQueryTimeout<T>(work: Promise<T>, timeoutMs: number, context?: {
    dialect?: string;
    role?: "primary" | "replica";
}): Promise<T>;
/** Guard: data-check path should only run SELECT (and WITH … SELECT). */
export declare function assertSelectOnly(sql: string, readOnly: boolean | undefined): void;
/**
 * Wrap any SqlExecutor with timeout, readOnly SELECT guard, and error classification.
 */
export declare function wrapSqlExecutor(inner: SqlExecutor, options?: SqlExecutorWrapOptions): SqlExecutor;
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
 * Primary + optional read-replica executor for data-check lookups.
 * Does not invent multi-region logic: host supplies two pools (primary write URL, replica RO URL).
 */
export declare function createPrimaryReplicaExecutor(options: PrimaryReplicaOptions): SqlExecutor;
