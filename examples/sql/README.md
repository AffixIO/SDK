# SQL connection recipes (pg / mysql / odbc)

Drivers are **not** bundled in `affixio`. Install the client your estate uses, then copy one of these scripts.

| File | Driver | Notes |
|------|--------|--------|
| `postgres.mjs` | `pg` | Primary + optional replica URLs |
| `mysql.mjs` | `mysql2` | Multi-param site filter example |
| `odbc.mjs` | `odbc` | DSN / legacy PAS |

## Behaviour contract

| Outcome | Meaning | Typical exit / code path |
|---------|---------|---------------------------|
| `lookup` → `null` | **No row** (id not found) | application not-found, exit 3 in examples |
| `SqlLookupError` `connection` / `pool` / `timeout` | **DB down / infra** | retriable; exit 2 |
| `SqlLookupError` `query` | Bad SQL / missing table | fix app SQL |
| `SqlLookupError` `readonly` | Non-SELECT on RO path | miswired write |

Use `store.lookupOutcome(query, { catchInfra: true })` for a tagged result without try/catch spaghetti.

## Env

```bash
export AFFIX_SQL_PRIMARY_URL=...
export AFFIX_SQL_REPLICA_URL=...   # optional
export AFFIX_SQL_TIMEOUT_MS=10000
export AFFIX_API_KEY=...
```

## Pattern (any driver)

```ts
import {
  createPgExecutor,
  createPrimaryReplicaExecutor,
  SqlStore,
  resolveSqlConnectionConfig,
} from "affixio";

const cfg = resolveSqlConnectionConfig({ dialect: "postgres" });
const executor = createPrimaryReplicaExecutor({
  primary: createPgExecutor(primaryPool, { timeoutMs: cfg.timeoutMs, readOnly: true }),
  replica: replicaPool
    ? createPgExecutor(replicaPool, { timeoutMs: cfg.timeoutMs, readOnly: true, role: "replica" })
    : undefined,
  preferReplica: true,
  failoverToPrimary: true,
});

const store = SqlStore.fromExecutor(executor, {
  table: "patients",
  dialect: "postgres",
  lookupSql: "SELECT id, status FROM patients WHERE id = :id LIMIT 1",
  // multi: bindParams: (q) => [q.id, site],
  readOnly: true,
  timeoutMs: 10_000,
});
```

Never concatenate `id` into SQL. Always bind.
