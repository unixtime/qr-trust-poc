import { Effect } from "effect"
import { Pool, type PoolConfig } from "pg"

import { persistenceError, type NetworkError } from "../errors.js"
import {
  artifactByIdCommand,
  type PostgresArtifactRow,
  type PostgresArtifactStoreExecutorShape,
} from "./postgres-artifact-store.js"
import {
  decodePostgresArtifactPublicationWorkItemRows,
  type PostgresArtifactPublicationQueueExecutorShape,
} from "./postgres-artifact-publication-queue.js"
import {
  decodePostgresDomainProofRows,
  type PostgresDomainProofStoreExecutorShape,
} from "./postgres-domain-proof-store.js"
import {
  decodePostgresDestinationPolicyIssuerRows,
  type PostgresDestinationPolicyPublicationContextExecutorShape,
} from "./postgres-destination-policy-publication-context.js"
import {
  decodePostgresEventOutboxMetricsRows,
  type PostgresEventOutboxMetricsExecutorShape,
} from "./postgres-event-outbox-metrics.js"
import {
  decodePostgresEventOutboxRows,
  type PostgresEventOutboxWorkerExecutorShape,
} from "./postgres-event-outbox-worker.js"
import {
  decodePostgresGovernancePublicationRows,
  type PostgresGovernancePublicationSourceExecutorShape,
} from "./postgres-governance-publication-source.js"
import {
  decodePostgresRuntimeSafetyObservationReportRows,
  type PostgresRuntimeSafetyObservationReportExecutorShape,
} from "./postgres-runtime-safety-observation-report.js"
import {
  decodePostgresVerifierCacheWorkItemRows,
  type PostgresVerifierCacheReadModelQueueExecutorShape,
} from "./postgres-verifier-cache-read-model-queue.js"
import type {
  PostgresStatementSinkShape,
  SqlCommand,
} from "./postgres-persistence.js"
import {
  decodePostgresTrustKeyRows,
  type PostgresTrustKeyRegistryExecutorShape,
} from "./postgres-trust-key-registry.js"

export interface PostgresQueryResultShape {
  readonly rows: ReadonlyArray<Record<string, unknown>>
}

export interface PostgresQueryClientShape {
  readonly query: (
    text: string,
    values?: ReadonlyArray<unknown>,
  ) => Promise<PostgresQueryResultShape>
}

export interface PostgresTransactionClientShape
  extends PostgresQueryClientShape {
  readonly release: (err?: Error | boolean) => void
}

export interface PostgresPoolShape extends PostgresQueryClientShape {
  readonly connect: () => Promise<PostgresTransactionClientShape>
}

export type PostgresExecutorShape = PostgresStatementSinkShape &
  PostgresArtifactStoreExecutorShape &
  PostgresArtifactPublicationQueueExecutorShape &
  PostgresDomainProofStoreExecutorShape &
  PostgresDestinationPolicyPublicationContextExecutorShape &
  PostgresTrustKeyRegistryExecutorShape &
  PostgresEventOutboxWorkerExecutorShape &
  PostgresVerifierCacheReadModelQueueExecutorShape &
  PostgresEventOutboxMetricsExecutorShape &
  PostgresRuntimeSafetyObservationReportExecutorShape &
  PostgresGovernancePublicationSourceExecutorShape

export interface PostgresTransactionRunnerShape {
  readonly transact: <A>(
    use: (executor: PostgresExecutorShape) => Effect.Effect<A, NetworkError>,
  ) => Effect.Effect<A, NetworkError>
}

export const makePgPool = (config: string | PoolConfig): Pool =>
  new Pool(typeof config === "string" ? { connectionString: config } : config)

export const makePostgresExecutorFromClient = (
  client: PostgresQueryClientShape,
): PostgresExecutorShape => ({
  execute: (command) =>
    runCommand(client, command).pipe(Effect.map(() => command)),
  queryOne: (command) =>
    runCommand(client, command).pipe(
      Effect.flatMap((result) => {
        if (command.name !== "published_artifacts.get") {
          return Effect.succeed(undefined)
        }

        const row = result.rows[0]
        return row ? decodePostgresArtifactRow(row) : Effect.succeed(undefined)
      }),
    ),
  queryMany: (command) =>
    runCommand(client, command).pipe(
      Effect.flatMap((result) => {
        if (!command.name.startsWith("trust_keys.")) {
          return Effect.succeed([])
        }

        return decodePostgresTrustKeyRows(result.rows)
      }),
    ),
  queryEventOutbox: (command) =>
    runCommand(client, command).pipe(
      Effect.flatMap((result) => {
        if (!command.name.startsWith("event_outbox.")) {
          return Effect.succeed([])
        }

        return decodePostgresEventOutboxRows(result.rows)
      }),
    ),
  queryArtifactPublicationWorkItems: (command) =>
    runCommand(client, command).pipe(
      Effect.flatMap((result) => {
        if (!command.name.startsWith("artifact_publication_work_items.")) {
          return Effect.succeed([])
        }

        return decodePostgresArtifactPublicationWorkItemRows(result.rows)
      }),
    ),
  queryDomainProofs: (command) =>
    runCommand(client, command).pipe(
      Effect.flatMap((result) => {
        if (!command.name.startsWith("issuer_domain_proofs.")) {
          return Effect.succeed([])
        }

        return decodePostgresDomainProofRows(result.rows)
      }),
    ),
  queryIssuerEnrollment: (command) =>
    runCommand(client, command).pipe(
      Effect.flatMap((result) => {
        if (command.name !== "issuers.by_namespace") {
          return Effect.succeed([])
        }

        return decodePostgresDestinationPolicyIssuerRows(result.rows)
      }),
    ),
  queryVerifierCacheWorkItems: (command) =>
    runCommand(client, command).pipe(
      Effect.flatMap((result) => {
        if (!command.name.startsWith("verifier_cache_work_items.")) {
          return Effect.succeed([])
        }

        return decodePostgresVerifierCacheWorkItemRows(result.rows)
      }),
    ),
  queryEventOutboxMetrics: (command) =>
    runCommand(client, command).pipe(
      Effect.flatMap((result) =>
        decodePostgresEventOutboxMetricsRows(result.rows),
      ),
    ),
  queryRuntimeSafetyObservationReport: (command) =>
    runCommand(client, command).pipe(
      Effect.flatMap((result) =>
        decodePostgresRuntimeSafetyObservationReportRows(result.rows),
      ),
    ),
  queryGovernancePublicationBundle: (command) =>
    runCommand(client, command).pipe(
      Effect.flatMap((result) => {
        if (command.name !== "governance_publication.bundle_by_issuer_policy") {
          return Effect.succeed([])
        }

        return decodePostgresGovernancePublicationRows(result.rows)
      }),
    ),
  recorded: () => [],
})

export const makePostgresTransactionRunner = (
  pool: PostgresPoolShape,
): PostgresTransactionRunnerShape => ({
  transact: (use) =>
    Effect.acquireUseRelease(
      connectClient(pool),
      (client) =>
        Effect.gen(function* () {
          yield* runRaw(client, "transaction.begin", "begin")

          const result = yield* use(makePostgresExecutorFromClient(client))
          yield* runRaw(client, "transaction.commit", "commit")

          return result
        }).pipe(
          Effect.catchAll((error) =>
            runRaw(client, "transaction.rollback", "rollback").pipe(
              Effect.catchAll(() => Effect.void),
              Effect.flatMap(() => Effect.fail(error)),
            ),
          ),
        ),
      (client) => Effect.sync(() => client.release()),
    ),
})

export const makePostgresArtifactLookupCommand = (
  artifactId: string,
): SqlCommand => artifactByIdCommand(artifactId)

const runRaw = (
  client: PostgresQueryClientShape,
  name: string,
  text: string,
): Effect.Effect<PostgresQueryResultShape, NetworkError> =>
  runCommand(client, {
    name,
    text,
    values: [],
  })

const runCommand = (
  client: PostgresQueryClientShape,
  command: SqlCommand,
): Effect.Effect<PostgresQueryResultShape, NetworkError> =>
  Effect.tryPromise({
    try: () => client.query(command.text, [...command.values]),
    catch: (cause) =>
      persistenceError(`Postgres command ${command.name} failed.`, cause),
  })

const connectClient = (
  pool: PostgresPoolShape,
): Effect.Effect<PostgresTransactionClientShape, NetworkError> =>
  Effect.tryPromise({
    try: () => pool.connect(),
    catch: (cause) => persistenceError("Postgres connection failed.", cause),
  })

const postgresArtifactRowFromRecord = (
  row: Record<string, unknown>,
): PostgresArtifactRow => ({
  artifact_id: requireStringField(row, "artifact_id"),
  artifact_hash: requireStringField(row, "artifact_hash"),
  artifact_type: requireStringField(row, "artifact_type"),
  version: requireNumberField(row, "version"),
  canonical_json: row.canonical_json,
})

const decodePostgresArtifactRow = (
  row: Record<string, unknown>,
): Effect.Effect<PostgresArtifactRow, NetworkError> =>
  Effect.try({
    try: () => postgresArtifactRowFromRecord(row),
    catch: (cause) =>
      persistenceError("Postgres artifact row decoding failed.", cause),
  })

const requireStringField = (
  row: Record<string, unknown>,
  field: string,
): string => {
  const value = row[field]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Postgres artifact row is missing ${field}.`)
  }

  return value
}

const requireNumberField = (
  row: Record<string, unknown>,
  field: string,
): number => {
  const value = row[field]
  if (typeof value === "number") {
    return value
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value)
  }

  throw new Error(`Postgres artifact row is missing ${field}.`)
}
