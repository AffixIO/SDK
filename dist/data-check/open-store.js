import { existsSync, readFileSync } from "node:fs";
import { JsonDocumentStore } from "./adapters/json-document.js";
import { KeyValueStore } from "./adapters/key-value.js";
import { CsvTableStore } from "./adapters/csv-table.js";
import { FixedWidthStore } from "./adapters/fixed-width.js";
import { PipeDelimitedStore } from "./adapters/pipe-delimited.js";
import { SqlStore } from "./adapters/sql.js";
import { InMemorySqlDatabase } from "./in-memory-sql.js";
import { MongoDocumentStore } from "./adapters/mongo-document.js";
import { XmlDocumentStore } from "./adapters/xml-document.js";
import { DbaseStore } from "./adapters/dbase.js";
import { LdifStore } from "./adapters/ldif.js";
import { DelimitedTableStore } from "./adapters/delimited.js";
import { IniSectionStore } from "./adapters/ini-section.js";
import { RedisExportStore } from "./adapters/redis-export.js";
/** Known adapter catalogue (historic + modern). */
export const DATA_STORE_KINDS = [
    // modern SQL / document
    "sql",
    "postgres",
    "mysql",
    "mariadb",
    "sqlite",
    "mssql",
    "sql_script",
    "json",
    "json_document",
    "mongo",
    "mongo_document",
    "ndjson",
    "key_value",
    "redis",
    "redis_export",
    // legacy SQL / files
    "oracle",
    "db2",
    "odbc",
    "csv",
    "tsv",
    "pipe",
    "pipe_delimited",
    "semicolon",
    "delimited",
    "fixed_width",
    "dbase",
    "dbf",
    "xml",
    "ldif",
    "ini",
];
/**
 * Open any supported database style from a single options object.
 * Live RDBMS: pass `executor` + kind sql|postgres|mysql|….
 * Files: pass `path` + kind matching format.
 */
export function openDataStore(options) {
    const kind = String(options.kind).toLowerCase().replace(/-/g, "_");
    switch (kind) {
        case "sql":
        case "postgres":
        case "mysql":
        case "mariadb":
        case "sqlite":
        case "mssql":
        case "oracle":
        case "db2":
        case "odbc": {
            const dialect = (options.dialect ??
                (kind === "sql" ? "generic" : kind));
            if (options.path && !options.executor) {
                // SQL DDL/DML script → in-memory engine (demo / offline)
                const script = readFileSync(options.path, "utf8");
                const db = InMemorySqlDatabase.fromSqlScript(script);
                return new SqlStore(db, {
                    table: options.table ?? "patients",
                    idColumn: options.idColumn ?? "id",
                    schema: options.schema,
                    dialect: dialect === "generic" ? "sqlite" : dialect,
                    style: options.style,
                    name: options.name,
                    lookupSql: options.lookupSql,
                    bindParams: options.bindParams,
                    timeoutMs: options.timeoutMs,
                    readOnly: options.readOnly,
                    role: options.role,
                });
            }
            if (!options.executor) {
                throw new Error(`openDataStore(${kind}): executor or path (SQL script) required`);
            }
            return new SqlStore(options.executor, {
                table: options.table ?? "patients",
                idColumn: options.idColumn ?? "id",
                schema: options.schema,
                dialect,
                style: options.style,
                name: options.name,
                lookupSql: options.lookupSql,
                bindParams: options.bindParams,
                timeoutMs: options.timeoutMs,
                readOnly: options.readOnly ?? true,
                role: options.role,
            });
        }
        case "sql_script": {
            if (!options.path)
                throw new Error("openDataStore(sql_script): path required");
            const db = InMemorySqlDatabase.fromSqlScript(readFileSync(options.path, "utf8"));
            return new SqlStore(db, {
                table: options.table ?? "patients",
                idColumn: options.idColumn ?? "id",
                dialect: "sqlite",
                style: "modern",
                name: options.name ?? "sql_script",
                lookupSql: options.lookupSql,
                bindParams: options.bindParams,
                timeoutMs: options.timeoutMs,
            });
        }
        case "json":
        case "json_document":
            return requirePath(options, JsonDocumentStore.fromFile);
        case "mongo":
        case "mongo_document":
        case "ndjson":
            if (!options.path)
                throw new Error("openDataStore(mongo): path required");
            return MongoDocumentStore.fromFile(options.path, { idField: options.idField ?? "_id" });
        case "key_value":
            return requirePath(options, KeyValueStore.fromFile);
        case "redis":
        case "redis_export":
            if (!options.path)
                throw new Error("openDataStore(redis): path required");
            return RedisExportStore.fromFile(options.path);
        case "csv":
            if (!options.path)
                throw new Error("openDataStore(csv): path required");
            return CsvTableStore.fromFile(options.path, {
                delimiter: options.delimiter ?? ",",
                idColumn: options.idColumn,
            });
        case "tsv":
            if (!options.path)
                throw new Error("openDataStore(tsv): path required");
            return CsvTableStore.fromFile(options.path, {
                delimiter: "\t",
                idColumn: options.idColumn,
            });
        case "pipe":
        case "pipe_delimited":
            if (!options.path)
                throw new Error("openDataStore(pipe): path required");
            return PipeDelimitedStore.fromFile(options.path, { idColumn: options.idColumn });
        case "semicolon":
            if (!options.path)
                throw new Error("openDataStore(semicolon): path required");
            return DelimitedTableStore.fromFile(options.path, {
                delimiter: ";",
                idColumn: options.idColumn,
                name: "delimited_semicolon",
                style: "legacy",
            });
        case "delimited":
            if (!options.path)
                throw new Error("openDataStore(delimited): path required");
            if (!options.delimiter)
                throw new Error("openDataStore(delimited): delimiter required");
            return DelimitedTableStore.fromFile(options.path, {
                delimiter: options.delimiter,
                idColumn: options.idColumn,
                name: options.name,
                style: options.style ?? "legacy",
            });
        case "fixed_width":
            if (!options.path)
                throw new Error("openDataStore(fixed_width): path required");
            if (!options.fixedFields?.length)
                throw new Error("openDataStore(fixed_width): fixedFields required");
            return FixedWidthStore.fromFile(options.path, options.fixedFields, {
                idField: options.idField ?? options.idColumn ?? "id",
                skipHeader: options.skipHeader,
            });
        case "dbase":
        case "dbf":
            if (!options.path)
                throw new Error("openDataStore(dbase): path required");
            return DbaseStore.fromFile(options.path, { idField: options.idField ?? options.idColumn });
        case "xml":
            if (!options.path)
                throw new Error("openDataStore(xml): path required");
            return XmlDocumentStore.fromFile(options.path, {
                idField: options.idField ?? options.idColumn,
                recordTag: options.recordTag,
                style: options.style ?? "legacy",
            });
        case "ldif":
            if (!options.path)
                throw new Error("openDataStore(ldif): path required");
            return LdifStore.fromFile(options.path, { idAttr: options.idField ?? "uid" });
        case "ini":
            if (!options.path)
                throw new Error("openDataStore(ini): path required");
            return IniSectionStore.fromFile(options.path);
        default:
            throw new Error(`openDataStore_unknown_kind:${kind}. Supported: ${DATA_STORE_KINDS.join(", ")}`);
    }
}
function requirePath(options, factory) {
    if (!options.path || !existsSync(options.path)) {
        throw new Error(`openDataStore: path required and must exist (${options.path ?? ""})`);
    }
    return factory(options.path);
}
