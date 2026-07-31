import { Effect } from "effect"

import type { NetworkError } from "../errors.js"

export interface RuntimeSafetyObservationReportInput {
  readonly observed_at: Date
  readonly lookback_seconds?: number
  readonly host_limit?: number
}

export interface RuntimeSafetyProviderReport {
  readonly provider_id: string
  readonly total_count: number
  readonly risky_count: number
  readonly blocked_count: number
  readonly unavailable_count: number
  readonly last_observed_at: string
}

export interface RuntimeSafetyHostReport {
  readonly destination_host: string
  readonly verdict: string
  readonly risk_score: number
  readonly reason_codes: ReadonlyArray<string>
  readonly observed_at: string
  readonly final_url: string | undefined
}

export interface RuntimeSafetyObservationReport {
  readonly observed_at: string
  readonly lookback_seconds: number
  readonly total_count: number
  readonly clear_count: number
  readonly risky_count: number
  readonly blocked_count: number
  readonly unavailable_count: number
  readonly unknown_count: number
  readonly expired_count: number
  readonly highest_risk_score: number
  readonly provider_reports: ReadonlyArray<RuntimeSafetyProviderReport>
  readonly top_hosts: ReadonlyArray<RuntimeSafetyHostReport>
}

export interface RuntimeSafetyObservationHealth {
  readonly status: "healthy" | "degraded" | "blocked"
  readonly reasons: ReadonlyArray<string>
}

export interface RuntimeSafetyObservationReportStoreShape {
  readonly loadReport: (
    input: RuntimeSafetyObservationReportInput,
  ) => Effect.Effect<RuntimeSafetyObservationReport, NetworkError>
}

export const summarizeRuntimeSafetyObservationHealth = (
  report: RuntimeSafetyObservationReport,
): RuntimeSafetyObservationHealth => {
  const reasons: string[] = []

  if (report.total_count === 0) {
    reasons.push("no_runtime_observations")
  }
  if (report.blocked_count > 0) {
    reasons.push("runtime_blocks_present")
  }
  if (report.unavailable_count > 0) {
    reasons.push("provider_unavailable")
  }
  if (report.unknown_count > 0) {
    reasons.push("runtime_status_unknown")
  }
  if (report.expired_count > 0) {
    reasons.push("expired_runtime_observations")
  }
  if (report.risky_count > 0) {
    reasons.push("runtime_risk_present")
  }

  if (report.blocked_count > 0) {
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
