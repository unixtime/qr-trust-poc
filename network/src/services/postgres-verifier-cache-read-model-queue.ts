import { Effect } from "effect"

import { persistenceError, type NetworkError } from "../errors.js"
import type {
  VerifierCacheReadModelClaimInput,
  VerifierCacheReadModelFailure,
  VerifierCacheReadModelQueueRecord,
  VerifierCacheReadModelQueueStoreShape,
  VerifierCacheReadModelSuccess,
} from "./verifier-cache-read-model-queue-worker.js"
import type { VerifierCacheScannerProbe } from "./verifier-cache-read-model-worker.js"
import type { SqlCommand } from "./postgres-persistence.js"

export interface PostgresVerifierCacheReadModelQueueExecutorShape {
  readonly execute: (command: SqlCommand) => Effect.Effect<SqlCommand, NetworkError>
  readonly queryVerifierCacheWorkItems: (
    command: SqlCommand,
  ) => Effect.Effect<ReadonlyArray<VerifierCacheReadModelQueueRecord>, NetworkError>
  readonly recorded: () => ReadonlyArray<SqlCommand>
}

export const makePostgresVerifierCacheReadModelQueueStore = (
  executor: PostgresVerifierCacheReadModelQueueExecutorShape,
): VerifierCacheReadModelQueueStoreShape => ({
  claimPending: (input) =>
    executor.queryVerifierCacheWorkItems(
      claimVerifierCacheWorkItemsCommand(input),
    ),
  markCompleted: (successes, completedAt) =>
    Effect.gen(function* () {
      if (successes.length === 0) {
        return 0
      }

      yield* executor.execute(
        markVerifierCacheWorkItemsCompletedCommand(successes, completedAt),
      )
      return successes.length
    }),
  markFailed: (failures, failedAt) =>
    Effect.gen(function* () {
      if (failures.length === 0) {
        return 0
      }

      yield* executor.execute(
        markVerifierCacheWorkItemsFailedCommand(failures, failedAt),
      )
      return failures.length
    }),
})

export const claimVerifierCacheWorkItemsCommand = (
  input: VerifierCacheReadModelClaimInput,
): SqlCommand => ({
  name: "verifier_cache_work_items.claim_pending",
  text: `
with next_rows as (
  select work_item_id
  from qr_trust.verifier_cache_work_items
  where work_status = 'pending'
    or (
      work_status = 'processing'
      and (claim_expires_at is null or claim_expires_at <= $2::timestamptz)
    )
  order by created_at asc, work_item_id asc
  limit $3::integer
  for update skip locked
)
update qr_trust.verifier_cache_work_items as work_item
set
  work_status = 'processing',
  attempts = work_item.attempts + 1,
  claimed_by = $1,
  claimed_at = $2::timestamptz,
  claim_expires_at = $4::timestamptz,
  last_error = null
from next_rows
where work_item.work_item_id = next_rows.work_item_id
returning
  work_item.work_item_id::text,
  work_item.verifier_id,
  work_item.root_manifest_artifact_id,
  work_item.delegated_authority_manifest_artifact_id,
  work_item.issuer_record_artifact_id,
  work_item.destination_policy_artifact_id,
  work_item.status_event_artifact_id,
  work_item.materialized_at,
  work_item.scanner_probes
`.trim(),
  values: [
    input.worker_id,
    input.claimed_at.toISOString(),
    input.batch_size,
    input.claim_expires_at.toISOString(),
  ],
})

export const markVerifierCacheWorkItemsCompletedCommand = (
  successes: ReadonlyArray<VerifierCacheReadModelSuccess>,
  completedAt: Date,
): SqlCommand => ({
  name: "verifier_cache_work_items.mark_completed",
  text: `
with completed(work_item_id, cache_entry_id) as (
  select work_item_id, cache_entry_id
  from jsonb_to_recordset($2::jsonb) as row(work_item_id uuid, cache_entry_id text)
)
update qr_trust.verifier_cache_work_items as work_item
set
  work_status = 'completed',
  completed_at = $1::timestamptz,
  claimed_by = null,
  claimed_at = null,
  claim_expires_at = null,
  last_error = null
from completed
where work_item.work_item_id = completed.work_item_id
`.trim(),
  values: [
    completedAt.toISOString(),
    jsonb(
      successes.map((success) => ({
        work_item_id: success.work_item_id,
        cache_entry_id: success.cache_entry_id,
      })),
    ),
  ],
})

export const markVerifierCacheWorkItemsFailedCommand = (
  failures: ReadonlyArray<VerifierCacheReadModelFailure>,
  _failedAt: Date,
): SqlCommand => ({
  name: "verifier_cache_work_items.mark_failed",
  text: `
with failed(work_item_id, reason) as (
  select work_item_id, reason
  from jsonb_to_recordset($1::jsonb) as row(work_item_id uuid, reason text)
)
update qr_trust.verifier_cache_work_items as work_item
set
  work_status = 'failed',
  claimed_by = null,
  claimed_at = null,
  claim_expires_at = null,
  last_error = left(failed.reason, 1000)
from failed
where work_item.work_item_id = failed.work_item_id
`.trim(),
  values: [
    jsonb(
      failures.map((failure) => ({
        work_item_id: failure.work_item_id,
        reason: failure.reason,
      })),
    ),
  ],
})

export const decodePostgresVerifierCacheWorkItemRows = (
  rows: ReadonlyArray<Record<string, unknown>>,
): Effect.Effect<ReadonlyArray<VerifierCacheReadModelQueueRecord>, NetworkError> =>
  Effect.try({
    try: () => rows.map(postgresVerifierCacheWorkItemFromRow),
    catch: (cause) =>
      persistenceError(
        "Postgres verifier-cache work-item row decoding failed.",
        cause,
      ),
  })

const postgresVerifierCacheWorkItemFromRow = (
  row: Record<string, unknown>,
): VerifierCacheReadModelQueueRecord => ({
  work_item_id: requireStringField(row, "work_item_id"),
  work_item: {
    verifier_id: requireStringField(row, "verifier_id"),
    artifacts: {
      root_manifest_artifact_id: requireStringField(
        row,
        "root_manifest_artifact_id",
      ),
      delegated_authority_manifest_artifact_id: requireStringField(
        row,
        "delegated_authority_manifest_artifact_id",
      ),
      issuer_record_artifact_id: requireStringField(
        row,
        "issuer_record_artifact_id",
      ),
      destination_policy_artifact_id: requireStringField(
        row,
        "destination_policy_artifact_id",
      ),
      status_event_artifact_id: requireStringField(
        row,
        "status_event_artifact_id",
      ),
    },
    materialized_at: requireDateField(row, "materialized_at"),
    scanner_probes: scannerProbesValue(row.scanner_probes),
  },
})

const requireStringField = (
  row: Record<string, unknown>,
  field: string,
): string => {
  const value = row[field]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Postgres verifier-cache work-item row is missing ${field}.`)
  }

  return value
}

const requireDateField = (
  row: Record<string, unknown>,
  field: string,
): Date => {
  const value = row[field]
  if (value instanceof Date) {
    return value
  }
  if (typeof value === "string" && value.length > 0) {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return date
    }
  }

  throw new Error(`Postgres verifier-cache work-item row is missing ${field}.`)
}

const scannerProbesValue = (
  value: unknown,
): ReadonlyArray<VerifierCacheScannerProbe> => {
  const decoded = jsonbValue(value)
  if (!Array.isArray(decoded)) {
    return []
  }

  return decoded.map((probe) => {
    if (!probe || typeof probe !== "object" || Array.isArray(probe)) {
      throw new Error("scanner_probes entries must be objects.")
    }

    const record = probe as Record<string, unknown>
    const payload = record.payload
    const issuerHintHost = record.issuer_hint_host

    if (typeof payload !== "string" || payload.length === 0) {
      throw new Error("scanner_probes entries must include payload.")
    }
    if (
      issuerHintHost !== undefined &&
      typeof issuerHintHost !== "string"
    ) {
      throw new Error("scanner_probes issuer_hint_host must be a string.")
    }

    return {
      payload,
      ...(issuerHintHost ? { issuer_hint_host: issuerHintHost } : {}),
    }
  })
}

const jsonbValue = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value
  }

  return JSON.parse(value) as unknown
}

const jsonb = (value: unknown): string => JSON.stringify(value)
