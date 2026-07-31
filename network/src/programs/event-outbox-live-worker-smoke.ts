import { Console, Effect } from "effect"
import type { Pool } from "pg"

import {
  connectNatsJs,
  drainNatsJsConnection,
  ensureQrTrustJetStreamStreams,
  eventPublicationError,
  InMemoryEventBusLive,
  makeEventOutboxPublisher,
  makeEventOutboxWorker,
  makeLiveJetStreamMessageSink,
  makeNatsJsJetStreamPublisher,
  makePgPool,
  makePostgresEventOutboxWorkerStore,
  makePostgresExecutorFromClient,
  makePostgresPersistenceService,
  makePostgresTransactionRunner,
  persistenceError,
  type NetworkError,
} from "../index.js"
import { resetAndApplyReferenceSchema } from "./postgres-reference-seed.js"
import { makeReferenceNetworkFixture } from "./reference-network-fixture.js"

const observedAt = new Date("2026-05-18T00:00:00Z")
const databaseUrl = process.env.QRTRUST_NETWORK_DATABASE_URL
const resetRequested =
  process.env.QRTRUST_NETWORK_LIVE_SMOKE_RESET === "true"
const natsUrl = process.env.QRTRUST_NETWORK_NATS_URL ?? "nats://127.0.0.1:4222"
const natsUser = process.env.QRTRUST_NETWORK_NATS_USER
const natsPassword = process.env.QRTRUST_NETWORK_NATS_PASSWORD

const runLiveWorkerSmoke = (connectionString: string) =>
  withPgPool(connectionString, (pool) =>
    Effect.acquireUseRelease(
      connectNatsJs({
        servers: natsUrl,
        name: "qrtrust-event-outbox-live-worker-smoke",
        timeout_ms: 2_000,
        user: natsUser,
        pass: natsPassword,
      }),
      (connection) =>
        Effect.gen(function* () {
          yield* resetAndApplyReferenceSchema(pool)

          const fixture = yield* makeReferenceNetworkFixture(observedAt)
          const runner = makePostgresTransactionRunner(pool)
          const persistenceReport = yield* runner.transact((executor) =>
            makePostgresPersistenceService(executor).persistBatch({
              events: fixture.events,
            }),
          )

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
              worker_id: "qrtrust-live-worker-smoke",
              batch_size: 100,
              claim_ttl_ms: 60_000,
              now: deterministicClock(
                new Date("2026-05-18T00:01:00Z"),
                new Date("2026-05-18T00:01:05Z"),
              ),
            },
          )

          const workerReport = yield* worker.processOnce()
          const outboxStatus = yield* fetchOutboxStatus(pool)

          yield* assertSmoke(
            persistenceReport.events_enqueued === fixture.events.length,
            "fixture events were not inserted into event_outbox",
          )
          yield* assertSmoke(
            workerReport.published === fixture.events.length &&
              workerReport.failed === 0,
            "event outbox worker did not publish all fixture rows cleanly",
          )
          yield* assertSmoke(
            outboxStatus.published === fixture.events.length &&
              outboxStatus.failed === 0 &&
              outboxStatus.pending === 0 &&
              outboxStatus.publishing === 0,
            "event_outbox status counts did not settle to all-published",
          )
          yield* assertSmoke(
            sink.recorded().some(
              (message) => message.stream === "QRTRUST_SCANNER_AUDIT",
            ),
            "worker should propagate scanner decisions to the scanner audit stream",
          )

          yield* Console.log(
            JSON.stringify(
              {
                live_event_outbox_worker_smoke: "passed",
                reset_schema: "qr_trust",
                nats_url: natsUrl,
                streams: ensureReport.streams,
                persistence_report: persistenceReport,
                worker_report: workerReport,
                outbox_status: outboxStatus,
                scanner_decision: {
                  id: fixture.scanner_decision.decision_id,
                  color: fixture.scanner_decision.decision_color,
                  state: fixture.scanner_decision.decision_state,
                },
              },
              null,
              2,
            ),
          )
        }).pipe(Effect.provide(InMemoryEventBusLive)),
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
    catch: (cause) => persistenceError("Postgres outbox status query failed.", cause),
  })

const deterministicClock = (
  ...dates: ReadonlyArray<Date>
): (() => Date) => {
  let index = 0

  return () => {
    const date = dates[index] ?? dates.at(-1)
    index += 1

    return new Date(date ?? "2026-05-18T00:00:00Z")
  }
}

const assertSmoke = (
  condition: boolean,
  message: string,
): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Live event outbox worker smoke failed: ${message}`)
    }
  })

const skipped = (reason: string): Effect.Effect<void> =>
  Console.log(
    JSON.stringify(
      {
        live_event_outbox_worker_smoke: "skipped",
        reason,
      },
      null,
      2,
    ),
  )

const program = databaseUrl
  ? resetRequested
    ? runLiveWorkerSmoke(databaseUrl)
    : skipped(
        "QRTRUST_NETWORK_LIVE_SMOKE_RESET=true is required before this smoke resets qr_trust.",
      )
  : skipped(
      "Set QRTRUST_NETWORK_DATABASE_URL to run the optional live Postgres plus NATS outbox worker smoke.",
    )

Effect.runPromise(program).catch((cause: NetworkError | unknown) => {
  console.error(cause)
  process.exitCode = 1
})
