from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import pytest

from backend.app.core.config import config
from backend.app.services import network_outbox_status


_OBSERVED_AT = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)


class FakeNetworkOutboxConnection:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self.row = row
        self.closed = False
        self.fetch_args: tuple[Any, ...] | None = None

    async def fetchrow(self, *args: Any) -> dict[str, Any] | None:
        self.fetch_args = args
        return self.row

    async def close(self) -> None:
        self.closed = True


def _network_outbox_row(
    *,
    pending_count: int = 0,
    publishing_count: int = 0,
    published_count: int = 0,
    failed_count: int = 0,
    quarantined_count: int = 0,
    stale_claim_count: int = 0,
    retryable_failed_count: int = 0,
    oldest_pending_age_ms: int = 0,
    oldest_failed_age_ms: int = 0,
    max_attempts: int = 0,
    failed_rows: Any | None = None,
) -> dict[str, Any]:
    return {
        "observed_at": _OBSERVED_AT,
        "pending_count": pending_count,
        "publishing_count": publishing_count,
        "published_count": published_count,
        "failed_count": failed_count,
        "quarantined_count": quarantined_count,
        "stale_claim_count": stale_claim_count,
        "retryable_failed_count": retryable_failed_count,
        "oldest_pending_age_ms": oldest_pending_age_ms,
        "oldest_failed_age_ms": oldest_failed_age_ms,
        "max_attempts": max_attempts,
        "failed_rows": failed_rows if failed_rows is not None else [],
    }


@pytest.mark.asyncio
async def test_network_outbox_status_is_unconfigured_without_network_dsn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _unexpected_connect(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("network outbox loader should not connect without a DSN")

    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", None)
    monkeypatch.setattr(network_outbox_status.asyncpg, "connect", _unexpected_connect)

    result = await network_outbox_status.load_network_outbox_operator_status()

    assert result.status == "unavailable"
    assert result.supervisor_state == "unconfigured"
    assert result.database_configured is False
    assert result.reasons == ["network_database_unconfigured"]
    assert result.metrics is None


@pytest.mark.asyncio
async def test_network_outbox_status_decodes_healthy_metrics_and_binds_datetime(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    failed_rows = json.dumps([])
    connection = FakeNetworkOutboxConnection(
        _network_outbox_row(
            pending_count=0,
            publishing_count=0,
            published_count=3,
            failed_count=0,
            stale_claim_count=0,
            retryable_failed_count=0,
            failed_rows=failed_rows,
        )
    )
    connect_calls: list[dict[str, Any]] = []

    async def _fake_connect(*args: Any, **kwargs: Any) -> FakeNetworkOutboxConnection:
        connect_calls.append({"args": args, "kwargs": kwargs})
        return connection

    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql+asyncpg://publisher:publisher@db:5432/qr_trust_network",
    )
    monkeypatch.setattr(network_outbox_status.asyncpg, "connect", _fake_connect)

    result = await network_outbox_status.load_network_outbox_operator_status()

    assert connect_calls[0]["args"] == ("postgresql://publisher:publisher@db:5432/qr_trust_network",)
    assert connect_calls[0]["kwargs"] == {"timeout": 1.5, "command_timeout": 2.0}
    assert connection.fetch_args is not None
    assert "qr_trust.event_outbox" in connection.fetch_args[0]
    assert isinstance(connection.fetch_args[1], datetime)
    assert connection.fetch_args[2:] == (10, 3)
    assert connection.closed is True

    assert result.status == "healthy"
    assert result.supervisor_state == "observable"
    assert result.summary == "Network outbox propagation is observable and healthy."
    assert result.reasons == []
    assert result.database_configured is True
    assert result.database_dsn_label == "db:5432/qr_trust_network"
    assert result.metrics is not None
    assert result.metrics.published_count == 3
    assert result.metrics.quarantined_count == 0
    assert result.metrics.observed_at == "2026-05-19T12:00:00Z"


@pytest.mark.asyncio
async def test_network_outbox_status_blocks_on_quarantined_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = FakeNetworkOutboxConnection(
        _network_outbox_row(
            pending_count=0,
            publishing_count=0,
            published_count=3,
            failed_count=0,
            quarantined_count=1,
            stale_claim_count=0,
            retryable_failed_count=0,
        )
    )

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeNetworkOutboxConnection:
        return connection

    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://publisher:publisher@db:5432/qr_trust_network",
    )
    monkeypatch.setattr(network_outbox_status.asyncpg, "connect", _fake_connect)

    result = await network_outbox_status.load_network_outbox_operator_status()

    assert result.status == "blocked"
    assert result.reasons == ["quarantined_rows"]
    assert result.metrics is not None
    assert result.metrics.quarantined_count == 1


@pytest.mark.asyncio
async def test_network_outbox_status_handles_malformed_dsn_port_on_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_connect(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("connect failed")

    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://publisher:publisher@db:99999/qr_trust_network",
    )
    monkeypatch.setattr(network_outbox_status.asyncpg, "connect", _fake_connect)

    result = await network_outbox_status.load_network_outbox_operator_status()

    assert result.status == "unavailable"
    assert result.supervisor_state == "unavailable"
    assert result.reasons == ["network_outbox_unavailable"]
    assert result.database_dsn_label == "db/qr_trust_network"
    assert result.error == "connect failed"
