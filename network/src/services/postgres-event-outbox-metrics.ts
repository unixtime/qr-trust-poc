import { Effect } from "effect"

import { persistenceError, type NetworkError } from "../errors.js"
import type {
  EventOutboxFailedRowSummary,
  EventOutboxMetricsInput,
  EventOutboxMetricsSnapshot,
  EventOutboxMetricsStoreShape,
} from "./event-outbox-metrics.js"
import type { SqlCommand } from "./postgres-persistence.js"

export interface PostgresEventOutboxMetricsExecutorShape {
  readonly queryEventOutboxMetrics: (
    command: SqlCommand,
  ) => Effect.Effect<EventOutboxMetricsSnapshot, NetworkError>
}

export const makePostgresEventOutboxMetricsStore = (
  executor: PostgresEventOutboxMetricsExecutorShape,
): EventOutboxMetricsStoreShape => ({
  loadSnapshot: (input) =>
    executor.queryEventOutboxMetrics(eventOutboxMetricsSnapshotCommand(input)),
})

export const eventOutboxMetricsSnapshotCommand = (
  input: EventOutboxMetricsInput,
): SqlCommand => {
  const failedRowLimit = input.failed_row_limit ?? 10
  const maxRetryAttempts = input.max_retry_attempts ?? 3

  return {
    name: "event_outbox.metrics_snapshot",
    text: `
with metrics as (
  select
    count(*) filter (where publish_status = 'pending')::integer as pending_count,
    count(*) filter (where publish_status = 'publishing')::integer as publishing_count,
    count(*) filter (where publish_status = 'published')::integer as published_count,
    count(*) filter (where publish_status = 'failed')::integer as failed_count,
    count(*) filter (
      where publish_status = 'publishing'
        and claim_expires_at is not null
        and claim_expires_at <= $1::timestamptz
    )::integer as stale_claim_count,
    count(*) filter (
      where publish_status = 'failed'
        and attempts < $3::integer
    )::integer as retryable_failed_count,
    coalesce(
      floor(
        extract(
          epoch from (
            $1::timestamptz - min(created_at) filter (where publish_status = 'pending')
          )
        ) * 1000
      ),
      0
    )::bigint as oldest_pending_age_ms,
    coalesce(
      floor(
        extract(
          epoch from (
            $1::timestamptz - min(created_at) filter (where publish_status = 'failed')
          )
        ) * 1000
      ),
      0
    )::bigint as oldest_failed_age_ms,
    coalesce(max(attempts), 0)::integer as max_attempts
  from qr_trust.event_outbox
),
failed_rows as (
  select
    outbox_id,
    event_id,
    event_type,
    attempts,
    last_error,
    created_at
  from qr_trust.event_outbox
  where publish_status = 'failed'
  order by created_at asc, outbox_id asc
  limit $2::integer
)
select
  $1::timestamptz as observed_at,
  metrics.pending_count,
  metrics.publishing_count,
  metrics.published_count,
  metrics.failed_count,
  metrics.stale_claim_count,
  metrics.retryable_failed_count,
  metrics.oldest_pending_age_ms,
  metrics.oldest_failed_age_ms,
  metrics.max_attempts,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'outbox_id', failed_rows.outbox_id::text,
        'event_id', failed_rows.event_id,
        'event_type', failed_rows.event_type,
        'attempts', failed_rows.attempts,
        'last_error', failed_rows.last_error,
        'created_at', failed_rows.created_at
      )
      order by failed_rows.created_at asc, failed_rows.outbox_id asc
    ) filter (where failed_rows.outbox_id is not null),
    '[]'::jsonb
  ) as failed_rows
from metrics
left join failed_rows on true
group by
  metrics.pending_count,
  metrics.publishing_count,
  metrics.published_count,
  metrics.failed_count,
  metrics.stale_claim_count,
  metrics.retryable_failed_count,
  metrics.oldest_pending_age_ms,
  metrics.oldest_failed_age_ms,
  metrics.max_attempts
`.trim(),
    values: [
      input.observed_at.toISOString(),
      failedRowLimit,
      maxRetryAttempts,
    ],
  }
}

export const decodePostgresEventOutboxMetricsRows = (
  rows: ReadonlyArray<Record<string, unknown>>,
): Effect.Effect<EventOutboxMetricsSnapshot, NetworkError> =>
  Effect.try({
    try: () => {
      const row = rows[0]
      if (!row) {
        throw new Error("Postgres event outbox metrics query returned no row.")
      }

      return {
        observed_at: timestampField(row, "observed_at"),
        pending_count: numberField(row, "pending_count"),
        publishing_count: numberField(row, "publishing_count"),
        published_count: numberField(row, "published_count"),
        failed_count: numberField(row, "failed_count"),
        stale_claim_count: numberField(row, "stale_claim_count"),
        retryable_failed_count: numberField(row, "retryable_failed_count"),
        oldest_pending_age_ms: numberField(row, "oldest_pending_age_ms"),
        oldest_failed_age_ms: numberField(row, "oldest_failed_age_ms"),
        max_attempts: numberField(row, "max_attempts"),
        failed_rows: failedRowsField(row.failed_rows),
      }
    },
    catch: (cause) =>
      persistenceError("Postgres event outbox metrics decoding failed.", cause),
  })

const failedRowsField = (
  value: unknown,
): ReadonlyArray<EventOutboxFailedRowSummary> => {
  const rows = jsonbValue(value)
  if (!Array.isArray(rows)) {
    throw new Error("Postgres event outbox metrics failed_rows is not an array.")
  }

  return rows.map((row) => {
    if (!isRecord(row)) {
      throw new Error("Postgres event outbox metrics failed row is invalid.")
    }

    return {
      outbox_id: stringField(row, "outbox_id"),
      event_id: stringField(row, "event_id"),
      event_type: stringField(row, "event_type"),
      attempts: numberField(row, "attempts"),
      last_error: optionalStringField(row, "last_error"),
      created_at: timestampField(row, "created_at"),
    }
  })
}

const jsonbValue = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value
  }

  return JSON.parse(value) as unknown
}

const numberField = (
  row: Record<string, unknown>,
  field: string,
): number => {
  const value = row[field]
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "bigint") {
    return Number(value)
  }
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value)
  }

  throw new Error(`Postgres event outbox metrics row is missing ${field}.`)
}

const stringField = (
  row: Record<string, unknown>,
  field: string,
): string => {
  const value = row[field]
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  throw new Error(`Postgres event outbox metrics row is missing ${field}.`)
}

const optionalStringField = (
  row: Record<string, unknown>,
  field: string,
): string | undefined => {
  const value = row[field]
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value === "string") {
    return value
  }

  throw new Error(`Postgres event outbox metrics row has invalid ${field}.`)
}

const timestampField = (
  row: Record<string, unknown>,
  field: string,
): string => {
  const value = row[field]
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  throw new Error(`Postgres event outbox metrics row is missing ${field}.`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
