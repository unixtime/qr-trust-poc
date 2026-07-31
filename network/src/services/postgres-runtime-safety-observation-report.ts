import { Effect } from "effect"

import { persistenceError, type NetworkError } from "../errors.js"
import type { SqlCommand } from "./postgres-persistence.js"
import type {
  RuntimeSafetyHostReport,
  RuntimeSafetyObservationReport,
  RuntimeSafetyObservationReportInput,
  RuntimeSafetyObservationReportStoreShape,
  RuntimeSafetyProviderReport,
} from "./runtime-safety-observation-report.js"

export interface PostgresRuntimeSafetyObservationReportExecutorShape {
  readonly queryRuntimeSafetyObservationReport: (
    command: SqlCommand,
  ) => Effect.Effect<RuntimeSafetyObservationReport, NetworkError>
}

export const makePostgresRuntimeSafetyObservationReportStore = (
  executor: PostgresRuntimeSafetyObservationReportExecutorShape,
): RuntimeSafetyObservationReportStoreShape => ({
  loadReport: (input) =>
    executor.queryRuntimeSafetyObservationReport(
      runtimeSafetyObservationReportCommand(input),
    ),
})

export const runtimeSafetyObservationReportCommand = (
  input: RuntimeSafetyObservationReportInput,
): SqlCommand => {
  const lookbackSeconds = input.lookback_seconds ?? 3600
  const hostLimit = input.host_limit ?? 10

  return {
    name: "runtime_observations.report",
    text: `
with windowed as (
  select *
  from qr_trust.runtime_observations
  where observed_at >= (
    $1::timestamptz - make_interval(secs => $2::integer)
  )
),
metrics as (
  select
    count(*)::integer as total_count,
    count(*) filter (where verdict = 'clear')::integer as clear_count,
    count(*) filter (where verdict = 'risky')::integer as risky_count,
    count(*) filter (where verdict = 'blocked')::integer as blocked_count,
    count(*) filter (where verdict = 'unavailable')::integer as unavailable_count,
    count(*) filter (where verdict = 'unknown')::integer as unknown_count,
    count(*) filter (
      where expires_at is not null
        and expires_at <= $1::timestamptz
    )::integer as expired_count,
    coalesce(max(risk_score), 0)::integer as highest_risk_score
  from windowed
),
provider_rollup as (
  select
    provider_id,
    count(*)::integer as total_count,
    count(*) filter (where verdict = 'risky')::integer as risky_count,
    count(*) filter (where verdict = 'blocked')::integer as blocked_count,
    count(*) filter (where verdict = 'unavailable')::integer as unavailable_count,
    max(observed_at) as last_observed_at
  from windowed
  group by provider_id
),
ranked_hosts as (
  select
    destination_host,
    final_url,
    verdict,
    risk_score,
    reason_codes,
    observed_at,
    row_number() over (
      partition by destination_host
      order by
        case verdict
          when 'blocked' then 3
          when 'risky' then 2
          when 'unavailable' then 1
          when 'unknown' then 1
          else 0
        end desc,
        risk_score desc,
        observed_at desc
    ) as host_rank
  from windowed
),
top_hosts as (
  select
    destination_host,
    final_url,
    verdict,
    risk_score,
    reason_codes,
    observed_at
  from ranked_hosts
  where host_rank = 1
  order by
    case verdict
      when 'blocked' then 3
      when 'risky' then 2
      when 'unavailable' then 1
      else 0
    end desc,
    risk_score desc,
    observed_at desc,
    destination_host asc
  limit $3::integer
)
select
  $1::timestamptz as observed_at,
  $2::integer as lookback_seconds,
  metrics.total_count,
  metrics.clear_count,
  metrics.risky_count,
  metrics.blocked_count,
  metrics.unavailable_count,
  metrics.expired_count,
  metrics.highest_risk_score,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'provider_id', provider_rollup.provider_id,
          'total_count', provider_rollup.total_count,
          'risky_count', provider_rollup.risky_count,
          'blocked_count', provider_rollup.blocked_count,
          'unavailable_count', provider_rollup.unavailable_count,
          'last_observed_at', provider_rollup.last_observed_at
        )
        order by provider_rollup.last_observed_at desc, provider_rollup.provider_id asc
      )
      from provider_rollup
    ),
    '[]'::jsonb
  ) as provider_reports,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'destination_host', top_hosts.destination_host,
          'verdict', top_hosts.verdict,
          'risk_score', top_hosts.risk_score,
          'reason_codes', top_hosts.reason_codes,
          'observed_at', top_hosts.observed_at,
          'final_url', top_hosts.final_url
        )
        order by
          case top_hosts.verdict
            when 'blocked' then 3
            when 'risky' then 2
            when 'unavailable' then 1
            else 0
          end desc,
          top_hosts.risk_score desc,
          top_hosts.observed_at desc,
          top_hosts.destination_host asc
      )
      from top_hosts
    ),
    '[]'::jsonb
  ) as top_hosts
from metrics
`.trim(),
    values: [input.observed_at.toISOString(), lookbackSeconds, hostLimit],
  }
}

export const decodePostgresRuntimeSafetyObservationReportRows = (
  rows: ReadonlyArray<Record<string, unknown>>,
): Effect.Effect<RuntimeSafetyObservationReport, NetworkError> =>
  Effect.try({
    try: () => {
      const row = rows[0]
      if (!row) {
        throw new Error("Postgres runtime observation report returned no row.")
      }

      return {
        observed_at: timestampField(row, "observed_at"),
        lookback_seconds: numberField(row, "lookback_seconds"),
        total_count: numberField(row, "total_count"),
        clear_count: numberField(row, "clear_count"),
        risky_count: numberField(row, "risky_count"),
        blocked_count: numberField(row, "blocked_count"),
        unavailable_count: numberField(row, "unavailable_count"),
        unknown_count: numberField(row, "unknown_count"),
        expired_count: numberField(row, "expired_count"),
        highest_risk_score: numberField(row, "highest_risk_score"),
        provider_reports: providerReportsField(row.provider_reports),
        top_hosts: topHostsField(row.top_hosts),
      }
    },
    catch: (cause) =>
      persistenceError(
        "Postgres runtime observation report decoding failed.",
        cause,
      ),
  })

const providerReportsField = (
  value: unknown,
): ReadonlyArray<RuntimeSafetyProviderReport> => {
  const rows = jsonbValue(value)
  if (!Array.isArray(rows)) {
    throw new Error("Postgres provider report payload is not an array.")
  }

  return rows.map((row) => {
    if (!isRecord(row)) {
      throw new Error("Postgres provider report row is invalid.")
    }

    return {
      provider_id: stringField(row, "provider_id"),
      total_count: numberField(row, "total_count"),
      risky_count: numberField(row, "risky_count"),
      blocked_count: numberField(row, "blocked_count"),
      unavailable_count: numberField(row, "unavailable_count"),
      last_observed_at: timestampField(row, "last_observed_at"),
    }
  })
}

const topHostsField = (value: unknown): ReadonlyArray<RuntimeSafetyHostReport> => {
  const rows = jsonbValue(value)
  if (!Array.isArray(rows)) {
    throw new Error("Postgres top hosts payload is not an array.")
  }

  return rows.map((row) => {
    if (!isRecord(row)) {
      throw new Error("Postgres top host row is invalid.")
    }

    return {
      destination_host: stringField(row, "destination_host"),
      verdict: stringField(row, "verdict"),
      risk_score: numberField(row, "risk_score"),
      reason_codes: stringArrayField(row, "reason_codes"),
      observed_at: timestampField(row, "observed_at"),
      final_url: optionalStringField(row, "final_url"),
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

  throw new Error(`Postgres runtime observation report row is missing ${field}.`)
}

const stringField = (
  row: Record<string, unknown>,
  field: string,
): string => {
  const value = row[field]
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  throw new Error(`Postgres runtime observation report row is missing ${field}.`)
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

  throw new Error(
    `Postgres runtime observation report row has invalid ${field}.`,
  )
}

const stringArrayField = (
  row: Record<string, unknown>,
  field: string,
): ReadonlyArray<string> => {
  const value = row[field]
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(
      `Postgres runtime observation report row has invalid ${field}.`,
    )
  }

  return value
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
    return new Date(value).toISOString()
  }

  throw new Error(`Postgres runtime observation report row is missing ${field}.`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
