import { Console, Effect } from "effect"

import {
  decodePostgresEventOutboxMetricsRows,
  eventOutboxMetricsSnapshotCommand,
  makePostgresEventOutboxMetricsStore,
  summarizeEventOutboxHealth,
  type EventOutboxMetricsSnapshot,
  type PostgresEventOutboxMetricsExecutorShape,
  type SqlCommand,
} from "../index.js"

const observedAt = new Date("2026-05-18T12:00:00Z")

const snapshotFixture: EventOutboxMetricsSnapshot = {
  observed_at: observedAt.toISOString(),
  pending_count: 3,
  publishing_count: 2,
  published_count: 11,
  failed_count: 1,
  stale_claim_count: 1,
  retryable_failed_count: 1,
  oldest_pending_age_ms: 90_000,
  oldest_failed_age_ms: 120_000,
  max_attempts: 2,
  failed_rows: [
    {
      outbox_id: "00000000-0000-4000-8000-000000000001",
      event_id: "evt_failed_1",
      event_type: "issuer.record.published",
      attempts: 2,
      last_error: "fixture publication failure",
      created_at: "2026-05-18T11:58:00.000Z",
    },
  ],
}

const program = Effect.gen(function* () {
  const command = eventOutboxMetricsSnapshotCommand({
    observed_at: observedAt,
    failed_row_limit: 5,
    max_retry_attempts: 4,
  })

  yield* assertSmoke(
    command.name === "event_outbox.metrics_snapshot",
    "metrics command should be explicit for logs and audit trails",
  )
  yield* assertSmoke(
    command.text.includes("stale_claim_count"),
    "metrics query should expose expired publishing claims",
  )
  yield* assertSmoke(
    command.text.includes("retryable_failed_count"),
    "metrics query should expose failed rows that are still retry candidates",
  )
  yield* assertSmoke(
    command.text.includes("oldest_pending_age_ms"),
    "metrics query should expose pending propagation lag",
  )
  yield* assertSmoke(
    command.values[1] === 5 && command.values[2] === 4,
    "metrics command should carry failed-row and retry thresholds",
  )

  const decoded = yield* decodePostgresEventOutboxMetricsRows([
    {
      ...snapshotFixture,
      published_count: "11",
      oldest_pending_age_ms: "90000",
      failed_rows: JSON.stringify(snapshotFixture.failed_rows),
    },
  ])
  const health = summarizeEventOutboxHealth(decoded)

  yield* assertSmoke(
    decoded.failed_rows[0]?.event_id === "evt_failed_1",
    "metrics decoder should preserve failed-row evidence",
  )
  yield* assertSmoke(
    health.status === "blocked",
    "failed rows and stale claims should block propagation health",
  )
  yield* assertSmoke(
    health.reasons.includes("stale_claims") &&
      health.reasons.includes("pending_lag"),
    "health summary should explain why the outbox is unhealthy",
  )

  const executor = new FakeMetricsExecutor(snapshotFixture)
  const store = makePostgresEventOutboxMetricsStore(executor)
  const loaded = yield* store.loadSnapshot({
    observed_at: observedAt,
    failed_row_limit: 2,
  })

  yield* assertSmoke(
    loaded.failed_count === 1,
    "metrics store should return the executor snapshot",
  )
  yield* assertSmoke(
    executor.commands[0]?.name === "event_outbox.metrics_snapshot",
    "metrics store should use the Postgres metrics command",
  )

  yield* Console.log(
    JSON.stringify(
      {
        metrics: {
          pending_count: loaded.pending_count,
          stale_claim_count: loaded.stale_claim_count,
          failed_count: loaded.failed_count,
          oldest_pending_age_ms: loaded.oldest_pending_age_ms,
        },
        health,
        command: {
          name: command.name,
          failed_row_limit: command.values[1],
          max_retry_attempts: command.values[2],
        },
      },
      null,
      2,
    ),
  )
})

class FakeMetricsExecutor implements PostgresEventOutboxMetricsExecutorShape {
  readonly commands: SqlCommand[] = []

  constructor(private readonly snapshot: EventOutboxMetricsSnapshot) {}

  queryEventOutboxMetrics(command: SqlCommand) {
    return Effect.sync(() => {
      this.commands.push(command)
      return this.snapshot
    })
  }
}

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Event outbox metrics smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
