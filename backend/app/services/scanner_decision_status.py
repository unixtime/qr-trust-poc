from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import asyncpg

from backend.app.core.config import config
from backend.app.services.database_url import asyncpg_dsn, database_dsn_label
from backend.app.schemas.poc import (
    ScannerDecisionOperatorStatusResponse,
    ScannerDecisionPersistenceReportResponse,
    ScannerDecisionRecentResponse,
)


_SCANNER_DECISION_REPORT_QUERY = """
with windowed as (
  select *
  from qr_trust.scanner_decisions
  where created_at >= (
    $1::timestamptz - make_interval(secs => $2::integer)
  )
),
metrics as (
  select
    count(*)::integer as total_count,
    count(*) filter (where decision_color = 'green')::integer as green_count,
    count(*) filter (where decision_color = 'orange')::integer as orange_count,
    count(*) filter (where decision_color = 'red')::integer as red_count,
    count(*) filter (where hold_to_open_required)::integer as hold_required_count,
    coalesce(max(risk_score), 0)::integer as highest_risk_score
  from windowed
),
recent as (
  select
    decision_id,
    verifier_id,
    decision_color,
    decision_state,
    reason_codes,
    risk_score,
    destination_fingerprint,
    hold_to_open_required,
    hold_to_open_duration_ms,
    created_at
  from windowed
  order by created_at desc, decision_id asc
  limit $3::integer
)
select
  $1::timestamptz as observed_at,
  $2::integer as lookback_seconds,
  metrics.total_count,
  metrics.green_count,
  metrics.orange_count,
  metrics.red_count,
  metrics.hold_required_count,
  metrics.highest_risk_score,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'decision_id', recent.decision_id,
          'verifier_id', recent.verifier_id,
          'decision_color', recent.decision_color,
          'decision_state', recent.decision_state,
          'reason_codes', recent.reason_codes,
          'risk_score', recent.risk_score,
          'destination_fingerprint', recent.destination_fingerprint,
          'hold_to_open_required', recent.hold_to_open_required,
          'hold_to_open_duration_ms', recent.hold_to_open_duration_ms,
          'created_at', recent.created_at
        )
        order by recent.created_at desc, recent.decision_id asc
      )
      from recent
    ),
    '[]'::jsonb
  ) as recent_decisions
from metrics
"""


async def load_scanner_decision_operator_status(
    *,
    lookback_seconds: int = 3600,
    recent_limit: int = 8,
) -> ScannerDecisionOperatorStatusResponse:
    dsn = config.QRTRUST_NETWORK_DATABASE_URL
    if not dsn:
        return ScannerDecisionOperatorStatusResponse(
            status="unavailable",
            persistence_state="unconfigured",
            summary="Scanner-decision persistence is not configured for this runtime.",
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
            _SCANNER_DECISION_REPORT_QUERY,
            observed_at,
            lookback_seconds,
            recent_limit,
        )
        if row is None:
            raise RuntimeError("Scanner decision report query returned no row.")

        report = _decode_report_row(row)
        status, reasons = _summarize_report(report)
        return ScannerDecisionOperatorStatusResponse(
            status=status,
            persistence_state="observable",
            summary=_summary_for_status(status, reasons),
            reasons=reasons,
            database_configured=True,
            database_dsn_label=database_dsn_label(dsn),
            report=report,
        )
    except Exception as exc:
        return ScannerDecisionOperatorStatusResponse(
            status="unavailable",
            persistence_state="unavailable",
            summary="Scanner-decision persistence could not be loaded.",
            reasons=["scanner_decisions_unavailable"],
            database_configured=True,
            database_dsn_label=database_dsn_label(dsn),
            error=str(exc),
        )
    finally:
        if connection is not None:
            await connection.close()


def _decode_report_row(row: asyncpg.Record) -> ScannerDecisionPersistenceReportResponse:
    return ScannerDecisionPersistenceReportResponse(
        observed_at=_iso_timestamp(row["observed_at"]),
        lookback_seconds=_int_field(row["lookback_seconds"]),
        total_count=_int_field(row["total_count"]),
        green_count=_int_field(row["green_count"]),
        orange_count=_int_field(row["orange_count"]),
        red_count=_int_field(row["red_count"]),
        hold_required_count=_int_field(row["hold_required_count"]),
        highest_risk_score=_int_field(row["highest_risk_score"]),
        recent_decisions=_decode_recent_decisions(row["recent_decisions"]),
    )


def _decode_recent_decisions(value: Any) -> list[ScannerDecisionRecentResponse]:
    rows = _jsonb_value(value)
    if rows is None:
        return []
    if not isinstance(rows, list):
        raise RuntimeError("Scanner decision recent_decisions is not an array.")

    return [
        ScannerDecisionRecentResponse(
            decision_id=str(row["decision_id"]),
            verifier_id=str(row["verifier_id"]),
            decision_color=str(row["decision_color"]),
            decision_state=str(row["decision_state"]),
            reason_codes=_string_list(row.get("reason_codes")),
            risk_score=_optional_int_field(row.get("risk_score")),
            destination_fingerprint=row.get("destination_fingerprint"),
            hold_to_open_required=bool(row["hold_to_open_required"]),
            hold_to_open_duration_ms=_int_field(row["hold_to_open_duration_ms"]),
            created_at=_iso_timestamp(row["created_at"]),
        )
        for row in rows
        if isinstance(row, dict)
    ]


def _summarize_report(
    report: ScannerDecisionPersistenceReportResponse,
) -> tuple[str, list[str]]:
    if report.total_count == 0:
        return "degraded", ["no_scanner_decisions"]
    return "healthy", []


def _summary_for_status(status: str, reasons: list[str]) -> str:
    if status == "healthy":
        return "Scanner-decision persistence is recording verifier outcomes."
    if status == "degraded":
        return f"Scanner-decision persistence needs evidence: {', '.join(reasons)}."
    if status == "blocked":
        return f"Scanner-decision persistence shows active block conditions: {', '.join(reasons)}."
    return "Scanner-decision persistence is unavailable."


def _jsonb_value(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def _string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise RuntimeError("Scanner decision reason_codes is not an array.")
    if any(not isinstance(item, str) for item in value):
        raise RuntimeError("Scanner decision reason_codes contains non-string values.")
    return value


def _int_field(value: Any) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.isnumeric():
        return int(value)
    raise RuntimeError("Scanner decision report contained a non-integer field.")


def _optional_int_field(value: Any) -> int | None:
    if value is None:
        return None
    return _int_field(value)


def _iso_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    return str(value)
