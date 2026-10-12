import { buildCheckResult } from "../map-check.js";
import { classifySqlError, SqlLookupError, outcomeFromLookup } from "../sql-errors.js";
import { wrapSqlExecutor } from "../sql-executor.js";
const LEGACY_DIALECTS = new Set(["oracle", "db2", "odbc", "mssql"]);
/**
 * SQL / RDBMS data check. Wire any driver that implements SqlExecutor.query().
 *
 * null => no row. Throws SqlLookupError for timeout / pool / connection / query faults.
 *
 * Examples:
 *   new SqlStore(pgExecutor, { table: "patients", dialect: "postgres" })
 *   SqlStore.fromPg(pool, { table: "patients", timeoutMs: 10_000, readOnly: true })
 */
export class SqlStore {
    name;
    style;
    executor;
    options;
    constructor(executor, options) {
        if (!options.table?.trim())
            throw new Error("sql_store_table_required");
        const dialect = options.dialect ?? "generic";
        this.options = {
            ...options,
            table: options.table.trim(),
            idColumn: options.idColumn ?? "id",
            dialect,
        };
        this.name = options.name ?? `sql_${dialect}`;
        this.style =
            options.style ??
                (LEGACY_DIALECTS.has(dialect) ? "legacy" : "modern");
        const wrapOpts = {
            timeoutMs: options.timeoutMs,
            dialect,
            role: options.role,
            readOnly: options.readOnly,
        };
        // Always wrap so classification is consistent (idempotent if already wrapped).
        this.executor = wrapSqlExecutor(executor, wrapOpts);
    }
    /** Generic path when you already built an SqlExecutor (pg/mysql/odbc factories). */
    static fromExecutor(executor, options) {
        return new SqlStore(executor, options);
    }
    /** Wrap node-postgres (pg): client.query returns { rows }. */
    static fromPg(client, options) {
        return new SqlStore({
            async query(sql, params) {
                const res = await client.query(sql, params);
                return res.rows ?? [];
            },
        }, { ...options, dialect: options.dialect ?? "postgres" });
    }
    /** Wrap mysql2/promise: connection.query returns [rows, fields]. */
    static fromMysql(connection, options) {
        return new SqlStore({
            async query(sql, params) {
                const [rows] = await connection.query(sql, params);
                return Array.isArray(rows) ? rows : [];
            },
        }, { ...options, dialect: options.dialect ?? "mysql" });
    }
    /** Wrap better-sqlite3 sync prepare/all. */
    static fromBetterSqlite(db, options) {
        return new SqlStore({
            async query(sql, params = []) {
                return db.prepare(sql).all(...params);
            },
        }, { ...options, dialect: options.dialect ?? "sqlite" });
    }
    /** Wrap node:sqlite DatabaseSync (Node 22.5+). */
    static fromNodeSqlite(db, options) {
        return SqlStore.fromBetterSqlite(db, { ...options, dialect: options.dialect ?? "sqlite" });
    }
    /** Wrap tedious / mssql style Request that resolves recordset. */
    static fromMssql(queryFn, options) {
        return new SqlStore({ query: queryFn }, { ...options, dialect: options.dialect ?? "mssql" });
    }
    /** Classic ODBC (node-odbc / ibm_db) promise query. */
    static fromOdbc(executor, options) {
        return new SqlStore(executor, {
            ...options,
            dialect: options.dialect ?? "odbc",
            style: options.style ?? "legacy",
            name: options.name ?? "sql_odbc",
            readOnly: options.readOnly ?? true,
        });
    }
    buildLookupSql() {
        if (this.options.lookupSql) {
            return prepareLookupSql(this.options.lookupSql, this.options.dialect, {
                multiParam: Boolean(this.options.bindParams),
            });
        }
        const table = qualifyTable(this.options.table, this.options.schema, this.options.dialect);
        const idCol = quoteIdent(this.options.idColumn, this.options.dialect);
        const bind = bindPlaceholder(this.options.dialect, 1);
        return `SELECT * FROM ${table} WHERE ${idCol} = ${bind}`;
    }
    /** Bind array for the current lookup SQL. Default single id. */
    buildBindParams(query) {
        if (this.options.bindParams) {
            return this.options.bindParams(query);
        }
        return [query.id];
    }
    /**
     * Lookup: returns DataCheckResult or null (no row).
     * Throws SqlLookupError for DB / pool / timeout / query faults.
     */
    async lookup(query) {
        const sql = this.buildLookupSql();
        const params = this.buildBindParams(query);
        let rows;
        try {
            rows = await this.executor.query(sql, params);
        }
        catch (err) {
            throw classifySqlError(err, {
                dialect: this.options.dialect,
                role: this.options.role,
            });
        }
        if (!rows?.length)
            return null;
        const row = rows[0];
        return buildCheckResult({
            row,
            query,
            source: this.name,
            style: this.style,
            record_id: query.id,
            meta: {
                dialect: this.options.dialect ?? "generic",
                table: this.options.table,
                id_column: this.options.idColumn,
                role: this.options.role ?? "",
                read_only: this.options.readOnly ? "true" : "false",
                param_count: String(params.length),
            },
        });
    }
    /**
     * Same as lookup but never throws for “no row”; returns a tagged outcome.
     * Infrastructure errors still throw (or return db_error if catchInfra is true).
     */
    async lookupOutcome(query, opts) {
        try {
            const result = await this.lookup(query);
            return outcomeFromLookup(result, query.id);
        }
        catch (err) {
            if (opts?.catchInfra) {
                return {
                    kind: "db_error",
                    error: classifySqlError(err, {
                        dialect: this.options.dialect,
                        role: this.options.role,
                    }),
                };
            }
            throw err;
        }
    }
}
export function bindPlaceholder(dialect, index) {
    switch (dialect) {
        case "postgres":
            return `$${index}`;
        case "mssql":
            return `@p${index}`;
        case "oracle":
            return `:${index}`;
        case "mysql":
        case "mariadb":
        case "sqlite":
        case "db2":
        case "odbc":
        case "generic":
        default:
            return "?";
    }
}
export function quoteIdent(name, dialect) {
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && dialect !== "mssql" && dialect !== "oracle") {
        return name;
    }
    switch (dialect) {
        case "mysql":
        case "mariadb":
            return `\`${name.replace(/`/g, "``")}\``;
        case "mssql":
            return `[${name.replace(/]/g, "]]")}]`;
        case "postgres":
        case "oracle":
        case "db2":
        case "sqlite":
        case "odbc":
        case "generic":
        default:
            return `"${name.replace(/"/g, '""')}"`;
    }
}
export function qualifyTable(table, schema, dialect) {
    if (table.includes(".") || table.includes("[")) {
        return table;
    }
    if (schema) {
        return `${quoteIdent(schema, dialect)}.${quoteIdent(table, dialect)}`;
    }
    return quoteIdent(table, dialect);
}
/**
 * Prepare custom lookupSql for a dialect.
 * - Always rewrites :id to bind #1 for that dialect.
 * - For single-param templates, also normalise $1, @p1, :1, and lone first ?.
 * - When multiParam is true, only :id is rewritten (leave $1,$2 or ?,? intact).
 */
export function prepareLookupSql(sql, dialect, opts) {
    const bind1 = bindPlaceholder(dialect, 1);
    // Named :id bind. Do not use \b:id because ":" is non-word and a boundary before it never matches.
    let out = sql.replace(/:id\b/g, bind1);
    if (opts?.multiParam) {
        return out;
    }
    // Single-param: normalise first-bind spellings across dialects
    if (/\$1\b/.test(out) || /@p1\b/i.test(out)) {
        out = out.replace(/\$1\b/g, bind1).replace(/@p1\b/gi, bind1);
    }
    else if (dialect !== "oracle" && /(^|[^:\w]):1\b/.test(out)) {
        out = out.replace(/(^|[^:\w]):1\b/g, `$1${bind1}`);
    }
    return out;
}
export { SqlLookupError };
