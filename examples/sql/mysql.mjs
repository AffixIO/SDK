/**
 * Copyable MySQL / MariaDB (mysql2/promise) + Affix SQL data-check.
 * Install: npm i mysql2
 *
 * Env:
 *   AFFIX_SQL_PRIMARY_URL  e.g. mysql://user:pass@primary:3306/pas
 *   AFFIX_SQL_REPLICA_URL  optional RO replica
 *   AFFIX_SQL_TIMEOUT_MS
 *   AFFIX_SQL_SITE         optional second bind filter
 *   AFFIX_API_KEY
 *
 * node examples/sql/mysql.mjs <record-id>
 */

import mysql from "mysql2/promise";
import {
  AffixSDK,
  SqlStore,
  createMysqlExecutor,
  createPrimaryReplicaExecutor,
  resolveSqlConnectionConfig,
  SqlLookupError,
} from "affixio";

const config = resolveSqlConnectionConfig({ dialect: "mysql" });
const id = process.argv[2] ?? "SQL-1001";

function poolFromUrl(url) {
  return mysql.createPool({
    uri: url,
    connectionLimit: config.poolMax ?? 10,
    connectTimeout: config.connectTimeoutMs ?? 5_000,
  });
}

if (!config.primaryUrl) {
  console.error("Set AFFIX_SQL_PRIMARY_URL");
  process.exit(1);
}

const primaryPool = poolFromUrl(config.primaryUrl);
const replicaPool = config.replicaUrl ? poolFromUrl(config.replicaUrl) : null;

const executor = createPrimaryReplicaExecutor({
  primary: createMysqlExecutor(primaryPool, {
    timeoutMs: config.timeoutMs,
    readOnly: true,
    role: "primary",
  }),
  replica: replicaPool
    ? createMysqlExecutor(replicaPool, {
        timeoutMs: config.timeoutMs,
        readOnly: true,
        role: "replica",
      })
    : undefined,
  preferReplica: config.preferReplica,
  failoverToPrimary: config.failoverToPrimary,
  dialect: "mysql",
  readOnly: true,
  timeoutMs: config.timeoutMs,
});

const siteFilter = process.env.AFFIX_SQL_SITE;

const store = SqlStore.fromExecutor(executor, {
  table: "patients",
  dialect: "mysql",
  readOnly: true,
  timeoutMs: config.timeoutMs,
  lookupSql: siteFilter
    ? "SELECT id, status, ward, site FROM patients WHERE id = ? AND site = ? LIMIT 1"
    : "SELECT id, status, ward, site FROM patients WHERE id = :id LIMIT 1",
  bindParams: siteFilter ? (q) => [q.id, siteFilter] : undefined,
});

const sdk = new AffixSDK({ apiKey: process.env.AFFIX_API_KEY ?? "demo-key" });

try {
  const outcome = await store.lookupOutcome(
    { id, claimField: "status", required: "in_ed", select: ["ward", "site"] },
    { catchInfra: true }
  );

  if (outcome.kind === "no_row") {
    console.log(JSON.stringify({ ok: false, reason: "no_row", id }, null, 2));
    process.exit(3);
  }
  if (outcome.kind === "db_error") {
    console.error(
      JSON.stringify(
        {
          ok: false,
          reason: "db_down_or_infra",
          is_db_down: outcome.error.isDbDown,
          error: outcome.error.toJSON(),
        },
        null,
        2
      )
    );
    process.exit(2);
  }

  const proved = await sdk.proveFromCheck({
    check: outcome.result,
    mode: "offline",
    queueForSync: false,
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        fields: proved.fields,
        decision: proved.decision,
        proof_id: proved.proof_id,
      },
      null,
      2
    )
  );
} catch (err) {
  if (err instanceof SqlLookupError) {
    console.error(JSON.stringify({ ok: false, error: err.toJSON() }, null, 2));
    process.exit(2);
  }
  throw err;
} finally {
  await primaryPool.end();
  if (replicaPool) await replicaPool.end();
}
