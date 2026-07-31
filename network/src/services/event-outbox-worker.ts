import { Effect } from "effect"

import type { NetworkError } from "../errors.js"
import type {
  EventOutboxPublishFailure,
  EventOutboxPublishReport,
  EventOutboxPublishSuccess,
  EventOutboxPublisherShape,
  EventOutboxRecord,
} from "./event-outbox-publisher.js"

export interface EventOutboxClaimInput {
  readonly worker_id: string
  readonly batch_size: number
  readonly claimed_at: Date
  readonly claim_expires_at: Date
  readonly max_retry_attempts: number
}

export interface EventOutboxWorkerStoreShape {
  readonly claimPending: (
    input: EventOutboxClaimInput,
  ) => Effect.Effect<ReadonlyArray<EventOutboxRecord>, NetworkError>
  readonly markPublished: (
    successes: ReadonlyArray<EventOutboxPublishSuccess>,
    publishedAt: Date,
  ) => Effect.Effect<number, NetworkError>
  readonly markFailed: (
    failures: ReadonlyArray<EventOutboxPublishFailure>,
    failedAt: Date,
  ) => Effect.Effect<number, NetworkError>
}

export interface EventOutboxWorkerOptions {
  readonly worker_id: string
  readonly batch_size?: number
  readonly claim_ttl_ms?: number
  readonly max_retry_attempts?: number
  readonly now?: () => Date
}

export interface EventOutboxWorkerReport {
  readonly worker_id: string
  readonly claimed: number
  readonly attempted: number
  readonly published: number
  readonly failed: number
  readonly marked_published: number
  readonly marked_failed: number
  readonly publish_report: EventOutboxPublishReport | undefined
}

export interface EventOutboxWorkerShape {
  readonly processOnce: () => Effect.Effect<EventOutboxWorkerReport, NetworkError>
}

export const makeEventOutboxWorker = (
  store: EventOutboxWorkerStoreShape,
  publisher: EventOutboxPublisherShape,
  options: EventOutboxWorkerOptions,
): EventOutboxWorkerShape => {
  const batchSize = options.batch_size ?? 100
  const claimTtlMs = options.claim_ttl_ms ?? 30_000
  const maxRetryAttempts = options.max_retry_attempts ?? 3
  const now = options.now ?? (() => new Date())

  return {
    processOnce: () =>
      Effect.gen(function* () {
        const claimedAt = now()
        const claimExpiresAt = new Date(claimedAt.getTime() + claimTtlMs)
        const rows = yield* store.claimPending({
          worker_id: options.worker_id,
          batch_size: batchSize,
          claimed_at: claimedAt,
          claim_expires_at: claimExpiresAt,
          max_retry_attempts: maxRetryAttempts,
        })

        if (rows.length === 0) {
          return emptyWorkerReport(options.worker_id)
        }

        const publishReport = yield* publisher.publishBatch(rows)
        const completedAt = now()
        const markedPublished =
          publishReport.successes.length === 0
            ? 0
            : yield* store.markPublished(publishReport.successes, completedAt)
        const markedFailed =
          publishReport.failures.length === 0
            ? 0
            : yield* store.markFailed(publishReport.failures, completedAt)

        return {
          worker_id: options.worker_id,
          claimed: rows.length,
          attempted: publishReport.attempted,
          published: publishReport.published,
          failed: publishReport.failed,
          marked_published: markedPublished,
          marked_failed: markedFailed,
          publish_report: publishReport,
        }
      }),
  }
}

const emptyWorkerReport = (workerId: string): EventOutboxWorkerReport => ({
  worker_id: workerId,
  claimed: 0,
  attempted: 0,
  published: 0,
  failed: 0,
  marked_published: 0,
  marked_failed: 0,
  publish_report: undefined,
})
