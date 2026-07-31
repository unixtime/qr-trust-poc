import { Effect } from "effect"

import type { NetworkError } from "../errors.js"

export interface EventOutboxMetricsInput {
  readonly observed_at: Date
  readonly failed_row_limit?: number
  readonly max_retry_attempts?: number
}

export interface EventOutboxFailedRowSummary {
  readonly outbox_id: string
  readonly event_id: string
  readonly event_type: string
  readonly attempts: number
  readonly last_error: string | undefined
  readonly created_at: string
}

export interface EventOutboxMetricsSnapshot {
  readonly observed_at: string
  readonly pending_count: number
  readonly publishing_count: number
  readonly published_count: number
  readonly failed_count: number
  readonly stale_claim_count: number
  readonly retryable_failed_count: number
  readonly oldest_pending_age_ms: number
  readonly oldest_failed_age_ms: number
  readonly max_attempts: number
  readonly failed_rows: ReadonlyArray<EventOutboxFailedRowSummary>
}

export interface EventOutboxHealthSummary {
  readonly status: "healthy" | "degraded" | "blocked"
  readonly reasons: ReadonlyArray<string>
}

export interface EventOutboxMetricsStoreShape {
  readonly loadSnapshot: (
    input: EventOutboxMetricsInput,
  ) => Effect.Effect<EventOutboxMetricsSnapshot, NetworkError>
}

export const summarizeEventOutboxHealth = (
  snapshot: EventOutboxMetricsSnapshot,
): EventOutboxHealthSummary => {
  const reasons: string[] = []

  if (snapshot.failed_count > 0) {
    reasons.push("failed_rows")
  }
  if (snapshot.stale_claim_count > 0) {
    reasons.push("stale_claims")
  }
  if (snapshot.oldest_pending_age_ms >= 60_000) {
    reasons.push("pending_lag")
  }
  if (snapshot.retryable_failed_count > 0) {
    reasons.push("retry_candidates")
  }

  if (snapshot.failed_count > 0 || snapshot.stale_claim_count > 0) {
    return {
      status: "blocked",
      reasons,
    }
  }

  if (reasons.length > 0) {
    return {
      status: "degraded",
      reasons,
    }
  }

  return {
    status: "healthy",
    reasons: [],
  }
}
