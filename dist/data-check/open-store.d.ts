import type { DataCheckSource, SqlDialect } from "./types.js";
import type { FixedFieldDef } from "./adapters/fixed-width.js";
export type DataStoreKind = (typeof DATA_STORE_KINDS)[number];
export type OpenDataStoreOptions = {
    kind: DataStoreKind | string;
    /** File path for file-backed stores / SQL scripts */
    path?: string;
    /** Live SQL executor (pg, mysql2, odbc, InMemorySqlDatabase, …) */
    executor?: {
        query: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>;
    };
    table?: string;
    idColumn?: string;
    idField?: string;
    schema?: string;
    dialect?: SqlDialect;
    claimField?: string;
    delimiter?: string;
    fixedFields?: FixedFieldDef[];
    skipHeader?: boolean;
    recordTag?: string;
    style?: "modern" | "legacy";
    name?: string;
    lookupSql?: string;
    /** Bind factory for parameterised lookupSql. Default [query.id]. */
    bindParams?: (query: import("./types.js").DataCheckQuery) => unknown[];
    /** SDK query deadline (ms). */
    timeoutMs?: number;
    /** Prefer SELECT-only + RO meta. Default true for live executors. */
    readOnly?: boolean;
    role?: "primary" | "replica";
};
/** Known adapter catalogue (historic + modern). */
export declare const DATA_STORE_KINDS: string[];
/**
 * Open any supported database style from a single options object.
 * Live RDBMS: pass `executor` + kind sql|postgres|mysql|….
 * Files: pass `path` + kind matching format.
 */
export declare function openDataStore(options: OpenDataStoreOptions): DataCheckSource;
