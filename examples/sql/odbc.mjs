/**
 * Copyable ODBC (node-odbc) + Affix SQL data-check — classic PAS / mainframe estates.
 * Install: npm i odbc   (system ODBC driver + DSN required)
 *
 * Env:
 *   AFFIX_SQL_PRIMARY_URL or ODBC_DSN  e.g. DSN=TrustPas;UID=ro;PWD=...
 *   AFFIX_SQL_TIMEOUT_MS
 *   AFFIX_API_KEY
 *
 * node examples/sql/odbc.mjs <record-id>
 */

import odbc from "odbc";
import {
  AffixSDK,
  SqlStore,
  createOdbcExecutor,
  resolveSqlConnectionConfig,
  SqlLookupError,
} from "affixio";

const config = resolveSqlConnectionConfig({ dialect: "odbc" });
const dsn = config.primaryUrl ?? process.env.ODBC_DSN;
const id = process.argv[2] ?? "ORA-01";

if (!dsn) {
  console.error("Set AFFIX_SQL_PRIMARY_URL or ODBC_DSN");
  process.exit(1);
}

const conn = await odbc.connect(dsn);
// Prefer a RO DSN user in real estates. SDK still blocks non-SELECT when readOnly: true.

const executor = createOdbcExecutor(conn, {
  timeoutMs: config.timeoutMs ?? 15_000,
  readOnly: true,
  role: "replica",
  dialect: "odbc",
});

const store = SqlStore.fromExecutor(executor, {
  table: "HOSP.PATIENT",
  dialect: "odbc",
  style: "legacy",
  readOnly: true,
  timeoutMs: config.timeoutMs ?? 15_000,
  role: "replica",
  // Parameterised — ? bound as first param (query.id)
  lookupSql:
    "SELECT id, status, ward, site FROM HOSP.PATIENT WHERE id = ?",
});

const sdk = new AffixSDK({ apiKey: process.env.AFFIX_API_KEY ?? "demo-key" });

try {
  const outcome = await store.lookupOutcome(
    {
      id,
      claimField: "status",
      required: "in_ed",
      select: ["ward", "site"],
    },
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
  await conn.close();
}
