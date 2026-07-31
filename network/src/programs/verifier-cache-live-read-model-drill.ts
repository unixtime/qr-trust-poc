import { Console, Effect } from "effect"
import type { Pool } from "pg"

import {
  EventBus,
  InMemoryEventBusLive,
  makeArtifactPublicationService,
  makeAuthorityPublicationService,
  makeFixtureTrustArtifactSigner,
  makePgPool,
  makePostgresArtifactStore,
  makePostgresEventBus,
  makePostgresExecutorFromClient,
  makePostgresGovernancePublicationSource,
  makePostgresPersistenceService,
  makePostgresTransactionRunner,
  makePostgresVerifierCacheReadModelQueueStore,
  makeVerifierCacheReadModelQueueWorker,
  makeVerifierCacheReadModelWorker,
  persistenceError,
  type ArtifactPublicationServiceShape,
  type NetworkError,
  type PostgresPersistenceServiceShape,
  type SqlCommand,
} from "../index.js"
import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
} from "../services/verifier-cache.js"
import {
  resetAndApplyReferenceSchema,
  seedReferenceRows,
} from "./postgres-reference-seed.js"

const observedAt = new Date("2026-05-20T17:00:00Z")
const materializedAt = new Date("2026-05-20T17:01:00Z")
const completedAt = new Date("2026-05-20T17:01:05Z")
const databaseUrl = process.env.QRTRUST_NETWORK_DATABASE_URL
const resetRequested =
  process.env.QRTRUST_NETWORK_LIVE_SMOKE_RESET === "true"
const workItemId = "00000000-0000-4000-8000-000000000501"
const verifierId = "verifier:live-cache-drill"
const scannerProbePayload = "https://acme.example/pay"

const runLiveVerifierCacheDrill = (connectionString: string) =>
  withPgPool(connectionString, (pool) =>
    Effect.gen(function* () {
      yield* resetAndApplyReferenceSchema(pool)

      const runner = makePostgresTransactionRunner(pool)
      const setupReport = yield* runner.transact((executor) =>
        Effect.gen(function* () {
          yield* seedReferenceRows(executor)

          const artifactStore = makePostgresArtifactStore(executor)
          const persistence = makePostgresPersistenceService(executor)
          const eventBus = makePostgresEventBus(persistence)
          const artifactPublisher = makeArtifactPublicationService(
            artifactStore,
            eventBus,
          )
          const source = makePostgresGovernancePublicationSource(executor)
          const authorityPublisher = makeAuthorityPublicationService(
            source,
            artifactPublisher,
          )

          const publicationReport =
            yield* authorityPublisher.publishGovernanceBundle({
              namespace: demoIssuerProjection.namespace,
              destination_policy_id:
                demoDestinationPolicyProjection.destination_policy_id,
              observedAt,
            })
          const statusArtifactId = yield* publishActiveIssuerStatus(
            artifactPublisher,
            persistence,
          )

          yield* executor.execute(
            insertVerifierCacheWorkItemCommand({
              work_item_id: workItemId,
              verifier_id: verifierId,
              root_manifest_artifact_id:
                publicationReport.root_manifest_artifact_id,
              delegated_authority_manifest_artifact_id:
                publicationReport.delegated_authority_artifact_id,
              issuer_record_artifact_id:
                publicationReport.issuer_record_artifact_id,
              destination_policy_artifact_id:
                publicationReport.destination_policy_artifact_id,
              status_event_artifact_id: statusArtifactId,
              materialized_at: materializedAt,
              scanner_probes: [
                {
                  payload: scannerProbePayload,
                  issuer_hint_host: "acme.example",
                },
              ],
            }),
          )

          return {
            publication_report: publicationReport,
            status_artifact_id: statusArtifactId,
            work_item_id: workItemId,
          }
        }),
      )

      const executor = makePostgresExecutorFromClient(pool)
      const eventBus = yield* EventBus
      const artifactStore = makePostgresArtifactStore(executor)
      const persistence = makePostgresPersistenceService(executor)
      const queueStore = makePostgresVerifierCacheReadModelQueueStore(executor)
      const readModelWorker = makeVerifierCacheReadModelWorker(
        artifactStore,
        persistence,
        eventBus,
      )
      const queueWorker = makeVerifierCacheReadModelQueueWorker(
        queueStore,
        readModelWorker,
        {
          worker_id: "qrtrust-live-verifier-cache-drill",
          batch_size: 10,
          claim_ttl_ms: 60_000,
          now: deterministicClock(materializedAt, completedAt),
        },
      )
      const workerReport = yield* queueWorker.processOnce()
      const dbState = yield* fetchVerifierCacheDrillState(pool)

      yield* assertSmoke(
        setupReport.publication_report.published_artifacts === 4,
        "authority publication should publish the four governance artifacts",
      )
      yield* assertSmoke(
        workerReport.claimed === 1 &&
          workerReport.completed === 1 &&
          workerReport.failed === 0,
        `verifier-cache queue worker should claim and complete one work item; report=${JSON.stringify(
          {
            claimed: workerReport.claimed,
            completed: workerReport.completed,
            failed: workerReport.failed,
            failures: workerReport.failures,
          },
        )}`,
      )
      yield* assertSmoke(
        workerReport.marked_completed === 1 && workerReport.marked_failed === 0,
        "verifier-cache queue worker should mark the work item completed",
      )

      const success = workerReport.successes[0]
      yield* assertSmoke(
        Boolean(success),
        "verifier-cache queue worker did not return a success report",
      )
      if (!success) {
        return
      }

      yield* assertSmoke(
        success.report.source_artifact_hashes.length === 5,
        "verifier-cache materialization should preserve five source artifact hashes",
      )
      yield* assertSmoke(
        success.report.persistence_report.cache_entries_upserted === 1 &&
          success.report.persistence_report.scanner_decisions_inserted === 1,
        "read-model worker should persist one cache entry and one scanner decision",
      )
      yield* assertSmoke(
        success.report.persistence_report.artifacts_upserted === 0 &&
          success.report.persistence_report.status_events_upserted === 0 &&
          success.report.persistence_report.events_enqueued === 0,
        "read-model worker should not republish source artifacts or outbox events",
      )
      yield* assertSmoke(
        success.report.scanner_decisions[0]?.decision_color === "green" &&
          success.report.scanner_decisions[0]?.decision_state ===
            "verified_issuer",
        `scanner probe should produce a green verified reusable-public decision from live cache state; decision=${JSON.stringify(
          success.report.scanner_decisions[0],
        )}`,
      )
      yield* assertSmoke(
        dbState.row_counts.published_artifacts === 5 &&
          dbState.row_counts.event_outbox === 5 &&
          dbState.row_counts.status_events === 1 &&
          dbState.row_counts.verifier_cache_work_items === 1 &&
          dbState.row_counts.verifier_cache_entries === 1 &&
          dbState.row_counts.scanner_decisions === 1,
        "live database should contain five artifacts, one queue item, one cache entry, and one scanner decision",
      )
      yield* assertSmoke(
        dbState.work_item?.work_status === "completed",
        "verifier-cache work item should be marked completed",
      )
      yield* assertSmoke(
        dbState.cache_entry?.verifier_id === verifierId &&
          dbState.cache_entry.issuer_id ===
            demoIssuerProjection.namespace.issuer_id &&
          dbState.cache_entry.destination_policy_id ===
            demoDestinationPolicyProjection.destination_policy_id &&
          dbState.cache_entry.freshness_status === "fresh",
        "verifier-cache entry should be fresh and scoped to the demo issuer policy",
      )
      yield* assertSmoke(
        dbState.scanner_decision?.verifier_id === verifierId &&
          dbState.scanner_decision.decision_color === "green" &&
          dbState.scanner_decision.decision_state ===
            "verified_issuer" &&
          dbState.scanner_decision.issuer_id ===
            demoIssuerProjection.namespace.issuer_id,
        `scanner decision row should carry the green verified reusable-public issuer projection; row=${JSON.stringify(
          dbState.scanner_decision,
        )}`,
      )

      yield* Console.log(
        JSON.stringify(
          {
            verifier_cache_live_read_model_drill: "passed",
            reset_schema: "qr_trust",
            setup_report: setupReport,
            worker_report: {
              worker_id: workerReport.worker_id,
              claimed: workerReport.claimed,
              completed: workerReport.completed,
              failed: workerReport.failed,
              marked_completed: workerReport.marked_completed,
              marked_failed: workerReport.marked_failed,
              cache_entry_ids: workerReport.successes.map(
                (item) => item.cache_entry_id,
              ),
            },
            row_counts: dbState.row_counts,
            cache_entry: dbState.cache_entry,
            scanner_decision: dbState.scanner_decision,
          },
          null,
          2,
        ),
      )
    }).pipe(Effect.provide(InMemoryEventBusLive)),
  )

const publishActiveIssuerStatus = (
  publisher: ArtifactPublicationServiceShape,
  persistence: PostgresPersistenceServiceShape,
): Effect.Effect<string, NetworkError> =>
  Effect.gen(function* () {
    const signer = makeFixtureTrustArtifactSigner()
    const publishedIssuerStatus = yield* publisher.publishArtifact({
      artifact_type: "revocation_status_event",
      artifact_id: "art_status_acme_demo_active_v1",
      version: 1,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
      issuer_id: demoIssuerProjection.namespace.issuer_id,
      body: (yield* signer.signTrustArtifact({
        body: {
          artifact_type: "revocation_status_event",
          schema_version: "0.1.0",
          status_event_id: "status:acme-demo:active:v1",
          root_program_id: demoIssuerProjection.namespace.root_program_id,
          delegated_authority_id:
            demoIssuerProjection.namespace.delegated_authority_id,
          target: {
            target_type: "issuer_record",
            issuer_id: demoIssuerProjection.namespace.issuer_id,
            certificate_ref: "cert:acme-demo:web-signing:v1",
          },
          status: "active",
          reason: "active status event proves live verifier-cache materialization",
          effective_at: observedAt.toISOString(),
          expires_at: demoIssuerProjection.cache_expires_at,
          signed_by: demoIssuerProjection.namespace.delegated_authority_id,
        },
        signed_by: demoIssuerProjection.namespace.delegated_authority_id,
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        delegated_authority_id:
          demoIssuerProjection.namespace.delegated_authority_id,
      })).body,
      occurredAt: observedAt,
      eventType: "issuer.status.changed",
      reason: "signed active status for live verifier-cache drill",
    })

    yield* persistence.persistBatch({
      artifacts: [publishedIssuerStatus.artifact],
    })

    return publishedIssuerStatus.artifact.artifact_id
  })

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

interface InsertVerifierCacheWorkItemInput {
  readonly work_item_id: string
  readonly verifier_id: string
  readonly root_manifest_artifact_id: string
  readonly delegated_authority_manifest_artifact_id: string
  readonly issuer_record_artifact_id: string
  readonly destination_policy_artifact_id: string
  readonly status_event_artifact_id: string
  readonly materialized_at: Date
  readonly scanner_probes: ReadonlyArray<{
    readonly payload: string
    readonly issuer_hint_host?: string
  }>
}

const insertVerifierCacheWorkItemCommand = (
  input: InsertVerifierCacheWorkItemInput,
): SqlCommand => ({
  name: "verifier_cache_work_items.insert_live_drill",
  text: `
insert into qr_trust.verifier_cache_work_items (
  work_item_id,
  verifier_id,
  root_manifest_artifact_id,
  delegated_authority_manifest_artifact_id,
  issuer_record_artifact_id,
  destination_policy_artifact_id,
  status_event_artifact_id,
  materialized_at,
  scanner_probes
) values ($1::uuid, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::jsonb)
`.trim(),
  values: [
    input.work_item_id,
    input.verifier_id,
    input.root_manifest_artifact_id,
    input.delegated_authority_manifest_artifact_id,
    input.issuer_record_artifact_id,
    input.destination_policy_artifact_id,
    input.status_event_artifact_id,
    input.materialized_at.toISOString(),
    JSON.stringify(input.scanner_probes),
  ],
})

const fetchVerifierCacheDrillState = (
  pool: Pool,
): Effect.Effect<
  {
    readonly row_counts: {
      readonly published_artifacts: number
      readonly event_outbox: number
      readonly status_events: number
      readonly verifier_cache_work_items: number
      readonly verifier_cache_entries: number
      readonly scanner_decisions: number
    }
    readonly work_item:
      | {
          readonly work_item_id: string
          readonly work_status: string
          readonly attempts: number
        }
      | undefined
    readonly cache_entry:
      | {
          readonly verifier_id: string
          readonly issuer_id: string
          readonly destination_policy_id: string
          readonly freshness_status: string
        }
      | undefined
    readonly scanner_decision:
      | {
          readonly verifier_id: string
          readonly decision_color: string
          readonly decision_state: string
          readonly issuer_id: string | null
          readonly destination_policy_id: string | null
        }
      | undefined
  },
  NetworkError
> =>
  Effect.tryPromise({
    try: async () => {
      const countsResult = await pool.query<{
        readonly published_artifacts: number
        readonly event_outbox: number
        readonly status_events: number
        readonly verifier_cache_work_items: number
        readonly verifier_cache_entries: number
        readonly scanner_decisions: number
      }>(`
select
  (select count(*)::int from qr_trust.published_artifacts) as published_artifacts,
  (select count(*)::int from qr_trust.event_outbox) as event_outbox,
  (select count(*)::int from qr_trust.status_events) as status_events,
  (select count(*)::int from qr_trust.verifier_cache_work_items) as verifier_cache_work_items,
  (select count(*)::int from qr_trust.verifier_cache_entries) as verifier_cache_entries,
  (select count(*)::int from qr_trust.scanner_decisions) as scanner_decisions
`)
      const workItems = await pool.query<{
        readonly work_item_id: string
        readonly work_status: string
        readonly attempts: number
      }>(
        `
select work_item_id::text, work_status, attempts
from qr_trust.verifier_cache_work_items
where work_item_id = $1::uuid
limit 1
`,
        [workItemId],
      )
      const cacheEntries = await pool.query<{
        readonly verifier_id: string
        readonly issuer_id: string
        readonly destination_policy_id: string
        readonly freshness_status: string
      }>(
        `
select verifier_id, issuer_id, destination_policy_id, freshness_status
from qr_trust.verifier_cache_entries
where verifier_id = $1
limit 1
`,
        [verifierId],
      )
      const scannerDecisions = await pool.query<{
        readonly verifier_id: string
        readonly decision_color: string
        readonly decision_state: string
        readonly issuer_id: string | null
        readonly destination_policy_id: string | null
      }>(
        `
select
  verifier_id,
  decision_color,
  decision_state,
  issuer_id,
  destination_policy_id
from qr_trust.scanner_decisions
where verifier_id = $1
order by created_at desc
limit 1
`,
        [verifierId],
      )
      const counts = countsResult.rows[0]
      if (!counts) {
        throw new Error("Postgres live verifier-cache count query returned no rows.")
      }

      return {
        row_counts: counts,
        work_item: workItems.rows[0],
        cache_entry: cacheEntries.rows[0],
        scanner_decision: scannerDecisions.rows[0],
      }
    },
    catch: (cause) =>
      persistenceError("Postgres live verifier-cache drill query failed.", cause),
  })

const deterministicClock = (...dates: ReadonlyArray<Date>): (() => Date) => {
  let index = 0

  return () => {
    const date = dates[index] ?? dates.at(-1)
    index += 1

    return new Date(date ?? materializedAt)
  }
}

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Live verifier-cache read-model drill failed: ${message}`)
    }
  })

const skipped = (reason: string): Effect.Effect<void> =>
  Console.log(
    JSON.stringify(
      {
        verifier_cache_live_read_model_drill: "skipped",
        reason,
      },
      null,
      2,
    ),
  )

const program = databaseUrl
  ? resetRequested
    ? runLiveVerifierCacheDrill(databaseUrl)
    : skipped(
        "QRTRUST_NETWORK_LIVE_SMOKE_RESET=true is required before this drill resets qr_trust.",
      )
  : skipped(
      "Set QRTRUST_NETWORK_DATABASE_URL to run the optional live Postgres-to-cache drill.",
    )

Effect.runPromise(program).catch((cause: NetworkError | unknown) => {
  console.error(cause)
  process.exitCode = 1
})
