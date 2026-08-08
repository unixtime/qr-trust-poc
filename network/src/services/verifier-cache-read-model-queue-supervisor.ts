import { Effect } from "effect"

import type { NetworkError } from "../errors.js"
import type {
  VerifierCacheReadModelQueueWorkerReport,
  VerifierCacheReadModelQueueWorkerShape,
} from "./verifier-cache-read-model-queue-worker.js"

export type VerifierCacheReadModelQueueSupervisorStopReason =
  | "max_iterations"
  | "idle_limit"
  | "shutdown_signal"

export interface VerifierCacheReadModelQueueSupervisorOptions {
  readonly worker_id: string
  readonly max_iterations?: number
  readonly idle_iteration_limit?: number
  readonly poll_interval_ms?: number
  readonly idle_poll_interval_ms?: number
  readonly shutdown_signal?: AbortSignal
  readonly now?: () => Date
}

export interface VerifierCacheReadModelQueueSupervisorIteration {
  readonly iteration: number
  readonly worker_report: VerifierCacheReadModelQueueWorkerReport
  readonly next_poll_delay_ms: number
}

export interface VerifierCacheReadModelQueueSupervisorReport {
  readonly worker_id: string
  readonly started_at: string
  readonly stopped_at: string
  readonly stop_reason: VerifierCacheReadModelQueueSupervisorStopReason
  readonly iterations: number
  readonly claimed: number
  readonly attempted: number
  readonly completed: number
  readonly failed: number
  readonly marked_completed: number
  readonly marked_failed: number
  readonly idle_iterations: number
  readonly last_worker_report:
    | VerifierCacheReadModelQueueWorkerReport
    | undefined
  readonly iteration_reports: ReadonlyArray<VerifierCacheReadModelQueueSupervisorIteration>
}

export interface VerifierCacheReadModelQueueSupervisorShape {
  readonly run: () => Effect.Effect<
    VerifierCacheReadModelQueueSupervisorReport,
    NetworkError
  >
}

export const makeVerifierCacheReadModelQueueSupervisor = (
  worker: VerifierCacheReadModelQueueWorkerShape,
  options: VerifierCacheReadModelQueueSupervisorOptions,
): VerifierCacheReadModelQueueSupervisorShape => {
  const maxIterations = options.max_iterations ?? Number.POSITIVE_INFINITY
  const idleIterationLimit = options.idle_iteration_limit ?? 5
  const pollIntervalMs = options.poll_interval_ms ?? 1_000
  const idlePollIntervalMs = options.idle_poll_interval_ms ?? pollIntervalMs
  const now = options.now ?? (() => new Date())

  return {
    run: () =>
      Effect.gen(function* () {
        const startedAt = now()
        const iterations: VerifierCacheReadModelQueueSupervisorIteration[] = []
        let stopReason: VerifierCacheReadModelQueueSupervisorStopReason =
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

        // `stopReason` is settled by whichever exit the loop actually took, so
        // it is not re-derived from the signal here. A shutdown that arrives
        // while the final iteration is in flight leaves the signal aborted even
        // though the loop stopped for its own reason, and overwriting on that
        // basis reports a drained queue as work cut short.

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

        // The listener has to come off on both exits, not just on abort:
        // `{ once: true }` self-removes only when the event fires, and the
        // default configuration polls forever against a caller-owned signal,
        // so the timeout path would accrue one dead listener per iteration.
        const onAbort = () => {
          clearTimeout(timeout)
          resolve()
        }
        const timeout = setTimeout(() => {
          shutdownSignal?.removeEventListener("abort", onAbort)
          resolve()
        }, delayMs)

        shutdownSignal?.addEventListener("abort", onAbort, { once: true })
      }),
  )

const buildSupervisorReport = (input: {
  readonly workerId: string
  readonly startedAt: Date
  readonly stoppedAt: Date
  readonly stopReason: VerifierCacheReadModelQueueSupervisorStopReason
  readonly idleIterations: number
  readonly iterations: ReadonlyArray<VerifierCacheReadModelQueueSupervisorIteration>
}): VerifierCacheReadModelQueueSupervisorReport => {
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
  iterations: ReadonlyArray<VerifierCacheReadModelQueueSupervisorIteration>,
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
