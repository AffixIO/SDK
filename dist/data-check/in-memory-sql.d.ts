/**
 * Pure-JS relational store for demos and offline tests.
 * Supports a small subset of SQL used by SqlStore lookups:
 *   CREATE TABLE name (col TYPE, …)
 *   INSERT INTO name (cols…) VALUES (…)
 *   SELECT * FROM name WHERE id_col = ?   (or $1)
 * Multiple statements via `;`. Comments with `--` and `/* … *\/`.
 * Not a full SQL engine; production use should wire pg / mysql2 / sqlite / ODBC.
 */
export type InMemoryTable = {
    columns: string[];
    rows: Array<Record<string, unknown>>;
};
/**
 * Pure-JS relational store for demos and offline tests.
 * Supports a small subset of SQL used by SqlStore lookups:
 *   CREATE TABLE name (col TYPE, …)
 *   INSERT INTO name (cols…) VALUES (…)
 *   SELECT * FROM name WHERE id_col = ?   (or $1)
 * Multiple statements via `;`. Comments with `--` and `/* … *\/`.
 * Not a full SQL engine; production use should wire pg / mysql2 / sqlite / ODBC.
 */
export declare class InMemorySqlDatabase {
    tables: Map<any, any>;
    exec(sqlScript: string): void;
    createTable(stmt: any): void;
    insert(stmt: any): void;
    /** SqlExecutor-compatible query (lookup path). */
    query(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
    static fromSqlScript(script: any): InMemorySqlDatabase;
}
