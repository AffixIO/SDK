export { exactFieldString, stringsEqualExact, buildCheckResult, fieldsExactMatch, resolveClaimField, } from "./map-check.js";
export { JsonDocumentStore } from "./adapters/json-document.js";
export { KeyValueStore } from "./adapters/key-value.js";
export { CsvTableStore, parseCsvLine } from "./adapters/csv-table.js";
export { FixedWidthStore } from "./adapters/fixed-width.js";
export { PipeDelimitedStore } from "./adapters/pipe-delimited.js";
export { SqlStore, prepareLookupSql, bindPlaceholder, quoteIdent, qualifyTable, } from "./adapters/sql.js";
export { SqlLookupError, classifySqlError, outcomeFromLookup, } from "./sql-errors.js";
export { wrapSqlExecutor, withQueryTimeout, createPrimaryReplicaExecutor, assertSelectOnly, } from "./sql-executor.js";
export { createPgExecutor, createMysqlExecutor, createOdbcExecutor, resolveSqlConnectionConfig, } from "./sql-connections.js";
export { InMemorySqlDatabase } from "./in-memory-sql.js";
export { MongoDocumentStore } from "./adapters/mongo-document.js";
export { XmlDocumentStore } from "./adapters/xml-document.js";
export { DbaseStore, parseDbf } from "./adapters/dbase.js";
export { LdifStore } from "./adapters/ldif.js";
export { DelimitedTableStore } from "./adapters/delimited.js";
export { IniSectionStore } from "./adapters/ini-section.js";
export { RedisExportStore } from "./adapters/redis-export.js";
export { openDataStore, DATA_STORE_KINDS, } from "./open-store.js";
/** Run a lookup against any wired source. */
export async function runDataCheck(source, query) {
    return source.lookup(query);
}
