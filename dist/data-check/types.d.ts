/**
 * Data-check layer: query modern/legacy stores → exact fields → Affix yes/no prove.
 * Field values are always strings so results are byte-for-byte comparable.
 */
/** Every field is a string. Claim and required drive the yes/no circuit. */
export type DataCheckFields = {
    /** Value taken from the record (must match DB field exactly as stringified by adapter). */
    claim: string;
    /** Policy / required value compared for pass. */
    required: string;
    /** Additional named fields copied exactly from the store. */
    [key: string]: string;
};
export type DataCheckStyle = "modern" | "legacy";
export type DataCheckResult = {
    /** true only when fields.claim === fields.required (exact string equality). */
    pass: boolean;
    /** Exact field map used for prove; decision must use these strings unchanged. */
    fields: DataCheckFields;
    /** Adapter id, e.g. sql | json_document | dbase | xml_document */
    source: string;
    /** modern (SQL/document/KV) or legacy (CSV / fixed-width / dBase / pipe / LDIF / …) */
    style: DataCheckStyle;
    /** Record key if found */
    record_id?: string;
    /** Adapter-specific debug (no PII required) */
    meta?: Record<string, string>;
};
export type DataCheckQuery = {
    /** Lookup key (patient ref, primary key, etc.) */
    id: string;
    /**
     * Column / property for the claim value.
     * Default: "claim" then "status" then "value".
     */
    claimField?: string;
    /** Required policy string (exact). */
    required: string;
    /**
     * Extra columns/properties to include in fields (exact string values).
     * Always includes claim + required.
     */
    select?: string[];
};
export interface DataCheckSource {
    readonly name: string;
    readonly style: DataCheckStyle;
    lookup(query: DataCheckQuery): Promise<DataCheckResult | null>;
}
/**
 * Minimal SQL port: any RDBMS driver that can return row objects
 * (pg, mysql2, better-sqlite3, tedious, oracledb, node-odbc, …).
 */
export type SqlExecutor = {
    query(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>;
};
export type SqlDialect = "postgres" | "mysql" | "mariadb" | "mssql" | "oracle" | "sqlite" | "db2" | "odbc" | "generic";
export type ProveFromCheckInput = {
    /** Result of a data check, or async factory. */
    check: DataCheckResult | (() => Promise<DataCheckResult | null>);
    circuitId?: "simple_yesno" | "yesno";
    mode?: "auto" | "offline" | "online";
    /**
     * Queue this proof for Affix verify / merkle (same as any other prove).
     * Default: follow SDK queueUnsyncedProofs (usually true).
     */
    queueForSync?: boolean;
    /**
     * When true, after local prove call Affix verify + audit immediately
     * (same path as proveAndVerify). Requires online mode / connectivity.
     */
    verifyRemote?: boolean;
    requestAttestation?: boolean;
    /** Explicit request correlation id. Default: fresh UUID per call. */
    request_id?: string;
    secret?: string;
    context_id?: string;
    /** Credential scaffolding (claim_value is overwritten by check.fields.claim). */
    schema_id?: string;
    issuer_id?: string;
    issuer_pubkey_hash?: string;
    credential_id?: string;
    valid_from?: number;
    valid_until?: number;
};
