import { Console, Effect } from "effect"
import type { Pool } from "pg"

import {
  connectNatsJs,
  drainNatsJsConnection,
  ensureQrTrustJetStreamStreams,
  eventPublicationError,
  makeArtifactPublicationService,
  makeAuthorityPublicationService,
  makeEventOutboxPublisher,
  makeEventOutboxWorker,
  makeLiveJetStreamMessageSink,
  makeNatsJsJetStreamPublisher,
  makePgPool,
  makePostgresArtifactStore,
  makePostgresEventBus,
  makePostgresEventOutboxWorkerStore,
  makePostgresExecutorFromClient,
  makePostgresGovernancePublicationSource,
  makePostgresPersistenceService,
  makePostgresTransactionRunner,
  persistenceError,
  type JetStreamMessageSinkShape,
  type NetworkError,
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
const firstWorkerObservedAt = new Date("2026-05-20T17:01:00Z")
const recoveryWorkerObservedAt = new Date("2026-05-20T17:02:00Z")
const databaseUrl = process.env.QRTRUST_NETWORK_DATABASE_URL
const resetRequested =
  process.env.QRTRUST_NETWORK_LIVE_SMOKE_RESET === "true"
const natsUrl = process.env.QRTRUST_NETWORK_NATS_URL ?? "nats://127.0.0.1:4222"
const natsUser = process.env.QRTRUST_NETWORK_NATS_USER
const natsPassword = process.env.QRTRUST_NETWORK_NATS_PASSWORD

const expectedSubjects = [
  "qrtrust.root-qrtrust-demo-2026.root.manifest.published.v1",
  "qrtrust.root-qrtrust-demo-2026.authority.manifest.published.v1",
  "qrtrust.root-qrtrust-demo-2026.issuer.record.published.v1",
  "qrtrust.root-qrtrust-demo-2026.destination.policy.published.v1",
] as const

const runLiveRetryDrill = (connectionString: string) =>
  withPgPool(connectionString, (pool) =>
    Effect.gen(function* () {
      yield* resetAndApplyReferenceSchema(pool)

      const runner = makePostgresTransactionRunner(pool)
      const publicationReport = yield* runner.transact((executor) =>
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

          return yield* authorityPublisher.publishGovernanceBundle({
            namespace: demoIssuerProjection.namespace,
            destination_policy_id:
              demoDestinationPolicyProjection.destination_policy_id,
            observedAt,
          })
        }),
      )
      const outboxStatusBeforeFailure = yield* fetchOutboxStatus(pool)

      const store = makePostgresEventOutboxWorkerStore(
        makePostgresExecutorFromClient(pool),
      )
      const outageWorker = makeEventOutboxWorker(
        store,
        makeEventOutboxPublisher(makeSimulatedOutageSink()),
        {
          worker_id: "qrtrust-live-outbox-retry-drill-outage",
          batch_size: 100,
          claim_ttl_ms: 60_000,
          now: deterministicClock(
            firstWorkerObservedAt,
            new Date(firstWorkerObservedAt.getTime() + 5_000),
          ),
        },
      )
      const simulatedBrokerOutageReport = yield* outageWorker.processOnce()
      const outboxStatusAfterFailure = yield* fetchOutboxStatus(pool)

      yield* Effect.acquireUseRelease(
        connectNatsJs({
          servers: natsUrl,
          name: "qrtrust-event-outbox-live-retry-drill",
          timeout_ms: 2_000,
          user: natsUser,
          pass: natsPassword,
        }),
        (connection) =>
          Effect.gen(function* () {
            const manager = yield* Effect.tryPromise({
              try: () => connection.jetstreamManager(),
              catch: (cause): NetworkError =>
                eventPublicationError("Failed to create JetStream manager.", {
                  cause,
                }),
            })
            const ensureReport = yield* ensureQrTrustJetStreamStreams(manager)
            const recoverySink = makeLiveJetStreamMessageSink(
              makeNatsJsJetStreamPublisher(connection.jetstream()),
            )
            const recoveryWorker = makeEventOutboxWorker(
              store,
              makeEventOutboxPublisher(recoverySink),
              {
                worker_id: "qrtrust-live-outbox-retry-drill-recovery",
                batch_size: 100,
                claim_ttl_ms: 60_000,
                max_retry_attempts: 5,
                now: deterministicClock(
                  recoveryWorkerObservedAt,
                  new Date(recoveryWorkerObservedAt.getTime() + 5_000),
                ),
              },
            )
            const recoveryWorkerReport = yield* recoveryWorker.processOnce()
            const outboxStatusAfterRecovery = yield* fetchOutboxStatus(pool)
            const recoveredMessages = recoverySink.recorded()

            yield* assertSmoke(
              publicationReport.published_artifacts === expectedSubjects.length,
              "authority publication should enqueue the governance bundle",
            )
            yield* assertSmoke(
              outboxStatusBeforeFailure.pending === expectedSubjects.length,
              "authority publication outbox rows should start pending",
            )
            yield* assertSmoke(
              simulatedBrokerOutageReport.failed === expectedSubjects.length &&
                simulatedBrokerOutageReport.published === 0,
              "simulated broker outage should fail every pending outbox row",
            )
            yield* assertSmoke(
              outboxStatusAfterFailure.failed === expectedSubjects.length &&
                outboxStatusAfterFailure.pending === 0 &&
                outboxStatusAfterFailure.published === 0,
              "outbox rows should be failed after broker outage",
            )
            yield* assertSmoke(
              recoveryWorkerReport.published === expectedSubjects.length &&
                recoveryWorkerReport.failed === 0,
              "recovery worker should publish every failed outbox row",
            )
            yield* assertSmoke(
              outboxStatusAfterRecovery.published === expectedSubjects.length &&
                outboxStatusAfterRecovery.failed === 0 &&
                outboxStatusAfterRecovery.pending === 0 &&
                outboxStatusAfterRecovery.publishing === 0,
              "outbox rows should settle to published after NATS recovery",
            )
            yield* assertSmoke(
              sameStringSet(
                recoveredMessages.map((message) => message.subject),
                expectedSubjects,
              ),
              "recovered NATS subjects should match the authority bundle",
            )

            yield* Console.log(
              JSON.stringify(
                {
                  event_outbox_live_retry_drill: "passed",
                  reset_schema: "qr_trust",
                  nats_url: natsUrl,
                  streams: ensureReport.streams,
                  publication_report: publicationReport,
                  simulated_broker_outage_report: simulatedBrokerOutageReport,
                  recovery_worker_report: recoveryWorkerReport,
                  outbox_status_before_failure: outboxStatusBeforeFailure,
                  outbox_status_after_failure: outboxStatusAfterFailure,
                  outbox_status_after_recovery: outboxStatusAfterRecovery,
                  recovered_subjects: recoveredMessages.map(
                    (message) => message.subject,
                  ),
                },
                null,
                2,
              ),
            )
          }),
        (connection) => drainNatsJsConnection(connection).pipe(Effect.orDie),
      )
    }),
  )

const makeSimulatedOutageSink = (): JetStreamMessageSinkShape => ({
  publish: (message) =>
    Effect.fail(
      eventPublicationError("Simulated NATS broker outage.", {
        subject: message.subject,
        stream: message.stream,
      }),
    ),
  recorded: () => [],
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

const fetchOutboxStatus = (
  pool: Pool,
): Effect.Effect<
  {
    readonly pending: number
    readonly publishing: number
    readonly published: number
    readonly failed: number
  },
  NetworkError
> =>
  Effect.tryPromise({
    try: async () => {
      const result = await pool.query<{
        readonly publish_status: "pending" | "publishing" | "published" | "failed"
        readonly count: number
      }>(`
select publish_status, count(*)::int as count
from qr_trust.event_outbox
group by publish_status
`)
      const counts = {
        pending: 0,
        publishing: 0,
        published: 0,
        failed: 0,
      }

      for (const row of result.rows) {
        counts[row.publish_status] = Number(row.count)
      }

      return counts
    },
    catch: (cause) =>
      persistenceError("Postgres live outbox retry status query failed.", cause),
  })

const deterministicClock = (...dates: ReadonlyArray<Date>): (() => Date) => {
  let index = 0

  return () => {
    const date = dates[index] ?? dates.at(-1)
    index += 1

    return new Date(date ?? observedAt)
  }
}

const sameStringSet = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean => [...left].sort().join("\n") === [...right].sort().join("\n")

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Live event outbox retry drill failed: ${message}`)
    }
  })

const skipped = (reason: string): Effect.Effect<void> =>
  Console.log(
    JSON.stringify(
      {
        event_outbox_live_retry_drill: "skipped",
        reason,
      },
      null,
      2,
    ),
  )

const program = databaseUrl
  ? resetRequested
    ? runLiveRetryDrill(databaseUrl)
    : skipped(
        "QRTRUST_NETWORK_LIVE_SMOKE_RESET=true is required before this drill resets qr_trust.",
      )
  : skipped(
      "Set QRTRUST_NETWORK_DATABASE_URL to run the optional live Postgres outbox retry drill.",
    )

Effect.runPromise(program).catch((cause: NetworkError | unknown) => {
  console.error(cause)
  process.exitCode = 1
})
