import { Console, Effect } from "effect"
import type { Pool, PoolClient } from "pg"

import { persistenceError, type NetworkError } from "../errors.js"
import { makePgPool } from "../index.js"
import {
  expectedReferenceSchemaTables,
  loadPostgresMigrations,
  type LoadedPostgresMigration,
} from "../services/postgres-migrations.js"

const databaseUrl = process.env.QRTRUST_NETWORK_DATABASE_URL

interface AppliedMigrationRow {
  readonly migration_id: string
  readonly checksum: string
}

const applyMigrations = (connectionString: string) =>
  withPgPool(connectionString, (pool) =>
    Effect.gen(function* () {
      const migrations = loadPostgresMigrations()

      yield* runPoolCommand(
        pool,
        "migrations.ensure_ledger",
        migrationLedgerSql,
      )

      const report: Array<{
        readonly migration_id: string
        readonly status: "applied" | "already_applied"
        readonly checksum: string
      }> = []

      for (const migration of migrations) {
        const existing = yield* fetchAppliedMigration(
          pool,
          migration.migration_id,
        )

        if (existing) {
          yield* assertApplied(
            existing.checksum === migration.checksum,
            `migration ${migration.migration_id} was already applied with checksum ${existing.checksum}, not ${migration.checksum}`,
          )
          report.push({
            migration_id: migration.migration_id,
            status: "already_applied",
            checksum: migration.checksum,
          })
          continue
        }

        yield* applyMigration(pool, migration)
        report.push({
          migration_id: migration.migration_id,
          status: "applied",
          checksum: migration.checksum,
        })
      }

      const installedTables = yield* fetchQrTrustTables(pool)
      const missingTables = expectedReferenceSchemaTables.filter(
        (tableName) => !installedTables.includes(tableName),
      )

      yield* assertApplied(
        missingTables.length === 0,
        `migration-managed schema is missing tables: ${missingTables.join(", ")}`,
      )

      yield* Console.log(
        JSON.stringify(
          {
            postgres_migrations: "passed",
            schema: "qr_trust",
            reset_schema: false,
            installed_tables: installedTables.length,
            expected_tables: expectedReferenceSchemaTables.length,
            migrations: report,
          },
          null,
          2,
        ),
      )
    }),
  )

const migrationLedgerSql = `
create schema if not exists qr_trust;

create table if not exists qr_trust.schema_migrations (
  migration_id text primary key,
  description text not null,
  checksum text not null,
  applied_at timestamptz not null default now()
);
`

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

const runPoolCommand = (
  pool: Pool,
  name: string,
  text: string,
  values: ReadonlyArray<unknown> = [],
): Effect.Effect<void, NetworkError> =>
  Effect.tryPromise({
    try: () => pool.query(text, [...values]).then(() => undefined),
    catch: (cause) => persistenceError(`Postgres command ${name} failed.`, cause),
  })

const applyMigration = (
  pool: Pool,
  migration: LoadedPostgresMigration,
): Effect.Effect<void, NetworkError> =>
  Effect.acquireUseRelease(
    connectClient(pool),
    (client) =>
      Effect.gen(function* () {
        yield* runClientCommand(client, "migrations.transaction.begin", "begin")
        yield* runClientCommand(
          client,
          `migrations.apply.${migration.migration_id}`,
          migration.sql,
        )
        yield* runClientCommand(
          client,
          `migrations.record.${migration.migration_id}`,
          `
insert into qr_trust.schema_migrations (
  migration_id,
  description,
  checksum
) values ($1, $2, $3)
`,
          [
            migration.migration_id,
            migration.description,
            migration.checksum,
          ],
        )
        yield* runClientCommand(client, "migrations.transaction.commit", "commit")
      }).pipe(
        Effect.catchAll((error) =>
          runClientCommand(
            client,
            "migrations.transaction.rollback",
            "rollback",
          ).pipe(
            Effect.catchAll(() => Effect.void),
            Effect.flatMap(() => Effect.fail(error)),
          ),
        ),
      ),
    (client) => Effect.sync(() => client.release()),
  )

const connectClient = (pool: Pool): Effect.Effect<PoolClient, NetworkError> =>
  Effect.tryPromise({
    try: () => pool.connect(),
    catch: (cause) => persistenceError("Postgres connection failed.", cause),
  })

const runClientCommand = (
  client: PoolClient,
  name: string,
  text: string,
  values: ReadonlyArray<unknown> = [],
): Effect.Effect<void, NetworkError> =>
  Effect.tryPromise({
    try: () => client.query(text, [...values]).then(() => undefined),
    catch: (cause) => persistenceError(`Postgres command ${name} failed.`, cause),
  })

const fetchAppliedMigration = (
  pool: Pool,
  migrationId: string,
): Effect.Effect<AppliedMigrationRow | undefined, NetworkError> =>
  Effect.tryPromise({
    try: async () => {
      const result = await pool.query<AppliedMigrationRow>(
        `
select migration_id, checksum
from qr_trust.schema_migrations
where migration_id = $1
`,
        [migrationId],
      )

      return result.rows[0]
    },
    catch: (cause) =>
      persistenceError("Postgres schema migration lookup failed.", cause),
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

const assertApplied = (
  condition: boolean,
  message: string,
): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Postgres migration apply failed: ${message}`)
    }
  })

const skipped = (reason: string): Effect.Effect<void> =>
  Console.log(
    JSON.stringify(
      {
        postgres_migrations: "skipped",
        reason,
      },
      null,
      2,
    ),
  )

const program = databaseUrl
  ? applyMigrations(databaseUrl)
  : skipped("Set QRTRUST_NETWORK_DATABASE_URL to apply Postgres migrations.")

Effect.runPromise(program)
