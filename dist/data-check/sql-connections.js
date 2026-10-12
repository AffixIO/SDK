/**
 * Copyable wire-ups for common Node SQL drivers.
 * Drivers are not package dependencies: pass your pool/connection in.
 *
 * See examples/sql/ for full scripts.
 */
import { wrapSqlExecutor } from "./sql-executor.js";
import { classifySqlError } from "./sql-errors.js";
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
export function createPgExecutor(pool, options = {}) {
    const dialect = options.dialect ?? "postgres";
    const inner = {
        async query(sql, params) {
            try {
                const res = await pool.query(sql, params);
                return res.rows ?? [];
            }
            catch (err) {
                throw classifySqlError(err, { dialect, role: options.role });
            }
        },
    };
    return wrapSqlExecutor(inner, { ...options, dialect, readOnly: options.readOnly ?? false });
}
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
export function createMysqlExecutor(pool, options = {}) {
    const dialect = options.dialect ?? "mysql";
    const inner = {
        async query(sql, params) {
            try {
                const runner = pool.execute?.bind(pool) ?? pool.query.bind(pool);
                const [rows] = await runner(sql, params ?? []);
                return Array.isArray(rows) ? rows : [];
            }
            catch (err) {
                throw classifySqlError(err, { dialect, role: options.role });
            }
        },
    };
    return wrapSqlExecutor(inner, {
        ...options,
        dialect,
        readOnly: options.readOnly ?? false,
    });
}
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
export function createOdbcExecutor(connection, options = {}) {
    const dialect = options.dialect ?? "odbc";
    const inner = {
        async query(sql, params) {
            try {
                const res = await connection.query(sql, params ?? []);
                if (Array.isArray(res))
                    return res;
                if (res && typeof res === "object" && Array.isArray(res.rows)) {
                    return res.rows;
                }
                return [];
            }
            catch (err) {
                throw classifySqlError(err, { dialect, role: options.role });
            }
        },
    };
    return wrapSqlExecutor(inner, {
        ...options,
        dialect,
        readOnly: options.readOnly ?? true,
        role: options.role ?? "replica",
    });
}
export function resolveSqlConnectionConfig(partial) {
    return {
        name: partial.name ?? "affix-data-check",
        dialect: partial.dialect,
        primaryUrl: partial.primaryUrl ?? process.env.AFFIX_SQL_PRIMARY_URL,
        replicaUrl: partial.replicaUrl ?? process.env.AFFIX_SQL_REPLICA_URL,
        preferReplica: partial.preferReplica ?? true,
        failoverToPrimary: partial.failoverToPrimary ?? true,
        readOnly: partial.readOnly ?? true,
        timeoutMs: partial.timeoutMs ??
            (Number(process.env.AFFIX_SQL_TIMEOUT_MS) || 10_000),
        poolMax: partial.poolMax ?? 10,
        connectTimeoutMs: partial.connectTimeoutMs ?? 5_000,
    };
}
