import { Effect } from "effect"

import { persistenceError, type NetworkError } from "../errors.js"
import type {
  EventOutboxClaimInput,
  EventOutboxWorkerStoreShape,
} from "./event-outbox-worker.js"
import type {
  EventOutboxPublishFailure,
  EventOutboxPublishSuccess,
  EventOutboxRecord,
} from "./event-outbox-publisher.js"
import type { SqlCommand } from "./postgres-persistence.js"

export interface PostgresEventOutboxWorkerExecutorShape {
  readonly execute: (command: SqlCommand) => Effect.Effect<SqlCommand, NetworkError>
  readonly queryEventOutbox: (
    command: SqlCommand,
  ) => Effect.Effect<ReadonlyArray<EventOutboxRecord>, NetworkError>
  readonly recorded: () => ReadonlyArray<SqlCommand>
}

export const makePostgresEventOutboxWorkerStore = (
  executor: PostgresEventOutboxWorkerExecutorShape,
): EventOutboxWorkerStoreShape => ({
  claimPending: (input) =>
    executor.queryEventOutbox(claimEventOutboxBatchCommand(input)),
  markPublished: (successes, publishedAt) =>
    Effect.gen(function* () {
      if (successes.length === 0) {
        return 0
      }

      yield* executor.execute(
        markEventOutboxPublishedCommand(successes, publishedAt),
      )
      return successes.length
    }),
  markFailed: (failures, failedAt) =>
    Effect.gen(function* () {
      if (failures.length === 0) {
        return 0
      }

      yield* executor.execute(markEventOutboxFailedCommand(failures, failedAt))
      return failures.length
    }),
})

export const claimEventOutboxBatchCommand = (
  input: EventOutboxClaimInput,
): SqlCommand => ({
  name: "event_outbox.claim_pending",
  text: `
with next_rows as (
  select outbox_id
  from qr_trust.event_outbox
  where publish_status = 'pending'
    or (
      publish_status = 'publishing'
      and (claim_expires_at is null or claim_expires_at <= $2::timestamptz)
    )
    or (
      publish_status = 'failed'
      and attempts < $5::integer
    )
  order by created_at asc, outbox_id asc
  limit $3::integer
  for update skip locked
)
update qr_trust.event_outbox as outbox
set
  publish_status = 'publishing',
  attempts = outbox.attempts + 1,
  claimed_by = $1,
  claimed_at = $2::timestamptz,
  claim_expires_at = $4::timestamptz,
  last_error = null
from next_rows
where outbox.outbox_id = next_rows.outbox_id
returning
  outbox.outbox_id::text,
  outbox.event_id,
  outbox.payload
`.trim(),
  values: [
    input.worker_id,
    input.claimed_at.toISOString(),
    input.batch_size,
    input.claim_expires_at.toISOString(),
    input.max_retry_attempts,
  ],
})

export const markEventOutboxPublishedCommand = (
  successes: ReadonlyArray<EventOutboxPublishSuccess>,
  publishedAt: Date,
): SqlCommand => ({
  name: "event_outbox.mark_published",
  text: `
with published(outbox_id) as (
  select outbox_id
  from jsonb_to_recordset($2::jsonb) as row(outbox_id uuid)
)
update qr_trust.event_outbox as outbox
set
  publish_status = 'published',
  published_at = $1::timestamptz,
  claimed_by = null,
  claimed_at = null,
  claim_expires_at = null,
  last_error = null
from published
where outbox.outbox_id = published.outbox_id
`.trim(),
  values: [
    publishedAt.toISOString(),
    jsonb(successes.map((success) => ({ outbox_id: success.outbox_id }))),
  ],
})

export const markEventOutboxFailedCommand = (
  failures: ReadonlyArray<EventOutboxPublishFailure>,
  failedAt: Date,
): SqlCommand => ({
  name: "event_outbox.mark_failed",
  text: `
with failed(outbox_id, reason) as (
  select outbox_id, reason
  from jsonb_to_recordset($1::jsonb) as row(outbox_id uuid, reason text)
)
update qr_trust.event_outbox as outbox
set
  publish_status = 'failed',
  claimed_by = null,
  claimed_at = null,
  claim_expires_at = null,
  last_error = left(failed.reason, 1000)
from failed
where outbox.outbox_id = failed.outbox_id
`.trim(),
  values: [
    jsonb(
      failures.map((failure) => ({
        outbox_id: failure.outbox_id,
        reason: failure.reason,
      })),
    ),
  ],
})

export const decodePostgresEventOutboxRows = (
  rows: ReadonlyArray<Record<string, unknown>>,
): Effect.Effect<ReadonlyArray<EventOutboxRecord>, NetworkError> =>
  Effect.try({
    try: () => rows.map(postgresEventOutboxRecordFromRow),
    catch: (cause) =>
      persistenceError("Postgres event outbox row decoding failed.", cause),
  })

const postgresEventOutboxRecordFromRow = (
  row: Record<string, unknown>,
): EventOutboxRecord => ({
  outbox_id: requireStringField(row, "outbox_id"),
  event_id: requireStringField(row, "event_id"),
  payload: jsonbValue(row.payload),
})

const requireStringField = (
  row: Record<string, unknown>,
  field: string,
): string => {
  const value = row[field]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Postgres event outbox row is missing ${field}.`)
  }

  return value
}

const jsonbValue = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value
  }

  return JSON.parse(value) as unknown
}

const jsonb = (value: unknown): string => JSON.stringify(value)
