/**
 * Pure-JS relational store for demos and offline tests.
 * Supports a small subset of SQL used by SqlStore lookups:
 *   CREATE TABLE name (col TYPE, …)
 *   INSERT INTO name (cols…) VALUES (…)
 *   SELECT * FROM name WHERE id_col = ?   (or $1)
 * Multiple statements via `;`. Comments with `--` and `/* … *\/`.
 * Not a full SQL engine; production use should wire pg / mysql2 / sqlite / ODBC.
 */
export class InMemorySqlDatabase {
    tables = new Map();
    exec(sqlScript) {
        const cleaned = stripSqlComments(sqlScript);
        const statements = splitStatements(cleaned);
        for (const raw of statements) {
            const stmt = raw.trim();
            if (!stmt)
                continue;
            const upper = stmt.toUpperCase();
            if (upper.startsWith("CREATE TABLE")) {
                this.createTable(stmt);
            }
            else if (upper.startsWith("INSERT INTO")) {
                this.insert(stmt);
            }
            else if (upper.startsWith("SELECT")) {
                // ignore bare selects in scripts
            }
            else {
                throw new Error(`in_memory_sql_unsupported:${stmt.slice(0, 40)}`);
            }
        }
    }
    createTable(stmt) {
        const m = stmt.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[]?\w+[`"\]]?)\s*\(([\s\S]+)\)\s*$/i);
        if (!m)
            throw new Error(`create_table_parse_failed:${stmt.slice(0, 60)}`);
        const name = unquoteIdent(m[1]);
        const body = m[2];
        const columns = [];
        for (const part of splitTopLevel(body, ",")) {
            const col = part.trim();
            if (!col)
                continue;
            if (/^(PRIMARY|UNIQUE|CONSTRAINT|FOREIGN|CHECK|KEY)\b/i.test(col))
                continue;
            const cm = col.match(/^[`"[]?(\w+)[`"\]]?/);
            if (!cm)
                continue;
            columns.push(cm[1]);
        }
        if (!columns.length)
            throw new Error(`create_table_no_columns:${name}`);
        this.tables.set(name.toLowerCase(), { columns, rows: [] });
    }
    insert(stmt) {
        const m = stmt.match(/^INSERT\s+INTO\s+([`"[]?\w+[`"\]]?)\s*(?:\(([^)]*)\))?\s*VALUES\s*\(([\s\S]+)\)\s*$/i);
        if (!m)
            throw new Error(`insert_parse_failed:${stmt.slice(0, 60)}`);
        const name = unquoteIdent(m[1]).toLowerCase();
        const table = this.tables.get(name);
        if (!table)
            throw new Error(`insert_unknown_table:${name}`);
        const cols = m[2]
            ? splitTopLevel(m[2], ",").map((c) => unquoteIdent(c.trim()))
            : [...table.columns];
        const vals = splitTopLevel(m[3], ",").map((v) => parseSqlLiteral(v.trim()));
        if (cols.length !== vals.length) {
            throw new Error(`insert_column_value_mismatch:${name}`);
        }
        const row = {};
        for (let i = 0; i < cols.length; i++) {
            row[cols[i]] = vals[i];
        }
        table.rows.push(row);
    }
    /** SqlExecutor-compatible query (lookup path). */
    async query(sql, params = []) {
        const normalised = sql
            .replace(/["`\[\]]/g, "")
            .replace(/\s+/g, " ")
            .trim();
        const m = normalised.match(/^SELECT \* FROM (\w+(?:\.\w+)?) WHERE (\w+) = (?:\?|\$1|:id|:1|@p1)\s*$/i);
        if (!m) {
            throw new Error(`in_memory_sql_select_unsupported: only SELECT * FROM t WHERE col = ? supported (got ${sql.slice(0, 80)})`);
        }
        const tableName = m[1].toLowerCase().split(".").pop();
        const col = m[2];
        const table = this.tables.get(tableName);
        if (!table)
            return [];
        // Match column case-insensitively (Oracle-style unquoted uppercasing)
        const colKey = table.columns.find((c) => c === col) ??
            table.columns.find((c) => c.toLowerCase() === col.toLowerCase()) ??
            col;
        const want = params[0] === undefined || params[0] === null ? "" : String(params[0]);
        return table.rows
            .filter((r) => {
            const val = r[colKey] ?? r[col] ?? r[col.toUpperCase()] ?? r[col.toLowerCase()];
            return String(val ?? "") === want;
        })
            .map((r) => ({ ...r }));
    }
    static fromSqlScript(script) {
        const db = new InMemorySqlDatabase();
        db.exec(script);
        return db;
    }
}
function stripSqlComments(sql) {
    let out = sql.replace(/\/\*[\s\S]*?\*\//g, " ");
    out = out.replace(/--[^\n]*/g, " ");
    return out;
}
function splitStatements(sql) {
    const parts = [];
    let cur = "";
    let inStr = null;
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (inStr) {
            cur += ch;
            if (ch === inStr) {
                if (sql[i + 1] === inStr) {
                    cur += sql[++i];
                }
                else {
                    inStr = null;
                }
            }
            continue;
        }
        if (ch === "'" || ch === '"') {
            inStr = ch;
            cur += ch;
            continue;
        }
        if (ch === ";") {
            parts.push(cur);
            cur = "";
            continue;
        }
        cur += ch;
    }
    if (cur.trim())
        parts.push(cur);
    return parts;
}
function splitTopLevel(s, delim) {
    const out = [];
    let cur = "";
    let depth = 0;
    let inStr = null;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            cur += ch;
            if (ch === inStr) {
                if (s[i + 1] === inStr) {
                    cur += s[++i];
                }
                else {
                    inStr = null;
                }
            }
            continue;
        }
        if (ch === "'" || ch === '"') {
            inStr = ch;
            cur += ch;
            continue;
        }
        if (ch === "(") {
            depth++;
            cur += ch;
            continue;
        }
        if (ch === ")") {
            depth--;
            cur += ch;
            continue;
        }
        if (ch === delim && depth === 0) {
            out.push(cur);
            cur = "";
            continue;
        }
        cur += ch;
    }
    if (cur.length)
        out.push(cur);
    return out;
}
function unquoteIdent(id) {
    const t = id.trim();
    if ((t.startsWith('"') && t.endsWith('"')) ||
        (t.startsWith("`") && t.endsWith("`")) ||
        (t.startsWith("[") && t.endsWith("]"))) {
        return t.slice(1, -1);
    }
    return t;
}
function parseSqlLiteral(token) {
    if (/^null$/i.test(token))
        return null;
    if (/^true$/i.test(token))
        return true;
    if (/^false$/i.test(token))
        return false;
    if ((token.startsWith("'") && token.endsWith("'")) ||
        (token.startsWith('"') && token.endsWith('"'))) {
        const q = token[0];
        return token.slice(1, -1).replace(new RegExp(q + q, "g"), q);
    }
    if (/^-?\d+$/.test(token))
        return token; // keep as string-stable digits for exactness path via exactFieldString
    if (/^-?\d+\.\d+$/.test(token))
        return token;
    return token;
}
