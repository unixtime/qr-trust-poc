"""Unit tests for the scan-activity evidence reader (no Postgres needed)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest

from backend.app.core.config import config
from backend.app.services import scan_activity as scan_activity_module
from backend.app.services.scan_activity import load_scan_activity


class _FakeConnection:
    def __init__(self, captured: dict[str, Any]) -> None:
        self._captured = captured

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any]:
        self._captured["query"] = query
        self._captured["args"] = args
        return {
            "scan_count": 0,
            "green_count": 0,
            "orange_count": 0,
            "red_count": 0,
            "first_verified_at": None,
            "blocked_since_verified": 0,
            "first_scanned_at": None,
            "last_scanned_at": None,
            "latest": None,
        }

    async def close(self) -> None:
        return None


@pytest.fixture
def captured_query(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    captured: dict[str, Any] = {}

    async def fake_connect(*_: Any, **__: Any) -> _FakeConnection:
        return _FakeConnection(captured)

    monkeypatch.setattr(scan_activity_module.asyncpg, "connect", fake_connect)
    monkeypatch.setattr(
        config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://lab:lab@db.example:5432/lab"
    )
    return captured


async def test_load_scan_activity_scopes_the_query_to_the_issuance(
    captured_query: dict[str, Any],
) -> None:
    issued_at = datetime(2026, 8, 25, 17, 36, 59, tzinfo=timezone.utc)

    activity = await load_scan_activity("0123456789abcdef", issued_at=issued_at)

    assert activity.persistence_state == "observable"
    assert activity.issued_at == "2026-08-25T17:36:59Z"
    assert captured_query["args"][0] == "0123456789abcdef"
    assert captured_query["args"][3] == issued_at
    assert "$4::timestamptz" in captured_query["query"]


async def test_load_scan_activity_without_issued_at_reads_the_whole_lookback(
    captured_query: dict[str, Any],
) -> None:
    activity = await load_scan_activity("0123456789abcdef")

    assert activity.issued_at is None
    assert captured_query["args"][3] is None
