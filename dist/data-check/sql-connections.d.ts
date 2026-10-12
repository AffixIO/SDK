/**
 * Copyable wire-ups for common Node SQL drivers.
 * Drivers are not package dependencies: pass your pool/connection in.
 *
 * See examples/sql/ for full scripts.
 */
import type { SqlDialect, SqlExecutor } from "./types.js";
import { type SqlExecutorWrapOptions } from "./sql-executor.js";
export type PgPoolLike = {
    query: (sql: string, params?: unknown[]) => Promise<{
        rows: Array<Record<string, unknown>>;
    }>;
};
export type MysqlPoolLike = {
    query: (sql: string, params?: unknown[]) => Promise<[Array<Record<string, unknown>> | unknown, unknown]>;
    execute?: (sql: string, params?: unknown[]) => Promise<[Array<Record<string, unknown>> | unknown, unknown]>;
};
/** node-odbc connection/pool shape (promisified or native promise API). */
export type OdbcConnectionLike = {
    query: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>> | {
        rows?: Array<Record<string, unknown>>;
    }>;
};
export type ConnectionFactoryOptions = SqlExecutorWrapOptions & {
    dialect?: SqlDialect;
};
/**
 * PostgreSQL (pg Pool | Client).
 *
 * ```ts
 * import pg from "pg";
 * import { createPgExecutor, SqlStore } from "@affix-io/sdk";
 *
 * const pool = new pg.Pool({
 *   connectionString: process.env.DATABASE_URL, // use a replica URL for RO
 *   max: 10,
 *   connectionTimeoutMillis: 5_000,
 *   idleTimeoutMillis: 30_000,
 *   statement_timeout: 8_000, // server-side (pg supports via options)
 * });
 * // optional server statement_timeout per session:
 * // pool.on("connect", (c) => { c.query("SET statement_timeout = 8000"); });
 *
 * const executor = createPgExecutor(pool, {
 *   timeoutMs: 10_000,
 *   readOnly: true,
 *   role: "replica",
 * });
 * const store = SqlStore.fromExecutor(executor, {
 *   table: "patients",
 *   dialect: "postgres",
 *   lookupSql: "SELECT id, status, ward, site FROM patients WHERE id = $1 LIMIT 1",
 * });
 * ```
 */
export declare function createPgExecutor(pool: PgPoolLike, options?: ConnectionFactoryOptions): SqlExecutor;
/**
 * MySQL / MariaDB (mysql2/promise pool).
 *
 * ```ts
 * import mysql from "mysql2/promise";
 * import { createMysqlExecutor, SqlStore } from "@affix-io/sdk";
 *
 * const pool = mysql.createPool({
 *   uri: process.env.MYSQL_URL,
 *   connectionLimit: 10,
 *   connectTimeout: 5_000,
 *   // prefer a RO user / replica host for data-check
 * });
 *
 * const executor = createMysqlExecutor(pool, {
 *   timeoutMs: 10_000,
 *   readOnly: true,
 *   role: "replica",
 * });
 * const store = SqlStore.fromExecutor(executor, {
 *   table: "patients",
 *   dialect: "mysql",
 *   lookupSql: "SELECT id, status, ward, site FROM patients WHERE id = ? LIMIT 1",
 * });
 * ```
 */
export declare function createMysqlExecutor(pool: MysqlPoolLike, options?: ConnectionFactoryOptions): SqlExecutor;
/**
 * ODBC (node-odbc or similar).
 *
 * ```ts
 * import odbc from "odbc";
 * import { createOdbcExecutor, SqlStore } from "@affix-io/sdk";
 *
 * const conn = await odbc.connect(process.env.ODBC_DSN!); // e.g. DSN=TrustPasRO
 * const executor = createOdbcExecutor(conn, {
 *   timeoutMs: 15_000,
 *   readOnly: true,
 *   role: "replica",
 *   dialect: "odbc",
 * });
 * const store = SqlStore.fromExecutor(executor, {
 *   table: "HOSP.PATIENT",
 *   dialect: "odbc",
 *   style: "legacy",
 *   lookupSql: "SELECT id, status, ward, site FROM HOSP.PATIENT WHERE id = ?",
 * });
 * ```
 */
export declare function createOdbcExecutor(connection: OdbcConnectionLike, options?: ConnectionFactoryOptions): SqlExecutor;
/**
 * Config shape for host apps (env + ops). Pattern only; SDK does not open sockets from this alone.
 */
export type SqlConnectionConfig = {
    /** Application name / tenant. */
    name?: string;
    dialect: SqlDialect;
    /** Primary (read-write) connection string or DSN. */
    primaryUrl?: string;
    /** Read replica / RO DSN. Prefer for data-check. */
    replicaUrl?: string;
    /** Prefer replica for lookups. Default true when replicaUrl is set. */
    preferReplica?: boolean;
    /** Fail over to primary on replica infra errors. Default true. */
    failoverToPrimary?: boolean;
    /** Force SDK SELECT-only guard + RO role meta. Default true for data-check. */
    readOnly?: boolean;
    /** SDK-side query deadline (ms). */
    timeoutMs?: number;
    /** Pool size hint for host setup docs. */
    poolMax?: number;
    /** Driver connect timeout hint (ms). */
    connectTimeoutMs?: number;
};
export declare function resolveSqlConnectionConfig(partial: Partial<SqlConnectionConfig> & {
    dialect: SqlDialect;
}): SqlConnectionConfig;
