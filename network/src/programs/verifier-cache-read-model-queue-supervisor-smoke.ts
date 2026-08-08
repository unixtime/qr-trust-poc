import { getEventListeners } from "node:events"

import { Console, Effect } from "effect"

import {
  makeVerifierCacheReadModelQueueSupervisor,
  type VerifierCacheReadModelQueueWorkerReport,
  type VerifierCacheReadModelQueueWorkerShape,
} from "../index.js"

const observedAt = new Date("2026-05-19T00:00:00Z")

const program = Effect.gen(function* () {
  const worker = new SequencedQueueWorker([
    workerReport({ claimed: 2, completed: 2, marked_completed: 2 }),
    workerReport({ claimed: 0 }),
    workerReport({ claimed: 0 }),
  ])
  const supervisor = makeVerifierCacheReadModelQueueSupervisor(worker, {
    worker_id: "verifier-cache-supervised-a",
    max_iterations: 10,
    idle_iteration_limit: 2,
    poll_interval_ms: 0,
    idle_poll_interval_ms: 0,
    now: deterministicClock(
      observedAt,
      new Date("2026-05-19T00:00:01Z"),
      new Date("2026-05-19T00:00:02Z"),
      new Date("2026-05-19T00:00:03Z"),
      new Date("2026-05-19T00:00:04Z"),
    ),
  })

  const report = yield* supervisor.run()

  yield* assertSmoke(
    report.stop_reason === "idle_limit",
    "supervisor should stop after bounded idle polling",
  )
  yield* assertSmoke(
    report.iterations === 3,
    "supervisor should retain per-iteration cache materialization evidence",
  )
  yield* assertSmoke(
    report.claimed === 2 &&
      report.completed === 2 &&
      report.failed === 0 &&
      report.marked_completed === 2,
    "supervisor should aggregate verifier-cache worker counts",
  )

  const failureReport = yield* makeVerifierCacheReadModelQueueSupervisor(
    new SequencedQueueWorker([
      workerReport({ claimed: 1, failed: 1, marked_failed: 1 }),
    ]),
    {
      worker_id: "verifier-cache-supervised-failure",
      max_iterations: 1,
      poll_interval_ms: 0,
      now: deterministicClock(observedAt, new Date("2026-05-19T00:00:01Z")),
    },
  ).run()

  yield* assertSmoke(
    failureReport.stop_reason === "max_iterations" &&
      failureReport.failed === 1 &&
      failureReport.marked_failed === 1,
    "supervisor should expose failed verifier-cache queue rows",
  )

  const abortController = new AbortController()
  abortController.abort()
  const shutdownReport = yield* makeVerifierCacheReadModelQueueSupervisor(
    new SequencedQueueWorker([workerReport({ claimed: 1 })]),
    {
      worker_id: "verifier-cache-supervised-shutdown",
      max_iterations: 5,
      shutdown_signal: abortController.signal,
      now: deterministicClock(observedAt, new Date("2026-05-19T00:00:01Z")),
    },
  ).run()

  yield* assertSmoke(
    shutdownReport.stop_reason === "shutdown_signal" &&
      shutdownReport.iterations === 0,
    "supervisor should honor an already-requested graceful shutdown",
  )

  const drainedController = new AbortController()
  const drainedReport = yield* makeVerifierCacheReadModelQueueSupervisor(
    new AbortingQueueWorker(drainedController, workerReport({ claimed: 0 })),
    {
      worker_id: "verifier-cache-supervised-drained",
      max_iterations: 5,
      idle_iteration_limit: 1,
      poll_interval_ms: 0,
      idle_poll_interval_ms: 0,
      shutdown_signal: drainedController.signal,
      now: deterministicClock(observedAt, new Date("2026-05-19T00:00:01Z")),
    },
  ).run()

  yield* assertSmoke(
    drainedReport.stop_reason === "idle_limit" && drainedReport.iterations === 1,
    "supervisor should report why the loop actually stopped, not a shutdown that arrived alongside it",
  )

  const pollingController = new AbortController()
  const pollingReport = yield* makeVerifierCacheReadModelQueueSupervisor(
    new SequencedQueueWorker([
      workerReport({ claimed: 1, completed: 1, marked_completed: 1 }),
    ]),
    {
      worker_id: "verifier-cache-supervised-polling",
      max_iterations: 3,
      poll_interval_ms: 1,
      shutdown_signal: pollingController.signal,
      now: deterministicClock(observedAt, new Date("2026-05-19T00:00:01Z")),
    },
  ).run()

  yield* assertSmoke(
    pollingReport.iterations === 3 &&
      getEventListeners(pollingController.signal, "abort").length === 0,
    "supervisor should not retain one abort listener per completed poll interval",
  )

  yield* Console.log(
    JSON.stringify(
      {
        verifier_cache_read_model_queue_supervisor_smoke: "passed",
        idle_report: {
          stop_reason: report.stop_reason,
          iterations: report.iterations,
          claimed: report.claimed,
          completed: report.completed,
        },
        failure_report: {
          stop_reason: failureReport.stop_reason,
          failed: failureReport.failed,
          marked_failed: failureReport.marked_failed,
        },
        shutdown_report: {
          stop_reason: shutdownReport.stop_reason,
          iterations: shutdownReport.iterations,
        },
        drained_report: {
          stop_reason: drainedReport.stop_reason,
          iterations: drainedReport.iterations,
        },
        polling_report: {
          stop_reason: pollingReport.stop_reason,
          iterations: pollingReport.iterations,
          retained_abort_listeners: getEventListeners(
            pollingController.signal,
            "abort",
          ).length,
        },
      },
      null,
      2,
    ),
  )
})

class SequencedQueueWorker implements VerifierCacheReadModelQueueWorkerShape {
  private index = 0

  constructor(
    private readonly reports: ReadonlyArray<VerifierCacheReadModelQueueWorkerReport>,
  ) {}

  processOnce() {
    return Effect.sync(() => {
      const report = this.reports[this.index] ?? this.reports.at(-1)
      this.index += 1

      if (!report) {
        return workerReport()
      }

      return report
    })
  }
}

class AbortingQueueWorker implements VerifierCacheReadModelQueueWorkerShape {
  constructor(
    private readonly controller: AbortController,
    private readonly report: VerifierCacheReadModelQueueWorkerReport,
  ) {}

  processOnce() {
    return Effect.sync(() => {
      // Shutdown lands while this batch is in flight. The iteration still
      // finishes, so the shutdown is not what stopped the loop.
      this.controller.abort()
      return this.report
    })
  }
}

const workerReport = (
  overrides: Partial<VerifierCacheReadModelQueueWorkerReport> = {},
): VerifierCacheReadModelQueueWorkerReport => {
  const claimed = overrides.claimed ?? 0
  const completed = overrides.completed ?? 0
  const failed = overrides.failed ?? 0

  return {
    worker_id: overrides.worker_id ?? "verifier-cache-supervised-a",
    claimed,
    attempted: overrides.attempted ?? completed + failed,
    completed,
    failed,
    marked_completed: overrides.marked_completed ?? completed,
    marked_failed: overrides.marked_failed ?? failed,
    successes: overrides.successes ?? [],
    failures: overrides.failures ?? [],
  }
}

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
      throw new Error(
        `Verifier cache read-model queue supervisor smoke failed: ${message}`,
      )
    }
  })

Effect.runPromise(program)
