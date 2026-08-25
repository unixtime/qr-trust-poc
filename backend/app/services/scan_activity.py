from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from typing import Any

import asyncpg

from backend.app.core.config import config
from backend.app.schemas.poc import (
    ScanActivityDecisionResponse,
    ScanActivityReplayGuardResponse,
    ScanActivityResponse,
)
from backend.app.services.database_url import asyncpg_dsn
from backend.app.services.scanner_decision_status import (
    _int_field,
    _iso_timestamp,
    _jsonb_value,
    _optional_int_field,
    _string_list,
)


NONCE_FINGERPRINT_HEX_LENGTH = 16
DEFAULT_SCAN_ACTIVITY_LOOKBACK_SECONDS = 86_400


def nonce_fingerprint(nonce: str) -> str:
    """Truncated SHA-256 of a QR nonce: stable for lookups, useless for replay."""
    return sha256(nonce.encode("utf-8")).hexdigest()[:NONCE_FINGERPRINT_HEX_LENGTH]


_SCAN_ACTIVITY_QUERY = """
with matched as (
  select *
  from qr_trust.scanner_decisions
  where nonce_fingerprint = $1::text
    and created_at >= (
      $2::timestamptz - make_interval(secs => $3::integer)
    )
    and ($4::timestamptz is null or created_at >= $4::timestamptz)
)
select
  count(*)::integer as scan_count,
  count(*) filter (where decision_color = 'green')::integer as green_count,
  count(*) filter (where decision_color = 'orange')::integer as orange_count,
  count(*) filter (where decision_color = 'red')::integer as red_count,
  min(created_at) filter (where decision_color = 'green') as first_verified_at,
  count(*) filter (
    where decision_color = 'red'
      and created_at > (
        select min(first_green.created_at)
        from matched as first_green
        where first_green.decision_color = 'green'
      )
  )::integer as blocked_since_verified,
  min(created_at) as first_scanned_at,
  max(created_at) as last_scanned_at,
  (
    select jsonb_build_object(
      'decision_id', latest.decision_id,
      'verifier_id', latest.verifier_id,
      'decision_color', latest.decision_color,
      'decision_state', latest.decision_state,
      'reason_codes', latest.reason_codes,
      'risk_score', latest.risk_score,
      'destination_fingerprint', latest.destination_fingerprint,
      'usage_policy', latest.usage_policy,
      'hold_to_open_required', latest.hold_to_open_required,
      'hold_to_open_duration_ms', latest.hold_to_open_duration_ms,
      'client_platform', latest.client_platform,
      'created_at', latest.created_at
    )
    from matched as latest
    order by latest.created_at desc, latest.decision_id asc
    limit 1
  ) as latest
from matched
""".strip()


def _no_replay_guard() -> ScanActivityReplayGuardResponse:
    return ScanActivityReplayGuardResponse(applies=False, state="not_applicable")


async def load_scan_activity(
    fingerprint: str,
    *,
    lookback_seconds: int = DEFAULT_SCAN_ACTIVITY_LOOKBACK_SECONDS,
    issued_at: datetime | None = None,
) -> ScanActivityResponse:
    """Read back every recorded scan of one QR from the evidence store.

    ``issued_at`` narrows the read to this issuance of the nonce: scans recorded
    before it belong to an earlier code that happened to carry the same nonce.
    The replay-guard view is left at ``not_applicable``; the endpoint layers the
    live one-time state on top because the guard is process-local, not stored.
    """
    issued_at_text = _optional_timestamp(issued_at)
    dsn = config.QRTRUST_NETWORK_DATABASE_URL
    if not dsn:
        return ScanActivityResponse(
            nonce_fingerprint=fingerprint,
            persistence_state="unconfigured",
            lookback_seconds=lookback_seconds,
            issued_at=issued_at_text,
            scan_count=0,
            green_count=0,
            orange_count=0,
            red_count=0,
            replay_guard=_no_replay_guard(),
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
            _SCAN_ACTIVITY_QUERY,
            fingerprint,
            observed_at,
            lookback_seconds,
            issued_at,
        )
        if row is None:
            raise RuntimeError("Scan activity query returned no row.")
        return ScanActivityResponse(
            nonce_fingerprint=fingerprint,
            persistence_state="observable",
            lookback_seconds=lookback_seconds,
            issued_at=issued_at_text,
            scan_count=_int_field(row["scan_count"]),
            green_count=_int_field(row["green_count"]),
            orange_count=_int_field(row["orange_count"]),
            red_count=_int_field(row["red_count"]),
            first_scanned_at=_optional_timestamp(row["first_scanned_at"]),
            last_scanned_at=_optional_timestamp(row["last_scanned_at"]),
            first_verified_at=_optional_timestamp(row["first_verified_at"]),
            blocked_since_verified=_int_field(row["blocked_since_verified"]),
            latest=_decode_latest(row["latest"]),
            replay_guard=_no_replay_guard(),
        )
    except Exception as exc:
        return ScanActivityResponse(
            nonce_fingerprint=fingerprint,
            persistence_state="unavailable",
            lookback_seconds=lookback_seconds,
            issued_at=issued_at_text,
            scan_count=0,
            green_count=0,
            orange_count=0,
            red_count=0,
            replay_guard=_no_replay_guard(),
            error=str(exc),
        )
    finally:
        if connection is not None:
            await connection.close()


def _optional_timestamp(value: Any) -> str | None:
    return None if value is None else _iso_timestamp(value)


def _decode_latest(value: Any) -> ScanActivityDecisionResponse | None:
    row = _jsonb_value(value)
    if row is None:
        return None
    if not isinstance(row, dict):
        raise RuntimeError("Scan activity latest decision is not an object.")
    client_platform = row.get("client_platform")
    return ScanActivityDecisionResponse(
        decision_id=str(row["decision_id"]),
        verifier_id=str(row["verifier_id"]),
        decision_color=str(row["decision_color"]),
        decision_state=str(row["decision_state"]),
        reason_codes=_string_list(row.get("reason_codes")),
        risk_score=_optional_int_field(row.get("risk_score")),
        destination_fingerprint=row.get("destination_fingerprint"),
        usage_policy=row.get("usage_policy"),
        hold_to_open_required=bool(row["hold_to_open_required"]),
        hold_to_open_duration_ms=_int_field(row["hold_to_open_duration_ms"]),
        created_at=_iso_timestamp(row["created_at"]),
        client_platform=None if client_platform is None else str(client_platform),
    )
