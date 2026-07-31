from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import pytest

from backend.app.core.config import config
from backend.app.schemas.poc import (
    ScannerDecisionAction,
    ScannerDecisionContract,
    ScannerDecisionContractCacheFreshness,
    ScannerDecisionContractDestination,
    ScannerDecisionContractHoldToOpen,
    ScannerDecisionContractTrustPath,
    ScannerDecisionContractTrustStep,
    ScannerDecisionDestination,
    ScannerDecisionGovernance,
    ScannerDecisionIssuer,
    ScannerDecisionResponse,
    ScannerDecisionSignal,
)
from backend.app.services import network_evidence_recorder


class FakeEvidenceConnection:
    def __init__(self) -> None:
        self.execute_calls: list[tuple[Any, ...]] = []
        self.closed = False
        self.transaction_started = False
        self.transaction_committed = False
        self.transaction_rolled_back = False

    async def execute(self, *args: Any) -> str:
        self.execute_calls.append(args)
        return "INSERT 0 1"

    def transaction(self) -> "FakeEvidenceTransaction":
        return FakeEvidenceTransaction(self)

    async def close(self) -> None:
        self.closed = True


class FakeEvidenceTransaction:
    def __init__(self, connection: FakeEvidenceConnection) -> None:
        self._connection = connection

    async def __aenter__(self) -> "FakeEvidenceTransaction":
        self._connection.transaction_started = True
        return self

    async def __aexit__(self, exc_type: Any, *_args: Any) -> None:
        if exc_type is None:
            self._connection.transaction_committed = True
            return
        self._connection.transaction_rolled_back = True


class FailingOutboxEvidenceConnection(FakeEvidenceConnection):
    async def execute(self, *args: Any) -> str:
        self.execute_calls.append(args)
        if "qr_trust.event_outbox" in str(args[0]):
            raise RuntimeError("event outbox unavailable")
        return "INSERT 0 1"


def _trust_step(status: str, reason_codes: list[str] | None = None) -> ScannerDecisionContractTrustStep:
    return ScannerDecisionContractTrustStep(
        status=status,
        label=status.replace("_", " ").title(),
        message=f"{status} message",
        reason_codes=reason_codes or [],
    )


def _scanner_response(
    *,
    decision_state: str = "verified_issuer",
    runtime_state: str = "clean",
    runtime_reason: str = "Runtime safety provider found no current block or warning condition.",
) -> ScannerDecisionResponse:
    contract = ScannerDecisionContract(
        decision_id="scan_test_001",
        decided_at="2026-05-24T12:00:00Z",
        decision_color="green",
        decision_state=decision_state,
        reason_codes=[],
        risk_score=0,
        destination=ScannerDecisionContractDestination(
            display_host="acme.example",
            fingerprint="acme.example",
            url="https://acme.example/pay",
            final_url="https://acme.example/pay",
        ),
        trust_path=ScannerDecisionContractTrustPath(
            issuer_legitimacy=_trust_step("recognized"),
            destination_binding=_trust_step("bound"),
            runtime_safety=_trust_step(runtime_state),
            scanner_decision=_trust_step("verified_issuer"),
        ),
        hold_to_open=ScannerDecisionContractHoldToOpen(
            required=False,
            duration_ms=0,
            reason_codes=[],
        ),
        cache_freshness=ScannerDecisionContractCacheFreshness(
            status="fresh",
            cache_generated_at="2026-05-24T11:00:00Z",
            cache_expires_at="2026-05-24T13:00:00Z",
        ),
        governance={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "destination_policy_id": "policy:acme-demo:web-payments:v1",
        },
    )
    governance = ScannerDecisionGovernance(
        root_program_id="root:qrtrust-demo:2026",
        delegated_authority_id="authority:qrtrust-demo:merchant-web",
        issuer_id="issuer:acme-demo",
        issuer_namespace_label=(
            "(root:qrtrust-demo:2026, authority:qrtrust-demo:merchant-web, issuer:acme-demo)"
        ),
        issuer_display_name="ACME Demo",
        assurance_tier="verified_business",
        destination_policy_id="policy:acme-demo:web-payments:v1",
        cache_entry_id="cache:acme-demo:2026-05-15",
        cache_freshness_state="fresh",
        cache_state_published_at="2026-05-24T11:00:00Z",
        cache_generated_at="2026-05-24T11:00:00Z",
        cache_expires_at="2026-05-24T13:00:00Z",
        max_staleness_seconds=300,
        stale_behavior="downgrade_or_block",
        source_artifacts={},
    )
    return ScannerDecisionResponse(
        decision_state=decision_state,
        open_allowed=True,
        usage_policy="reusable_public",
        primary_message="Verified reusable QR.",
        issuer=ScannerDecisionIssuer(
            name="ACME Demo",
            tier="verified_business",
            status="recognized",
        ),
        destination=ScannerDecisionDestination(
            display_url="https://acme.example/pay",
            host="acme.example",
            binding="bound",
            final_url="https://acme.example/pay",
        ),
        governance=governance,
        signals=[
            ScannerDecisionSignal(layer="issuer_legitimacy", state="recognized"),
            ScannerDecisionSignal(layer="destination_binding", state="bound"),
            ScannerDecisionSignal(
                layer="runtime_safety",
                state=runtime_state,
                message=runtime_reason,
            ),
            ScannerDecisionSignal(layer="scanner_decision", state="verified_issuer"),
        ],
        actions=[
            ScannerDecisionAction(id="open_destination", label="Open", style="primary")
        ],
        contract=contract,
        verifier_stage="accepted",
        verifier_reason="accepted",
        request_id="scan_test_001",
    )


@pytest.mark.asyncio
async def test_record_scanner_evidence_writes_decision_and_runtime_observation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = FakeEvidenceConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeEvidenceConnection:
        return connection

    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(config, "QRTRUST_SCANNER_VERIFIER_ID", "verifier:test")
    monkeypatch.setattr(network_evidence_recorder.asyncpg, "connect", _fake_connect)

    result = await network_evidence_recorder.record_scanner_evidence(
        _scanner_response()
    )

    assert result.scanner_decisions_inserted == 1
    assert result.runtime_observations_inserted == 1
    assert result.scanner_events_enqueued == 1
    assert result.error is None
    assert connection.closed is True
    assert connection.transaction_started is True
    assert connection.transaction_committed is True
    assert len(connection.execute_calls) == 3

    scanner_insert = connection.execute_calls[0]
    assert "qr_trust.scanner_decisions" in scanner_insert[0]
    assert scanner_insert[1] == "scan_test_001"
    assert scanner_insert[2] == "verifier:test"
    assert scanner_insert[3:6] == ("green", "verified_issuer", [])
    assert scanner_insert[12] == "policy:acme-demo:web-payments:v1"
    assert scanner_insert[13] == "reusable_public"
    assert json.loads(scanner_insert[16])["runtime_safety"]["status"] == "clean"
    assert isinstance(scanner_insert[17], datetime)

    runtime_insert = connection.execute_calls[1]
    assert "qr_trust.runtime_observations" in runtime_insert[0]
    assert runtime_insert[1] == "deterministic-runtime-safety"
    assert runtime_insert[2:7] == (
        "acme.example",
        "https://acme.example/pay",
        "https://acme.example/pay",
        "clear",
        0,
    )
    assert runtime_insert[7] == ["runtime_clear"]
    assert isinstance(runtime_insert[8], datetime)

    outbox_insert = connection.execute_calls[2]
    assert "qr_trust.event_outbox" in outbox_insert[0]
    assert outbox_insert[1:11] == (
        "evt_scan_test_001",
        "scanner.decision.recorded",
        "scanner_decision",
        "scan_test_001",
        "scan_test_001",
        outbox_insert[6],
        "root:qrtrust-demo:2026",
        "authority:qrtrust-demo:merchant-web",
        "issuer:acme-demo",
        "policy:acme-demo:web-payments:v1",
    )
    assert outbox_insert[6].startswith("sha256:")
    assert len(outbox_insert[6]) == 71
    payload = json.loads(outbox_insert[11])
    assert payload["envelope"]["event_id"] == "evt_scan_test_001"
    assert payload["envelope"]["type"] == "scanner.decision.recorded"
    assert payload["envelope"]["artifact_id"] == "scan_test_001"
    assert payload["envelope"]["artifact_hash"] == outbox_insert[6]
    assert payload["body"]["decision_id"] == "scan_test_001"


@pytest.mark.asyncio
async def test_record_scanner_evidence_does_not_report_rolled_back_inserts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = FailingOutboxEvidenceConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FailingOutboxEvidenceConnection:
        return connection

    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(network_evidence_recorder.asyncpg, "connect", _fake_connect)

    result = await network_evidence_recorder.record_scanner_evidence(
        _scanner_response()
    )

    assert result.scanner_decisions_inserted == 0
    assert result.runtime_observations_inserted == 0
    assert result.scanner_events_enqueued == 0
    assert result.error == "event outbox unavailable"
    assert connection.transaction_started is True
    assert connection.transaction_committed is False
    assert connection.transaction_rolled_back is True


@pytest.mark.asyncio
async def test_record_scanner_evidence_skips_runtime_when_not_evaluated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = FakeEvidenceConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeEvidenceConnection:
        return connection

    response = _scanner_response(runtime_state="not_evaluated")
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://user:pass@db/qr")
    monkeypatch.setattr(network_evidence_recorder.asyncpg, "connect", _fake_connect)

    result = await network_evidence_recorder.record_scanner_evidence(response)

    assert result.scanner_decisions_inserted == 1
    assert result.runtime_observations_inserted == 0
    assert result.scanner_events_enqueued == 1
    assert len(connection.execute_calls) == 2
    assert "qr_trust.event_outbox" in connection.execute_calls[1][0]


@pytest.mark.asyncio
async def test_record_scanner_evidence_does_not_enqueue_event_without_governance_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = FakeEvidenceConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeEvidenceConnection:
        return connection

    response = _scanner_response(
        decision_state="unverified",
        runtime_state="not_evaluated",
    )
    assert response.contract is not None
    response = response.model_copy(
        update={
            "governance": None,
            "contract": response.contract.model_copy(update={"governance": {}}),
        }
    )
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://user:pass@db/qr")
    monkeypatch.setattr(network_evidence_recorder.asyncpg, "connect", _fake_connect)

    result = await network_evidence_recorder.record_scanner_evidence(response)

    assert result.scanner_decisions_inserted == 1
    assert result.runtime_observations_inserted == 0
    assert result.scanner_events_enqueued == 0
    assert result.error is None
    assert len(connection.execute_calls) == 1
    assert "qr_trust.scanner_decisions" in connection.execute_calls[0][0]


@pytest.mark.asyncio
async def test_record_scanner_evidence_defaults_runtime_final_url_to_destination(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = FakeEvidenceConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeEvidenceConnection:
        return connection

    response = _scanner_response()
    assert response.contract is not None
    response = response.model_copy(
        update={
            "destination": response.destination.model_copy(update={"final_url": None}),
            "contract": response.contract.model_copy(
                update={
                    "destination": response.contract.destination.model_copy(
                        update={"final_url": None}
                    )
                }
            ),
        }
    )
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "postgresql://user:pass@db/qr")
    monkeypatch.setattr(network_evidence_recorder.asyncpg, "connect", _fake_connect)

    result = await network_evidence_recorder.record_scanner_evidence(response)

    assert result.runtime_observations_inserted == 1
    runtime_insert = connection.execute_calls[1]
    assert runtime_insert[4] == "https://acme.example/pay"
