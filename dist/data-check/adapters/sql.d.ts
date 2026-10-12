import type { DataCheckQuery, DataCheckResult, DataCheckSource, SqlDialect, SqlExecutor } from "../types.js";
import { SqlLookupError, type SqlLookupOutcome } from "../sql-errors.js";
export type SqlStoreOptions = {
    /** Physical / logical table name. */
    table: string;
    /** Primary lookup column. Default: id */
    idColumn?: string;
    /** Optional schema prefix (postgres: public.patients). */
    schema?: string;
    dialect?: SqlDialect;
    /**
     * modern → Postgres/MySQL/SQLite/Maria/cloud SQL
     * legacy → DB2, Oracle forms, classic ODBC estate
     */
    style?: "modern" | "legacy";
    name?: string;
    /**
     * Parameterised override lookup SQL.
     * Placeholders:
     *   :id          → dialect bind for query.id (always first bind by default)
     *   $1 / ? / @p1 / :1  → also accepted and normalised for single-id templates
     * Multi-param: write dialect SQL with $1,$2 or ?,? and supply bindParams.
     * Never interpolate id into the string.
     */
    lookupSql?: string;
    /**
     * Bind values for lookupSql. Default: (q) => [q.id]
     * Example multi-param:
     *   lookupSql: "SELECT * FROM patients WHERE id = $1 AND site = $2"
     *   bindParams: (q) => [q.id, q.fields_site ?? "GGH"]  // or close over site
     */
    bindParams?: (query: DataCheckQuery) => unknown[];
    /** SDK query deadline (ms). Wrapped onto the executor if not already wrapped. */
    timeoutMs?: number;
    /**
     * Prefer SELECT-only path (blocks INSERT/UPDATE…).
     * Pair with a RO DB user or replica URL in operations.
     */
    readOnly?: boolean;
    /** Which side of a primary/replica pair this store means (meta + errors). */
    role?: "primary" | "replica";
};
/**
 * SQL / RDBMS data check. Wire any driver that implements SqlExecutor.query().
 *
 * null => no row. Throws SqlLookupError for timeout / pool / connection / query faults.
 *
 * Examples:
 *   new SqlStore(pgExecutor, { table: "patients", dialect: "postgres" })
 *   SqlStore.fromPg(pool, { table: "patients", timeoutMs: 10_000, readOnly: true })
 */
export declare class SqlStore implements DataCheckSource {
    readonly name: string;
    readonly style: "modern" | "legacy";
    private readonly executor;
    private readonly options;
    constructor(executor: SqlExecutor, options: SqlStoreOptions);
    /** Generic path when you already built an SqlExecutor (pg/mysql/odbc factories). */
    static fromExecutor(executor: SqlExecutor, options: SqlStoreOptions): SqlStore;
    /** Wrap node-postgres (pg): client.query returns { rows }. */
    static fromPg(client: {
        query: (sql: string, params?: unknown[]) => Promise<{
            rows: Array<Record<string, unknown>>;
        }>;
    }, options: Omit<SqlStoreOptions, "dialect"> & {
        dialect?: SqlDialect;
    }): SqlStore;
    /** Wrap mysql2/promise: connection.query returns [rows, fields]. */
    static fromMysql(connection: {
        query: (sql: string, params?: unknown[]) => Promise<[Array<Record<string, unknown>>, unknown]>;
    }, options: Omit<SqlStoreOptions, "dialect"> & {
        dialect?: SqlDialect;
    }): SqlStore;
    /** Wrap better-sqlite3 sync prepare/all. */
    static fromBetterSqlite(db: {
        prepare: (sql: string) => {
            all: (...params: unknown[]) => Array<Record<string, unknown>>;
        };
    }, options: Omit<SqlStoreOptions, "dialect"> & {
        dialect?: SqlDialect;
    }): SqlStore;
    /** Wrap node:sqlite DatabaseSync (Node 22.5+). */
    static fromNodeSqlite(db: {
        prepare: (sql: string) => {
            all: (...params: unknown[]) => Array<Record<string, unknown>>;
        };
    }, options: Omit<SqlStoreOptions, "dialect"> & {
        dialect?: SqlDialect;
    }): SqlStore;
    /** Wrap tedious / mssql style Request that resolves recordset. */
    static fromMssql(queryFn: (sql: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>, options: Omit<SqlStoreOptions, "dialect"> & {
        dialect?: SqlDialect;
    }): SqlStore;
    /** Classic ODBC (node-odbc / ibm_db) promise query. */
    static fromOdbc(executor: SqlExecutor, options: Omit<SqlStoreOptions, "dialect" | "style"> & {
        dialect?: SqlDialect;
        style?: "modern" | "legacy";
    }): SqlStore;
    buildLookupSql(): string;
    /** Bind array for the current lookup SQL. Default single id. */
    buildBindParams(query: DataCheckQuery): unknown[];
    /**
     * Lookup: returns DataCheckResult or null (no row).
     * Throws SqlLookupError for DB / pool / timeout / query faults.
     */
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
    /**
     * Same as lookup but never throws for “no row”; returns a tagged outcome.
     * Infrastructure errors still throw (or return db_error if catchInfra is true).
     */
    lookupOutcome(query: DataCheckQuery, opts?: {
        catchInfra?: boolean;
    }): Promise<SqlLookupOutcome>;
}
export declare function bindPlaceholder(dialect: SqlDialect, index: number): string;
export declare function quoteIdent(name: string, dialect: SqlDialect): string;
export declare function qualifyTable(table: string, schema: string | undefined, dialect: SqlDialect): string;
/**
 * Prepare custom lookupSql for a dialect.
 * - Always rewrites :id to bind #1 for that dialect.
 * - For single-param templates, also normalise $1, @p1, :1, and lone first ?.
 * - When multiParam is true, only :id is rewritten (leave $1,$2 or ?,? intact).
 */
export declare function prepareLookupSql(sql: string, dialect: SqlDialect, opts?: {
    multiParam?: boolean;
}): string;
export { SqlLookupError };
