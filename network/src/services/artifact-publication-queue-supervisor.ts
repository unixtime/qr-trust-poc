import { Effect } from "effect"

import type { NetworkError } from "../errors.js"
import type {
  ArtifactPublicationQueueWorkerReport,
  ArtifactPublicationQueueWorkerShape,
} from "./artifact-publication-queue-worker.js"

export type ArtifactPublicationQueueSupervisorStopReason =
  | "max_iterations"
  | "idle_limit"
  | "shutdown_signal"

export interface ArtifactPublicationQueueSupervisorOptions {
  readonly worker_id: string
  readonly max_iterations?: number
  readonly idle_iteration_limit?: number
  readonly poll_interval_ms?: number
  readonly idle_poll_interval_ms?: number
  readonly shutdown_signal?: AbortSignal
  readonly now?: () => Date
}

export interface ArtifactPublicationQueueSupervisorIteration {
  readonly iteration: number
  readonly worker_report: ArtifactPublicationQueueWorkerReport
  readonly next_poll_delay_ms: number
}

export interface ArtifactPublicationQueueSupervisorReport {
  readonly worker_id: string
  readonly started_at: string
  readonly stopped_at: string
  readonly stop_reason: ArtifactPublicationQueueSupervisorStopReason
  readonly iterations: number
  readonly claimed: number
  readonly attempted: number
  readonly completed: number
  readonly failed: number
  readonly marked_completed: number
  readonly marked_failed: number
  readonly idle_iterations: number
  readonly last_worker_report: ArtifactPublicationQueueWorkerReport | undefined
  readonly iteration_reports: ReadonlyArray<ArtifactPublicationQueueSupervisorIteration>
}

export interface ArtifactPublicationQueueSupervisorShape {
  readonly run: () => Effect.Effect<
    ArtifactPublicationQueueSupervisorReport,
    NetworkError
  >
}

export const makeArtifactPublicationQueueSupervisor = (
  worker: ArtifactPublicationQueueWorkerShape,
  options: ArtifactPublicationQueueSupervisorOptions,
): ArtifactPublicationQueueSupervisorShape => {
  const maxIterations = options.max_iterations ?? Number.POSITIVE_INFINITY
  const idleIterationLimit = options.idle_iteration_limit ?? 5
  const pollIntervalMs = options.poll_interval_ms ?? 1_000
  const idlePollIntervalMs = options.idle_poll_interval_ms ?? pollIntervalMs
  const now = options.now ?? (() => new Date())

  return {
    run: () =>
      Effect.gen(function* () {
        const startedAt = now()
        const iterations: ArtifactPublicationQueueSupervisorIteration[] = []
        let stopReason: ArtifactPublicationQueueSupervisorStopReason =
          "max_iterations"
        let idleIterations = 0

        while (iterations.length < maxIterations) {
          if (options.shutdown_signal?.aborted) {
            stopReason = "shutdown_signal"
            break
          }

          const workerReport = yield* worker.processOnce()
          idleIterations =
            workerReport.claimed === 0 ? idleIterations + 1 : 0
          const nextPollDelayMs =
            workerReport.claimed === 0 ? idlePollIntervalMs : pollIntervalMs

          iterations.push({
            iteration: iterations.length + 1,
            worker_report: workerReport,
            next_poll_delay_ms: nextPollDelayMs,
          })

          if (idleIterations >= idleIterationLimit) {
            stopReason = "idle_limit"
            break
          }
          if (iterations.length >= maxIterations) {
            stopReason = "max_iterations"
            break
          }

          yield* supervisorSleep(nextPollDelayMs, options.shutdown_signal)
        }

        if (options.shutdown_signal?.aborted) {
          stopReason = "shutdown_signal"
        }

        return buildSupervisorReport({
          workerId: options.worker_id,
          startedAt,
          stoppedAt: now(),
          stopReason,
          idleIterations,
          iterations,
        })
      }),
  }
}

const supervisorSleep = (
  delayMs: number,
  shutdownSignal: AbortSignal | undefined,
): Effect.Effect<void> =>
  Effect.promise(
    () =>
      new Promise<void>((resolve) => {
        if (delayMs <= 0 || shutdownSignal?.aborted) {
          resolve()
          return
        }

        const timeout = setTimeout(resolve, delayMs)
        shutdownSignal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timeout)
            resolve()
          },
          { once: true },
        )
      }),
  )

const buildSupervisorReport = (input: {
  readonly workerId: string
  readonly startedAt: Date
  readonly stoppedAt: Date
  readonly stopReason: ArtifactPublicationQueueSupervisorStopReason
  readonly idleIterations: number
  readonly iterations: ReadonlyArray<ArtifactPublicationQueueSupervisorIteration>
}): ArtifactPublicationQueueSupervisorReport => {
  const lastIteration = input.iterations.at(-1)

  return {
    worker_id: input.workerId,
    started_at: input.startedAt.toISOString(),
    stopped_at: input.stoppedAt.toISOString(),
    stop_reason: input.stopReason,
    iterations: input.iterations.length,
    claimed: sumWorkerReports(input.iterations, "claimed"),
    attempted: sumWorkerReports(input.iterations, "attempted"),
    completed: sumWorkerReports(input.iterations, "completed"),
    failed: sumWorkerReports(input.iterations, "failed"),
    marked_completed: sumWorkerReports(input.iterations, "marked_completed"),
    marked_failed: sumWorkerReports(input.iterations, "marked_failed"),
    idle_iterations: input.idleIterations,
    last_worker_report: lastIteration?.worker_report,
    iteration_reports: input.iterations,
  }
}

const sumWorkerReports = (
  iterations: ReadonlyArray<ArtifactPublicationQueueSupervisorIteration>,
  field:
    | "claimed"
    | "attempted"
    | "completed"
    | "failed"
    | "marked_completed"
    | "marked_failed",
): number =>
  iterations.reduce(
    (total, iteration) => total + iteration.worker_report[field],
    0,
  )
