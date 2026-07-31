import { Effect } from "effect"

import type { NetworkError } from "../errors.js"
import {
  summarizeEventOutboxHealth,
  type EventOutboxHealthSummary,
  type EventOutboxMetricsSnapshot,
  type EventOutboxMetricsStoreShape,
} from "./event-outbox-metrics.js"
import type {
  EventOutboxWorkerReport,
  EventOutboxWorkerShape,
} from "./event-outbox-worker.js"

export type EventOutboxSupervisorStopReason =
  | "max_iterations"
  | "idle_limit"
  | "shutdown_signal"

export interface EventOutboxSupervisorOptions {
  readonly worker_id: string
  readonly max_iterations?: number
  readonly idle_iteration_limit?: number
  readonly poll_interval_ms?: number
  readonly idle_poll_interval_ms?: number
  readonly failed_row_limit?: number
  readonly max_retry_attempts?: number
  readonly shutdown_signal?: AbortSignal
  readonly now?: () => Date
}

export interface EventOutboxSupervisorIteration {
  readonly iteration: number
  readonly worker_report: EventOutboxWorkerReport
  readonly metrics: EventOutboxMetricsSnapshot | undefined
  readonly health: EventOutboxHealthSummary | undefined
  readonly next_poll_delay_ms: number
}

export interface EventOutboxSupervisorReport {
  readonly worker_id: string
  readonly started_at: string
  readonly stopped_at: string
  readonly stop_reason: EventOutboxSupervisorStopReason
  readonly iterations: number
  readonly claimed: number
  readonly attempted: number
  readonly published: number
  readonly failed: number
  readonly idle_iterations: number
  readonly last_worker_report: EventOutboxWorkerReport | undefined
  readonly last_metrics: EventOutboxMetricsSnapshot | undefined
  readonly last_health: EventOutboxHealthSummary | undefined
  readonly iteration_reports: ReadonlyArray<EventOutboxSupervisorIteration>
}

export interface EventOutboxSupervisorShape {
  readonly run: () => Effect.Effect<EventOutboxSupervisorReport, NetworkError>
}

export const makeEventOutboxSupervisor = (
  worker: EventOutboxWorkerShape,
  metricsStore: EventOutboxMetricsStoreShape | undefined,
  options: EventOutboxSupervisorOptions,
): EventOutboxSupervisorShape => {
  const maxIterations = options.max_iterations ?? Number.POSITIVE_INFINITY
  const idleIterationLimit = options.idle_iteration_limit ?? 5
  const pollIntervalMs = options.poll_interval_ms ?? 1_000
  const idlePollIntervalMs = options.idle_poll_interval_ms ?? pollIntervalMs
  const now = options.now ?? (() => new Date())

  return {
    run: () =>
      Effect.gen(function* () {
        const startedAt = now()
        const iterations: EventOutboxSupervisorIteration[] = []
        let stopReason: EventOutboxSupervisorStopReason = "max_iterations"
        let idleIterations = 0

        while (iterations.length < maxIterations) {
          if (options.shutdown_signal?.aborted) {
            stopReason = "shutdown_signal"
            break
          }

          const workerReport = yield* worker.processOnce()
          idleIterations =
            workerReport.claimed === 0 ? idleIterations + 1 : 0
          const metrics = metricsStore
            ? yield* metricsStore.loadSnapshot(
                metricsInput({
                  observedAt: now(),
                  failedRowLimit: options.failed_row_limit,
                  maxRetryAttempts: options.max_retry_attempts,
                }),
              )
            : undefined
          const health = metrics ? summarizeEventOutboxHealth(metrics) : undefined
          const nextPollDelayMs =
            workerReport.claimed === 0 ? idlePollIntervalMs : pollIntervalMs

          iterations.push({
            iteration: iterations.length + 1,
            worker_report: workerReport,
            metrics,
            health,
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

const metricsInput = (input: {
  readonly observedAt: Date
  readonly failedRowLimit: number | undefined
  readonly maxRetryAttempts: number | undefined
}) => ({
  observed_at: input.observedAt,
  ...(input.failedRowLimit === undefined
    ? {}
    : { failed_row_limit: input.failedRowLimit }),
  ...(input.maxRetryAttempts === undefined
    ? {}
    : { max_retry_attempts: input.maxRetryAttempts }),
})

const buildSupervisorReport = (input: {
  readonly workerId: string
  readonly startedAt: Date
  readonly stoppedAt: Date
  readonly stopReason: EventOutboxSupervisorStopReason
  readonly idleIterations: number
  readonly iterations: ReadonlyArray<EventOutboxSupervisorIteration>
}): EventOutboxSupervisorReport => {
  const lastIteration = input.iterations.at(-1)

  return {
    worker_id: input.workerId,
    started_at: input.startedAt.toISOString(),
    stopped_at: input.stoppedAt.toISOString(),
    stop_reason: input.stopReason,
    iterations: input.iterations.length,
    claimed: sumWorkerReports(input.iterations, "claimed"),
    attempted: sumWorkerReports(input.iterations, "attempted"),
    published: sumWorkerReports(input.iterations, "published"),
    failed: sumWorkerReports(input.iterations, "failed"),
    idle_iterations: input.idleIterations,
    last_worker_report: lastIteration?.worker_report,
    last_metrics: lastIteration?.metrics,
    last_health: lastIteration?.health,
    iteration_reports: input.iterations,
  }
}

const sumWorkerReports = (
  iterations: ReadonlyArray<EventOutboxSupervisorIteration>,
  field: "claimed" | "attempted" | "published" | "failed",
): number =>
  iterations.reduce(
    (total, iteration) => total + iteration.worker_report[field],
    0,
  )
