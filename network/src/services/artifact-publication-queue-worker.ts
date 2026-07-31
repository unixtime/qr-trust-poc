import { Effect } from "effect"

import { hashJson } from "../hash.js"
import type { NetworkError } from "../errors.js"
import type {
  ArtifactPublicationInput,
  ArtifactPublicationResult,
  ArtifactPublicationServiceShape,
} from "./artifact-publication.js"

export interface ArtifactPublicationQueueRecord {
  readonly work_item_id: string
  readonly input: ArtifactPublicationInput
}

export interface ArtifactPublicationClaimInput {
  readonly worker_id: string
  readonly batch_size: number
  readonly claimed_at: Date
  readonly claim_expires_at: Date
}

export interface ArtifactPublicationSuccess {
  readonly work_item_id: string
  readonly artifact_id: string
  readonly artifact_hash: string
  readonly event_id: string
  readonly result: ArtifactPublicationResult
}

export interface ArtifactPublicationFailure {
  readonly work_item_id: string
  readonly reason: string
  readonly artifact_id?: string
  readonly artifact_hash?: string
  readonly artifact_type?: string
  readonly artifact_version?: number
  readonly root_program_id?: string
  readonly delegated_authority_id?: string
  readonly issuer_id?: string
}

export interface ArtifactPublicationQueueStoreShape {
  readonly claimPending: (
    input: ArtifactPublicationClaimInput,
  ) => Effect.Effect<ReadonlyArray<ArtifactPublicationQueueRecord>, NetworkError>
  readonly markCompleted: (
    successes: ReadonlyArray<ArtifactPublicationSuccess>,
    completedAt: Date,
  ) => Effect.Effect<number, NetworkError>
  readonly markFailed: (
    failures: ReadonlyArray<ArtifactPublicationFailure>,
    failedAt: Date,
  ) => Effect.Effect<number, NetworkError>
}

export interface ArtifactPublicationQueueWorkerOptions {
  readonly worker_id: string
  readonly batch_size?: number
  readonly claim_ttl_ms?: number
  readonly now?: () => Date
}

export interface ArtifactPublicationQueueWorkerReport {
  readonly worker_id: string
  readonly claimed: number
  readonly attempted: number
  readonly completed: number
  readonly failed: number
  readonly marked_completed: number
  readonly marked_failed: number
  readonly successes: ReadonlyArray<ArtifactPublicationSuccess>
  readonly failures: ReadonlyArray<ArtifactPublicationFailure>
}

export interface ArtifactPublicationQueueWorkerShape {
  readonly processOnce: () => Effect.Effect<
    ArtifactPublicationQueueWorkerReport,
    NetworkError
  >
}

export const makeArtifactPublicationQueueWorker = (
  store: ArtifactPublicationQueueStoreShape,
  publisher: ArtifactPublicationServiceShape,
  options: ArtifactPublicationQueueWorkerOptions,
): ArtifactPublicationQueueWorkerShape => {
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

        const successes: ArtifactPublicationSuccess[] = []
        const failures: ArtifactPublicationFailure[] = []

        for (const record of records) {
          const result = yield* Effect.either(
            publisher.publishArtifact(record.input),
          )

          if (result._tag === "Right") {
            successes.push({
              work_item_id: record.work_item_id,
              artifact_id: result.right.artifact.artifact_id,
              artifact_hash: result.right.artifact.artifact_hash,
              event_id: result.right.event.envelope.event_id,
              result: result.right,
            })
          } else {
            failures.push({
              work_item_id: record.work_item_id,
              reason: failureReason(result.left),
              artifact_id: record.input.artifact_id,
              artifact_hash: `sha256:${hashJson(record.input.body)}`,
              artifact_type: record.input.artifact_type,
              artifact_version: record.input.version,
              root_program_id: record.input.root_program_id,
              ...(record.input.delegated_authority_id
                ? { delegated_authority_id: record.input.delegated_authority_id }
                : {}),
              ...(record.input.issuer_id
                ? { issuer_id: record.input.issuer_id }
                : {}),
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
): ArtifactPublicationQueueWorkerReport => ({
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
