from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import pytest

from backend.app.core.config import config
from backend.app.services import runtime_observation_status as observation_status


_OBSERVED_AT = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)


class FakeRuntimeObservationConnection:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self.row = row
        self.closed = False
        self.fetch_args: tuple[Any, ...] | None = None

    async def fetchrow(self, *args: Any) -> dict[str, Any] | None:
        self.fetch_args = args
        return self.row

    async def close(self) -> None:
        self.closed = True


def _runtime_observation_row(
    *,
    total_count: int,
    clear_count: int = 0,
    risky_count: int = 0,
    blocked_count: int = 0,
    unavailable_count: int = 0,
    unknown_count: int = 0,
    expired_count: int = 0,
    highest_risk_score: int = 0,
    provider_reports: Any | None = None,
    top_hosts: Any | None = None,
) -> dict[str, Any]:
    return {
        "observed_at": _OBSERVED_AT,
        "lookback_seconds": 3600,
        "total_count": total_count,
        "clear_count": clear_count,
        "risky_count": risky_count,
        "blocked_count": blocked_count,
        "unavailable_count": unavailable_count,
        "unknown_count": unknown_count,
        "expired_count": expired_count,
        "highest_risk_score": highest_risk_score,
        "provider_reports": provider_reports if provider_reports is not None else [],
        "top_hosts": top_hosts if top_hosts is not None else [],
    }


def test_runtime_observation_report_query_selects_unknown_count() -> None:
    assert "metrics.unknown_count" in observation_status._RUNTIME_OBSERVATION_REPORT_QUERY


@pytest.mark.asyncio
async def test_runtime_observation_status_is_unconfigured_without_network_dsn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _unexpected_connect(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("runtime observation loader should not connect without a DSN")

    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", None)
    monkeypatch.setattr(observation_status.asyncpg, "connect", _unexpected_connect)

    result = await observation_status.load_runtime_observation_operator_status()

    assert result.status == "unavailable"
    assert result.observation_state == "unconfigured"
    assert result.database_configured is False
    assert result.reasons == ["network_database_unconfigured"]
    assert result.report is None


@pytest.mark.asyncio
async def test_runtime_observation_status_decodes_healthy_report_and_masks_dsn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_reports = json.dumps(
        [
            {
                "provider_id": "demo-provider",
                "total_count": 3,
                "risky_count": 0,
                "blocked_count": 0,
                "unavailable_count": 0,
                "last_observed_at": "2026-05-19T12:00:00Z",
            }
        ]
    )
    top_hosts = [
        {
            "destination_host": "pay.example",
            "verdict": "clear",
            "risk_score": 4,
            "reason_codes": [],
            "observed_at": _OBSERVED_AT,
            "final_url": "https://pay.example/checkout",
        }
    ]
    connection = FakeRuntimeObservationConnection(
        _runtime_observation_row(
            total_count=3,
            clear_count=3,
            highest_risk_score=4,
            provider_reports=provider_reports,
            top_hosts=top_hosts,
        )
    )
    connect_calls: list[dict[str, Any]] = []

    async def _fake_connect(*args: Any, **kwargs: Any) -> FakeRuntimeObservationConnection:
        connect_calls.append({"args": args, "kwargs": kwargs})
        return connection

    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql+asyncpg://publisher:publisher@db:5432/qr_trust_network",
    )
    monkeypatch.setattr(observation_status.asyncpg, "connect", _fake_connect)

    result = await observation_status.load_runtime_observation_operator_status(
        lookback_seconds=900,
        host_limit=5,
    )

    assert connect_calls[0]["args"] == ("postgresql://publisher:publisher@db:5432/qr_trust_network",)
    assert connect_calls[0]["kwargs"] == {"timeout": 1.5, "command_timeout": 2.0}
    assert connection.fetch_args is not None
    assert "qr_trust.runtime_observations" in connection.fetch_args[0]
    assert isinstance(connection.fetch_args[1], datetime)
    assert connection.fetch_args[2:] == (900, 5)
    assert connection.closed is True

    assert result.status == "healthy"
    assert result.observation_state == "observable"
    assert result.summary == "Runtime-safety observations are fresh and clear."
    assert result.reasons == []
    assert result.database_configured is True
    assert result.database_dsn_label == "db:5432/qr_trust_network"
    assert result.report is not None
    assert result.report.total_count == 3
    assert result.report.observed_at == "2026-05-19T12:00:00Z"
    assert result.report.provider_reports[0].provider_id == "demo-provider"
    assert result.report.top_hosts[0].destination_host == "pay.example"


@pytest.mark.asyncio
async def test_runtime_observation_status_reports_blocked_before_degraded_reasons(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = FakeRuntimeObservationConnection(
        _runtime_observation_row(
            total_count=4,
            clear_count=1,
            risky_count=1,
            blocked_count=1,
            unavailable_count=1,
            expired_count=1,
            highest_risk_score=92,
        )
    )

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeRuntimeObservationConnection:
        return connection

    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://user:pass@db/qr")
    monkeypatch.setattr(observation_status.asyncpg, "connect", _fake_connect)

    result = await observation_status.load_runtime_observation_operator_status()

    assert result.status == "blocked"
    assert result.reasons == [
        "runtime_blocks_present",
        "provider_unavailable",
        "expired_runtime_observations",
        "runtime_risk_present",
    ]
    assert result.summary == (
        "Runtime-safety observations show active block conditions: "
        "runtime_blocks_present, provider_unavailable, expired_runtime_observations, "
        "runtime_risk_present."
    )
    assert connection.closed is True


@pytest.mark.asyncio
async def test_runtime_observation_status_reports_unknown_runtime_as_degraded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = FakeRuntimeObservationConnection(
        _runtime_observation_row(
            total_count=1,
            unknown_count=1,
            highest_risk_score=30,
            top_hosts=[
                {
                    "destination_host": "acme.example",
                    "verdict": "unknown",
                    "risk_score": 30,
                    "reason_codes": ["runtime_stale"],
                    "observed_at": _OBSERVED_AT,
                    "final_url": "https://acme.example/pay?runtime=stale",
                }
            ],
        )
    )

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeRuntimeObservationConnection:
        return connection

    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://user:pass@db/qr")
    monkeypatch.setattr(observation_status.asyncpg, "connect", _fake_connect)

    result = await observation_status.load_runtime_observation_operator_status()

    assert result.status == "degraded"
    assert result.reasons == ["runtime_status_unknown"]
    assert result.report is not None
    assert result.report.unknown_count == 1
    assert result.report.top_hosts[0].verdict == "unknown"


@pytest.mark.asyncio
async def test_runtime_observation_status_closes_connection_when_decode_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = FakeRuntimeObservationConnection(
        _runtime_observation_row(
            total_count=1,
            risky_count=1,
            highest_risk_score=44,
            top_hosts=[
                {
                    "destination_host": "risky.example",
                    "verdict": "risky",
                    "risk_score": 44,
                    "reason_codes": "known_bad",
                    "observed_at": _OBSERVED_AT,
                    "final_url": "https://risky.example/pay",
                }
            ],
        )
    )

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeRuntimeObservationConnection:
        return connection

    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://user:pass@db/qr")
    monkeypatch.setattr(observation_status.asyncpg, "connect", _fake_connect)

    result = await observation_status.load_runtime_observation_operator_status()

    assert result.status == "unavailable"
    assert result.observation_state == "unavailable"
    assert result.reasons == ["runtime_observations_unavailable"]
    assert result.database_dsn_label == "db/qr"
    assert result.error is not None
    assert "reason_codes is not an array" in result.error
    assert connection.closed is True


@pytest.mark.asyncio
async def test_runtime_observation_status_handles_malformed_dsn_port_on_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_connect(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("connect failed")

    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://publisher:publisher@db:99999/qr_trust_network",
    )
    monkeypatch.setattr(observation_status.asyncpg, "connect", _fake_connect)

    result = await observation_status.load_runtime_observation_operator_status()

    assert result.status == "unavailable"
    assert result.observation_state == "unavailable"
    assert result.reasons == ["runtime_observations_unavailable"]
    assert result.database_dsn_label == "db/qr_trust_network"
    assert result.error == "connect failed"


@pytest.mark.asyncio
async def test_runtime_observation_status_reports_no_rows_as_degraded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = FakeRuntimeObservationConnection(_runtime_observation_row(total_count=0))

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeRuntimeObservationConnection:
        return connection

    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://user:pass@db/qr")
    monkeypatch.setattr(observation_status.asyncpg, "connect", _fake_connect)

    result = await observation_status.load_runtime_observation_operator_status()

    assert result.status == "degraded"
    assert result.reasons == ["no_runtime_observations"]
    assert result.summary == "Runtime-safety observations need review: no_runtime_observations."
