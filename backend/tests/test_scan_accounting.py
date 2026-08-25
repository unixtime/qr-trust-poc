from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from backend.app.core.config import config
from backend.app.services import scan_accounting


class FakeAccountingConnection:
    def __init__(
        self,
        *,
        accounting_rows: list[dict[str, Any]] | None = None,
        spike_rows: list[dict[str, Any]] | None = None,
    ) -> None:
        self.accounting_rows = accounting_rows or []
        self.spike_rows = spike_rows or []
        self.fetch_calls: list[tuple[str, tuple[Any, ...]]] = []
        self.execute_calls: list[tuple[str, tuple[Any, ...]]] = []
        self.closed = False

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        self.fetch_calls.append((query, args))
        if "date_trunc" in query:
            return self.accounting_rows
        return self.spike_rows

    async def execute(self, query: str, *args: Any) -> str:
        self.execute_calls.append((query, args))
        return "INSERT 0 1"

    async def close(self) -> None:
        self.closed = True


NOW = datetime(2026, 8, 25, 12, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_issuer_day_accounting_groups_by_issuer_and_utc_day() -> None:
    connection = FakeAccountingConnection(
        accounting_rows=[
            {
                "issuer_id": "issuer-a",
                "day": datetime(2026, 8, 25, tzinfo=timezone.utc),
                "scan_count": 42,
                "green_count": 40,
                "orange_count": 1,
                "red_count": 1,
                "distinct_nonces": 7,
            },
            {
                "issuer_id": None,
                "day": datetime(2026, 8, 24, tzinfo=timezone.utc),
                "scan_count": 3,
                "green_count": 0,
                "orange_count": 0,
                "red_count": 3,
                "distinct_nonces": 1,
            },
        ]
    )
    since = NOW - timedelta(days=6)

    rows = await scan_accounting.load_issuer_day_accounting(
        connection, since=since, until=NOW, limit=200
    )

    query, args = connection.fetch_calls[0]
    assert "qr_trust.scanner_decisions" in query
    assert "date_trunc('day'" in query
    assert "group by" in query.lower()
    assert args == (since, NOW, 200)
    assert rows[0].issuer_id == "issuer-a"
    assert rows[0].day == "2026-08-25"
    assert rows[0].scan_count == 42
    assert rows[0].green_count == 40
    assert rows[0].distinct_nonces == 7
    assert rows[1].issuer_id is None
    assert rows[1].red_count == 3


def _spike_row(
    fingerprint: str,
    recent: int,
    baseline: int,
    *,
    issuer_id: str | None = "issuer:a",
    root_program_id: str | None = "root:program-a",
) -> dict[str, Any]:
    return {
        "nonce_fingerprint": fingerprint,
        "issuer_id": issuer_id,
        "root_program_id": root_program_id,
        "usage_policy": "reusable_public",
        "recent_count": recent,
        "baseline_count": baseline,
    }


@pytest.mark.asyncio
async def test_detect_nonce_spikes_flags_only_bursts_above_baseline() -> None:
    connection = FakeAccountingConnection(
        spike_rows=[
            _spike_row("fp-burst", 60, 120),
            _spike_row("fp-steady", 40, 3000),
            _spike_row("fp-new", 30, 30, issuer_id=None),
        ]
    )

    spikes = await scan_accounting.detect_nonce_spikes(
        connection,
        now=NOW,
        window_seconds=60,
        baseline_seconds=3600,
        threshold_ratio=10.0,
        min_scans=30,
        limit=50,
    )

    query, args = connection.fetch_calls[0]
    assert "nonce_fingerprint is not null" in query
    assert "max(root_program_id) as root_program_id" in query
    assert args == (
        NOW - timedelta(seconds=3600),
        NOW - timedelta(seconds=60),
        scan_accounting.SCAN_SPIKE_CANDIDATE_LIMIT,
    )

    by_fp = {spike.nonce_fingerprint: spike for spike in spikes}
    assert set(by_fp) == {"fp-burst", "fp-new"}

    burst = by_fp["fp-burst"]
    # 60 prior scans spread over the 59 non-window minutes ~= 1.02 per minute.
    assert burst.baseline_per_window == pytest.approx(60 * 60 / 3540)
    assert burst.ratio == pytest.approx(60 / (60 * 60 / 3540))
    assert burst.recent_count == 60
    assert burst.baseline_count == 120
    assert burst.root_program_id == "root:program-a"
    assert burst.cached_recent_count == 0
    assert burst.cached_baseline_count == 0
    assert burst.window_seconds == 60
    assert burst.baseline_seconds == 3600
    assert burst.observed_at == NOW.isoformat()

    fresh = by_fp["fp-new"]
    assert fresh.issuer_id is None
    assert fresh.baseline_per_window == 0.0
    assert fresh.ratio is None


class FakeVerdictCache:
    """Answers cached-scan counts keyed by (fingerprint, window length in seconds)."""

    def __init__(self, counts: dict[tuple[str, int], int]) -> None:
        self.counts = counts
        self.calls: list[tuple[str, float, float]] = []

    async def cached_scan_count(self, fingerprint: str, *, since: float, until: float) -> int:
        self.calls.append((fingerprint, since, until))
        return self.counts.get((fingerprint, int(round(until - since))), 0)


@pytest.mark.asyncio
async def test_detect_nonce_spikes_adds_cached_verdict_hits() -> None:
    # A warm verdict cache answers most of a flood without writing evidence rows,
    # so the detector must merge the cache's own per-minute counters.
    connection = FakeAccountingConnection(
        spike_rows=[_spike_row("fp-quiet", 1, 1), _spike_row("fp-warm", 2, 2)]
    )
    cache = FakeVerdictCache({("fp-warm", 60): 45, ("fp-warm", 3600): 45})

    spikes = await scan_accounting.detect_nonce_spikes(
        connection,
        now=NOW,
        window_seconds=60,
        baseline_seconds=3600,
        threshold_ratio=10.0,
        min_scans=30,
        limit=50,
        verdict_cache=cache,
    )

    assert [spike.nonce_fingerprint for spike in spikes] == ["fp-warm"]
    warm = spikes[0]
    assert warm.recent_count == 47
    assert warm.baseline_count == 47
    assert warm.cached_recent_count == 45
    assert warm.cached_baseline_count == 45
    assert warm.ratio is None
    window_start = (NOW - timedelta(seconds=60)).timestamp()
    baseline_start = (NOW - timedelta(seconds=3600)).timestamp()
    assert ("fp-warm", window_start, NOW.timestamp()) in cache.calls
    assert ("fp-warm", baseline_start, NOW.timestamp()) in cache.calls


@pytest.mark.asyncio
async def test_detect_nonce_spikes_respects_min_scan_floor() -> None:
    connection = FakeAccountingConnection(spike_rows=[_spike_row("fp-small", 12, 12)])

    spikes = await scan_accounting.detect_nonce_spikes(
        connection,
        now=NOW,
        window_seconds=60,
        baseline_seconds=3600,
        threshold_ratio=10.0,
        min_scans=30,
        limit=50,
    )

    assert spikes == []


@pytest.mark.asyncio
async def test_emit_scan_spike_events_writes_deduplicated_outbox_rows() -> None:
    connection = FakeAccountingConnection(spike_rows=[_spike_row("fp-burst", 60, 120)])
    spikes = await scan_accounting.detect_nonce_spikes(
        connection,
        now=NOW,
        window_seconds=60,
        baseline_seconds=3600,
        threshold_ratio=10.0,
        min_scans=30,
        limit=50,
    )

    inserted = await scan_accounting.emit_scan_spike_events(
        connection, spikes, baseline_seconds=3600
    )

    assert inserted == 1
    query, args = connection.execute_calls[0]
    assert "insert into qr_trust.event_outbox" in query
    assert "on conflict (event_id) do nothing" in query
    bucket = int(NOW.timestamp()) // 3600
    assert args[0] == f"evt_scan_spike_fp-burst_{bucket}"
    assert args[1] == "scanner.spike.detected"
    assert args[2] == "nonce"
    assert args[3] == "fp-burst"
    assert args[4] == "scan_spike:fp-burst"
    assert args[5].startswith("sha256:") and len(args[5]) == len("sha256:") + 64
    assert args[6] == "root:program-a"
    assert args[8] == "issuer:a"
    payload = json.loads(args[10])
    # The NATS relay refuses any outbox payload that is not an event envelope
    # plus body, so the spike record rides as the body of a standard envelope.
    envelope = payload["envelope"]
    assert envelope["event_id"] == args[0]
    assert envelope["type"] == "scanner.spike.detected"
    assert envelope["occurred_at"] == NOW.isoformat()
    assert envelope["root_program_id"] == "root:program-a"
    assert envelope["issuer_id"] == "issuer:a"
    assert envelope["artifact_id"] == args[0]
    assert envelope["artifact_hash"] == args[5]
    assert envelope["artifact_ref"] == "scan_spike:fp-burst"
    assert envelope["version"] == 1
    assert envelope["reason"] == "scan_spike"
    assert "delegated_authority_id" not in envelope
    assert "destination_policy_id" not in envelope
    body = payload["body"]
    assert body["nonce_fingerprint"] == "fp-burst"
    assert body["recent_count"] == 60
    assert body["cached_recent_count"] == 0
    assert body["threshold_ratio"] == 10.0
    assert body["min_scans"] == 30
    assert body["observed_at"] == NOW.isoformat()


@pytest.mark.asyncio
async def test_emit_scan_spike_events_skips_unattributed_spikes(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # Evidence rows from unsigned payloads carry no root program. The relay
    # refuses trust-state subjects under the control-plane root, so such
    # spikes stay visible on /admin/scan-accounting but never reach the outbox.
    connection = FakeAccountingConnection(
        spike_rows=[
            _spike_row("fp-anon", 60, 120, issuer_id=None, root_program_id=None),
            _spike_row("fp-burst", 60, 120),
        ]
    )
    spikes = await scan_accounting.detect_nonce_spikes(
        connection,
        now=NOW,
        window_seconds=60,
        baseline_seconds=3600,
        threshold_ratio=10.0,
        min_scans=30,
        limit=50,
    )

    with caplog.at_level("WARNING", logger=scan_accounting.logger.name):
        inserted = await scan_accounting.emit_scan_spike_events(
            connection, spikes, baseline_seconds=3600
        )

    assert inserted == 1
    assert len(connection.execute_calls) == 1
    _, args = connection.execute_calls[0]
    assert args[3] == "fp-burst"
    assert args[6] == "root:program-a"
    assert any("fp-anon" in record.getMessage() for record in caplog.records)


def test_scan_spike_monitor_disabled_without_database(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", None)
    monkeypatch.setattr(config, "VERIFIER_SCAN_SPIKE_INTERVAL_SECONDS", 60)
    assert scan_accounting.scan_spike_monitor_enabled() is False

    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://lab:lab@db.example:5432/lab")
    monkeypatch.setattr(config, "VERIFIER_SCAN_SPIKE_INTERVAL_SECONDS", 0)
    assert scan_accounting.scan_spike_monitor_enabled() is False

    monkeypatch.setattr(config, "VERIFIER_SCAN_SPIKE_INTERVAL_SECONDS", 60)
    assert scan_accounting.scan_spike_monitor_enabled() is True


@pytest.mark.asyncio
async def test_scan_spike_monitor_tick_survives_connection_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://lab:lab@db.example:5432/lab")

    async def _failing_connect(*args: Any, **kwargs: Any) -> Any:
        raise ConnectionError("database down")

    monkeypatch.setattr(scan_accounting.asyncpg, "connect", _failing_connect)

    inserted = await scan_accounting.run_scan_spike_monitor_tick(now=NOW)

    assert inserted == 0


@pytest.mark.asyncio
async def test_scan_spike_monitor_tick_emits_and_closes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://lab:lab@db.example:5432/lab")
    monkeypatch.setattr(config, "VERIFIER_SCAN_SPIKE_MIN_SCANS", 30)
    monkeypatch.setattr(config, "VERIFIER_SCAN_SPIKE_RATIO", 10.0)
    connection = FakeAccountingConnection(spike_rows=[_spike_row("fp-burst", 60, 120)])

    async def _connect(*args: Any, **kwargs: Any) -> FakeAccountingConnection:
        return connection

    monkeypatch.setattr(scan_accounting.asyncpg, "connect", _connect)

    inserted = await scan_accounting.run_scan_spike_monitor_tick(now=NOW)

    assert inserted == 1
    assert connection.closed is True


@pytest.mark.asyncio
async def test_scan_spike_monitor_tick_logs_close_failure(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    # A connection that cannot be closed cleanly must neither kill the tick
    # nor vanish silently: the alert count stands and the failure is logged.
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://lab:lab@db.example:5432/lab")
    monkeypatch.setattr(config, "VERIFIER_SCAN_SPIKE_MIN_SCANS", 30)
    monkeypatch.setattr(config, "VERIFIER_SCAN_SPIKE_RATIO", 10.0)

    class StuckConnection(FakeAccountingConnection):
        async def close(self) -> None:
            raise ConnectionError("socket already gone")

    connection = StuckConnection(spike_rows=[_spike_row("fp-burst", 60, 120)])

    async def _connect(*args: Any, **kwargs: Any) -> StuckConnection:
        return connection

    monkeypatch.setattr(scan_accounting.asyncpg, "connect", _connect)

    with caplog.at_level("DEBUG", logger=scan_accounting.logger.name):
        inserted = await scan_accounting.run_scan_spike_monitor_tick(now=NOW)

    assert inserted == 1
    assert any("socket already gone" in record.getMessage() for record in caplog.records)


def test_lifespan_starts_and_cancels_spike_monitor(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    from backend.app.main import app
    from backend.app.services.redis_service import redis_service

    async def _noop() -> None:
        return None

    monkeypatch.setattr(redis_service, "connect", _noop)
    monkeypatch.setattr(redis_service, "disconnect", _noop)
    monkeypatch.setattr(config, "REDIS_STARTUP_ENABLED", False)
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://lab:lab@db.example:5432/lab")
    monkeypatch.setattr(config, "VERIFIER_SCAN_SPIKE_INTERVAL_SECONDS", 60)

    state = {"started": False, "cancelled": False}

    async def _fake_monitor() -> None:
        state["started"] = True
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            state["cancelled"] = True
            raise

    monkeypatch.setattr(scan_accounting, "run_scan_spike_monitor", _fake_monitor)

    with TestClient(app):
        assert state["started"] is True
        assert state["cancelled"] is False

    assert state["cancelled"] is True
