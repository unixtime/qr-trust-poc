import { Console, Effect } from "effect"
import type { Pool } from "pg"

import {
  EventBus,
  InMemoryEventBusLive,
  contractValidationError,
  decodeScannerDecision,
  makeArtifactPublicationService,
  makeAuthorityPublicationService,
  makeClearRuntimeSafetyProvider,
  makeFixtureTrustArtifactSigner,
  makeInMemoryEventBus,
  makePgPool,
  makePostgresArtifactStore,
  makePostgresEventBus,
  makePostgresExecutorFromClient,
  makePostgresGovernancePublicationSource,
  makePostgresPersistenceService,
  makePostgresTransactionRunner,
  makePostgresVerifierCache,
  makePostgresVerifierCacheReadModelQueueStore,
  makeScannerDecisionService,
  makeScannerDecisionPersistenceEventBus,
  makeVerifierCacheReadModelQueueWorker,
  makeVerifierCacheReadModelWorker,
  persistenceError,
  startScannerDecisionHttpRuntime,
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

const observedAt = new Date("2026-05-20T18:00:00Z")
const materializedAt = new Date("2026-05-20T18:01:00Z")
const completedAt = new Date("2026-05-20T18:01:05Z")
const decidedAt = new Date("2026-05-20T18:02:00Z")
const databaseUrl = process.env.QRTRUST_NETWORK_DATABASE_URL
const resetRequested =
  process.env.QRTRUST_NETWORK_LIVE_SMOKE_RESET === "true"
const workItemId = "00000000-0000-4000-8000-000000000601"
const verifierId = "verifier:scanner-live-cache-drill"
const scannerProbePayload = "https://acme.example/pay"

const runLiveScannerDecisionCacheDrill = (connectionString: string) =>
  withPgPool(connectionString, (pool) =>
    Effect.gen(function* () {
      yield* resetAndApplyReferenceSchema(pool)

      const setupReport = yield* makePostgresTransactionRunner(pool).transact(
        (executor) =>
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
          worker_id: "qrtrust-live-scanner-decision-cache-drill",
          batch_size: 10,
          claim_ttl_ms: 60_000,
          now: deterministicClock(materializedAt, completedAt),
        },
      )
      const workerReport = yield* queueWorker.processOnce()
      const scannerEventBus = makeInMemoryEventBus()
      const scanner = makeScannerDecisionService(
        makePostgresVerifierCache(pool, {
          verifier_id: verifierId,
          accepted_root_program_ids: [
            demoIssuerProjection.namespace.root_program_id,
          ],
        }),
        scannerEventBus,
        makeClearRuntimeSafetyProvider(),
      )
      const decision = yield* scanner.decide({
        payload: scannerProbePayload,
        issuerHintHost: "acme.example",
        observedAt: decidedAt,
      })
      const scannerEvents = yield* scannerEventBus.recent()
      const httpRuntimeReport = yield* runLiveScannerDecisionHttpRuntimeProbe(
        pool,
        persistence,
      )
      const dbState = yield* fetchScannerDecisionCacheDrillState(pool)

      yield* assertSmoke(
        setupReport.publication_report.published_artifacts === 4,
        "authority publication should publish four source governance artifacts",
      )
      yield* assertSmoke(
        workerReport.claimed === 1 &&
          workerReport.completed === 1 &&
          workerReport.failed === 0,
        `verifier-cache worker should complete one cache materialization work item; report=${JSON.stringify(
          {
            claimed: workerReport.claimed,
            completed: workerReport.completed,
            failed: workerReport.failed,
            failures: workerReport.failures,
          },
        )}`,
      )
      yield* assertSmoke(
        dbState.row_counts.verifier_cache_entries === 1 &&
          dbState.row_counts.scanner_decisions === 2,
        "database should retain one cache entry, one worker scanner probe, and one HTTP scanner decision row",
      )
      yield* assertSmoke(
        decision.decision_color === "green" &&
          decision.decision_state === "verified_issuer" &&
          decision.governance?.issuer_id ===
            demoIssuerProjection.namespace.issuer_id,
        `scanner decision should be green from persisted verifier-cache state; decision=${JSON.stringify(
          decision,
        )}`,
      )
      yield* assertSmoke(
        scannerEvents.length === 1 &&
          scannerEvents[0]?.envelope.type === "scanner.decision.recorded",
        "scanner decision service should emit one scanner decision event without writing source tables",
      )
      yield* assertSmoke(
        httpRuntimeReport.health_status === 200 &&
          httpRuntimeReport.valid_decision_status === 200 &&
          httpRuntimeReport.invalid_payload_status === 422,
        `HTTP runtime should expose health, accept valid scans, and reject malformed destinations; report=${JSON.stringify(
          httpRuntimeReport,
        )}`,
      )
      yield* assertSmoke(
        httpRuntimeReport.decision_color === "green" &&
          httpRuntimeReport.decision_state === "verified_issuer",
        `HTTP runtime scanner decision should be green from persisted verifier-cache state; report=${JSON.stringify(
          httpRuntimeReport,
        )}`,
      )
      yield* assertSmoke(
        dbState.row_counts.published_artifacts === 5 &&
          dbState.row_counts.event_outbox === 6 &&
          dbState.row_counts.status_events === 1 &&
          dbState.row_counts.verifier_cache_work_items === 1,
        "HTTP scanner decision should persist only its scanner decision event without republishing authority artifacts",
      )

      yield* Console.log(
        JSON.stringify(
          {
            scanner_decision_live_cache_drill: "passed",
            reset_schema: "qr_trust",
            setup_report: setupReport,
            worker_report: {
              worker_id: workerReport.worker_id,
              claimed: workerReport.claimed,
              completed: workerReport.completed,
              failed: workerReport.failed,
              cache_entry_ids: workerReport.successes.map(
                (item) => item.cache_entry_id,
              ),
            },
            row_counts: dbState.row_counts,
            scanner_decision: {
              decision_color: decision.decision_color,
              decision_state: decision.decision_state,
              issuer_id: decision.governance?.issuer_id,
              destination_policy_id: decision.governance?.destination_policy_id,
              reason_codes: decision.reason_codes,
            },
            http_runtime_report: httpRuntimeReport,
            emitted_event_types: scannerEvents.map((event) => event.envelope.type),
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
      artifact_id: "art_status_acme_demo_active_scanner_v1",
      version: 1,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
      issuer_id: demoIssuerProjection.namespace.issuer_id,
      body: (yield* signer.signTrustArtifact({
        body: {
          artifact_type: "revocation_status_event",
          schema_version: "0.1.0",
          status_event_id: "status:acme-demo:active:scanner:v1",
          root_program_id: demoIssuerProjection.namespace.root_program_id,
          delegated_authority_id:
            demoIssuerProjection.namespace.delegated_authority_id,
          target: {
            target_type: "issuer_record",
            issuer_id: demoIssuerProjection.namespace.issuer_id,
            certificate_ref: "cert:acme-demo:web-signing:v1",
          },
          status: "active",
          reason:
            "active status event proves scanner decisions can consume verifier-cache state",
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
      reason: "signed active status for live scanner-decision cache drill",
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

interface ScannerDecisionHttpRuntimeProbeReport {
  readonly health_status: number
  readonly valid_decision_status: number
  readonly invalid_payload_status: number
  readonly decision_color: string
  readonly decision_state: string
  readonly decision_reason_codes: ReadonlyArray<string>
}

const runLiveScannerDecisionHttpRuntimeProbe = (
  pool: Pool,
  persistence: PostgresPersistenceServiceShape,
): Effect.Effect<ScannerDecisionHttpRuntimeProbeReport, NetworkError> => {
  const httpScanner = makeScannerDecisionService(
    makePostgresVerifierCache(pool, {
      verifier_id: verifierId,
      accepted_root_program_ids: [demoIssuerProjection.namespace.root_program_id],
    }),
    makeScannerDecisionPersistenceEventBus(persistence, verifierId),
    makeClearRuntimeSafetyProvider(),
  )

  return Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () =>
        startScannerDecisionHttpRuntime({
          scanner: httpScanner,
          verifierId,
          host: "127.0.0.1",
          port: 0,
        }),
      catch: (cause) =>
        persistenceError(
          "Live scanner-decision HTTP runtime failed to start.",
          cause,
        ),
    }),
    (runtime) =>
      Effect.gen(function* () {
        const health = yield* httpJson(`${runtime.url}/healthz`)
        const valid = yield* httpJson(`${runtime.url}/scanner/decisions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            payload: scannerProbePayload,
            issuer_hint_host: "acme.example",
            observed_at: decidedAt.toISOString(),
          }),
        })
        const validDecision = yield* decodeScannerDecision(valid.body).pipe(
          Effect.mapError((cause) =>
            contractValidationError(
              "Live scanner-decision HTTP response failed validation.",
              cause,
            ),
          ),
        )
        const invalid = yield* httpJson(`${runtime.url}/scanner/decisions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            payload: "not a url",
            observed_at: decidedAt.toISOString(),
          }),
        })

        return {
          health_status: health.status,
          valid_decision_status: valid.status,
          invalid_payload_status: invalid.status,
          decision_color: validDecision.decision_color,
          decision_state: validDecision.decision_state,
          decision_reason_codes: validDecision.reason_codes,
        }
      }),
    (runtime) =>
      Effect.tryPromise({
        try: () => runtime.close(),
        catch: (cause) =>
          persistenceError(
            "Live scanner-decision HTTP runtime failed to close.",
            cause,
          ),
      }).pipe(Effect.orDie),
  )
}

interface HttpJsonResponse {
  readonly status: number
  readonly body: unknown
}

const httpJson = (
  url: string,
  init?: RequestInit,
): Effect.Effect<HttpJsonResponse, NetworkError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, init)
      return {
        status: response.status,
        body: (await response.json()) as unknown,
      }
    },
    catch: (cause) =>
      persistenceError("Live scanner-decision HTTP request failed.", cause),
  })

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
  name: "verifier_cache_work_items.insert_scanner_cache_drill",
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

const fetchScannerDecisionCacheDrillState = (
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
      const counts = countsResult.rows[0]
      if (!counts) {
        throw new Error(
          "Postgres live scanner-decision count query returned no rows.",
        )
      }

      return { row_counts: counts }
    },
    catch: (cause) =>
      persistenceError(
        "Postgres live scanner-decision cache drill query failed.",
        cause,
      ),
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
      throw new Error(`Live scanner-decision cache drill failed: ${message}`)
    }
  })

const skipped = (reason: string): Effect.Effect<void> =>
  Console.log(
    JSON.stringify(
      {
        scanner_decision_live_cache_drill: "skipped",
        reason,
      },
      null,
      2,
    ),
  )

const program = databaseUrl
  ? resetRequested
    ? runLiveScannerDecisionCacheDrill(databaseUrl)
    : skipped(
        "QRTRUST_NETWORK_LIVE_SMOKE_RESET=true is required before this drill resets qr_trust.",
      )
  : skipped(
      "Set QRTRUST_NETWORK_DATABASE_URL to run the optional live scanner-decision cache drill.",
    )

Effect.runPromise(program).catch((cause: NetworkError | unknown) => {
  console.error(cause)
  process.exitCode = 1
})
