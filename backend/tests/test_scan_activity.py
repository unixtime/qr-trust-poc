"""Unit tests for the scan-activity evidence reader (no Postgres needed)."""

from __future__ import annotations

import pytest

from backend.app.core.config import config
from backend.app.schemas.poc import ScanActivityResponse, ScanActivityThrottleResponse
from backend.app.services import scan_activity
from backend.app.services.scan_activity import (
    ENVELOPE_FINGERPRINT_HEX_LENGTH,
    envelope_fingerprint,
    load_scan_activity,
)

ENVELOPE_ID = "a3" * 32


def test_envelope_fingerprint_is_first_16_hex_chars():
    assert ENVELOPE_FINGERPRINT_HEX_LENGTH == 16
    assert envelope_fingerprint(ENVELOPE_ID) == "a3" * 8
    assert envelope_fingerprint(ENVELOPE_ID.upper()) == "a3" * 8


def test_scan_activity_query_keys_on_envelope_fingerprint_only():
    query = scan_activity._SCAN_ACTIVITY_QUERY
    assert "envelope_fingerprint = $1::text" in query
    assert "nonce" not in query
    assert "$4" not in query


def test_config_uses_envelope_rate_limit_names():
    assert config.VERIFIER_ENVELOPE_RATE_LIMIT_WINDOW_SECONDS == 60
    assert config.VERIFIER_ENVELOPE_RATE_LIMIT_MAX_REQUESTS == 300
    assert not hasattr(config, "VERIFIER_NONCE_RATE_LIMIT_MAX_REQUESTS")


def test_scan_activity_response_has_no_replay_guard_or_issued_at():
    fields = ScanActivityResponse.model_fields
    assert "envelope_fingerprint" in fields
    assert "replay_guard" not in fields
    assert "issued_at" not in fields
    assert "nonce_fingerprint" not in fields
    throttle = ScanActivityThrottleResponse.model_fields
    assert {
        "envelope_budget_limit",
        "envelope_budget_remaining",
        "envelope_budget_window_seconds",
    } <= set(throttle)
    assert "nonce_budget_limit" not in throttle


@pytest.mark.asyncio
async def test_load_scan_activity_without_database_reports_unavailable(monkeypatch):
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", None)
    activity = await load_scan_activity("a3" * 8)
    assert activity.envelope_fingerprint == "a3" * 8
    assert activity.persistence_state == "unconfigured"
    assert activity.scan_count == 0


@pytest.mark.asyncio
async def test_load_scan_activity_reads_the_observable_path(monkeypatch):
    """The reader keys on the fingerprint alone: fingerprint, now, window — no fourth argument."""
    monkeypatch.setattr(
        config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://qr_admin:pw@db.invalid/qrtrust"
    )
    captured: dict[str, object] = {}

    class _Connection:
        async def fetchrow(self, query, *args):
            captured["query"] = query
            captured["args"] = args
            return {
                "scan_count": 3,
                "green_count": 2,
                "orange_count": 1,
                "red_count": 0,
                "first_scanned_at": None,
                "last_scanned_at": None,
                "first_verified_at": None,
                "blocked_since_verified": 0,
                "latest": None,
            }

        async def close(self):
            captured["closed"] = True

    async def _connect(*_args, **_kwargs):
        return _Connection()

    monkeypatch.setattr(scan_activity.asyncpg, "connect", _connect)
    activity = await load_scan_activity("a3" * 8, lookback_seconds=900)

    assert activity.persistence_state == "observable"
    assert activity.error is None
    assert (activity.scan_count, activity.green_count, activity.orange_count) == (3, 2, 1)
    args = captured["args"]
    assert len(args) == 3
    assert args[0] == "a3" * 8
    assert args[2] == 900
    assert captured["closed"] is True
