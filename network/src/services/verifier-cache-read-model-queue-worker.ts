import { Effect } from "effect"

import type { NetworkError } from "../errors.js"
import type {
  VerifierCacheReadModelWorkItem,
  VerifierCacheReadModelWorkerReport,
  VerifierCacheReadModelWorkerShape,
} from "./verifier-cache-read-model-worker.js"
import type { VerifierCacheReadModelWorkItemAuthorizerShape } from "./verifier-cache-work-item-authorization.js"

export interface VerifierCacheReadModelQueueRecord {
  readonly work_item_id: string
  readonly work_item: VerifierCacheReadModelWorkItem
}

export interface VerifierCacheReadModelClaimInput {
  readonly worker_id: string
  readonly batch_size: number
  readonly claimed_at: Date
  readonly claim_expires_at: Date
}

export interface VerifierCacheReadModelSuccess {
  readonly work_item_id: string
  readonly cache_entry_id: string
  readonly report: VerifierCacheReadModelWorkerReport
}

export interface VerifierCacheReadModelFailure {
  readonly work_item_id: string
  readonly reason: string
}

export interface VerifierCacheReadModelQueueStoreShape {
  readonly claimPending: (
    input: VerifierCacheReadModelClaimInput,
  ) => Effect.Effect<ReadonlyArray<VerifierCacheReadModelQueueRecord>, NetworkError>
  readonly markCompleted: (
    successes: ReadonlyArray<VerifierCacheReadModelSuccess>,
    completedAt: Date,
  ) => Effect.Effect<number, NetworkError>
  readonly markFailed: (
    failures: ReadonlyArray<VerifierCacheReadModelFailure>,
    failedAt: Date,
  ) => Effect.Effect<number, NetworkError>
}

export interface VerifierCacheReadModelQueueWorkerOptions {
  readonly worker_id: string
  readonly batch_size?: number
  readonly claim_ttl_ms?: number
  readonly now?: () => Date
  readonly authorizer?: VerifierCacheReadModelWorkItemAuthorizerShape
}

export interface VerifierCacheReadModelQueueWorkerReport {
  readonly worker_id: string
  readonly claimed: number
  readonly attempted: number
  readonly completed: number
  readonly failed: number
  readonly marked_completed: number
  readonly marked_failed: number
  readonly successes: ReadonlyArray<VerifierCacheReadModelSuccess>
  readonly failures: ReadonlyArray<VerifierCacheReadModelFailure>
}

export interface VerifierCacheReadModelQueueWorkerShape {
  readonly processOnce: () => Effect.Effect<
    VerifierCacheReadModelQueueWorkerReport,
    NetworkError
  >
}

export const makeVerifierCacheReadModelQueueWorker = (
  store: VerifierCacheReadModelQueueStoreShape,
  readModelWorker: VerifierCacheReadModelWorkerShape,
  options: VerifierCacheReadModelQueueWorkerOptions,
): VerifierCacheReadModelQueueWorkerShape => {
  const batchSize = options.batch_size ?? 50
  const claimTtlMs = options.claim_ttl_ms ?? 60_000
  const now = options.now ?? (() => new Date())

  return {
    processOnce: () =>
      Effect.gen(function* () {
        const claimedAt = now()
        const claimExpiresAt = new Date(claimedAt.getTime() + claimTtlMs)
        const records = yield* store.claimPending({
          worker_id: options.worker_id,
          batch_size: batchSize,
          claimed_at: claimedAt,
          claim_expires_at: claimExpiresAt,
        })

        if (records.length === 0) {
          return emptyWorkerReport(options.worker_id)
        }

        const successes: VerifierCacheReadModelSuccess[] = []
        const failures: VerifierCacheReadModelFailure[] = []

        for (const record of records) {
          const result = yield* Effect.either(
            Effect.gen(function* () {
              if (options.authorizer) {
                yield* options.authorizer.authorize(record.work_item)
              }

              return yield* readModelWorker.process(record.work_item)
            }),
          )

          if (result._tag === "Right") {
            successes.push({
              work_item_id: record.work_item_id,
              cache_entry_id: result.right.cache_entry_id,
              report: result.right,
            })
          } else {
            failures.push({
              work_item_id: record.work_item_id,
              reason: failureReason(result.left),
            })
          }
        }

        const completedAt = now()
        const markedCompleted =
          successes.length === 0
            ? 0
            : yield* store.markCompleted(successes, completedAt)
        const markedFailed =
          failures.length === 0
            ? 0
            : yield* store.markFailed(failures, completedAt)

        return {
          worker_id: options.worker_id,
          claimed: records.length,
          attempted: records.length,
          completed: successes.length,
          failed: failures.length,
          marked_completed: markedCompleted,
          marked_failed: markedFailed,
          successes,
          failures,
        }
      }),
  }
}

const emptyWorkerReport = (
  workerId: string,
): VerifierCacheReadModelQueueWorkerReport => ({
  worker_id: workerId,
  claimed: 0,
  attempted: 0,
  completed: 0,
  failed: 0,
  marked_completed: 0,
  marked_failed: 0,
  successes: [],
  failures: [],
})

const failureReason = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }

  if (cause && typeof cause === "object" && "message" in cause) {
    return String((cause as { readonly message: unknown }).message)
  }

  return String(cause)
}
