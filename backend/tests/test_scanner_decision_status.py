from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import pytest

from backend.app.core.config import config
from backend.app.services import scanner_decision_status


_OBSERVED_AT = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)


class FakeScannerDecisionConnection:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self.row = row
        self.closed = False
        self.fetch_args: tuple[Any, ...] | None = None

    async def fetchrow(self, *args: Any) -> dict[str, Any] | None:
        self.fetch_args = args
        return self.row

    async def close(self) -> None:
        self.closed = True


def _scanner_decision_row(
    *,
    total_count: int,
    green_count: int = 0,
    orange_count: int = 0,
    red_count: int = 0,
    hold_required_count: int = 0,
    highest_risk_score: int = 0,
    recent_decisions: Any | None = None,
) -> dict[str, Any]:
    return {
        "observed_at": _OBSERVED_AT,
        "lookback_seconds": 3600,
        "total_count": total_count,
        "green_count": green_count,
        "orange_count": orange_count,
        "red_count": red_count,
        "hold_required_count": hold_required_count,
        "highest_risk_score": highest_risk_score,
        "recent_decisions": recent_decisions if recent_decisions is not None else [],
    }


@pytest.mark.asyncio
async def test_scanner_decision_status_is_unconfigured_without_network_dsn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _unexpected_connect(*_args: Any, **_kwargs: Any) -> None:
        raise AssertionError("scanner decision loader should not connect without a DSN")

    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", None)
    monkeypatch.setattr(scanner_decision_status.asyncpg, "connect", _unexpected_connect)

    result = await scanner_decision_status.load_scanner_decision_operator_status()

    assert result.status == "unavailable"
    assert result.persistence_state == "unconfigured"
    assert result.database_configured is False
    assert result.reasons == ["network_database_unconfigured"]
    assert result.report is None


@pytest.mark.asyncio
async def test_scanner_decision_status_decodes_healthy_report_and_masks_dsn(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recent_decisions = json.dumps(
        [
            {
                "decision_id": "decision-001",
                "verifier_id": "verifier-a",
                "decision_color": "orange",
                "decision_state": "hold_to_open",
                "reason_codes": ["net_new_domain", "redirect_chain"],
                "risk_score": 42,
                "destination_fingerprint": "pay.example",
                "usage_policy": "reusable_public",
                "hold_to_open_required": True,
                "hold_to_open_duration_ms": 800,
                "created_at": "2026-05-19T12:00:00Z",
            }
        ]
    )
    connection = FakeScannerDecisionConnection(
        _scanner_decision_row(
            total_count=4,
            green_count=2,
            orange_count=1,
            red_count=1,
            hold_required_count=2,
            highest_risk_score=68,
            recent_decisions=recent_decisions,
        )
    )
    connect_calls: list[dict[str, Any]] = []

    async def _fake_connect(*args: Any, **kwargs: Any) -> FakeScannerDecisionConnection:
        connect_calls.append({"args": args, "kwargs": kwargs})
        return connection

    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql+asyncpg://publisher:publisher@db:5432/qr_trust_network",
    )
    monkeypatch.setattr(scanner_decision_status.asyncpg, "connect", _fake_connect)

    result = await scanner_decision_status.load_scanner_decision_operator_status(
        lookback_seconds=900,
        recent_limit=5,
    )

    assert connect_calls[0]["args"] == ("postgresql://publisher:publisher@db:5432/qr_trust_network",)
    assert connect_calls[0]["kwargs"] == {"timeout": 1.5, "command_timeout": 2.0}
    assert connection.fetch_args is not None
    assert "qr_trust.scanner_decisions" in connection.fetch_args[0]
    assert isinstance(connection.fetch_args[1], datetime)
    assert connection.fetch_args[2:] == (900, 5)
    assert connection.closed is True

    assert result.status == "healthy"
    assert result.persistence_state == "observable"
    assert result.summary == "Scanner-decision persistence is recording verifier outcomes."
    assert result.reasons == []
    assert result.database_configured is True
    assert result.database_dsn_label == "db:5432/qr_trust_network"
    assert result.report is not None
    assert result.report.total_count == 4
    assert result.report.orange_count == 1
    assert result.report.highest_risk_score == 68
    assert result.report.recent_decisions[0].decision_id == "decision-001"
    assert result.report.recent_decisions[0].reason_codes == [
        "net_new_domain",
        "redirect_chain",
    ]


@pytest.mark.asyncio
async def test_scanner_decision_status_reports_no_rows_as_degraded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = FakeScannerDecisionConnection(_scanner_decision_row(total_count=0))

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeScannerDecisionConnection:
        return connection

    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://user:pass@db/qr")
    monkeypatch.setattr(scanner_decision_status.asyncpg, "connect", _fake_connect)

    result = await scanner_decision_status.load_scanner_decision_operator_status()

    assert result.status == "degraded"
    assert result.reasons == ["no_scanner_decisions"]
    assert result.summary == "Scanner-decision persistence needs evidence: no_scanner_decisions."
    assert connection.closed is True


@pytest.mark.asyncio
async def test_scanner_decision_status_closes_connection_when_decode_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = FakeScannerDecisionConnection(
        _scanner_decision_row(
            total_count=1,
            orange_count=1,
            recent_decisions=[
                {
                    "decision_id": "decision-bad",
                    "verifier_id": "verifier-a",
                    "decision_color": "orange",
                    "decision_state": "caution",
                    "reason_codes": "net_new_domain",
                    "risk_score": 42,
                    "destination_fingerprint": "pay.example",
                    "usage_policy": "reusable_public",
                    "hold_to_open_required": True,
                    "hold_to_open_duration_ms": 800,
                    "created_at": _OBSERVED_AT,
                }
            ],
        )
    )

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeScannerDecisionConnection:
        return connection

    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://user:pass@db/qr")
    monkeypatch.setattr(scanner_decision_status.asyncpg, "connect", _fake_connect)

    result = await scanner_decision_status.load_scanner_decision_operator_status()

    assert result.status == "unavailable"
    assert result.persistence_state == "unavailable"
    assert result.reasons == ["scanner_decisions_unavailable"]
    assert result.database_dsn_label == "db/qr"
    assert result.error is not None
    assert "reason_codes is not an array" in result.error
    assert connection.closed is True


@pytest.mark.asyncio
async def test_scanner_decision_status_handles_malformed_dsn_port_on_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_connect(*_args: Any, **_kwargs: Any) -> None:
        raise RuntimeError("connect failed")

    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://publisher:publisher@db:99999/qr_trust_network",
    )
    monkeypatch.setattr(scanner_decision_status.asyncpg, "connect", _fake_connect)

    result = await scanner_decision_status.load_scanner_decision_operator_status()

    assert result.status == "unavailable"
    assert result.persistence_state == "unavailable"
    assert result.reasons == ["scanner_decisions_unavailable"]
    assert result.database_dsn_label == "db/qr_trust_network"
    assert result.error == "connect failed"
