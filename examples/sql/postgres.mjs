/**
 * Copyable PostgreSQL (pg) + Affix SQL data-check.
 * Install: npm i pg  (not required by affixio itself)
 *
 * Env:
 *   AFFIX_SQL_PRIMARY_URL  e.g. postgresql://user:pass@primary:5432/pas
 *   AFFIX_SQL_REPLICA_URL  e.g. postgresql://user:pass@replica:5432/pas  (optional RO)
 *   AFFIX_SQL_TIMEOUT_MS   default 10000
 *   AFFIX_API_KEY
 *
 * node examples/sql/postgres.mjs <record-id>
 */

import pg from "pg";
import {
  AffixSDK,
  SqlStore,
  createPgExecutor,
  createPrimaryReplicaExecutor,
  resolveSqlConnectionConfig,
  SqlLookupError,
} from "affixio";

const config = resolveSqlConnectionConfig({ dialect: "postgres" });
const id = process.argv[2] ?? "SQL-1001";

const primaryPool = new pg.Pool({
  connectionString: config.primaryUrl,
  max: config.poolMax ?? 10,
  connectionTimeoutMillis: config.connectTimeoutMs ?? 5_000,
});
primaryPool.on("connect", (client) => {
  // Server-side statement timeout (ms as string for postgres)
  client.query(`SET statement_timeout = ${config.timeoutMs ?? 10_000}`).catch(() => {});
});

const replicaPool = config.replicaUrl
  ? new pg.Pool({
      connectionString: config.replicaUrl,
      max: config.poolMax ?? 10,
      connectionTimeoutMillis: config.connectTimeoutMs ?? 5_000,
    })
  : null;

if (replicaPool) {
  replicaPool.on("connect", (client) => {
    client.query(`SET default_transaction_read_only = on`).catch(() => {});
    client.query(`SET statement_timeout = ${config.timeoutMs ?? 10_000}`).catch(() => {});
  });
}

const executor = createPrimaryReplicaExecutor({
  primary: createPgExecutor(primaryPool, {
    timeoutMs: config.timeoutMs,
    readOnly: true,
    role: "primary",
  }),
  replica: replicaPool
    ? createPgExecutor(replicaPool, {
        timeoutMs: config.timeoutMs,
        readOnly: true,
        role: "replica",
      })
    : undefined,
  preferReplica: config.preferReplica,
  failoverToPrimary: config.failoverToPrimary,
  dialect: "postgres",
  readOnly: true,
  timeoutMs: config.timeoutMs,
});

const store = SqlStore.fromExecutor(executor, {
  table: "patients",
  dialect: "postgres",
  readOnly: true,
  timeoutMs: config.timeoutMs,
  // Parameterised custom SQL — never string-concat the id
  lookupSql:
    "SELECT id, status, ward, site FROM patients WHERE id = :id LIMIT 1",
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

  const check = outcome.result;
  const proved = await sdk.proveFromCheck({
    check,
    mode: "offline",
    queueForSync: false,
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        fields: proved.fields,
        decision: proved.decision,
        field_aligned: proved.field_aligned,
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
