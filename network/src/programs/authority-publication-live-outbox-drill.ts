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

const observedAt = new Date("2026-05-20T16:00:00Z")
const workerObservedAt = new Date("2026-05-20T16:01:00Z")
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

const runLiveOutboxDrill = (connectionString: string) =>
  withPgPool(connectionString, (pool) =>
    Effect.acquireUseRelease(
      connectNatsJs({
        servers: natsUrl,
        name: "qrtrust-authority-publication-live-outbox-drill",
        timeout_ms: 2_000,
        user: natsUser,
        pass: natsPassword,
      }),
      (connection) =>
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
          const rowCountsBeforeWorker = yield* fetchRowCounts(pool)
          const outboxStatusBeforeWorker = yield* fetchOutboxStatus(pool)

          const manager = yield* Effect.tryPromise({
            try: () => connection.jetstreamManager(),
            catch: (cause): NetworkError =>
              eventPublicationError("Failed to create JetStream manager.", {
                cause,
              }),
          })
          const ensureReport = yield* ensureQrTrustJetStreamStreams(manager)
          const sink = makeLiveJetStreamMessageSink(
            makeNatsJsJetStreamPublisher(connection.jetstream()),
          )
          const store = makePostgresEventOutboxWorkerStore(
            makePostgresExecutorFromClient(pool),
          )
          const worker = makeEventOutboxWorker(
            store,
            makeEventOutboxPublisher(sink),
            {
              worker_id: "qrtrust-live-authority-outbox-drill",
              batch_size: 100,
              claim_ttl_ms: 60_000,
              now: deterministicClock(
                workerObservedAt,
                new Date(workerObservedAt.getTime() + 5_000),
              ),
            },
          )
          const workerReport = yield* worker.processOnce()
          const outboxStatusAfterWorker = yield* fetchOutboxStatus(pool)
          const messages = sink.recorded()

          yield* assertSmoke(
            publicationReport.published_artifacts === expectedSubjects.length,
            "authority publication should publish the full governance bundle",
          )
          yield* assertSmoke(
            rowCountsBeforeWorker.published_artifacts === expectedSubjects.length &&
              rowCountsBeforeWorker.event_outbox === expectedSubjects.length,
            "authority publication should persist four artifacts and four outbox rows",
          )
          yield* assertSmoke(
            outboxStatusBeforeWorker.pending === expectedSubjects.length &&
              outboxStatusBeforeWorker.published === 0,
            "authority publication outbox rows should start as pending",
          )
          yield* assertSmoke(
            workerReport.published === expectedSubjects.length &&
              workerReport.failed === 0,
            "event outbox worker should publish every authority event cleanly",
          )
          yield* assertSmoke(
            outboxStatusAfterWorker.published === expectedSubjects.length &&
              outboxStatusAfterWorker.pending === 0 &&
              outboxStatusAfterWorker.publishing === 0 &&
              outboxStatusAfterWorker.failed === 0,
            "event_outbox status counts should settle to all-published",
          )
          yield* assertSmoke(
            messages.length === expectedSubjects.length,
            "live NATS sink should record one governance message per authority event",
          )
          yield* assertSmoke(
            sameStringSet(
              messages.map((message) => message.subject),
              expectedSubjects,
            ),
            "live NATS subjects should match the authority governance bundle",
          )
          yield* assertSmoke(
            messages.every((message) => message.stream === "QRTRUST_GOVERNANCE"),
            "authority events must stay on the governance stream",
          )
          yield* assertSmoke(
            messages.every((message) => !message.payload.includes('"body"')),
            "NATS propagation payloads must carry event envelopes only",
          )
          yield* assertSmoke(
            messages.every(
              (message) =>
                message.headers["QRTrust-Artifact-Id"] &&
                message.headers["QRTrust-Artifact-Hash"],
            ),
            "NATS propagation headers must expose artifact id and hash references",
          )

          yield* Console.log(
            JSON.stringify(
              {
                authority_publication_live_outbox_drill: "passed",
                reset_schema: "qr_trust",
                nats_url: natsUrl,
                streams: ensureReport.streams,
                publication_report: publicationReport,
                row_counts_before_worker: rowCountsBeforeWorker,
                outbox_status_before_worker: outboxStatusBeforeWorker,
                worker_report: workerReport,
                outbox_status_after_worker: outboxStatusAfterWorker,
                subjects: messages.map((message) => message.subject),
              },
              null,
              2,
            ),
          )
        }),
      (connection) => drainNatsJsConnection(connection).pipe(Effect.orDie),
    ),
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

const fetchRowCounts = (
  pool: Pool,
): Effect.Effect<
  {
    readonly published_artifacts: number
    readonly event_outbox: number
  },
  NetworkError
> =>
  Effect.tryPromise({
    try: async () => {
      const result = await pool.query<{
        readonly published_artifacts: number
        readonly event_outbox: number
      }>(`
select
  (select count(*)::int from qr_trust.published_artifacts) as published_artifacts,
  (select count(*)::int from qr_trust.event_outbox) as event_outbox
`)
      const row = result.rows[0]
      if (!row) {
        throw new Error("Postgres live authority outbox count query returned no rows.")
      }
      return row
    },
    catch: (cause) =>
      persistenceError(
        "Postgres live authority outbox count query failed.",
        cause,
      ),
  })

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
      persistenceError("Postgres live authority outbox status query failed.", cause),
  })

const deterministicClock = (...dates: ReadonlyArray<Date>): (() => Date) => {
  let index = 0

  return () => {
    const date = dates[index] ?? dates.at(-1)
    index += 1

    return new Date(date ?? workerObservedAt)
  }
}

const sameStringSet = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean => [...left].sort().join("\n") === [...right].sort().join("\n")

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Live authority publication outbox drill failed: ${message}`)
    }
  })

const skipped = (reason: string): Effect.Effect<void> =>
  Console.log(
    JSON.stringify(
      {
        authority_publication_live_outbox_drill: "skipped",
        reason,
      },
      null,
      2,
    ),
  )

const program = databaseUrl
  ? resetRequested
    ? runLiveOutboxDrill(databaseUrl)
    : skipped(
        "QRTRUST_NETWORK_LIVE_SMOKE_RESET=true is required before this drill resets qr_trust.",
      )
  : skipped(
      "Set QRTRUST_NETWORK_DATABASE_URL to run the optional live Postgres-to-NATS authority drill.",
    )

Effect.runPromise(program).catch((cause: NetworkError | unknown) => {
  console.error(cause)
  process.exitCode = 1
})
