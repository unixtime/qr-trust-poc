import { Effect } from "effect"

import { persistenceError, type NetworkError } from "../errors.js"
import type { SqlCommand } from "./postgres-persistence.js"
import type {
  ArtifactPublicationClaimInput,
  ArtifactPublicationFailure,
  ArtifactPublicationQueueRecord,
  ArtifactPublicationQueueStoreShape,
  ArtifactPublicationSuccess,
} from "./artifact-publication-queue-worker.js"

export interface PostgresArtifactPublicationQueueExecutorShape {
  readonly execute: (command: SqlCommand) => Effect.Effect<SqlCommand, NetworkError>
  readonly queryArtifactPublicationWorkItems: (
    command: SqlCommand,
  ) => Effect.Effect<ReadonlyArray<ArtifactPublicationQueueRecord>, NetworkError>
  readonly recorded: () => ReadonlyArray<SqlCommand>
}

export const makePostgresArtifactPublicationQueueStore = (
  executor: PostgresArtifactPublicationQueueExecutorShape,
): ArtifactPublicationQueueStoreShape => ({
  claimPending: (input) =>
    executor.queryArtifactPublicationWorkItems(
      claimArtifactPublicationWorkItemsCommand(input),
    ),
  markCompleted: (successes, completedAt) =>
    Effect.gen(function* () {
      if (successes.length === 0) {
        return 0
      }

      yield* executor.execute(
        markArtifactPublicationWorkItemsCompletedCommand(
          successes,
          completedAt,
        ),
      )
      return successes.length
    }),
  markFailed: (failures, failedAt) =>
    Effect.gen(function* () {
      if (failures.length === 0) {
        return 0
      }

      yield* executor.execute(
        markArtifactPublicationWorkItemsFailedCommand(failures, failedAt),
      )
      return failures.length
    }),
})

export const claimArtifactPublicationWorkItemsCommand = (
  input: ArtifactPublicationClaimInput,
): SqlCommand => ({
  name: "artifact_publication_work_items.claim_pending",
  text: `
with next_rows as (
  select work_item_id
  from qr_trust.artifact_publication_work_items
  where work_status = 'pending'
    or (
      work_status = 'processing'
      and (claim_expires_at is null or claim_expires_at <= $2::timestamptz)
    )
  order by created_at asc, work_item_id asc
  limit $3::integer
  for update skip locked
)
update qr_trust.artifact_publication_work_items as work_item
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
  work_item.artifact_type,
  work_item.artifact_id,
  work_item.version,
  work_item.root_program_id,
  work_item.delegated_authority_id,
  work_item.issuer_id,
  work_item.destination_policy_id,
  work_item.canonical_json,
  work_item.occurred_at,
  work_item.event_type,
  work_item.artifact_ref,
  work_item.previous_version,
  work_item.reason
`.trim(),
  values: [
    input.worker_id,
    input.claimed_at.toISOString(),
    input.batch_size,
    input.claim_expires_at.toISOString(),
  ],
})

export const markArtifactPublicationWorkItemsCompletedCommand = (
  successes: ReadonlyArray<ArtifactPublicationSuccess>,
  completedAt: Date,
): SqlCommand => ({
  name: "artifact_publication_work_items.mark_completed",
  text: `
with completed(work_item_id, artifact_id, artifact_hash, event_id) as (
  select work_item_id, artifact_id, artifact_hash, event_id
  from jsonb_to_recordset($2::jsonb) as row(
    work_item_id uuid,
    artifact_id text,
    artifact_hash text,
    event_id text
  )
)
update qr_trust.artifact_publication_work_items as work_item
set
  work_status = 'completed',
  completed_at = $1::timestamptz,
  claimed_by = null,
  claimed_at = null,
  claim_expires_at = null,
  last_error = null,
  published_artifact_id = completed.artifact_id,
  published_artifact_hash = completed.artifact_hash,
  published_event_id = completed.event_id
from completed
where work_item.work_item_id = completed.work_item_id
`.trim(),
  values: [
    completedAt.toISOString(),
    jsonb(
      successes.map((success) => ({
        work_item_id: success.work_item_id,
        artifact_id: success.artifact_id,
        artifact_hash: success.artifact_hash,
        event_id: success.event_id,
      })),
    ),
  ],
})

export const markArtifactPublicationWorkItemsFailedCommand = (
  failures: ReadonlyArray<ArtifactPublicationFailure>,
  failedAt: Date,
): SqlCommand => ({
  name: "artifact_publication_work_items.mark_failed",
  text: `
with failed(work_item_id, reason) as (
  select work_item_id, reason
  from jsonb_to_recordset($2::jsonb) as row(work_item_id uuid, reason text)
)
update qr_trust.artifact_publication_work_items as work_item
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
    failedAt.toISOString(),
    jsonb(
      failures.map((failure) => ({
        work_item_id: failure.work_item_id,
        reason: failure.reason,
      })),
    ),
  ],
})

export const decodePostgresArtifactPublicationWorkItemRows = (
  rows: ReadonlyArray<Record<string, unknown>>,
): Effect.Effect<ReadonlyArray<ArtifactPublicationQueueRecord>, NetworkError> =>
  Effect.try({
    try: () => rows.map(postgresArtifactPublicationWorkItemFromRow),
    catch: (cause) =>
      persistenceError(
        "Postgres artifact-publication work-item row decoding failed.",
        cause,
      ),
  })

const postgresArtifactPublicationWorkItemFromRow = (
  row: Record<string, unknown>,
): ArtifactPublicationQueueRecord => {
  const previousVersion = optionalNumberField(row, "previous_version")

  return {
    work_item_id: requireStringField(row, "work_item_id"),
    input: {
      artifact_type: requireStringField(row, "artifact_type"),
      artifact_id: requireStringField(row, "artifact_id"),
      version: requireNumberField(row, "version"),
      root_program_id: requireStringField(row, "root_program_id"),
      body: jsonbValue(row.canonical_json),
      occurredAt: requireDateField(row, "occurred_at"),
      eventType: requireStringField(row, "event_type"),
      ...optionalStringProperty(
        row,
        "delegated_authority_id",
        "delegated_authority_id",
      ),
      ...optionalStringProperty(row, "issuer_id", "issuer_id"),
      ...optionalStringProperty(
        row,
        "destination_policy_id",
        "destination_policy_id",
      ),
      ...optionalStringProperty(row, "artifact_ref", "artifact_ref"),
      ...(previousVersion === undefined
        ? {}
        : { previous_version: previousVersion }),
      ...optionalStringProperty(row, "reason", "reason"),
    },
  }
}

const requireStringField = (
  row: Record<string, unknown>,
  field: string,
): string => {
  const value = row[field]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Postgres artifact-publication work-item row is missing ${field}.`,
    )
  }

  return value
}

const optionalStringProperty = <K extends string>(
  row: Record<string, unknown>,
  field: string,
  property: K,
): Partial<Record<K, string>> => {
  const value = row[field]
  if (value === null || value === undefined || value === "") {
    return {}
  }
  if (typeof value !== "string") {
    throw new Error(
      `Postgres artifact-publication work-item row ${field} must be a string.`,
    )
  }

  return { [property]: value } as Partial<Record<K, string>>
}

const requireNumberField = (
  row: Record<string, unknown>,
  field: string,
): number => {
  const value = row[field]
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value)
  }

  throw new Error(
    `Postgres artifact-publication work-item row is missing ${field}.`,
  )
}

const optionalNumberField = (
  row: Record<string, unknown>,
  field: string,
): number | undefined => {
  const value = row[field]
  if (value === null || value === undefined || value === "") {
    return undefined
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value)
  }

  throw new Error(
    `Postgres artifact-publication work-item row ${field} must be numeric.`,
  )
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

  throw new Error(
    `Postgres artifact-publication work-item row is missing ${field}.`,
  )
}

const jsonbValue = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value
  }

  return JSON.parse(value) as unknown
}

const jsonb = (value: unknown): string => JSON.stringify(value)
