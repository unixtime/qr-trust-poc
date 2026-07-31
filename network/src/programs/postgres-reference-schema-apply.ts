import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { Console, Effect } from "effect"
import type { Pool } from "pg"

import { makePgPool } from "../index.js"
import { persistenceError, type NetworkError } from "../errors.js"

const databaseUrl = process.env.QRTRUST_NETWORK_DATABASE_URL

const expectedTables = [
  "artifact_publication_work_items",
  "delegated_authorities",
  "destination_policies",
  "event_outbox",
  "issuer_certificates",
  "issuer_domain_proofs",
  "issuers",
  "published_artifacts",
  "root_programs",
  "runtime_observations",
  "scanner_decisions",
  "status_events",
  "trust_keys",
  "verifier_cache_entries",
  "verifier_cache_work_items",
] as const

const applyReferenceSchema = (connectionString: string) =>
  withPgPool(connectionString, (pool) =>
    Effect.gen(function* () {
      const schemaSql = readFileSync(referenceSchemaPath(), "utf8")

      yield* runPoolCommand(
        pool,
        "reference_schema.apply_idempotent",
        schemaSql,
      )

      const installedTables = yield* fetchQrTrustTables(pool)
      const missingTables = expectedTables.filter(
        (tableName) => !installedTables.includes(tableName),
      )

      yield* assertApplied(
        missingTables.length === 0,
        `reference schema is missing tables: ${missingTables.join(", ")}`,
      )

      yield* Console.log(
        JSON.stringify(
          {
            reference_schema_apply: "passed",
            schema: "qr_trust",
            reset_schema: false,
            installed_tables: installedTables.length,
            expected_tables: expectedTables.length,
          },
          null,
          2,
        ),
      )
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

const referenceSchemaPath = (): string =>
  resolve(
    process.cwd(),
    "../docs/public/network-contracts/reference-postgres-schema.sql",
  )

const runPoolCommand = (
  pool: Pool,
  name: string,
  text: string,
): Effect.Effect<void, NetworkError> =>
  Effect.tryPromise({
    try: () => pool.query(text).then(() => undefined),
    catch: (cause) => persistenceError(`Postgres command ${name} failed.`, cause),
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
      throw new Error(`Reference schema apply failed: ${message}`)
    }
  })

const skipped = (reason: string): Effect.Effect<void> =>
  Console.log(
    JSON.stringify(
      {
        reference_schema_apply: "skipped",
        reason,
      },
      null,
      2,
    ),
  )

const program = databaseUrl
  ? applyReferenceSchema(databaseUrl)
  : skipped("Set QRTRUST_NETWORK_DATABASE_URL to apply the reference schema.")

Effect.runPromise(program)
