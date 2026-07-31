import { Console, Effect } from "effect"

import {
  makeArtifactPublicationQueueSupervisor,
  type ArtifactPublicationQueueWorkerReport,
  type ArtifactPublicationQueueWorkerShape,
} from "../index.js"

const observedAt = new Date("2026-05-19T00:00:00Z")

const program = Effect.gen(function* () {
  const worker = new SequencedQueueWorker([
    workerReport({ claimed: 3, completed: 3, marked_completed: 3 }),
    workerReport({ claimed: 0 }),
    workerReport({ claimed: 0 }),
  ])
  const supervisor = makeArtifactPublicationQueueSupervisor(worker, {
    worker_id: "artifact-publication-supervised-a",
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
    "supervisor should retain per-iteration artifact publication evidence",
  )
  yield* assertSmoke(
    report.claimed === 3 &&
      report.completed === 3 &&
      report.failed === 0 &&
      report.marked_completed === 3,
    "supervisor should aggregate artifact-publication worker counts",
  )

  const failureReport = yield* makeArtifactPublicationQueueSupervisor(
    new SequencedQueueWorker([
      workerReport({ claimed: 1, failed: 1, marked_failed: 1 }),
    ]),
    {
      worker_id: "artifact-publication-supervised-failure",
      max_iterations: 1,
      poll_interval_ms: 0,
      now: deterministicClock(observedAt, new Date("2026-05-19T00:00:01Z")),
    },
  ).run()

  yield* assertSmoke(
    failureReport.stop_reason === "max_iterations" &&
      failureReport.failed === 1 &&
      failureReport.marked_failed === 1,
    "supervisor should expose failed artifact-publication queue rows",
  )

  const abortController = new AbortController()
  abortController.abort()
  const shutdownReport = yield* makeArtifactPublicationQueueSupervisor(
    new SequencedQueueWorker([workerReport({ claimed: 1 })]),
    {
      worker_id: "artifact-publication-supervised-shutdown",
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

  yield* Console.log(
    JSON.stringify(
      {
        artifact_publication_queue_supervisor_smoke: "passed",
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
      },
      null,
      2,
    ),
  )
})

class SequencedQueueWorker implements ArtifactPublicationQueueWorkerShape {
  private index = 0

  constructor(
    private readonly reports: ReadonlyArray<ArtifactPublicationQueueWorkerReport>,
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

const workerReport = (
  overrides: Partial<ArtifactPublicationQueueWorkerReport> = {},
): ArtifactPublicationQueueWorkerReport => {
  const claimed = overrides.claimed ?? 0
  const completed = overrides.completed ?? 0
  const failed = overrides.failed ?? 0

  return {
    worker_id: overrides.worker_id ?? "artifact-publication-supervised-a",
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
        `Artifact publication queue supervisor smoke failed: ${message}`,
      )
    }
  })

Effect.runPromise(program)
