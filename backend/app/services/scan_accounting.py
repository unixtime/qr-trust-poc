"""Scan accounting and the per-nonce scan-spike alert.

Both readers work over the scanner evidence store (``qr_trust.scanner_decisions``)
and take an open asyncpg connection, so the management endpoint and the
background monitor share one query each:

* ``load_issuer_day_accounting`` -- scans per issuer per UTC day (cost accounting).
* ``detect_nonce_spikes`` -- nonces whose scans in the trailing window exceed
  their own per-window baseline; the monitor turns those into
  ``scanner.spike.detected`` outbox events, the endpoint just shows them.

The evidence store is the single source of truth here: no extra counters, no
Redis dependency, and the alert survives API restarts because the bucketed
``event_id`` deduplicates on the outbox's unique constraint.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg

from backend.app.core.config import config
from backend.app.schemas.management import ScanAccountingIssuerDayRecord, ScanSpikeRecord
from backend.app.services.database_url import asyncpg_dsn
from backend.app.services.verdict_cache import shared_verdict_cache

logger = logging.getLogger(__name__)

SCAN_SPIKE_EVENT_TYPE = "scanner.spike.detected"
SCAN_SPIKE_MONITOR_ALERT_LIMIT = 100

_ISSUER_DAY_QUERY = """
select
  issuer_id,
  date_trunc('day', created_at at time zone 'UTC') as day,
  count(*)::integer as scan_count,
  count(*) filter (where decision_color = 'green')::integer as green_count,
  count(*) filter (where decision_color = 'orange')::integer as orange_count,
  count(*) filter (where decision_color = 'red')::integer as red_count,
  count(distinct nonce_fingerprint)::integer as distinct_nonces
from qr_trust.scanner_decisions
where created_at >= $1 and created_at < $2
group by issuer_id, date_trunc('day', created_at at time zone 'UTC')
order by day desc, scan_count desc, issuer_id nulls last
limit $3
"""

# One row per nonce seen in the baseline window; recent_count is the slice of
# those rows that also fall inside the trailing alert window.
_NONCE_SPIKE_QUERY = """
select
  nonce_fingerprint,
  max(issuer_id) as issuer_id,
  max(root_program_id) as root_program_id,
  max(usage_policy) as usage_policy,
  count(*) filter (where created_at >= $2)::integer as recent_count,
  count(*)::integer as baseline_count
from qr_trust.scanner_decisions
where nonce_fingerprint is not null and created_at >= $1
group by nonce_fingerprint
order by recent_count desc
limit $3
"""

# Candidate nonces fetched per tick before the cache counters are merged in. A
# warm-cache flood leaves only ~2 evidence rows a minute (one per verdict TTL),
# so the candidate set must be wider than the alert limit or busier-but-honest
# nonces would crowd the flooded one out of the fetch.
SCAN_SPIKE_CANDIDATE_LIMIT = 500

_SCAN_SPIKE_OUTBOX_INSERT = """
insert into qr_trust.event_outbox (
  event_id,
  event_type,
  aggregate_type,
  aggregate_id,
  artifact_id,
  artifact_hash,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id,
  payload
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
on conflict (event_id) do nothing
"""


def _json_dumps(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _int_value(value: Any) -> int:
    return int(value) if value is not None else 0


def _optional_str(value: Any) -> str | None:
    return None if value is None else str(value)


def _day_label(value: Any) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    return str(value)[:10]


async def load_issuer_day_accounting(
    connection: Any,
    *,
    since: datetime,
    until: datetime,
    limit: int,
) -> list[ScanAccountingIssuerDayRecord]:
    rows = await connection.fetch(_ISSUER_DAY_QUERY, since, until, limit)
    return [
        ScanAccountingIssuerDayRecord(
            issuer_id=_optional_str(row["issuer_id"]),
            day=_day_label(row["day"]),
            scan_count=_int_value(row["scan_count"]),
            green_count=_int_value(row["green_count"]),
            orange_count=_int_value(row["orange_count"]),
            red_count=_int_value(row["red_count"]),
            distinct_nonces=_int_value(row["distinct_nonces"]),
        )
        for row in rows
    ]


async def detect_nonce_spikes(
    connection: Any,
    *,
    now: datetime,
    window_seconds: int,
    baseline_seconds: int,
    threshold_ratio: float,
    min_scans: int,
    limit: int,
    verdict_cache: Any | None = None,
) -> list[ScanSpikeRecord]:
    """Return nonces whose trailing-window burst clears the floor and the ratio.

    The baseline is the nonce's own history: scans in the baseline window that
    fall *outside* the alert window, scaled to one window's worth. A nonce with
    no history at all has a zero baseline and is a spike as soon as it clears
    ``min_scans`` -- a brand-new reusable code being hammered is exactly the
    flood case.

    Counts merge two sources. Evidence rows cover computed verdicts; the verdict
    cache's minute buckets cover the scans it answered without touching the
    database or the nonce budget. Without the second source a warm cache hides
    almost the whole flood from this detector. Every cached hit implies a
    computed verdict inside the cache TTL, so each flooded nonce has at least
    one recent evidence row and appears in the candidate fetch.
    """
    baseline_start = now - timedelta(seconds=baseline_seconds)
    window_start = now - timedelta(seconds=window_seconds)
    rows = await connection.fetch(
        _NONCE_SPIKE_QUERY, baseline_start, window_start, max(limit, SCAN_SPIKE_CANDIDATE_LIMIT)
    )
    remaining_seconds = baseline_seconds - window_seconds
    spikes: list[ScanSpikeRecord] = []
    for row in rows:
        fingerprint = str(row["nonce_fingerprint"])
        cached_recent = 0
        cached_baseline = 0
        if verdict_cache is not None:
            cached_recent = await verdict_cache.cached_scan_count(
                fingerprint, since=window_start.timestamp(), until=now.timestamp()
            )
            cached_baseline = await verdict_cache.cached_scan_count(
                fingerprint, since=baseline_start.timestamp(), until=now.timestamp()
            )
        recent = _int_value(row["recent_count"]) + cached_recent
        baseline = _int_value(row["baseline_count"]) + cached_baseline
        prior = max(0, baseline - recent)
        if remaining_seconds > 0:
            baseline_per_window = prior * window_seconds / remaining_seconds
        else:
            baseline_per_window = 0.0
        ratio = recent / baseline_per_window if baseline_per_window > 0 else None
        if recent < min_scans:
            continue
        if ratio is not None and ratio < threshold_ratio:
            continue
        spikes.append(
            ScanSpikeRecord(
                nonce_fingerprint=fingerprint,
                issuer_id=_optional_str(row["issuer_id"]),
                root_program_id=_optional_str(row["root_program_id"]),
                usage_policy=_optional_str(row["usage_policy"]),
                recent_count=recent,
                baseline_count=baseline,
                cached_recent_count=cached_recent,
                cached_baseline_count=cached_baseline,
                baseline_per_window=baseline_per_window,
                ratio=ratio,
                threshold_ratio=threshold_ratio,
                min_scans=min_scans,
                window_seconds=window_seconds,
                baseline_seconds=baseline_seconds,
                observed_at=now.isoformat(),
            )
        )
    spikes.sort(key=lambda spike: spike.recent_count, reverse=True)
    return spikes[:limit]


def scan_spike_event_id(spike: ScanSpikeRecord, *, baseline_seconds: int) -> str:
    """One alert per nonce per baseline-length bucket.

    Ticks inside the same bucket (and other API replicas) collide on this id
    and the outbox insert's ``on conflict do nothing`` drops the duplicate.
    """
    observed = datetime.fromisoformat(spike.observed_at)
    bucket = int(observed.timestamp()) // max(1, baseline_seconds)
    return f"evt_scan_spike_{spike.nonce_fingerprint}_{bucket}"


async def emit_scan_spike_events(
    connection: Any,
    spikes: list[ScanSpikeRecord],
    *,
    baseline_seconds: int,
) -> int:
    inserted = 0
    for spike in spikes:
        if spike.root_program_id is None:
            # Unsigned payloads leave no root program on their evidence rows and
            # the relay refuses trust-state subjects under the control-plane
            # root, so the spike stays on /admin/scan-accounting only.
            logger.warning(
                "scan-spike monitor: nonce %s spiked (%d scans in window) but "
                "carries no root program; not written to the outbox",
                spike.nonce_fingerprint,
                spike.recent_count,
            )
            continue
        event_id = scan_spike_event_id(spike, baseline_seconds=baseline_seconds)
        envelope, body = scan_spike_outbox_payload(spike, event_id=event_id)
        result = await connection.execute(
            _SCAN_SPIKE_OUTBOX_INSERT,
            event_id,
            SCAN_SPIKE_EVENT_TYPE,
            "nonce",
            spike.nonce_fingerprint,
            envelope["artifact_ref"],
            envelope["artifact_hash"],
            envelope["root_program_id"],
            None,
            spike.issuer_id,
            None,
            _json_dumps({"envelope": envelope, "body": body}),
        )
        inserted += _rows_affected(result)
    return inserted


def scan_spike_outbox_payload(
    spike: ScanSpikeRecord, *, event_id: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Build the (envelope, body) pair the outbox relay expects.

    The relay only publishes payloads shaped ``{"envelope": ..., "body": ...}``
    and validates the envelope against the shared event contract, so the spike
    record travels as the body of a standard envelope. Unsigned payloads leave
    no root program on the evidence row; those alerts publish under the control
    plane like other governance events without a root.
    """
    body = spike.model_dump()
    body_json = _json_dumps(body)
    envelope: dict[str, Any] = {
        "event_id": event_id,
        "type": SCAN_SPIKE_EVENT_TYPE,
        "occurred_at": spike.observed_at,
        "root_program_id": spike.root_program_id,
        "artifact_id": event_id,
        "artifact_hash": "sha256:" + hashlib.sha256(body_json.encode("utf-8")).hexdigest(),
        "artifact_ref": f"scan_spike:{spike.nonce_fingerprint}",
        "version": 1,
        "reason": "scan_spike",
    }
    if spike.issuer_id:
        envelope["issuer_id"] = spike.issuer_id
    return envelope, body


def _rows_affected(command_tag: Any) -> int:
    try:
        return int(str(command_tag).rsplit(" ", 1)[-1])
    except (TypeError, ValueError):
        return 0


def scan_spike_monitor_enabled() -> bool:
    return bool(config.QRTRUST_NETWORK_DATABASE_URL) and (
        config.VERIFIER_SCAN_SPIKE_INTERVAL_SECONDS > 0
    )


async def run_scan_spike_monitor_tick(*, now: datetime | None = None) -> int:
    """Evaluate the detector once and write alerts; never raises."""
    database_url = config.QRTRUST_NETWORK_DATABASE_URL
    if not database_url:
        return 0
    observed_at = now or datetime.now(timezone.utc)
    baseline_seconds = max(1, config.VERIFIER_SCAN_SPIKE_BASELINE_SECONDS)
    connection: Any = None
    try:
        connection = await asyncpg.connect(
            asyncpg_dsn(database_url), timeout=1.5, command_timeout=5.0
        )
        spikes = await detect_nonce_spikes(
            connection,
            now=observed_at,
            window_seconds=max(1, config.VERIFIER_SCAN_SPIKE_WINDOW_SECONDS),
            baseline_seconds=baseline_seconds,
            threshold_ratio=max(0.0, config.VERIFIER_SCAN_SPIKE_RATIO),
            min_scans=max(0, config.VERIFIER_SCAN_SPIKE_MIN_SCANS),
            limit=SCAN_SPIKE_MONITOR_ALERT_LIMIT,
            verdict_cache=shared_verdict_cache,
        )
        inserted = await emit_scan_spike_events(
            connection, spikes, baseline_seconds=baseline_seconds
        )
        if inserted:
            logger.warning(
                "scan spike: %s new alert(s) written to the outbox for %s",
                inserted,
                ", ".join(spike.nonce_fingerprint for spike in spikes),
            )
        return inserted
    except Exception as exc:  # the monitor must outlive a flaky database
        logger.warning("scan-spike monitor tick skipped: %s", exc)
        return 0
    finally:
        if connection is not None:
            try:
                await connection.close()
            except Exception as exc:  # pragma: no cover - best effort
                logger.debug("scan-spike monitor: connection close failed: %s", exc)


async def run_scan_spike_monitor() -> None:
    """Background loop started from the app lifespan; cancelled at shutdown."""
    while True:
        await run_scan_spike_monitor_tick()
        await asyncio.sleep(max(1, config.VERIFIER_SCAN_SPIKE_INTERVAL_SECONDS))
