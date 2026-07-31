from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import asyncpg

from backend.app.core.config import config
from backend.app.services.database_url import asyncpg_dsn, database_dsn_label
from backend.app.schemas.poc import (
    RuntimeSafetyHostReportResponse,
    RuntimeSafetyObservationOperatorStatusResponse,
    RuntimeSafetyObservationReportResponse,
    RuntimeSafetyProviderReportResponse,
)


_RUNTIME_OBSERVATION_REPORT_QUERY = """
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
  metrics.unknown_count,
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
"""


async def load_runtime_observation_operator_status(
    *,
    lookback_seconds: int = 3600,
    host_limit: int = 10,
) -> RuntimeSafetyObservationOperatorStatusResponse:
    dsn = config.QRTRUST_NETWORK_DATABASE_URL
    if not dsn:
        return RuntimeSafetyObservationOperatorStatusResponse(
            status="unavailable",
            observation_state="unconfigured",
            summary="Runtime-safety observations are not configured for this runtime.",
            reasons=["network_database_unconfigured"],
            database_configured=False,
        )

    observed_at = datetime.now(timezone.utc)
    connection: asyncpg.Connection | None = None
    try:
        connection = await asyncpg.connect(
            asyncpg_dsn(dsn),
            timeout=1.5,
            command_timeout=2.0,
        )
        row = await connection.fetchrow(
            _RUNTIME_OBSERVATION_REPORT_QUERY,
            observed_at,
            lookback_seconds,
            host_limit,
        )
        if row is None:
            raise RuntimeError("Runtime observation report query returned no row.")

        report = _decode_report_row(row)
        status, reasons = _summarize_report(report)
        return RuntimeSafetyObservationOperatorStatusResponse(
            status=status,
            observation_state="observable",
            summary=_summary_for_status(status, reasons),
            reasons=reasons,
            database_configured=True,
            database_dsn_label=database_dsn_label(dsn),
            report=report,
        )
    except Exception as exc:
        return RuntimeSafetyObservationOperatorStatusResponse(
            status="unavailable",
            observation_state="unavailable",
            summary="Runtime-safety observations could not be loaded.",
            reasons=["runtime_observations_unavailable"],
            database_configured=True,
            database_dsn_label=database_dsn_label(dsn),
            error=str(exc),
        )
    finally:
        if connection is not None:
            await connection.close()


def _decode_report_row(row: asyncpg.Record) -> RuntimeSafetyObservationReportResponse:
    return RuntimeSafetyObservationReportResponse(
        observed_at=_iso_timestamp(row["observed_at"]),
        lookback_seconds=_int_field(row["lookback_seconds"]),
        total_count=_int_field(row["total_count"]),
        clear_count=_int_field(row["clear_count"]),
        risky_count=_int_field(row["risky_count"]),
        blocked_count=_int_field(row["blocked_count"]),
        unavailable_count=_int_field(row["unavailable_count"]),
        unknown_count=_int_field(row.get("unknown_count", 0)),
        expired_count=_int_field(row["expired_count"]),
        highest_risk_score=_int_field(row["highest_risk_score"]),
        provider_reports=_decode_provider_reports(row["provider_reports"]),
        top_hosts=_decode_top_hosts(row["top_hosts"]),
    )


def _decode_provider_reports(value: Any) -> list[RuntimeSafetyProviderReportResponse]:
    rows = _jsonb_value(value)
    if rows is None:
        return []
    if not isinstance(rows, list):
        raise RuntimeError("Runtime observation provider_reports is not an array.")

    return [
        RuntimeSafetyProviderReportResponse(
            provider_id=str(row["provider_id"]),
            total_count=_int_field(row["total_count"]),
            risky_count=_int_field(row["risky_count"]),
            blocked_count=_int_field(row["blocked_count"]),
            unavailable_count=_int_field(row["unavailable_count"]),
            last_observed_at=_iso_timestamp(row["last_observed_at"]),
        )
        for row in rows
        if isinstance(row, dict)
    ]


def _decode_top_hosts(value: Any) -> list[RuntimeSafetyHostReportResponse]:
    rows = _jsonb_value(value)
    if rows is None:
        return []
    if not isinstance(rows, list):
        raise RuntimeError("Runtime observation top_hosts is not an array.")

    return [
        RuntimeSafetyHostReportResponse(
            destination_host=str(row["destination_host"]),
            verdict=str(row["verdict"]),
            risk_score=_int_field(row["risk_score"]),
            reason_codes=_string_list(row.get("reason_codes")),
            observed_at=_iso_timestamp(row["observed_at"]),
            final_url=row.get("final_url"),
        )
        for row in rows
        if isinstance(row, dict)
    ]


def _summarize_report(
    report: RuntimeSafetyObservationReportResponse,
) -> tuple[str, list[str]]:
    reasons: list[str] = []
    if report.total_count == 0:
        reasons.append("no_runtime_observations")
    if report.blocked_count > 0:
        reasons.append("runtime_blocks_present")
    if report.unavailable_count > 0:
        reasons.append("provider_unavailable")
    if report.unknown_count > 0:
        reasons.append("runtime_status_unknown")
    if report.expired_count > 0:
        reasons.append("expired_runtime_observations")
    if report.risky_count > 0:
        reasons.append("runtime_risk_present")

    if report.blocked_count > 0:
        return "blocked", reasons
    if reasons:
        return "degraded", reasons
    return "healthy", []


def _summary_for_status(status: str, reasons: list[str]) -> str:
    if status == "healthy":
        return "Runtime-safety observations are fresh and clear."
    if status == "degraded":
        return f"Runtime-safety observations need review: {', '.join(reasons)}."
    if status == "blocked":
        return f"Runtime-safety observations show active block conditions: {', '.join(reasons)}."
    return "Runtime-safety observations are unavailable."


def _jsonb_value(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise RuntimeError("Runtime observation reason_codes is not an array.")
    if any(not isinstance(item, str) for item in value):
        raise RuntimeError("Runtime observation reason_codes contains non-string values.")
    return value


def _int_field(value: Any) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.isnumeric():
        return int(value)
    raise RuntimeError("Runtime observation report contained a non-integer field.")


def _iso_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    return str(value)
