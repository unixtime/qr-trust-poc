import { Console, Effect } from "effect"

import {
  makeEventOutboxSupervisor,
  type EventOutboxMetricsInput,
  type EventOutboxMetricsSnapshot,
  type EventOutboxMetricsStoreShape,
  type EventOutboxWorkerReport,
  type EventOutboxWorkerShape,
} from "../index.js"

const observedAt = new Date("2026-05-18T00:00:00Z")

const program = Effect.gen(function* () {
  const worker = new SequencedWorker([
    workerReport({ claimed: 2, published: 2 }),
    workerReport({ claimed: 0, published: 0 }),
    workerReport({ claimed: 0, published: 0 }),
  ])
  const metricsStore = new SequencedMetricsStore([
    metricsSnapshot({ pending_count: 1, published_count: 2 }),
    metricsSnapshot({ pending_count: 0, published_count: 2 }),
    metricsSnapshot({ pending_count: 0, published_count: 2 }),
  ])
  const supervisor = makeEventOutboxSupervisor(worker, metricsStore, {
    worker_id: "worker-supervised-a",
    max_iterations: 10,
    idle_iteration_limit: 2,
    poll_interval_ms: 0,
    idle_poll_interval_ms: 0,
    failed_row_limit: 5,
    max_retry_attempts: 3,
    now: deterministicClock(
      observedAt,
      new Date("2026-05-18T00:00:01Z"),
      new Date("2026-05-18T00:00:02Z"),
      new Date("2026-05-18T00:00:03Z"),
      new Date("2026-05-18T00:00:04Z"),
    ),
  })

  const report = yield* supervisor.run()

  yield* assertSmoke(
    report.stop_reason === "idle_limit",
    "supervisor should stop cleanly after bounded idle polling",
  )
  yield* assertSmoke(
    report.iterations === 3,
    "supervisor should retain per-iteration operator evidence",
  )
  yield* assertSmoke(
    report.claimed === 2 && report.published === 2 && report.failed === 0,
    "supervisor should aggregate worker publish counts",
  )
  yield* assertSmoke(
    report.last_health?.status === "healthy",
    "supervisor should summarize operator-visible outbox health",
  )
  yield* assertSmoke(
    metricsStore.inputs[0]?.failed_row_limit === 5 &&
      metricsStore.inputs[0]?.max_retry_attempts === 3,
    "supervisor should pass metrics thresholds into the metrics store",
  )

  const blockedSupervisor = makeEventOutboxSupervisor(
    new SequencedWorker([workerReport({ claimed: 1, failed: 1 })]),
    new SequencedMetricsStore([
      metricsSnapshot({
        failed_count: 1,
        stale_claim_count: 1,
        pending_count: 0,
      }),
    ]),
    {
      worker_id: "worker-supervised-blocked",
      max_iterations: 1,
      poll_interval_ms: 0,
      now: deterministicClock(observedAt, new Date("2026-05-18T00:00:01Z")),
    },
  )
  const blockedReport = yield* blockedSupervisor.run()

  yield* assertSmoke(
    blockedReport.last_health?.status === "blocked" &&
      blockedReport.last_health.reasons.includes("failed_rows") &&
      blockedReport.last_health.reasons.includes("stale_claims"),
    "supervisor should expose blocked outbox health reasons",
  )

  const abortController = new AbortController()
  abortController.abort()
  const shutdownReport = yield* makeEventOutboxSupervisor(
    new SequencedWorker([workerReport({ claimed: 1 })]),
    undefined,
    {
      worker_id: "worker-supervised-shutdown",
      max_iterations: 5,
      shutdown_signal: abortController.signal,
      now: deterministicClock(observedAt, new Date("2026-05-18T00:00:01Z")),
    },
  ).run()

  yield* assertSmoke(
    shutdownReport.stop_reason === "shutdown_signal" &&
      shutdownReport.iterations === 0,
    "supervisor should honor an already-requested graceful shutdown",
  )

  yield* Console.log(
    JSON.stringify(
      {
        event_outbox_supervisor_smoke: "passed",
        idle_report: {
          stop_reason: report.stop_reason,
          iterations: report.iterations,
          claimed: report.claimed,
          published: report.published,
          health: report.last_health,
        },
        blocked_report: {
          health: blockedReport.last_health,
        },
        shutdown_report: {
          stop_reason: shutdownReport.stop_reason,
          iterations: shutdownReport.iterations,
        },
      },
      null,
      2,
    ),
  )
})

class SequencedWorker implements EventOutboxWorkerShape {
  private index = 0

  constructor(private readonly reports: ReadonlyArray<EventOutboxWorkerReport>) {}

  processOnce() {
    return Effect.sync(() => {
      const report = this.reports[this.index] ?? this.reports.at(-1)
      this.index += 1

      if (!report) {
        return workerReport({ claimed: 0 })
      }

      return report
    })
  }
}

class SequencedMetricsStore implements EventOutboxMetricsStoreShape {
  readonly inputs: EventOutboxMetricsInput[] = []
  private index = 0

  constructor(
    private readonly snapshots: ReadonlyArray<EventOutboxMetricsSnapshot>,
  ) {}

  loadSnapshot(input: EventOutboxMetricsInput) {
    return Effect.sync(() => {
      this.inputs.push(input)
      const snapshot = this.snapshots[this.index] ?? this.snapshots.at(-1)
      this.index += 1

      if (!snapshot) {
        return metricsSnapshot()
      }

      return snapshot
    })
  }
}

const workerReport = (
  overrides: Partial<EventOutboxWorkerReport> = {},
): EventOutboxWorkerReport => {
  const claimed = overrides.claimed ?? 0
  const published = overrides.published ?? 0
  const failed = overrides.failed ?? 0

  return {
    worker_id: "worker-supervised-a",
    claimed,
    attempted: overrides.attempted ?? published + failed,
    published,
    failed,
    marked_published: overrides.marked_published ?? published,
    marked_failed: overrides.marked_failed ?? failed,
    publish_report: overrides.publish_report,
  }
}

const metricsSnapshot = (
  overrides: Partial<EventOutboxMetricsSnapshot> = {},
): EventOutboxMetricsSnapshot => ({
  observed_at: overrides.observed_at ?? observedAt.toISOString(),
  pending_count: overrides.pending_count ?? 0,
  publishing_count: overrides.publishing_count ?? 0,
  published_count: overrides.published_count ?? 0,
  failed_count: overrides.failed_count ?? 0,
  stale_claim_count: overrides.stale_claim_count ?? 0,
  retryable_failed_count: overrides.retryable_failed_count ?? 0,
  oldest_pending_age_ms: overrides.oldest_pending_age_ms ?? 0,
  oldest_failed_age_ms: overrides.oldest_failed_age_ms ?? 0,
  max_attempts: overrides.max_attempts ?? 0,
  failed_rows: overrides.failed_rows ?? [],
})

const deterministicClock = (
  ...dates: ReadonlyArray<Date>
): (() => Date) => {
  let index = 0

  return () => {
    const date = dates[index] ?? dates.at(-1)
    index += 1
    return new Date(date ?? observedAt)
  }
}

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Event outbox supervisor smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
