import { Console, Effect } from "effect"
import type { Pool } from "pg"

import { persistenceError, type NetworkError } from "../errors.js"
import { makePgPool } from "../index.js"
import {
  expectedReferenceSchemaTables,
  loadPostgresMigrations,
} from "../services/postgres-migrations.js"

const databaseUrl = process.env.QRTRUST_NETWORK_DATABASE_URL

interface AppliedMigrationRow {
  readonly migration_id: string
  readonly description: string
  readonly checksum: string
  readonly applied_at: Date | string
}

const inspectMigrations = (connectionString: string) =>
  withPgPool(connectionString, (pool) =>
    Effect.gen(function* () {
      const migrations = loadPostgresMigrations()
      const schemaExists = yield* exists(
        pool,
        "migrations.schema_exists",
        `
select exists (
  select 1
  from information_schema.schemata
  where schema_name = 'qr_trust'
) as exists
`,
      )
      const ledgerExists = schemaExists
        ? yield* exists(
            pool,
            "migrations.ledger_exists",
            `
select exists (
  select 1
  from information_schema.tables
  where table_schema = 'qr_trust'
    and table_name = 'schema_migrations'
    and table_type = 'BASE TABLE'
) as exists
`,
          )
        : false
      const installedTables = schemaExists ? yield* fetchQrTrustTables(pool) : []
      const appliedMigrations = ledgerExists
        ? yield* fetchAppliedMigrations(pool)
        : []
      const appliedById = new Map(
        appliedMigrations.map((row) => [row.migration_id, row]),
      )
      const expectedMigrationIds = new Set(
        migrations.map((migration) => migration.migration_id),
      )
      const migrationStatuses = migrations.map((migration) => {
        const applied = appliedById.get(migration.migration_id)

        if (!applied) {
          return {
            migration_id: migration.migration_id,
            status: "pending",
            checksum: migration.checksum,
          }
        }

        return {
          migration_id: migration.migration_id,
          status:
            applied.checksum === migration.checksum ? "applied" : "drifted",
          checksum: migration.checksum,
          applied_checksum: applied.checksum,
          applied_at: applied.applied_at,
        }
      })
      const unknownLedgerRows = appliedMigrations
        .filter((row) => !expectedMigrationIds.has(row.migration_id))
        .map((row) => row.migration_id)
      const missingTables = expectedReferenceSchemaTables.filter(
        (tableName) => !installedTables.includes(tableName),
      )
      const blockingReasons = [
        ...(!schemaExists ? ["qr_trust schema is missing"] : []),
        ...(!ledgerExists ? ["schema_migrations ledger is missing"] : []),
        ...migrationStatuses
          .filter((migration) => migration.status !== "applied")
          .map(
            (migration) =>
              `migration ${migration.migration_id} is ${migration.status}`,
          ),
        ...(unknownLedgerRows.length > 0
          ? [
              `schema_migrations has unknown rows: ${unknownLedgerRows.join(
                ", ",
              )}`,
            ]
          : []),
        ...(missingTables.length > 0
          ? [`qr_trust is missing tables: ${missingTables.join(", ")}`]
          : []),
      ]
      const ready = blockingReasons.length === 0

      yield* Console.log(
        JSON.stringify(
          {
            postgres_migrations: ready ? "ready" : "not_ready",
            schema: "qr_trust",
            read_only: true,
            schema_exists: schemaExists,
            ledger_exists: ledgerExists,
            installed_tables: installedTables.length,
            expected_tables: expectedReferenceSchemaTables.length,
            missing_tables: missingTables,
            unknown_ledger_rows: unknownLedgerRows,
            migrations: migrationStatuses,
            blocking_reasons: blockingReasons,
          },
          null,
          2,
        ),
      )

      yield* markProcessNotReady(ready)
    }),
  )

const withPgPool = <A>(
  connectionString: string,
  use: (pool: Pool) => Effect.Effect<A, NetworkError>,
): Effect.Effect<A, NetworkError> =>
  Effect.acquireUseRelease(
    Effect.sync(() => makePgPool({ connectionString, max: 1 })),
    use,
    (pool) =>
      Effect.tryPromise({
        try: () => pool.end(),
        catch: (cause) =>
          persistenceError("Postgres pool shutdown failed.", cause),
      }).pipe(Effect.orDie),
  )

const exists = (
  pool: Pool,
  name: string,
  text: string,
): Effect.Effect<boolean, NetworkError> =>
  Effect.tryPromise({
    try: async () => {
      const result = await pool.query<{ readonly exists: boolean }>(text)
      return result.rows[0]?.exists === true
    },
    catch: (cause) => persistenceError(`Postgres command ${name} failed.`, cause),
  })

const fetchAppliedMigrations = (
  pool: Pool,
): Effect.Effect<ReadonlyArray<AppliedMigrationRow>, NetworkError> =>
  Effect.tryPromise({
    try: async () => {
      const result = await pool.query<AppliedMigrationRow>(`
select migration_id, description, checksum, applied_at
from qr_trust.schema_migrations
order by migration_id asc
`)
      return result.rows
    },
    catch: (cause) =>
      persistenceError("Postgres schema migration inventory failed.", cause),
  })

const fetchQrTrustTables = (
  pool: Pool,
): Effect.Effect<ReadonlyArray<string>, NetworkError> =>
  Effect.tryPromise({
    try: async () => {
      const result = await pool.query<{ readonly table_name: string }>(`
select table_name
from information_schema.tables
where table_schema = 'qr_trust'
  and table_type = 'BASE TABLE'
order by table_name asc
`)
      return result.rows.map((row) => row.table_name)
    },
    catch: (cause) =>
      persistenceError("Postgres qr_trust table inventory failed.", cause),
  })

const markProcessNotReady = (ready: boolean): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!ready) {
      process.exitCode = 1
    }
  })

const skipped = (reason: string): Effect.Effect<void> =>
  Console.log(
    JSON.stringify(
      {
        postgres_migrations: "skipped",
        read_only: true,
        reason,
      },
      null,
      2,
    ),
  )

const program = databaseUrl
  ? inspectMigrations(databaseUrl)
  : skipped("Set QRTRUST_NETWORK_DATABASE_URL to inspect Postgres migrations.")

const statusErrorMessage = (cause: NetworkError | unknown): string => {
  if (isNetworkError(cause)) {
    return cause.message
  }

  if (cause instanceof Error) {
    return cause.message
  }

  return String(cause)
}

const isNetworkError = (cause: unknown): cause is NetworkError =>
  typeof cause === "object" &&
  cause !== null &&
  "_tag" in cause &&
  "message" in cause

Effect.runPromise(program).catch((cause: NetworkError | unknown) => {
  console.error(
    JSON.stringify(
      {
        postgres_migrations: "not_ready",
        read_only: true,
        inspection_failed: true,
        blocking_reasons: [
          `Postgres migration status inspection failed: ${statusErrorMessage(
            cause,
          )}`,
        ],
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})
