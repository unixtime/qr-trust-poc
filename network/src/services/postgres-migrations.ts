import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

export interface PostgresMigrationDefinition {
  readonly migration_id: string
  readonly description: string
  readonly relative_path: string
}

export interface LoadedPostgresMigration extends PostgresMigrationDefinition {
  readonly checksum: string
  readonly sql: string
}

export const expectedReferenceSchemaTables = [
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

export const postgresMigrations: ReadonlyArray<PostgresMigrationDefinition> = [
  {
    migration_id: "0001_reference_schema",
    description:
      "Create the QR Trust reference schema used by local network workers.",
    relative_path: "../docs/public/network-contracts/reference-postgres-schema.sql",
  },
]

export const loadPostgresMigration = (
  migration: PostgresMigrationDefinition,
  cwd = process.cwd(),
): LoadedPostgresMigration => {
  const sql = readFileSync(resolve(cwd, migration.relative_path), "utf8")

  return {
    ...migration,
    checksum: sha256(sql),
    sql,
  }
}

export const loadPostgresMigrations = (
  cwd = process.cwd(),
): ReadonlyArray<LoadedPostgresMigration> => {
  assertValidMigrationPlan(postgresMigrations)

  return postgresMigrations.map((migration) =>
    loadPostgresMigration(migration, cwd),
  )
}

export const assertValidMigrationPlan = (
  migrations: ReadonlyArray<PostgresMigrationDefinition>,
): void => {
  const ids = new Set<string>()
  let previousId = ""

  for (const migration of migrations) {
    if (!/^\d{4}_[a-z0-9_]+$/.test(migration.migration_id)) {
      throw new Error(
        `Invalid Postgres migration id: ${migration.migration_id}`,
      )
    }

    if (ids.has(migration.migration_id)) {
      throw new Error(
        `Duplicate Postgres migration id: ${migration.migration_id}`,
      )
    }

    if (previousId && migration.migration_id <= previousId) {
      throw new Error(
        `Postgres migration ids must be sorted: ${migration.migration_id}`,
      )
    }

    ids.add(migration.migration_id)
    previousId = migration.migration_id
  }
}

export const sha256 = (input: string): string =>
  createHash("sha256").update(input).digest("hex")
