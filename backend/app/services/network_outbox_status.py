from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import asyncpg

from backend.app.core.config import config
from backend.app.services.database_url import asyncpg_dsn, database_dsn_label
from backend.app.schemas.poc import (
    NetworkOutboxFailedRowResponse,
    NetworkOutboxMetricsResponse,
    NetworkOutboxOperatorStatusResponse,
)


_METRICS_QUERY = """
with metrics as (
  select
    count(*) filter (where publish_status = 'pending')::integer as pending_count,
    count(*) filter (where publish_status = 'publishing')::integer as publishing_count,
    count(*) filter (where publish_status = 'published')::integer as published_count,
    count(*) filter (where publish_status = 'failed')::integer as failed_count,
    count(*) filter (where publish_status = 'quarantined')::integer as quarantined_count,
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
  metrics.quarantined_count,
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
  metrics.quarantined_count,
  metrics.stale_claim_count,
  metrics.retryable_failed_count,
  metrics.oldest_pending_age_ms,
  metrics.oldest_failed_age_ms,
  metrics.max_attempts
"""


async def load_network_outbox_operator_status() -> NetworkOutboxOperatorStatusResponse:
    dsn = config.QRTRUST_NETWORK_DATABASE_URL
    if not dsn:
        return NetworkOutboxOperatorStatusResponse(
            status="unavailable",
            supervisor_state="unconfigured",
            summary="Network outbox metrics are not configured for this runtime.",
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
            _METRICS_QUERY,
            observed_at,
            10,
            3,
        )
        if row is None:
            raise RuntimeError("Network outbox metrics query returned no row.")

        metrics = _decode_metrics_row(row)
        status, reasons = _summarize_metrics(metrics)
        return NetworkOutboxOperatorStatusResponse(
            status=status,
            supervisor_state="observable",
            summary=_summary_for_status(status, reasons),
            reasons=reasons,
            database_configured=True,
            database_dsn_label=database_dsn_label(dsn),
            metrics=metrics,
        )
    except Exception as exc:
        return NetworkOutboxOperatorStatusResponse(
            status="unavailable",
            supervisor_state="unavailable",
            summary="Network outbox metrics could not be loaded.",
            reasons=["network_outbox_unavailable"],
            database_configured=True,
            database_dsn_label=database_dsn_label(dsn),
            error=str(exc),
        )
    finally:
        if connection is not None:
            await connection.close()


def _decode_metrics_row(row: asyncpg.Record) -> NetworkOutboxMetricsResponse:
    failed_rows = _decode_failed_rows(row["failed_rows"])
    return NetworkOutboxMetricsResponse(
        observed_at=_iso_timestamp(row["observed_at"]),
        pending_count=_int_field(row["pending_count"]),
        publishing_count=_int_field(row["publishing_count"]),
        published_count=_int_field(row["published_count"]),
        failed_count=_int_field(row["failed_count"]),
        quarantined_count=_int_field(row["quarantined_count"]),
        stale_claim_count=_int_field(row["stale_claim_count"]),
        retryable_failed_count=_int_field(row["retryable_failed_count"]),
        oldest_pending_age_ms=_int_field(row["oldest_pending_age_ms"]),
        oldest_failed_age_ms=_int_field(row["oldest_failed_age_ms"]),
        max_attempts=_int_field(row["max_attempts"]),
        failed_rows=failed_rows,
    )


def _decode_failed_rows(value: Any) -> list[NetworkOutboxFailedRowResponse]:
    rows = json.loads(value) if isinstance(value, str) else value
    if rows is None:
        return []
    if not isinstance(rows, list):
        raise RuntimeError("Network outbox failed_rows is not an array.")

    return [
        NetworkOutboxFailedRowResponse(
            outbox_id=str(row["outbox_id"]),
            event_id=str(row["event_id"]),
            event_type=str(row["event_type"]),
            attempts=_int_field(row["attempts"]),
            last_error=row.get("last_error"),
            created_at=_iso_timestamp(row["created_at"]),
        )
        for row in rows
        if isinstance(row, dict)
    ]


def _summarize_metrics(
    metrics: NetworkOutboxMetricsResponse,
) -> tuple[str, list[str]]:
    reasons: list[str] = []
    if metrics.failed_count > 0:
        reasons.append("failed_rows")
    if metrics.quarantined_count > 0:
        reasons.append("quarantined_rows")
    if metrics.stale_claim_count > 0:
        reasons.append("stale_claims")
    if metrics.oldest_pending_age_ms >= 60_000:
        reasons.append("pending_lag")
    if metrics.retryable_failed_count > 0:
        reasons.append("retry_candidates")

    if (
        metrics.failed_count > 0
        or metrics.quarantined_count > 0
        or metrics.stale_claim_count > 0
    ):
        return "blocked", reasons
    if reasons:
        return "degraded", reasons
    return "healthy", []


def _summary_for_status(status: str, reasons: list[str]) -> str:
    if status == "healthy":
        return "Network outbox propagation is observable and healthy."
    if status == "degraded":
        return f"Network outbox propagation is delayed: {', '.join(reasons)}."
    if status == "blocked":
        return f"Network outbox propagation needs operator attention: {', '.join(reasons)}."
    return "Network outbox metrics are unavailable."


def _int_field(value: Any) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.isnumeric():
        return int(value)
    raise RuntimeError("Network outbox metrics contained a non-integer field.")


def _iso_timestamp(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    return str(value)
