from __future__ import annotations

import asyncio
import base64
import copy
import json
import re
import time
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import Any
from urllib.parse import quote

import pytest
import qrcode
from fastapi.testclient import TestClient

from backend.app.api.endpoints import verifier as verifier_endpoint
from backend.app.core.config import config
from backend.app.schemas.poc import (
    NetworkOutboxMetricsResponse,
    NetworkOutboxOperatorStatusResponse,
    RuntimeSafetyHostReportResponse,
    RuntimeSafetyObservationOperatorStatusResponse,
    RuntimeSafetyObservationReportResponse,
    RuntimeSafetyProviderReportResponse,
    ScannerDecisionOperatorStatusResponse,
    ScannerDecisionPersistenceReportResponse,
    ScannerDecisionRecentResponse,
    ScannerDecisionResponse,
)
from backend.app.schemas.poc import (
    ScanActivityDecisionResponse,
    ScanActivityResponse,
)
from backend.app.schemas.poc import TrustStoreResponse
from backend.app.services import verifier_api_key_service as api_key_service_module
from backend.app.services.scan_activity import envelope_fingerprint
from backend.app.services.qr_artifact_poc import (
    decode_envelope_from_qr_payload,
    decode_qr_payload_from_png_bytes,
    encode_envelope_as_qr_payload,
)


def _render_custom_qr_base64(payload: str, *, border: int) -> str:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=border,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white").get_image()
    output = BytesIO()
    image.convert("RGB").save(output, format="PNG")
    return base64.b64encode(output.getvalue()).decode("ascii")


def test_verifier_reference_api_accepts_a_signed_demo_envelope(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={},
    )
    assert demo_response.status_code == 200

    demo_payload = demo_response.json()
    assert "private_key_pem" not in demo_payload

    verify_request = demo_payload["verify_request"]

    first_result = client.post("/verifier/verify", json=verify_request)
    assert first_result.status_code == 200
    assert first_result.json()["allowed"] is True
    assert first_result.json()["stage"] == "accepted"


def test_root_serves_service_descriptor(client: TestClient) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"]
    payload = response.json()
    assert payload["service"] == "QR Code Verification API"
    assert payload["version"]
    assert payload["docs_url"] == "/docs"


def test_verifier_status_reports_runtime_posture(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", None)

    response = client.get("/verifier/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["api_key_auth_enabled"] is False
    assert payload["admin_api_key_management_enabled"] is False
    assert payload["api_key_header"] == "X-API-Key"
    assert payload["admin_header"] == "X-Admin-Token"
    assert payload["decode_image_fallback_enabled"] is True
    assert payload["redis_connected"] is False
    assert payload["distributed_rate_limiting_enabled"] is False
    assert payload["network_outbox"]["status"] == "unavailable"
    assert payload["network_outbox"]["supervisor_state"] == "unconfigured"
    assert payload["network_outbox"]["database_configured"] is False
    assert payload["scanner_decisions"]["status"] == "unavailable"
    assert payload["scanner_decisions"]["persistence_state"] == "unconfigured"
    assert payload["scanner_decisions"]["database_configured"] is False
    assert payload["runtime_observations"]["status"] == "unavailable"
    assert payload["runtime_observations"]["observation_state"] == "unconfigured"
    assert payload["runtime_observations"]["database_configured"] is False


def test_public_verifier_status_redacts_operator_evidence_when_auth_enabled(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _operator_status_should_not_load() -> NetworkOutboxOperatorStatusResponse:
        raise AssertionError("public status must not query operator outbox status")

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["status-admin"])
    monkeypatch.setattr(
        verifier_endpoint,
        "load_network_outbox_operator_status",
        _operator_status_should_not_load,
    )

    response = client.get("/verifier/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["api_key_auth_enabled"] is True
    assert payload["network_outbox"]["status"] == "unavailable"
    assert payload["network_outbox"]["database_dsn_label"] is None
    assert payload["scanner_decisions"]["status"] == "unavailable"
    assert payload["scanner_decisions"]["database_dsn_label"] is None
    assert payload["runtime_observations"]["status"] == "unavailable"
    assert payload["runtime_observations"]["database_dsn_label"] is None


def test_verifier_api_key_cannot_read_operator_evidence_when_auth_enabled(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _operator_status_should_not_load() -> NetworkOutboxOperatorStatusResponse:
        raise AssertionError("verifier client key must not query operator outbox status")

    monkeypatch.setattr(config, "VERIFIER_API_KEYS", ["status-client"])
    monkeypatch.setattr(
        verifier_endpoint,
        "load_network_outbox_operator_status",
        _operator_status_should_not_load,
    )

    response = client.get(
        "/verifier/status",
        headers={"X-API-Key": "status-client"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["api_key_auth_enabled"] is True
    assert payload["network_outbox"]["status"] == "unavailable"
    assert payload["network_outbox"]["database_dsn_label"] is None


def test_management_key_can_read_operator_evidence_when_auth_enabled(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeManagementCredentialConnection:
        async def fetchrow(self, *_args: Any) -> dict[str, Any]:
            return {
                "key_id": "mkey_status_reader",
                "operator_id": None,
                "scopes": ["audit:read"],
            }

        async def fetch(self, *_args: Any) -> list[dict[str, Any]]:
            return []

        async def close(self) -> None:
            return None

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementCredentialConnection:
        return FakeManagementCredentialConnection()

    async def _fake_network_outbox_status() -> NetworkOutboxOperatorStatusResponse:
        return NetworkOutboxOperatorStatusResponse(
            status="healthy",
            supervisor_state="observable",
            summary="Network outbox propagation is observable and healthy.",
            reasons=[],
            database_configured=True,
            database_dsn_label="127.0.0.1:5432/qr_trust_poc",
            metrics=NetworkOutboxMetricsResponse(
                observed_at="2026-05-18T00:00:00Z",
                pending_count=0,
                publishing_count=0,
                published_count=3,
                failed_count=0,
                stale_claim_count=0,
                retryable_failed_count=0,
                oldest_pending_age_ms=0,
                oldest_failed_age_ms=0,
                max_attempts=1,
                failed_rows=[],
            ),
        )

    class FakeAsyncpg:
        connect = staticmethod(_fake_connect)

    monkeypatch.setattr(config, "VERIFIER_API_KEYS", ["status-client"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(verifier_endpoint, "asyncpg", FakeAsyncpg, raising=False)
    monkeypatch.setattr(
        verifier_endpoint,
        "load_network_outbox_operator_status",
        _fake_network_outbox_status,
    )

    response = client.get(
        "/verifier/status",
        headers={"X-Admin-Token": "management-status-reader"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["network_outbox"]["status"] == "healthy"
    assert payload["network_outbox"]["database_dsn_label"] == "127.0.0.1:5432/qr_trust_poc"


def test_verifier_status_reports_network_outbox_posture(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_network_outbox_status() -> NetworkOutboxOperatorStatusResponse:
        return NetworkOutboxOperatorStatusResponse(
            status="healthy",
            supervisor_state="observable",
            summary="Network outbox propagation is observable and healthy.",
            reasons=[],
            database_configured=True,
            database_dsn_label="127.0.0.1:5432/qr_trust_poc",
            metrics=NetworkOutboxMetricsResponse(
                observed_at="2026-05-18T00:00:00Z",
                pending_count=0,
                publishing_count=0,
                published_count=3,
                failed_count=0,
                stale_claim_count=0,
                retryable_failed_count=0,
                oldest_pending_age_ms=0,
                oldest_failed_age_ms=0,
                max_attempts=1,
                failed_rows=[],
            ),
        )

    monkeypatch.setattr(
        verifier_endpoint,
        "load_network_outbox_operator_status",
        _fake_network_outbox_status,
    )

    response = client.get("/verifier/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["network_outbox"]["status"] == "healthy"
    assert payload["network_outbox"]["supervisor_state"] == "observable"
    assert payload["network_outbox"]["database_dsn_label"] == "127.0.0.1:5432/qr_trust_poc"
    assert payload["network_outbox"]["metrics"]["published_count"] == 3


def test_verifier_status_reports_scanner_decision_persistence(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_scanner_decision_status() -> ScannerDecisionOperatorStatusResponse:
        return ScannerDecisionOperatorStatusResponse(
            status="healthy",
            persistence_state="observable",
            summary="Scanner-decision persistence is recording verifier outcomes.",
            reasons=[],
            database_configured=True,
            database_dsn_label="127.0.0.1:5432/qr_trust_poc",
            report=ScannerDecisionPersistenceReportResponse(
                observed_at="2026-05-18T00:00:00Z",
                lookback_seconds=3600,
                total_count=2,
                green_count=1,
                orange_count=1,
                red_count=0,
                hold_required_count=1,
                highest_risk_score=42,
                recent_decisions=[
                    ScannerDecisionRecentResponse(
                        decision_id="decision-001",
                        verifier_id="verifier-a",
                        decision_color="orange",
                        decision_state="hold_to_open",
                        reason_codes=["net_new_domain"],
                        risk_score=42,
                        destination_fingerprint="pay.example",
                        hold_to_open_required=True,
                        hold_to_open_duration_ms=800,
                        created_at="2026-05-18T00:00:00Z",
                    )
                ],
            ),
        )

    monkeypatch.setattr(
        verifier_endpoint,
        "load_scanner_decision_operator_status",
        _fake_scanner_decision_status,
    )

    response = client.get("/verifier/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["scanner_decisions"]["status"] == "healthy"
    assert payload["scanner_decisions"]["persistence_state"] == "observable"
    assert payload["scanner_decisions"]["database_dsn_label"] == "127.0.0.1:5432/qr_trust_poc"
    assert payload["scanner_decisions"]["report"]["total_count"] == 2
    assert payload["scanner_decisions"]["report"]["hold_required_count"] == 1
    assert payload["scanner_decisions"]["report"]["recent_decisions"][0]["decision_id"] == (
        "decision-001"
    )


def test_verifier_status_reports_runtime_observation_posture(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_runtime_observation_status() -> RuntimeSafetyObservationOperatorStatusResponse:
        return RuntimeSafetyObservationOperatorStatusResponse(
            status="blocked",
            observation_state="observable",
            summary=(
                "Runtime-safety observations show active block conditions: "
                "runtime_blocks_present."
            ),
            reasons=["runtime_blocks_present"],
            database_configured=True,
            database_dsn_label="127.0.0.1:5432/qr_trust_poc",
            report=RuntimeSafetyObservationReportResponse(
                observed_at="2026-05-18T00:00:00Z",
                lookback_seconds=3600,
                total_count=2,
                clear_count=1,
                risky_count=0,
                blocked_count=1,
                unavailable_count=0,
                expired_count=0,
                highest_risk_score=82,
                provider_reports=[
                    RuntimeSafetyProviderReportResponse(
                        provider_id="demo-provider",
                        total_count=2,
                        risky_count=0,
                        blocked_count=1,
                        unavailable_count=0,
                        last_observed_at="2026-05-18T00:00:00Z",
                    )
                ],
                top_hosts=[
                    RuntimeSafetyHostReportResponse(
                        destination_host="evil.example",
                        verdict="blocked",
                        risk_score=82,
                        reason_codes=["known_bad"],
                        observed_at="2026-05-18T00:00:00Z",
                        final_url="https://evil.example/pay",
                    )
                ],
            ),
        )

    monkeypatch.setattr(
        verifier_endpoint,
        "load_runtime_observation_operator_status",
        _fake_runtime_observation_status,
    )

    response = client.get("/verifier/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["runtime_observations"]["status"] == "blocked"
    assert payload["runtime_observations"]["observation_state"] == "observable"
    assert payload["runtime_observations"]["database_dsn_label"] == "127.0.0.1:5432/qr_trust_poc"
    assert payload["runtime_observations"]["report"]["blocked_count"] == 1
    assert payload["runtime_observations"]["report"]["highest_risk_score"] == 82
    assert payload["runtime_observations"]["report"]["top_hosts"][0]["destination_host"] == (
        "evil.example"
    )


def test_admin_verifier_status_reports_operator_evidence_when_auth_enabled(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake_network_outbox_status() -> NetworkOutboxOperatorStatusResponse:
        return NetworkOutboxOperatorStatusResponse(
            status="healthy",
            supervisor_state="observable",
            summary="Network outbox propagation is observable and healthy.",
            reasons=[],
            database_configured=True,
            database_dsn_label="127.0.0.1:5432/qr_trust_poc",
            metrics=NetworkOutboxMetricsResponse(
                observed_at="2026-05-18T00:00:00Z",
                pending_count=0,
                publishing_count=0,
                published_count=3,
                failed_count=0,
                stale_claim_count=0,
                retryable_failed_count=0,
                oldest_pending_age_ms=0,
                oldest_failed_age_ms=0,
                max_attempts=1,
                failed_rows=[],
            ),
        )

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["status-admin"])
    monkeypatch.setattr(
        verifier_endpoint,
        "load_network_outbox_operator_status",
        _fake_network_outbox_status,
    )

    response = client.get(
        "/verifier/status",
        headers={"X-Admin-Token": "status-admin"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["network_outbox"]["status"] == "healthy"
    assert payload["network_outbox"]["database_dsn_label"] == "127.0.0.1:5432/qr_trust_poc"


def test_verifier_reference_api_blocks_expired_and_revoked(client: TestClient) -> None:
    expired_demo = client.post(
        "/verifier/demo-materials",
        json={
            # Offsets clear the 300-second clock-skew tolerance every
            # artifact-time comparison applies (global-constraints.md); a
            # 1-minute overrun no longer counts as expired once the verify
            # surface is wired through the trust store's skew-aware check.
            "issued_offset_minutes": -20,
            "expires_offset_minutes": -10,
        },
    )
    expired_request = expired_demo.json()["verify_request"]
    expired_result = client.post("/verifier/verify", json=expired_request)
    assert expired_result.status_code == 200
    assert expired_result.json()["allowed"] is False
    assert expired_result.json()["stage"] == "time_window"

    revoked_demo = client.post(
        "/verifier/demo-materials",
        json={
            "certificate_revoked": True,
            "certificate_revocation_reason": "revoked for test",
        },
    )
    revoked_request = revoked_demo.json()["verify_request"]
    revoked_result = client.post("/verifier/verify", json=revoked_request)
    assert revoked_result.status_code == 200
    assert revoked_result.json()["allowed"] is False
    assert revoked_result.json()["stage"] == "key_status"


def test_verifier_verify_allows_expiry_within_the_clock_skew_tolerance(
    client: TestClient,
) -> None:
    # Deliberately pins config.VERIFIER_CLOCK_SKEW_SECONDS: evaluate_trust_window
    # applies that tolerance to every artifact-time comparison (global-constraints.md),
    # so an object whose expires_at is only 1 minute in the past still reads
    # as within the window and must verify.
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "issued_offset_minutes": -20,
            "expires_offset_minutes": -1,
        },
    )
    assert demo_response.status_code == 200

    result = client.post(
        "/verifier/verify",
        json=demo_response.json()["verify_request"],
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["allowed"] is True
    assert payload["cause"] is None


def test_verifier_verify_blocks_expiry_past_the_clock_skew_tolerance(
    client: TestClient,
) -> None:
    # Companion to the allow-within-tolerance case above: 10 minutes past
    # expires_at clears config.VERIFIER_CLOCK_SKEW_SECONDS, so the request
    # must be blocked with the closed-vocabulary "object-expired" cause,
    # not just a time_window stage.
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "issued_offset_minutes": -20,
            "expires_offset_minutes": -10,
        },
    )
    assert demo_response.status_code == 200

    result = client.post(
        "/verifier/verify",
        json=demo_response.json()["verify_request"],
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["allowed"] is False
    assert payload["stage"] == "time_window"
    assert payload["cause"] == "object-expired"


def test_verifier_reference_api_rejects_malformed_payload_port(
    client: TestClient,
) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "payload": "https://acme.example:99999/pay",
            "verified_domains": ["acme.example"],
        },
    )
    assert demo_response.status_code == 200

    result = client.post(
        "/verifier/verify",
        json=demo_response.json()["verify_request"],
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["allowed"] is False
    assert payload["stage"] == "payload_revalidation"
    assert "Invalid destination URL" in payload["reason"]


def test_verifier_demo_materials_reject_lifetimes_beyond_thirty_days(
    client: TestClient,
) -> None:
    # The lab's time-limited picker caps at 30 days; the server enforces the
    # same bound so a hand-crafted request cannot seal a longer-lived code.
    thirty_days = 30 * 24 * 60
    accepted = client.post(
        "/verifier/demo-materials",
        json={"expires_offset_minutes": thirty_days},
    )
    assert accepted.status_code == 200

    rejected = client.post(
        "/verifier/demo-materials",
        json={"expires_offset_minutes": thirty_days + 1},
    )
    assert rejected.status_code == 422
    assert rejected.json()["detail"][0]["loc"] == ["body", "expires_offset_minutes"]


def test_verifier_demo_materials_support_the_expired_lab_case(
    client: TestClient,
) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            # Offsets clear the 300-second clock-skew tolerance every
            # artifact-time comparison applies (global-constraints.md); a
            # 2-minute overrun no longer counts as expired once the verify
            # surface is wired through the trust store's skew-aware check.
            "issued_offset_minutes": -20,
            "expires_offset_minutes": -10,
            "verified_domains": ["acme.example"],
        },
    )
    assert demo_response.status_code == 200

    demo_payload = demo_response.json()

    scanner_response = client.post(
        "/scanner/decisions",
        json={"qr_payload": demo_payload["qr_payload"]},
    )
    assert scanner_response.status_code == 200
    assert scanner_response.json()["decision_state"] == "blocked"


def test_scanner_decision_uses_server_verifier_profile_state(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "VERIFIER_PROVIDER_PROFILE_STATE", "revoked")
    demo_response = client.post(
        "/verifier/demo-materials",
        json={},
    )
    assert demo_response.status_code == 200

    scanner_response = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": demo_response.json()["qr_payload"],
            "client": {"platform": "browser_lab", "app_version": "test"},
        },
    )

    assert scanner_response.status_code == 200
    payload = scanner_response.json()
    assert payload["decision_state"] == "profile_revoked"
    assert payload["open_allowed"] is False
    assert payload["scanner_ux"]["risk_level"] == "red"


def test_verifier_scanned_api_accepts_real_qr_roundtrip(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={},
    )
    assert demo_response.status_code == 200

    demo_payload = demo_response.json()
    qr_payload = demo_payload["qr_payload"]
    qr_png_bytes = base64.b64decode(demo_payload["qr_png_base64"])
    decoded_qr_payload = decode_qr_payload_from_png_bytes(qr_png_bytes)

    assert decoded_qr_payload == qr_payload

    verify_request = {
        "qr_payload": decoded_qr_payload,
        "certificate": demo_payload["certificate"],
        "issuer_state": demo_payload["issuer_state"],
    }

    first_result = client.post("/verifier/verify-scanned", json=verify_request)
    assert first_result.status_code == 200
    assert first_result.json()["allowed"] is True
    assert first_result.json()["stage"] == "accepted"

    second_result = client.post("/verifier/verify-scanned", json=verify_request)
    assert second_result.status_code == 200
    assert second_result.json()["allowed"] is True
    assert second_result.json()["stage"] == "accepted"


def test_scanner_decision_api_resolves_registered_demo_qr(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={},
    )
    assert demo_response.status_code == 200

    qr_payload = demo_response.json()["qr_payload"]

    first_result = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": qr_payload,
            "client": {"platform": "ios", "app_version": "test"},
        },
    )
    assert first_result.status_code == 200
    first_payload = first_result.json()
    assert first_payload["decision_state"] == "verified_issuer"
    assert first_payload["open_allowed"] is True
    assert first_payload["verifier_stage"] == "accepted"
    assert first_payload["destination"]["binding"] == "bound"
    assert first_payload["issuer"]["status"] == "recognized"
    assert first_payload["governance"]["issuer_namespace_label"] == (
        "(root:qrtrust-demo:2026, "
        "authority:qrtrust-demo:merchant-web, "
        "issuer:acme-demo)"
    )
    assert first_payload["governance"]["cache_freshness_state"] == "fresh"
    assert first_payload["scanner_ux"]["risk_score"] == 0
    assert first_payload["scanner_ux"]["risk_level"] == "green"
    assert first_payload["scanner_ux"]["hold_required"] is False
    assert first_payload["scanner_ux"]["destination_display"] == "acme.example"
    assert first_payload["request_id"]
    contract = first_payload["contract"]
    assert contract["decision_id"].startswith("scan_")
    assert contract["decision_id"] != first_payload["request_id"]
    assert contract["decision_color"] == "green"
    assert contract["decision_state"] == "verified_issuer"
    assert contract["risk_score"] == 0
    assert contract["destination"]["display_host"] == "acme.example"
    assert contract["destination"]["fingerprint"] == "acme.example"
    assert contract["destination"]["url"] == "https://acme.example/pay"
    assert contract["trust_path"]["issuer_legitimacy"]["status"] == "recognized"
    assert contract["trust_path"]["destination_binding"]["status"] == "bound"
    assert contract["trust_path"]["runtime_safety"]["status"] == "clean"
    assert contract["trust_path"]["scanner_decision"]["status"] == "verified_issuer"
    assert contract["hold_to_open"] == {
        "required": False,
        "duration_ms": 0,
        "reason_codes": [],
    }
    assert contract["cache_freshness"]["status"] == "fresh"
    assert contract["governance"]["issuer_id"] == "issuer:acme-demo"

    second_result = client.post("/scanner/decisions", json={"qr_payload": qr_payload})
    assert second_result.status_code == 200
    second_payload = second_result.json()
    assert second_payload["decision_state"] == "verified_issuer"
    assert second_payload["open_allowed"] is True
    assert second_payload["verifier_stage"] == "accepted"
    assert second_payload["envelope_id"] == first_payload["envelope_id"]
    assert second_payload["scanner_ux"]["risk_level"] == "green"


def test_scanner_decision_api_flags_unregistered_demo_qr(client: TestClient) -> None:
    registered = client.post(
        "/verifier/demo-materials",
        json={},
    )
    assert registered.status_code == 200

    unregistered = client.post(
        "/verifier/demo-materials",
        json={
            "register_scanner_trust": False,
        },
    )
    assert unregistered.status_code == 200

    result = client.post(
        "/scanner/decisions",
        json={"qr_payload": unregistered.json()["qr_payload"]},
    )
    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "signed_unknown_issuer"
    assert payload["issuer"]["status"] == "unknown"
    assert payload["verifier_stage"] == "issuer_lookup"
    assert payload["scanner_ux"]["risk_level"] == "amber"
    assert "issuer_unknown" in payload["scanner_ux"]["reason_codes"]


def test_scanner_decision_uses_image_artifact_warning(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
        },
    )
    assert demo_response.status_code == 200
    qr_payload = demo_response.json()["qr_payload"]

    result = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": qr_payload,
            "image_base64": _render_custom_qr_base64(qr_payload, border=0),
        },
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "verified_issuer"
    assert payload["scanner_ux"]["risk_level"] == "amber"
    assert "artifact_warning" in payload["scanner_ux"]["reason_codes"]
    artifact_signal = next(
        signal for signal in payload["signals"] if signal["layer"] == "artifact_integrity"
    )
    assert artifact_signal["state"] == "warn"
    assert "low_quiet_zone" in artifact_signal["message"]


def test_scanner_decision_blocks_image_payload_mismatch(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
        },
    )
    assert demo_response.status_code == 200

    result = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": demo_response.json()["qr_payload"],
            "image_base64": _render_custom_qr_base64(
                "https://evil.example/pay",
                border=4,
            ),
        },
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "blocked"
    assert payload["open_allowed"] is False
    assert payload["verifier_stage"] == "artifact_integrity"
    assert "artifact_integrity_block" in payload["scanner_ux"]["reason_codes"]


def test_demo_materials_low_quiet_zone_profile_yields_artifact_warning(
    client: TestClient,
) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "artifact_profile": "low-quiet-zone",
        },
    )
    assert demo_response.status_code == 200
    demo = demo_response.json()

    result = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": demo["qr_payload"],
            "image_base64": demo["qr_png_base64"],
        },
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "verified_issuer"
    assert payload["scanner_ux"]["risk_level"] == "amber"
    assert "artifact_warning" in payload["scanner_ux"]["reason_codes"]
    artifact_signal = next(
        signal for signal in payload["signals"] if signal["layer"] == "artifact_integrity"
    )
    assert artifact_signal["state"] == "warn"
    assert "low_quiet_zone" in artifact_signal["message"]


def test_demo_materials_payload_mismatch_profile_blocks_scan(
    client: TestClient,
) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "artifact_profile": "payload-mismatch",
        },
    )
    assert demo_response.status_code == 200
    demo = demo_response.json()

    rendered_payload = decode_qr_payload_from_png_bytes(
        base64.b64decode(demo["qr_png_base64"])
    )
    assert rendered_payload != demo["qr_payload"]

    result = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": demo["qr_payload"],
            "image_base64": demo["qr_png_base64"],
        },
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "blocked"
    assert payload["open_allowed"] is False
    assert payload["verifier_stage"] == "artifact_integrity"
    assert "artifact_integrity_block" in payload["scanner_ux"]["reason_codes"]


def test_scanner_decision_rate_limit_uses_client_identity_for_unverified_api_keys(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_RATE_LIMIT_MAX_REQUESTS", 1)
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_RATE_LIMIT_WINDOW_SECONDS", 60)
    verifier_endpoint._request_rate_limiter._records.clear()

    try:
        first_response = client.post(
            "/scanner/decisions",
            json={"qr_payload": "https://example.com/pay"},
            headers={"X-API-Key": "client-controlled-bucket-a"},
        )
        rotated_fake_key_response = client.post(
            "/scanner/decisions",
            json={"qr_payload": "https://example.com/pay"},
            headers={"X-API-Key": "client-controlled-bucket-b"},
        )
    finally:
        verifier_endpoint._request_rate_limiter._records.clear()

    assert first_response.status_code == 200
    assert rotated_fake_key_response.status_code == 429


def test_scanner_decision_uses_unique_internal_decision_id_for_reused_request_id(
    client: TestClient,
) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
        },
    )
    assert demo_response.status_code == 200
    qr_payload = demo_response.json()["qr_payload"]
    headers = {"X-Request-ID": "fixed-scan-id"}

    first_response = client.post(
        "/scanner/decisions",
        json={"qr_payload": qr_payload},
        headers=headers,
    )
    second_response = client.post(
        "/scanner/decisions",
        json={"qr_payload": qr_payload},
        headers=headers,
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    first_payload = first_response.json()
    second_payload = second_response.json()
    assert first_payload["request_id"] == "fixed-scan-id"
    assert second_payload["request_id"] == "fixed-scan-id"
    assert first_payload["contract"]["decision_id"].startswith("scan_")
    assert second_payload["contract"]["decision_id"].startswith("scan_")
    assert first_payload["contract"]["decision_id"] != "fixed-scan-id"
    assert second_payload["contract"]["decision_id"] != "fixed-scan-id"
    assert first_payload["contract"]["decision_id"] != second_payload["contract"]["decision_id"]


def test_scanner_decision_replaces_invalid_request_id_header(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
        },
    )
    assert demo_response.status_code == 200

    response = client.post(
        "/scanner/decisions",
        json={"qr_payload": demo_response.json()["qr_payload"]},
        headers={"X-Request-ID": "x" * 200},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["request_id"] != "x" * 200
    assert payload["request_id"].startswith("req_")
    assert len(payload["request_id"]) <= 128
    assert response.headers["x-request-id"] == payload["request_id"]
    assert payload["contract"]["decision_id"].startswith("scan_")
    assert len(payload["contract"]["decision_id"]) <= 128


@pytest.mark.parametrize(
    ("qr_payload", "destination_display"),
    [
        ("https://login.bank.co.uk/pay", "bank.co.uk"),
        ("https://login.bank.com.sg/pay", "bank.com.sg"),
        ("https://login.bank.co.kr/pay", "bank.co.kr"),
        ("https://login.bank.com/pay", "bank.com"),
    ],
)
def test_scanner_decision_displays_common_cctld_registrable_domains(
    client: TestClient,
    qr_payload: str,
    destination_display: str,
) -> None:
    response = client.post("/scanner/decisions", json={"qr_payload": qr_payload})

    assert response.status_code == 200
    assert response.json()["scanner_ux"]["destination_display"] == destination_display


def test_scanner_decision_api_records_decorated_evidence(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorded: list[ScannerDecisionResponse] = []

    async def _fake_record_evidence(
        response: ScannerDecisionResponse,
        **_: Any,
    ) -> None:
        recorded.append(response)

    monkeypatch.setattr(verifier_endpoint, "record_scanner_evidence", _fake_record_evidence)

    demo_response = client.post(
        "/verifier/demo-materials",
        json={
        },
    )
    assert demo_response.status_code == 200

    result = client.post(
        "/scanner/decisions",
        json={"qr_payload": demo_response.json()["qr_payload"]},
    )

    assert result.status_code == 200
    payload = result.json()
    assert recorded
    assert recorded[0].request_id == payload["request_id"]
    assert recorded[0].scanner_ux is not None
    assert recorded[0].contract is not None
    assert recorded[0].contract.decision_id == payload["contract"]["decision_id"]
    assert recorded[0].contract.decision_id.startswith("scan_")
    assert recorded[0].contract.decision_id != payload["request_id"]


def test_scanner_ux_event_log_accepts_scanner_interaction_events(client: TestClient) -> None:
    base_payload = {
        "request_id": "scanner-request-001",
        "decision_state": "unverified",
        "risk_score": 35,
        "risk_level": "amber",
        "reason_codes": ["plain_url", "net_new_domain"],
        "hold_required": True,
        "hold_ms": 800,
        "destination_display": "example.com",
        "destination_url": "https://example.com/pay",
        "client": {"platform": "browser_lab", "app_version": "test"},
    }

    for event_type in ["preview", "hold_start", "hold_complete", "open", "cancel"]:
        response = client.post(
            "/scanner/ux-events",
            json={
                **base_payload,
                "event_type": event_type,
                "elapsed_ms": 800 if event_type == "hold_complete" else None,
            },
        )

        assert response.status_code == 200
        assert response.json() == {"recorded": True, "event_type": event_type}

    export_response = client.get(
        "/scanner/ux-events",
        params={"request_id": base_payload["request_id"], "limit": 10},
    )

    assert export_response.status_code == 200
    events = export_response.json()["events"]
    assert [entry["event"]["event_type"] for entry in events] == [
        "preview",
        "hold_start",
        "hold_complete",
        "open",
        "cancel",
    ]
    assert events[0]["event"]["risk_score"] == 35
    assert events[0]["event"]["reason_codes"] == ["plain_url", "net_new_domain"]
    assert events[2]["event"]["elapsed_ms"] == 800


def test_scanner_ux_event_log_filters_by_decision_id(client: TestClient) -> None:
    base_payload = {
        "request_id": "shared-scanner-request",
        "decision_state": "verified_issuer",
        "risk_score": 0,
        "risk_level": "green",
        "reason_codes": ["issuer_recognized"],
        "hold_required": False,
        "hold_ms": 0,
        "destination_display": "acme.example",
        "destination_url": "https://acme.example/pay",
        "client": {"platform": "browser_lab", "app_version": "test"},
    }

    for decision_id in ["scan_first", "scan_second"]:
        response = client.post(
            "/scanner/ux-events",
            json={
                **base_payload,
                "decision_id": decision_id,
                "event_type": "preview",
            },
        )

        assert response.status_code == 200

    export_response = client.get(
        "/scanner/ux-events",
        params={"decision_id": "scan_second", "limit": 10},
    )

    assert export_response.status_code == 200
    events = export_response.json()["events"]
    assert len(events) == 1
    assert events[0]["event"]["request_id"] == "shared-scanner-request"
    assert events[0]["event"]["decision_id"] == "scan_second"


def test_scanner_ux_event_log_validates_event_contract(client: TestClient) -> None:
    response = client.post(
        "/scanner/ux-events",
        json={
            "event_type": "instant_open",
            "decision_state": "unverified",
            "risk_score": 101,
            "risk_level": "amber",
            "reason_codes": [],
            "hold_required": False,
            "hold_ms": 0,
        },
    )

    assert response.status_code == 422


def test_scanner_ux_ab_fixture_models_hold_to_open_experiment(client: TestClient) -> None:
    response = client.get("/scanner/ux-ab-fixture", params={"seed": "unit-test"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["seed"] == "unit-test"
    assert payload["participants_per_arm"] == 60
    assert payload["scans_per_participant"] == 9
    assert payload["blind_open_window_ms"] == 300
    assert payload["hold_gate_ms"] == 800

    control_summary = payload["control"]["summary"]
    treatment_summary = payload["treatment"]["summary"]
    assert control_summary["flagged_scans"] == 5
    assert treatment_summary["flagged_scans"] == 5
    assert control_summary["flagged_blind_open_count"] == 5
    assert treatment_summary["flagged_blind_open_count"] == 0
    assert treatment_summary["held_open_count"] == 5
    assert (
        treatment_summary["median_benign_decision_ms"]
        - control_summary["median_benign_decision_ms"]
        <= 200
    )
    assert treatment_summary["false_friction_rate"] == 0

    treatment_events = payload["treatment"]["sample_events"]
    flagged_opens = [
        event
        for event in treatment_events
        if event["event_type"] == "open" and event["risk_score"] >= 30
    ]
    assert len(flagged_opens) == 5
    assert all(event["elapsed_ms"] >= 800 for event in flagged_opens)
    assert all(event["reason_codes"] for event in flagged_opens)
    assert any(event["event_type"] == "hold_complete" for event in treatment_events)


def test_scanner_provider_profile_does_not_reflect_forwarded_host(
    client: TestClient,
) -> None:
    response = client.get(
        "/scanner/provider-profile",
        headers={
            "x-forwarded-proto": "https",
            "x-forwarded-host": "attacker.example",
        },
    )

    assert response.status_code == 200
    assert response.json()["endpoints"] == ["http://testserver"]


def test_scanner_provider_profile_does_not_reflect_host_header(
    client: TestClient,
) -> None:
    response = client.get(
        "/scanner/provider-profile",
        headers={"host": "attacker.example"},
    )

    assert response.status_code == 200
    assert response.json()["endpoints"] == ["http://127.0.0.1"]


def test_scanner_provider_profile_rejects_credentialed_loopback_host(
    client: TestClient,
) -> None:
    response = client.get(
        "/scanner/provider-profile",
        headers={"host": "user:pass@127.0.0.1"},
    )

    assert response.status_code == 200
    assert response.json()["endpoints"] == ["http://127.0.0.1"]


def test_scanner_provider_profile_rejects_malformed_loopback_host_port(
    client: TestClient,
) -> None:
    response = client.get(
        "/scanner/provider-profile",
        headers={"host": "127.0.0.1:99999"},
    )

    assert response.status_code == 200
    assert response.json()["endpoints"] == ["http://127.0.0.1"]


def test_scanner_provider_profile_uses_configured_public_base_url(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        verifier_endpoint.config,
        "VERIFIER_PUBLIC_BASE_URL",
        "https://scanner-provider.example/base/path",
    )

    response = client.get("/scanner/provider-profile")

    assert response.status_code == 200
    assert response.json()["endpoints"] == ["https://scanner-provider.example"]


def test_scanner_decision_api_allows_repeated_scans_of_one_qr(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={},
    )
    assert demo_response.status_code == 200

    qr_payload = demo_response.json()["qr_payload"]

    first_result = client.post("/scanner/decisions", json={"qr_payload": qr_payload})
    second_result = client.post("/scanner/decisions", json={"qr_payload": qr_payload})

    assert first_result.status_code == 200
    assert second_result.status_code == 200
    first_payload = first_result.json()
    second_payload = second_result.json()
    assert first_payload["decision_state"] == "verified_issuer"
    assert first_payload["open_allowed"] is True
    assert first_payload["issuer"]["tier"] == "verified_business"
    assert first_payload["governance"]["assurance_tier"] == "verified_business"
    assert first_payload["governance"]["destination_policy_id"] == "policy:acme-demo:web-payments:v1"
    assert first_payload["governance"]["source_artifacts"]["destination_policy_ref"] == "destination-policy.json"
    assert "fixture governance namespace" in first_payload["signals"][0]["message"]
    assert second_payload["decision_state"] == "verified_issuer"
    assert second_payload["open_allowed"] is True
    assert second_payload["verifier_stage"] == "accepted"
    assert second_payload["scanner_ux"]["risk_level"] == "green"
    assert second_payload["scanner_ux"]["hold_required"] is False


def test_demo_materials_exposes_non_normative_governance_projection(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={},
    )

    assert demo_response.status_code == 200
    payload = demo_response.json()
    assert payload["governance"]["root_program_id"] == "root:qrtrust-demo:2026"
    assert payload["governance"]["delegated_authority_id"] == "authority:qrtrust-demo:merchant-web"
    assert payload["governance"]["issuer_id"] == "issuer:acme-demo"
    assert payload["governance"]["cache_entry_id"] == "cache:acme-demo:2026-05-15"
    assert payload["governance"]["cache_freshness_state"] == "fresh"
    assert payload["governance"]["stale_behavior"] == "downgrade_or_block"


def test_scanner_decision_downgrades_stale_governance_cache(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "governance_cache_profile": "stale",
        },
    )

    assert demo_response.status_code == 200
    demo_payload = demo_response.json()
    assert demo_payload["governance"]["cache_freshness_state"] == "stale"

    result = client.post(
        "/scanner/decisions",
        json={"qr_payload": demo_payload["qr_payload"]},
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "stale_trust_state"
    assert payload["open_allowed"] is True
    assert payload["verifier_stage"] == "governance_cache"
    assert payload["governance"]["cache_freshness_state"] == "stale"
    assert payload["issuer"]["status"] == "stale"
    assert payload["scanner_ux"]["risk_level"] == "amber"
    assert payload["scanner_ux"]["hold_required"] is True
    assert "stale_trust_state" in payload["scanner_ux"]["reason_codes"]
    assert payload["contract"]["decision_color"] == "orange"
    assert payload["contract"]["hold_to_open"] == {
        "required": True,
        "duration_ms": 800,
        "reason_codes": ["stale_trust_state"],
    }
    assert payload["contract"]["cache_freshness"]["status"] == "stale"
    assert payload["destination"]["binding"] == "not_evaluated"
    assert payload["signals"][0]["state"] == "stale"
    assert payload["signals"][3]["state"] == "caution"
    assert payload["actions"][0]["id"] == "continue_caution"


def test_scanner_decision_blocks_expired_governance_cache(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "governance_cache_profile": "expired",
        },
    )

    assert demo_response.status_code == 200
    demo_payload = demo_response.json()
    assert demo_payload["governance"]["cache_freshness_state"] == "expired"

    result = client.post(
        "/scanner/decisions",
        json={"qr_payload": demo_payload["qr_payload"]},
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "blocked"
    assert payload["open_allowed"] is False
    assert payload["verifier_stage"] == "governance_cache"
    assert payload["governance"]["cache_freshness_state"] == "expired"
    assert payload["issuer"]["status"] == "expired"
    assert payload["signals"][0]["state"] == "expired"
    assert payload["signals"][3]["state"] == "blocked"
    assert payload["contract"]["decision_color"] == "red"
    assert payload["contract"]["cache_freshness"]["status"] == "expired"
    assert re.fullmatch(r"[0-9a-f]{64}", payload["envelope_id"])


def test_scanner_decision_downgrades_stale_verifier_profile(
    client: TestClient,
) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
        },
    )
    assert demo_response.status_code == 200
    qr_payload = demo_response.json()["qr_payload"]

    stale_result = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": qr_payload,
            "client": {
                "platform": "ios",
                "app_version": "test",
                "verifier_profile_state": "stale",
            },
        },
    )

    assert stale_result.status_code == 200
    stale_payload = stale_result.json()
    assert stale_payload["decision_state"] == "profile_stale"
    assert stale_payload["open_allowed"] is True
    assert stale_payload["verifier_stage"] == "verifier_profile"
    assert stale_payload["issuer"]["status"] == "profile_stale"
    assert stale_payload["destination"]["binding"] == "unverified"
    assert stale_payload["signals"][0]["state"] == "not_checked"
    assert stale_payload["signals"][1]["state"] == "unverified"
    assert stale_payload["signals"][2]["state"] == "not_evaluated"
    assert stale_payload["signals"][3]["state"] == "caution"
    assert stale_payload["scanner_ux"]["risk_level"] == "amber"
    assert stale_payload["scanner_ux"]["hold_required"] is True
    assert stale_payload["scanner_ux"]["reason_codes"] == ["verifier_profile_stale"]
    assert stale_payload["contract"]["decision_color"] == "orange"
    assert stale_payload["contract"]["cache_freshness"]["status"] == "not_applicable"
    assert stale_payload["contract"]["trust_path"]["issuer_legitimacy"]["status"] == "not_checked"
    assert stale_payload["actions"][0]["id"] == "continue_caution"

    active_result = client.post(
        "/scanner/decisions",
        json={"qr_payload": qr_payload},
    )

    assert active_result.status_code == 200
    active_payload = active_result.json()
    assert active_payload["decision_state"] == "verified_issuer"
    assert active_payload["verifier_stage"] == "accepted"


def test_scanner_decision_blocks_revoked_verifier_profile(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
        },
    )
    assert demo_response.status_code == 200

    result = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": demo_response.json()["qr_payload"],
            "client": {
                "platform": "ios",
                "app_version": "test",
                "verifier_profile_state": "revoked",
            },
        },
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "profile_revoked"
    assert payload["open_allowed"] is False
    assert payload["verifier_stage"] == "verifier_profile"
    assert payload["issuer"]["status"] == "profile_revoked"
    assert payload["destination"]["binding"] == "not_evaluated"
    assert payload["signals"][0]["state"] == "profile_revoked"
    assert payload["signals"][1]["state"] == "not_evaluated"
    assert payload["signals"][2]["state"] == "not_evaluated"
    assert payload["signals"][3]["state"] == "blocked"
    assert payload["scanner_ux"]["risk_level"] == "red"
    assert payload["scanner_ux"]["hold_required"] is False
    assert payload["scanner_ux"]["reason_codes"] == ["verifier_profile_revoked"]
    assert payload["contract"]["decision_color"] == "red"
    assert payload["contract"]["cache_freshness"]["status"] == "not_applicable"
    assert payload["contract"]["trust_path"]["scanner_decision"]["status"] == "blocked"
    assert payload["actions"][0]["id"] == "dismiss"


def test_scanner_decision_api_marks_verified_destination_risky(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "payload": "https://acme.example/pay?runtime=risky",
        },
    )
    assert demo_response.status_code == 200

    result = client.post("/scanner/decisions", json={"qr_payload": demo_response.json()["qr_payload"]})

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "verified_issuer_destination_risky"
    assert payload["open_allowed"] is True
    assert payload["verifier_stage"] == "runtime_safety"
    assert payload["destination"]["binding"] == "bound"
    assert payload["issuer"]["status"] == "recognized"
    assert payload["signals"][0]["state"] == "recognized"
    assert payload["signals"][1]["state"] == "bound"
    assert payload["signals"][2]["layer"] == "runtime_safety"
    assert payload["signals"][2]["state"] == "risky"
    assert payload["signals"][3]["state"] == "verified_issuer_destination_risky"
    assert payload["actions"][0]["id"] == "continue_caution"
    assert payload["scanner_ux"]["risk_level"] == "amber"
    assert payload["scanner_ux"]["hold_required"] is True
    assert payload["scanner_ux"]["hold_ms"] == 800
    assert "runtime_risky" in payload["scanner_ux"]["reason_codes"]
    assert payload["contract"]["decision_color"] == "orange"
    assert payload["contract"]["hold_to_open"] == {
        "required": True,
        "duration_ms": 800,
        "reason_codes": ["runtime_risky"],
    }
    assert payload["contract"]["trust_path"]["runtime_safety"]["status"] == "risky"


@pytest.mark.parametrize(
    ("runtime_state", "reason_code"),
    [
        ("unavailable", "runtime_unavailable"),
        ("stale", "runtime_stale"),
    ],
)
def test_scanner_decision_runtime_degraded_reason_codes_are_specific(
    client: TestClient,
    runtime_state: str,
    reason_code: str,
) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "payload": f"https://acme.example/pay?runtime={runtime_state}",
        },
    )
    assert demo_response.status_code == 200

    result = client.post("/scanner/decisions", json={"qr_payload": demo_response.json()["qr_payload"]})

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "verified_issuer_destination_risky"
    assert payload["signals"][2]["layer"] == "runtime_safety"
    assert payload["signals"][2]["state"] == runtime_state
    assert reason_code in payload["scanner_ux"]["reason_codes"]
    assert "runtime_risky" not in payload["scanner_ux"]["reason_codes"]
    assert payload["contract"]["hold_to_open"]["reason_codes"] == [reason_code]


def test_scanner_decision_ignores_client_bad_host_hints_for_verified_destinations(
    client: TestClient,
) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
        },
    )
    assert demo_response.status_code == 200

    result = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": demo_response.json()["qr_payload"],
            "known_bad_hosts": ["acme.example"],
        },
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "verified_issuer"
    assert payload["scanner_ux"]["risk_level"] == "green"
    assert payload["scanner_ux"]["reason_codes"] == []
    assert payload["contract"]["decision_color"] == "green"
    assert payload["contract"]["trust_path"]["runtime_safety"]["status"] == "clean"


def test_scanner_decision_api_blocks_verified_destination_runtime_block(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "payload": "https://acme.example/pay?runtime=blocked",
        },
    )
    assert demo_response.status_code == 200

    result = client.post("/scanner/decisions", json={"qr_payload": demo_response.json()["qr_payload"]})

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "blocked"
    assert payload["open_allowed"] is False
    assert payload["verifier_stage"] == "runtime_safety"
    assert payload["destination"]["binding"] == "bound"
    assert payload["signals"][2]["layer"] == "runtime_safety"
    assert payload["signals"][2]["state"] == "blocked"
    assert payload["signals"][3]["state"] == "blocked"


def test_scanner_decision_api_blocks_direct_destination_path_mismatch(
    client: TestClient,
) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "payload": "https://acme.example/admin",
            "verified_domains": ["acme.example"],
        },
    )
    assert demo_response.status_code == 200

    result = client.post(
        "/scanner/decisions",
        json={"qr_payload": demo_response.json()["qr_payload"]},
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "blocked"
    assert payload["open_allowed"] is False
    assert payload["verifier_stage"] == "payload_revalidation"
    assert payload["destination"]["binding"] == "mismatch"
    assert "path" in payload["verifier_reason"].lower()
    assert payload["contract"]["decision_color"] == "red"


def test_scanner_decision_api_allows_approved_resolver_flow(client: TestClient) -> None:
    final_url = "https://acme.example/pay"
    resolver_url = (
        "https://qr.acme.example/r/pay"
        f"?final={quote(final_url, safe='')}&hops=1"
    )
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "payload": resolver_url,
            "verified_domains": ["qr.acme.example"],
        },
    )
    assert demo_response.status_code == 200

    result = client.post("/scanner/decisions", json={"qr_payload": demo_response.json()["qr_payload"]})

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "verified_issuer"
    assert payload["open_allowed"] is True
    assert payload["verifier_stage"] == "accepted"
    assert payload["destination"]["display_url"] == final_url
    assert payload["destination"]["host"] == "acme.example"
    assert payload["destination"]["binding"] == "bound"
    assert payload["destination"]["resolver_url"] == "https://qr.acme.example/r/pay"
    assert payload["destination"]["final_url"] == final_url
    assert payload["destination"]["redirect_hops"] == 1
    assert payload["destination"]["redirect_policy"] == "resolver_to_final:max_1_hop"
    assert payload["signals"][1]["state"] == "bound"
    assert "Resolver and final destination match issuer redirect policy" in payload["signals"][1]["message"]


def test_scanner_decision_api_blocks_resolver_final_host_mismatch(client: TestClient) -> None:
    final_url = "https://evil.example/pay"
    resolver_url = (
        "https://qr.acme.example/r/pay"
        f"?final={quote(final_url, safe='')}&hops=1"
    )
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "payload": resolver_url,
            "verified_domains": ["qr.acme.example"],
        },
    )
    assert demo_response.status_code == 200

    result = client.post("/scanner/decisions", json={"qr_payload": demo_response.json()["qr_payload"]})

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "blocked"
    assert payload["open_allowed"] is False
    assert payload["verifier_stage"] == "redirect_policy"
    assert payload["destination"]["binding"] == "redirect_mismatch"
    assert payload["destination"]["display_url"] == final_url
    assert payload["destination"]["resolver_url"] == "https://qr.acme.example/r/pay"
    assert payload["destination"]["final_url"] == final_url
    assert payload["signals"][1]["state"] == "redirect_mismatch"
    assert "not in the issuer-approved redirect host set" in payload["verifier_reason"]


def test_scanner_decision_api_blocks_excessive_redirect_hops(client: TestClient) -> None:
    final_url = "https://acme.example/pay"
    resolver_url = (
        "https://qr.acme.example/r/pay"
        f"?final={quote(final_url, safe='')}&hops=3"
    )
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "payload": resolver_url,
            "verified_domains": ["qr.acme.example"],
        },
    )
    assert demo_response.status_code == 200

    result = client.post("/scanner/decisions", json={"qr_payload": demo_response.json()["qr_payload"]})

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "blocked"
    assert payload["open_allowed"] is False
    assert payload["verifier_stage"] == "redirect_policy"
    assert payload["destination"]["binding"] == "redirect_mismatch"
    assert payload["destination"]["redirect_hops"] == 3
    assert "3 hops observed, max 1" in payload["verifier_reason"]


def test_scanner_decision_api_blocks_nested_shortener_flow(client: TestClient) -> None:
    final_url = "https://acme.example/pay"
    resolver_url = (
        "https://qr.acme.example/r/pay"
        f"?final={quote(final_url, safe='')}&hops=1&nested=1"
    )
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "payload": resolver_url,
            "verified_domains": ["qr.acme.example"],
        },
    )
    assert demo_response.status_code == 200

    result = client.post("/scanner/decisions", json={"qr_payload": demo_response.json()["qr_payload"]})

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "blocked"
    assert payload["open_allowed"] is False
    assert payload["verifier_stage"] == "redirect_policy"
    assert payload["destination"]["binding"] == "redirect_mismatch"
    assert payload["destination"]["redirect_hops"] == 1
    assert "Nested shorteners are not allowed" in payload["verifier_reason"]


def test_scanner_decision_api_blocks_destination_mismatch(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "payload": "https://rogue.example/phish",
            "verified_domains": ["acme.example"],
        },
    )
    assert demo_response.status_code == 200

    result = client.post("/scanner/decisions", json={"qr_payload": demo_response.json()["qr_payload"]})

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "blocked"
    assert payload["open_allowed"] is False
    assert payload["verifier_stage"] == "payload_revalidation"
    assert payload["destination"]["binding"] == "mismatch"


def test_scanner_decision_api_handles_plain_url_as_unverified(client: TestClient) -> None:
    result = client.post("/scanner/decisions", json={"qr_payload": "https://example.com/pay"})

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "unverified"
    assert payload["open_allowed"] is True
    assert payload["verifier_stage"] == "qr_decode"
    assert payload["verifier_reason"] == "Plain URL QR without a signed QR Trust envelope"
    assert payload["destination"]["host"] == "example.com"
    assert payload["destination"]["binding"] == "unverified"
    assert payload["signals"][1]["message"] == (
        "This is a regular URL QR. No issuer-approved destination binding was available."
    )
    assert payload["scanner_ux"]["risk_level"] == "amber"
    assert payload["scanner_ux"]["hold_required"] is True
    assert payload["scanner_ux"]["primary_action"] == "Open with caution"
    assert payload["scanner_ux"]["destination_display"] == "example.com"
    assert "plain_url" in payload["scanner_ux"]["reason_codes"]


def test_scanner_decision_api_displays_public_suffix_domain(
    client: TestClient,
) -> None:
    result = client.post(
        "/scanner/decisions",
        json={"qr_payload": "https://login.bank.co.uk/pay"},
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["scanner_ux"]["destination_display"] == "bank.co.uk"
    assert payload["contract"]["destination"]["display_host"] == "bank.co.uk"


def test_scanner_decision_api_flags_caption_domain_mismatch(
    client: TestClient,
) -> None:
    result = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": "https://evil.example/login",
            "display_text": "Pay at https://acme.example",
        },
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "unverified"
    assert payload["scanner_ux"]["risk_score"] == 90
    assert payload["scanner_ux"]["risk_level"] == "red"
    assert "caption_domain_mismatch" in payload["scanner_ux"]["reason_codes"]
    assert "known_bad_domain" in payload["scanner_ux"]["reason_codes"]
    assert "plain_url" in payload["scanner_ux"]["reason_codes"]


def test_scanner_decision_api_accepts_domain_intelligence_hints(
    client: TestClient,
) -> None:
    result = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": "https://fresh-risk.example/pay",
            "prior_opened_hosts": [],
            "newly_registered_hosts": ["fresh-risk.example"],
            "domain_age_days": {"fresh-risk.example": 5},
        },
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "unverified"
    assert payload["scanner_ux"]["risk_score"] == 75
    assert payload["scanner_ux"]["risk_level"] == "red"
    assert payload["scanner_ux"]["hold_required"] is True
    assert "net_new_domain" in payload["scanner_ux"]["reason_codes"]
    assert "newly_registered_domain" in payload["scanner_ux"]["reason_codes"]
    assert "plain_url" in payload["scanner_ux"]["reason_codes"]


def test_scanner_decision_api_flags_plain_url_with_embedded_credentials(
    client: TestClient,
) -> None:
    result = client.post(
        "/scanner/decisions",
        json={"qr_payload": "https://user:pass@wallet-login.example.zip/restore"},
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "unverified"
    assert payload["open_allowed"] is True
    assert payload["destination"]["host"] == "wallet-login.example.zip"
    # Without the suspicious-TLD heuristic the plain-URL and embedded-credential
    # signals alone total 45, which is amber rather than red. The heuristic was
    # the only thing that pushed this destination over the red threshold.
    assert payload["scanner_ux"]["risk_score"] == 45
    assert payload["scanner_ux"]["risk_level"] == "amber"
    assert payload["scanner_ux"]["hold_required"] is True
    assert payload["scanner_ux"]["destination_display"] == "example.zip"
    assert payload["scanner_ux"]["destination_fingerprint"] == "example.zip"
    assert "plain_url" in payload["scanner_ux"]["reason_codes"]
    assert "embedded_credentials" in payload["scanner_ux"]["reason_codes"]
    assert payload["contract"]["destination"]["display_host"] == "example.zip"
    assert payload["contract"]["decision_color"] == "orange"


def test_verifier_decode_image_endpoint_returns_qr_payload(client: TestClient) -> None:
    demo_response = client.post("/verifier/demo-materials", json={})
    assert demo_response.status_code == 200

    demo_payload = demo_response.json()
    decode_response = client.post(
        "/verifier/decode-image",
        json={"image_base64": demo_payload["qr_png_base64"]},
    )
    assert decode_response.status_code == 200
    assert decode_response.json()["qr_payload"] == demo_payload["qr_payload"]


def test_legacy_broad_api_routes_are_not_exposed_by_default(client: TestClient) -> None:
    certificate_response = client.post(
        "/certificates/issue",
        json={"issuer_name": "Acme Test Issuer"},
    )
    qrcode_response = client.post(
        "/qrcodes/generate?certificate_id=1",
        json={"org_id": 1, "payload": "https://acme.example/pay", "validity_minutes": 5},
    )
    organization_response = client.get("/organizations/1/domains")

    assert certificate_response.status_code == 404
    assert qrcode_response.status_code == 404
    assert organization_response.status_code == 404


def test_verifier_decode_image_rate_limit_returns_429(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_DECODE_RATE_LIMIT_MAX_REQUESTS", 1)
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_RATE_LIMIT_WINDOW_SECONDS", 60)
    verifier_endpoint._request_rate_limiter._records.clear()

    demo_response = client.post("/verifier/demo-materials", json={})
    demo_payload = demo_response.json()

    first_response = client.post(
        "/verifier/decode-image",
        json={"image_base64": demo_payload["qr_png_base64"]},
    )
    second_response = client.post(
        "/verifier/decode-image",
        json={"image_base64": demo_payload["qr_png_base64"]},
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 429
    assert second_response.headers["retry-after"]
    assert second_response.json()["detail"] == "Rate limit exceeded for verifier endpoint"


def test_verifier_post_routes_require_api_key_when_configured(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_API_KEYS", ["test-api-key"])

    missing_key_response = client.post("/verifier/demo-materials", json={})
    invalid_key_response = client.post(
        "/verifier/demo-materials",
        json={},
        headers={"X-API-Key": "wrong-key"},
    )
    valid_key_response = client.post(
        "/verifier/demo-materials",
        json={},
        headers={"X-API-Key": "test-api-key"},
    )

    assert missing_key_response.status_code == 401
    assert missing_key_response.json()["detail"] == "Missing verifier API key"
    assert invalid_key_response.status_code == 403
    assert invalid_key_response.json()["detail"] == "Invalid verifier API key"
    assert valid_key_response.status_code == 200


def test_scanner_decision_route_remains_public_when_api_key_is_enabled(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_API_KEYS", ["test-api-key"])

    response = client.post("/scanner/decisions", json={"qr_payload": "https://example.com/pay"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["decision_state"] == "unverified"
    assert payload["open_allowed"] is True
    assert payload["verifier_stage"] == "qr_decode"


def test_legacy_verifier_admin_api_key_routes_point_to_management_api(
    client: TestClient,
) -> None:
    responses = [
        client.get("/verifier/admin/api-keys"),
        client.post("/verifier/admin/api-keys/issue", json={"label": "lab-client"}),
        client.post(
            "/verifier/admin/api-keys/vkey_demo/rotate",
            json={"label": "rotated-client"},
        ),
        client.delete("/verifier/admin/api-keys/vkey_demo"),
    ]

    for response in responses:
        assert response.status_code == 410
        assert "/admin/verifier-clients/api-keys" in response.json()["detail"]


def test_verifier_api_key_store_unavailable_returns_503(
    client: TestClient,
    monkeypatch,
) -> None:
    async def _failed_connect(*_args: Any, **_kwargs: Any) -> None:
        raise OSError("connection refused")

    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_ADMIN_TOKENS", ["admin-secret"])
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_API_KEYS", [])
    monkeypatch.setattr(
        verifier_endpoint.config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(verifier_endpoint.config, "DATABASE_URL", None)
    monkeypatch.setattr(api_key_service_module.asyncpg, "connect", _failed_connect)

    issue_response = client.post(
        "/verifier/admin/api-keys/issue",
        json={"label": "lab-client"},
        headers={"X-Admin-Token": "admin-secret"},
    )
    protected_response = client.post(
        "/verifier/demo-materials",
        json={},
        headers={"X-API-Key": "unavailable-key"},
    )

    assert issue_response.status_code == 410
    assert protected_response.status_code == 503


def _scan_activity_fixture(
    fingerprint: str,
    *,
    scan_count: int = 1,
) -> ScanActivityResponse:
    latest = ScanActivityDecisionResponse(
        decision_id="scan_activity_001",
        verifier_id="verifier:test",
        decision_color="green",
        decision_state="verified_issuer",
        risk_score=4,
        hold_to_open_required=False,
        hold_to_open_duration_ms=0,
        destination_fingerprint="acme.example",
        policy_ref="policy:acme-demo:web-payments:v1",
        client_platform="ios",
        created_at="2026-08-25T10:00:00Z",
    )
    return ScanActivityResponse(
        envelope_fingerprint=fingerprint,
        persistence_state="observable",
        lookback_seconds=86_400,
        scan_count=scan_count,
        green_count=scan_count,
        orange_count=0,
        red_count=0,
        first_scanned_at="2026-08-25T09:59:00Z",
        last_scanned_at="2026-08-25T10:00:00Z",
        first_verified_at="2026-08-25T10:00:00Z",
        blocked_since_verified=0,
        latest=latest,
    )


def test_scan_activity_requires_envelope_id(client: TestClient) -> None:
    assert client.get("/verifier/scan-activity").status_code == 422
    assert client.get("/verifier/scan-activity", params={"envelope_id": "zz" * 32}).status_code == 422
    ok = client.get("/verifier/scan-activity", params={"envelope_id": "ab" * 32})
    assert ok.status_code == 200
    body = ok.json()
    assert body["envelope_fingerprint"] == "ab" * 8
    assert "replay_guard" not in body
    assert "issued_at" not in body
    assert body["throttle"]["envelope_budget_limit"] == 300
    assert body["throttle"]["envelope_budget_window_seconds"] == 60


def test_scan_activity_reports_unconfigured_store_without_database(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    demo = client.post("/verifier/demo-materials", json={}).json()
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "")

    response = client.get(
        "/verifier/scan-activity",
        params={"envelope_id": demo["envelope_id"]},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["envelope_fingerprint"] == envelope_fingerprint(demo["envelope_id"])
    assert payload["persistence_state"] == "unconfigured"
    assert payload["scan_count"] == 0
    assert payload["latest"] is None


def _scan_activity_ux_event(decision_id: str, event_type: str) -> dict[str, Any]:
    return {
        "request_id": f"scanner-request-{decision_id}",
        "decision_id": decision_id,
        "decision_state": "verified_issuer",
        "risk_score": 4,
        "risk_level": "green",
        "reason_codes": [],
        "hold_required": False,
        "hold_ms": 0,
        "destination_display": "acme.example",
        "destination_url": "https://acme.example/pay",
        "client": {"platform": "ios", "app_version": "test"},
        "event_type": event_type,
        "elapsed_ms": None,
    }


def test_scan_activity_reports_destination_outcome_from_ux_events(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    envelope_id = "cd" * 32
    fingerprint = envelope_fingerprint(envelope_id)

    async def fake_load(requested_fingerprint: str, **_: Any) -> ScanActivityResponse:
        return _scan_activity_fixture(fingerprint)

    monkeypatch.setattr(verifier_endpoint, "load_scan_activity", fake_load)
    params = {"envelope_id": envelope_id}

    # No UX event for this decision reached the verifier yet: say so, do not
    # guess that the phone never opened anything.
    unreported = client.get("/verifier/scan-activity", params=params)
    assert unreported.status_code == 200
    assert unreported.json()["destination_outcome"] == "unreported"
    assert unreported.json()["first_verified_at"] == "2026-08-25T10:00:00Z"
    assert unreported.json()["blocked_since_verified"] == 0

    body = unreported.json()
    assert body["latest"] is not None
    serialized = json.dumps(body)
    assert "nonce" not in serialized
    assert "usage_policy" not in serialized
    assert "replay_guard" not in serialized

    for event_type in ["preview", "hold_start", "hold_complete"]:
        response = client.post(
            "/scanner/ux-events",
            json=_scan_activity_ux_event("scan_activity_001", event_type),
        )
        assert response.status_code == 200
    held = client.get("/verifier/scan-activity", params=params)
    assert held.json()["destination_outcome"] == "held"

    # The most conclusive event for the decision wins; events for other
    # decisions are ignored.
    assert client.post(
        "/scanner/ux-events",
        json=_scan_activity_ux_event("scan_activity_001", "open"),
    ).status_code == 200
    assert client.post(
        "/scanner/ux-events",
        json=_scan_activity_ux_event("scan_activity_other", "cancel"),
    ).status_code == 200
    opened = client.get("/verifier/scan-activity", params=params)
    assert opened.json()["destination_outcome"] == "opened"


def test_scan_activity_omits_destination_outcome_without_a_latest_decision(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    envelope_id = "ef" * 32
    fingerprint = envelope_fingerprint(envelope_id)

    async def fake_load(requested_fingerprint: str, **_: Any) -> ScanActivityResponse:
        return _scan_activity_fixture(fingerprint).model_copy(
            update={
                "scan_count": 0,
                "green_count": 0,
                "first_scanned_at": None,
                "last_scanned_at": None,
                "first_verified_at": None,
                "latest": None,
            }
        )

    monkeypatch.setattr(verifier_endpoint, "load_scan_activity", fake_load)

    response = client.get(
        "/verifier/scan-activity",
        params={"envelope_id": envelope_id},
    )
    assert response.status_code == 200
    assert response.json()["destination_outcome"] is None
    assert response.json()["blocked_since_verified"] == 0


def test_scanner_decision_records_envelope_fingerprint_and_platform(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    original = verifier_endpoint.record_scanner_evidence

    async def passthrough(response: ScannerDecisionResponse, **kwargs: Any) -> Any:
        captured["decision_id"] = response.contract.decision_id
        captured.update(kwargs)
        return await original(response, **kwargs)

    monkeypatch.setattr(verifier_endpoint, "record_scanner_evidence", passthrough)

    demo_response = client.post(
        "/verifier/demo-materials",
        json={},
    )
    assert demo_response.status_code == 200

    scan_response = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": demo_response.json()["qr_payload"],
            "client": {"platform": "browser_lab", "app_version": "test"},
        },
    )

    assert scan_response.status_code == 200
    assert captured["decision_id"] == scan_response.json()["contract"]["decision_id"]
    assert captured["envelope_fingerprint"] == envelope_fingerprint(
        demo_response.json()["envelope_id"]
    )
    assert captured["client_platform"] == "browser_lab"


def test_scanner_decision_skips_the_envelope_fingerprint_for_plain_urls(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}
    original = verifier_endpoint.record_scanner_evidence

    async def passthrough(response: ScannerDecisionResponse, **kwargs: Any) -> Any:
        captured.update(kwargs)
        return await original(response, **kwargs)

    monkeypatch.setattr(verifier_endpoint, "record_scanner_evidence", passthrough)

    scan_response = client.post(
        "/scanner/decisions",
        json={"qr_payload": "https://unregistered.example/pay"},
    )

    assert scan_response.status_code == 200
    assert captured["envelope_fingerprint"] is None


def _clear_verifier_rate_limiter() -> None:
    verifier_endpoint._request_rate_limiter._records.clear()
    verifier_endpoint._verdict_cache.clear()


def _disable_verdict_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    # The budget tests replay one envelope; with the cache on, the replay is
    # a hit and never reaches the budget. Turn it off to test the budget alone.
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_VERDICT_CACHE_TTL_SECONDS", 0)


def _demo_verify_request(client: TestClient) -> dict[str, Any]:
    demo_response = client.post("/verifier/demo-materials", json={})
    assert demo_response.status_code == 200
    return demo_response.json()["verify_request"]


def test_verifier_envelope_budget_rejects_flood_before_signature_verification(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _disable_verdict_cache(monkeypatch)
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_ENVELOPE_RATE_LIMIT_MAX_REQUESTS", 1)
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_ENVELOPE_RATE_LIMIT_WINDOW_SECONDS", 60)
    _clear_verifier_rate_limiter()
    verify_request = _demo_verify_request(client)

    signature_checks = 0
    original_verify = verifier_endpoint._verifier.verify_presented_code

    async def counting_verify(*args: Any, **kwargs: Any) -> Any:
        nonlocal signature_checks
        signature_checks += 1
        return await original_verify(*args, **kwargs)

    monkeypatch.setattr(verifier_endpoint._verifier, "verify_presented_code", counting_verify)

    try:
        first = client.post("/verifier/verify", json=verify_request)
        second = client.post("/verifier/verify", json=verify_request)
    finally:
        _clear_verifier_rate_limiter()

    assert first.status_code == 200
    assert first.json()["allowed"] is True
    assert second.status_code == 429
    assert second.json()["detail"] == "Rate limit exceeded for this QR code"
    assert int(second.headers["Retry-After"]) >= 1
    # The over-budget request never reached the expensive signature check.
    assert signature_checks == 1


def test_scanner_decision_envelope_budget_returns_429_without_recording_evidence(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _disable_verdict_cache(monkeypatch)
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_ENVELOPE_RATE_LIMIT_MAX_REQUESTS", 1)
    _clear_verifier_rate_limiter()
    demo_response = client.post(
        "/verifier/demo-materials",
        json={},
    )
    assert demo_response.status_code == 200
    demo = demo_response.json()
    qr_payload = demo["qr_payload"]

    recorded_fingerprints: list[str | None] = []
    original_record = verifier_endpoint.record_scanner_evidence

    async def tracking_record(*args: Any, **kwargs: Any) -> Any:
        recorded_fingerprints.append(kwargs.get("envelope_fingerprint"))
        return await original_record(*args, **kwargs)

    monkeypatch.setattr(verifier_endpoint, "record_scanner_evidence", tracking_record)

    try:
        first = client.post("/scanner/decisions", json={"qr_payload": qr_payload})
        second = client.post("/scanner/decisions", json={"qr_payload": qr_payload})
    finally:
        _clear_verifier_rate_limiter()

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.headers["Retry-After"]
    # Only the served decision produced evidence; the throttled one left no row.
    assert recorded_fingerprints == [envelope_fingerprint(demo["envelope_id"])]


def test_verifier_issuer_budget_counts_only_signature_verified_requests(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _disable_verdict_cache(monkeypatch)
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_ISSUER_RATE_LIMIT_MAX_REQUESTS", 1)
    _clear_verifier_rate_limiter()
    verify_request = _demo_verify_request(client)
    forged_request = copy.deepcopy(verify_request)
    forged_request["envelope"]["signature"] = "AAAA" + forged_request["envelope"]["signature"][4:]

    try:
        forged = client.post("/verifier/verify", json=forged_request)
        valid = client.post("/verifier/verify", json=verify_request)
        over_budget = client.post("/verifier/verify", json=verify_request)
    finally:
        _clear_verifier_rate_limiter()

    # A forged envelope fails the signature check and must not burn the issuer's budget.
    assert forged.status_code == 200
    assert forged.json()["allowed"] is False
    assert forged.json()["stage"] == "signed_schema"
    assert valid.status_code == 200
    assert valid.json()["allowed"] is True
    assert over_budget.status_code == 429
    assert over_budget.json()["detail"] == "Rate limit exceeded for this issuer"
    assert int(over_budget.headers["Retry-After"]) >= 1


def test_verifier_status_reports_scan_flood_budgets(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(verifier_endpoint.config, "FORWARDED_ALLOW_IPS", "")
    payload = client.get("/verifier/status").json()
    assert payload["forwarded_ip_trust_configured"] is False
    assert payload["envelope_rate_limit_window_seconds"] == 60
    assert payload["envelope_rate_limit_max_requests"] == 300
    assert payload["issuer_rate_limit_max_requests"] == 3000

    # Loopback is uvicorn's own default: an explicit 127.0.0.1 trusts nothing new.
    monkeypatch.setattr(verifier_endpoint.config, "FORWARDED_ALLOW_IPS", "127.0.0.1, ::1")
    assert client.get("/verifier/status").json()["forwarded_ip_trust_configured"] is False

    monkeypatch.setattr(verifier_endpoint.config, "FORWARDED_ALLOW_IPS", "127.0.0.1,203.0.113.0/24")
    assert client.get("/verifier/status").json()["forwarded_ip_trust_configured"] is True


def _count_signature_checks(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    checks = [0]
    original_verify = verifier_endpoint._verifier.verify_presented_code

    async def counting_verify(*args: Any, **kwargs: Any) -> Any:
        checks[0] += 1
        return await original_verify(*args, **kwargs)

    monkeypatch.setattr(verifier_endpoint._verifier, "verify_presented_code", counting_verify)
    return checks


def test_verifier_verdict_cache_serves_repeat_scan_without_signature_check(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_verifier_rate_limiter()
    verify_request = _demo_verify_request(client)
    checks = _count_signature_checks(monkeypatch)

    try:
        first = client.post("/verifier/verify", json=verify_request)
        second = client.post("/verifier/verify", json=verify_request)
    finally:
        _clear_verifier_rate_limiter()

    assert first.status_code == 200
    assert first.headers["X-QR-Trust-Verdict"] == "computed"
    assert first.json()["verdict_source"] == "computed"
    assert second.status_code == 200
    assert second.headers["X-QR-Trust-Verdict"] == "cached"
    second_body = second.json()
    assert second_body["verdict_source"] == "cached"
    # Same verdict, only the provenance differs.
    assert {**second_body, "verdict_source": "computed"} == first.json()
    assert checks[0] == 1


def test_verifier_verdict_cache_wins_over_the_envelope_budget(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_ENVELOPE_RATE_LIMIT_MAX_REQUESTS", 1)
    _clear_verifier_rate_limiter()
    verify_request = _demo_verify_request(client)
    tampered = copy.deepcopy(verify_request)
    tampered["envelope"]["signature"] = "AAAA" + tampered["envelope"]["signature"][4:]

    try:
        first = client.post("/verifier/verify", json=verify_request)
        replay = client.post("/verifier/verify", json=verify_request)
        forged = client.post("/verifier/verify", json=tampered)
        forged_replay = client.post("/verifier/verify", json=tampered)
    finally:
        _clear_verifier_rate_limiter()

    assert first.status_code == 200
    # A crowd scanning the same poster gets the cached verdict, not a 429 ...
    assert replay.status_code == 200
    assert replay.headers["X-QR-Trust-Verdict"] == "cached"
    # ... while a tampered envelope is a different envelope: it carries its own
    # budget and its own failed signature check.
    assert forged.status_code == 200
    assert forged.json()["allowed"] is False
    assert forged.json()["stage"] == "signed_schema"
    # A forgery verdict is never cached, so replaying it meets the budget.
    assert forged_replay.status_code == 429
    assert forged_replay.json()["detail"] == "Rate limit exceeded for this QR code"


def test_scanner_decision_cached_verdict_skips_evidence_and_reports_throttle(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_verifier_rate_limiter()
    demo_response = client.post(
        "/verifier/demo-materials",
        json={},
    )
    assert demo_response.status_code == 200
    demo = demo_response.json()
    qr_payload = demo["qr_payload"]

    recorded_fingerprints: list[str | None] = []
    original_record = verifier_endpoint.record_scanner_evidence

    async def tracking_record(*args: Any, **kwargs: Any) -> Any:
        recorded_fingerprints.append(kwargs.get("envelope_fingerprint"))
        return await original_record(*args, **kwargs)

    monkeypatch.setattr(verifier_endpoint, "record_scanner_evidence", tracking_record)

    try:
        first = client.post("/scanner/decisions", json={"qr_payload": qr_payload})
        second = client.post("/scanner/decisions", json={"qr_payload": qr_payload})
        activity = client.get(
            "/verifier/scan-activity",
            params={"envelope_id": demo["envelope_id"]},
        )
    finally:
        _clear_verifier_rate_limiter()

    assert first.status_code == 200
    assert first.json()["verdict_source"] == "computed"
    assert second.status_code == 200
    assert second.headers["X-QR-Trust-Verdict"] == "cached"
    assert second.json()["verdict_source"] == "cached"
    assert second.json()["decision_state"] == first.json()["decision_state"]
    # The cached scan wrote no evidence row; it is counted in the throttle block.
    assert recorded_fingerprints == [envelope_fingerprint(demo["envelope_id"])]

    assert activity.status_code == 200
    payload = activity.json()
    throttle = payload["throttle"]
    assert throttle["cached_verdicts"] == 1
    assert throttle["last_cached_at"]
    assert throttle["verdict_cache_ttl_seconds"] == config.VERIFIER_VERDICT_CACHE_TTL_SECONDS
    assert throttle["envelope_budget_limit"] == config.VERIFIER_ENVELOPE_RATE_LIMIT_MAX_REQUESTS
    assert (
        throttle["envelope_budget_window_seconds"]
        == config.VERIFIER_ENVELOPE_RATE_LIMIT_WINDOW_SECONDS
    )
    # Only the computed scan spent budget.
    assert (
        throttle["envelope_budget_remaining"]
        == config.VERIFIER_ENVELOPE_RATE_LIMIT_MAX_REQUESTS - 1
    )
    # Without an evidence store the row counts stay honest: no fabricated scans.
    assert payload["persistence_state"] == "unconfigured"
    assert payload["scan_count"] == 0


def test_scanner_decision_cached_verdict_counts_toward_spike_detection(
    client: TestClient,
) -> None:
    _clear_verifier_rate_limiter()
    demo_response = client.post(
        "/verifier/demo-materials",
        json={},
    )
    assert demo_response.status_code == 200
    demo = demo_response.json()
    qr_payload = demo["qr_payload"]

    try:
        sources = [
            client.post("/scanner/decisions", json={"qr_payload": qr_payload}).json()["verdict_source"]
            for _ in range(3)
        ]
        # Cached scans write no evidence row, so the cache keeps its own
        # per-minute counter that the spike detector merges with the rows.
        # Read it before the helper below wipes the cache.
        now = time.time()
        cached_scans = asyncio.run(
            verifier_endpoint._verdict_cache.cached_scan_count(
                envelope_fingerprint(demo["envelope_id"]), since=now - 60, until=now
            )
        )
    finally:
        _clear_verifier_rate_limiter()

    assert sources == ["computed", "cached", "cached"]
    assert cached_scans == 2


def test_verifier_verdict_cache_misses_when_issuer_state_changes(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_verifier_rate_limiter()
    verify_request = _demo_verify_request(client)
    revoked = copy.deepcopy(verify_request)
    # Demo materials now bakes an explicit issuer_status onto the returned
    # issuer_state (Task 6); clear it so the legacy certificate_revoked
    # fallback this test exercises is still the thing deciding the outcome.
    revoked["issuer_state"]["issuer_status"] = None
    revoked["issuer_state"]["certificate_revoked"] = True
    revoked["issuer_state"]["certificate_revocation_reason"] = "key_compromise"

    try:
        first = client.post("/verifier/verify", json=verify_request)
        after_revocation = client.post("/verifier/verify", json=revoked)
    finally:
        _clear_verifier_rate_limiter()

    assert first.json()["allowed"] is True
    # Revocation changes the request, so it is a miss: never a stale green.
    assert after_revocation.headers["X-QR-Trust-Verdict"] == "computed"
    assert after_revocation.json()["allowed"] is False


def test_verifier_verdict_cache_disabled_by_zero_ttl(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _disable_verdict_cache(monkeypatch)
    _clear_verifier_rate_limiter()
    verify_request = _demo_verify_request(client)
    checks = _count_signature_checks(monkeypatch)

    try:
        client.post("/verifier/verify", json=verify_request)
        second = client.post("/verifier/verify", json=verify_request)
    finally:
        _clear_verifier_rate_limiter()

    assert second.headers["X-QR-Trust-Verdict"] == "computed"
    assert checks[0] == 2
    status = client.get("/verifier/status").json()
    assert status["verdict_cache_enabled"] is False
    assert status["verdict_cache_ttl_seconds"] == 0


def test_verifier_status_reports_verdict_cache(client: TestClient) -> None:
    payload = client.get("/verifier/status").json()
    assert payload["verdict_cache_enabled"] is True
    assert payload["verdict_cache_ttl_seconds"] == 30


def test_verifier_status_reports_scan_spike_settings(client: TestClient) -> None:
    payload = client.get("/verifier/status").json()
    assert payload["scan_spike_alerts_enabled"] is False
    assert payload["scan_spike_window_seconds"] == 60
    assert payload["scan_spike_baseline_seconds"] == 3600
    assert payload["scan_spike_ratio"] == 10.0
    assert payload["scan_spike_min_scans"] == 30


def test_demo_materials_returns_envelope_id_and_v2_claims(client):
    response = client.post("/verifier/demo-materials", json={})
    assert response.status_code == 200
    body = response.json()
    claims = body["verify_request"]["envelope"]["claims"]
    assert claims["version"] == "2"
    assert set(claims) == {"version", "certificate_ref", "issued_at", "expires_at", "payload"}
    assert re.fullmatch(r"[0-9a-f]{64}", body["envelope_id"])
    assert "nonce" not in json.dumps(body)
    assert "usage_policy" not in json.dumps(body)


def test_verifier_reference_api_accepts_repeated_scans_of_one_envelope(client):
    demo = client.post("/verifier/demo-materials", json={}).json()
    first = client.post("/verifier/verify", json=demo["verify_request"]).json()
    second = client.post("/verifier/verify", json=demo["verify_request"]).json()
    assert first["allowed"] is True
    assert second["allowed"] is True
    assert second["stage"] == first["stage"]
    assert "reservation_state" not in second
    assert "usage_policy" not in second


def test_scanner_decision_reports_envelope_id_for_signed_envelope(client):
    demo = client.post("/verifier/demo-materials", json={}).json()
    response = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": demo["qr_payload"],
            "certificate": demo["certificate"],
            "issuer_state": demo["issuer_state"],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["decision_state"] == "verified_issuer"
    assert body["envelope_id"] == demo["envelope_id"]
    assert "usage_policy" not in body


def test_scanner_decision_reports_envelope_id_for_unregistered_signed_envelope(client: TestClient) -> None:
    registered = client.post(
        "/verifier/demo-materials",
        json={},
    )
    assert registered.status_code == 200

    unregistered = client.post(
        "/verifier/demo-materials",
        json={
            "register_scanner_trust": False,
        },
    )
    assert unregistered.status_code == 200

    result = client.post(
        "/scanner/decisions",
        json={"qr_payload": unregistered.json()["qr_payload"]},
    )
    assert result.status_code == 200
    payload = result.json()
    assert payload["decision_state"] == "signed_unknown_issuer"
    assert re.fullmatch(r"[0-9a-f]{64}", payload["envelope_id"])


def test_scanner_decision_accepted_runtime_safety_message_drops_replay_wording(client: TestClient) -> None:
    demo = client.post("/verifier/demo-materials", json={}).json()
    response = client.post(
        "/scanner/decisions",
        json={"qr_payload": demo["qr_payload"]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["decision_state"] == "verified_issuer"
    runtime_signal = next(signal for signal in body["signals"] if signal["layer"] == "runtime_safety")
    assert runtime_signal["message"] == "Signature and validity checks passed."
    body_text = json.dumps(body)
    assert "replay" not in body_text.lower()


def test_scanner_decision_never_emits_suspicious_tld(client):
    demo = client.post(
        "/verifier/demo-materials",
        json={"payload": "https://acme.zip/pay", "verified_domains": ["acme.zip"]},
    ).json()
    response = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": demo["qr_payload"],
            "certificate": demo["certificate"],
            "issuer_state": demo["issuer_state"],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["decision_state"] == "verified_issuer"
    assert "suspicious" not in json.dumps(body).lower()


def test_verify_budget_is_keyed_by_envelope(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "VERIFIER_ENVELOPE_RATE_LIMIT_MAX_REQUESTS", 2)
    monkeypatch.setattr(config, "VERIFIER_VERDICT_CACHE_TTL_SECONDS", 0)
    demo = client.post("/verifier/demo-materials", json={}).json()
    codes = [
        client.post("/verifier/verify", json=demo["verify_request"]).status_code
        for _ in range(3)
    ]
    assert codes == [200, 200, 429]
    # A different envelope carries its own budget.
    other = client.post("/verifier/demo-materials", json={}).json()
    assert client.post("/verifier/verify", json=other["verify_request"]).status_code == 200


def test_verify_second_presentation_is_served_from_cache(client: TestClient) -> None:
    demo = client.post("/verifier/demo-materials", json={}).json()
    first = client.post("/verifier/verify", json=demo["verify_request"])
    second = client.post("/verifier/verify", json=demo["verify_request"])
    assert first.json()["verdict_source"] == "computed"
    assert second.json()["verdict_source"] == "cached"
    assert second.headers["X-QR-Trust-Verdict"] == "cached"
    activity = client.get(
        "/verifier/scan-activity",
        params={"envelope_id": demo["envelope_id"]},
    ).json()
    assert activity["throttle"]["cached_verdicts"] >= 1


def test_scanner_decisions_records_envelope_fingerprint(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def fake_record(
        response: ScannerDecisionResponse,
        *,
        envelope_fingerprint: str | None = None,
        client_platform: str | None = None,
    ) -> None:
        captured["fingerprint"] = envelope_fingerprint
        return None

    monkeypatch.setattr(verifier_endpoint, "record_scanner_evidence", fake_record)
    demo = client.post("/verifier/demo-materials", json={}).json()
    client.post(
        "/scanner/decisions",
        json={
            "qr_payload": demo["qr_payload"],
            "certificate": demo["certificate"],
            "issuer_state": demo["issuer_state"],
        },
    )
    assert captured["fingerprint"] == demo["envelope_id"][:16]


FAMILIES = (
    "issuer_chain",
    "destination_policy",
    "redirect_flow",
    "runtime_safety",
    "freshness",
    "artifact_integrity",
)


def _scan(client: TestClient, demo: dict[str, Any]) -> dict[str, Any]:
    return client.post(
        "/scanner/decisions",
        json={
            "qr_payload": demo["qr_payload"],
            "certificate": demo["certificate"],
            "issuer_state": demo["issuer_state"],
        },
    ).json()


def _legacy_v1_qr_payload(demo: dict[str, Any]) -> str:
    """A real legacy-v1 QR payload, built with the production artifact codec.

    The v2 envelope is decoded and re-encoded by `qr_artifact_poc`, so the
    container framing is the real one; only the claims mapping is put back the
    way version 1 carried it (a `version` of "1" alongside the two claim fields
    v2 removed). The signature is kept as-is: it will not verify, which is
    fine, because the claims-version check runs first.
    """
    envelope = decode_envelope_from_qr_payload(demo["qr_payload"])
    payload_mapping = json.loads(encode_envelope_as_qr_payload(envelope))
    claims = payload_mapping["claims"]
    claims["version"] = "1"
    claims["nonce"] = "legacy-001"
    claims["usage_policy"] = "reusable_public"
    return json.dumps(payload_mapping, separators=(",", ":"), ensure_ascii=True)


def test_verified_scan_exposes_a_passing_residual_vector_and_model_decision(
    client: TestClient,
) -> None:
    demo = client.post("/verifier/demo-materials", json={}).json()
    body = _scan(client, demo)
    assert tuple(body["residual_vector"]) == FAMILIES
    assert body["residual_vector"]["issuer_chain"] == {"tier": "pass", "cause": None}
    assert body["residual_vector"]["freshness"] == {"tier": "pass", "cause": None}
    assert body["residual_vector"]["runtime_safety"]["tier"] in {"not-checked", "pass"}
    model = body["model_decision"]
    assert model["profile"] == "bounded-online"
    assert model["primary_state"] == "verified-issuer"
    assert model["attention_level"] in {"positive", "neutral", "warning", "block"}


def test_expired_scan_blocks_on_freshness_with_object_expired_cause(
    client: TestClient,
) -> None:
    demo = client.post(
        "/verifier/demo-materials",
        json={"issued_offset_minutes": -10, "expires_offset_minutes": -5},
    ).json()
    body = _scan(client, demo)
    assert body["decision_state"] != "verified_issuer"
    assert body["residual_vector"]["freshness"] == {
        "tier": "block",
        "cause": "object-expired",
    }
    assert body["model_decision"]["primary_state"] != "verified-issuer"


def test_revoked_scan_marks_issuer_chain_revoked(client: TestClient) -> None:
    demo = client.post(
        "/verifier/demo-materials",
        json={"certificate_revoked": True, "certificate_revocation_reason": "key_compromise"},
    ).json()
    body = _scan(client, demo)
    # Task 6 redefines certificate_revoked on this surface as a revoked KEY, not
    # a revoked issuer (see verifier._build_demo_materials_response): the tier
    # both stages share stays revoked-issuer, but the cause slug now says which
    # half of the credential actually failed.
    assert body["residual_vector"]["issuer_chain"] == {
        "tier": "revoked-issuer",
        "cause": "key-revoked",
    }


def test_plain_url_scan_is_unverified_with_no_signed_envelope_cause(
    client: TestClient,
) -> None:
    demo = client.post("/verifier/demo-materials", json={}).json()
    body = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": "https://acme.example/pay",
            "certificate": demo["certificate"],
            "issuer_state": demo["issuer_state"],
        },
    ).json()
    assert body["decision_state"] == "unverified"
    assert body["envelope_id"] is None
    assert body["residual_vector"]["issuer_chain"] == {
        "tier": "unaccepted-issuer",
        "cause": "no-signed-envelope",
    }
    assert body["model_decision"]["primary_state"] != "verified-issuer"


def test_version_1_envelope_is_unverified_not_a_500(client: TestClient) -> None:
    demo = client.post("/verifier/demo-materials", json={}).json()
    legacy_payload = _legacy_v1_qr_payload(demo)
    response = client.post(
        "/scanner/decisions",
        json={
            "qr_payload": legacy_payload,
            "certificate": demo["certificate"],
            "issuer_state": demo["issuer_state"],
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["decision_state"] == "unverified"
    assert body["residual_vector"]["issuer_chain"] == {
        "tier": "unaccepted-issuer",
        "cause": "unsupported-claims-version",
    }
    assert "unsupported_claims_version" in body["model_decision"]["reason_codes"]


def test_verify_reports_key_revoked_from_the_new_key_state_field(client: TestClient) -> None:
    _clear_verifier_rate_limiter()
    request = _demo_verify_request(client)
    request["issuer_state"]["key_state"] = "revoked"
    request["issuer_state"]["key_revocation_reason"] = "key compromise"
    try:
        response = client.post("/verifier/verify", json=request)
    finally:
        _clear_verifier_rate_limiter()

    assert response.status_code == 200
    body = response.json()
    assert body["allowed"] is False
    assert body["stage"] == "key_status"
    assert body["cause"] == "key-revoked"


def test_verify_keeps_the_legacy_inactive_certificate_cause(client: TestClient) -> None:
    _clear_verifier_rate_limiter()
    request = _demo_verify_request(client)
    # Demo materials now bakes an explicit issuer_status onto the returned
    # issuer_state (Task 6); clear it so this test exercises the legacy
    # certificate_active fallback it is actually named for.
    request["issuer_state"]["issuer_status"] = None
    request["issuer_state"]["certificate_active"] = False
    try:
        response = client.post("/verifier/verify", json=request)
    finally:
        _clear_verifier_rate_limiter()

    assert response.status_code == 200
    body = response.json()
    assert body["allowed"] is False
    assert body["stage"] == "issuer_status"
    # The stage name changed; the cause slug the catalogues key on did not.
    assert body["cause"] == "issuer-inactive"


def test_verify_accepts_an_unchanged_legacy_request(client: TestClient) -> None:
    _clear_verifier_rate_limiter()
    request = _demo_verify_request(client)
    # No new fields at all: absent windows default to unbounded, absent states to active.
    try:
        response = client.post("/verifier/verify", json=request)
    finally:
        _clear_verifier_rate_limiter()

    assert response.status_code == 200
    body = response.json()
    assert body["allowed"] is True
    assert body["stage"] == "accepted"
    assert body["cause"] is None


def test_verify_rejects_an_inverted_key_window_with_422(client: TestClient) -> None:
    _clear_verifier_rate_limiter()
    request = _demo_verify_request(client)
    request["issuer_state"]["key_not_before"] = "2026-03-01T00:00:00Z"
    request["issuer_state"]["key_not_after"] = "2026-02-01T00:00:00Z"
    try:
        response = client.post("/verifier/verify", json=request)
    finally:
        _clear_verifier_rate_limiter()

    # Malformed trust input is an input error, never a blocked verdict.
    assert response.status_code == 422


def test_verify_rejects_an_unknown_issuer_status_with_422(client: TestClient) -> None:
    _clear_verifier_rate_limiter()
    request = _demo_verify_request(client)
    request["issuer_state"]["issuer_status"] = "probationary"
    try:
        response = client.post("/verifier/verify", json=request)
    finally:
        _clear_verifier_rate_limiter()

    assert response.status_code == 422


def test_verdict_cache_ttl_is_the_configured_ttl_for_open_ended_claims() -> None:
    # The demo surface cannot emit a null expiry until Task 6, so this covers the
    # nullable branch directly rather than through an HTTP round trip.
    assert (
        verifier_endpoint._verdict_cache_ttl_seconds(None)
        == config.VERIFIER_VERDICT_CACHE_TTL_SECONDS
    )


def test_scanner_trust_survives_a_second_issuance_under_a_new_key() -> None:
    """Two demo issuances no longer fight over one slot.

    This is the bug the store exists to fix: the old dict was keyed on
    certificate_ref, and every demo call minted a fresh keypair under the same
    ref, so the first QR stopped verifying the moment a second one was made.
    """
    from backend.app.api.endpoints import verifier as verifier_endpoint
    from backend.app.services.scanner_trust_store import IssuerRecord, KeyEntry

    verifier_endpoint._scanner_trust_store.clear()
    now = datetime.now(timezone.utc)
    issuer = IssuerRecord(
        issuer_id="acme-demo",
        issuer_name="Acme Demo Issuer",
        root_id="root:qrtrust-demo",
        status="active",
        issued_at=now - timedelta(days=1),
        expires_at=None,
        verified_domains=("acme.example",),
        allow_subdomains=False,
    )
    verifier_endpoint._scanner_trust_store.put_issuer(issuer)
    for ref in ("cert:acme-demo:2026-01", "cert:acme-demo:2026-01-r1"):
        verifier_endpoint._scanner_trust_store.put_key(
            KeyEntry(
                key_ref=ref,
                issuer_id="acme-demo",
                algorithm_id="rsa-pss-sha256-v1",
                public_key_pem="-----BEGIN PUBLIC KEY-----\nstub\n-----END PUBLIC KEY-----\n",
                state="active",
                not_before=now - timedelta(days=1),
                not_after=None,
            )
        )

    first = verifier_endpoint._scanner_record_for("cert:acme-demo:2026-01")
    second = verifier_endpoint._scanner_record_for("cert:acme-demo:2026-01-r1")

    assert first is not None
    assert second is not None
    assert first.certificate.certificate_ref == "cert:acme-demo:2026-01"
    assert second.certificate.certificate_ref == "cert:acme-demo:2026-01-r1"
    assert first.certificate.issuer_name == "Acme Demo Issuer"


def test_scanner_record_for_returns_none_for_an_unknown_key() -> None:
    from backend.app.api.endpoints import verifier as verifier_endpoint

    verifier_endpoint._scanner_trust_store.clear()

    assert verifier_endpoint._scanner_record_for("cert:nobody:2026-01") is None


def test_scanner_record_round_trips_the_issuer_state_the_rules_need() -> None:
    """The derived view must re-derive to the same trust decision inputs.

    _run_scanned_verifier rebuilds a TrustContext from record.issuer_state via
    the Task 4 adapter. If the round-trip drops a field, the scanner and the
    verify endpoint would disagree about the same artifact.
    """
    from backend.app.api.endpoints import verifier as verifier_endpoint
    from backend.app.schemas.poc import CertificateRecordInput, IssuerVerificationStateInput

    verifier_endpoint._scanner_trust_store.clear()
    now = datetime.now(timezone.utc)
    certificate = CertificateRecordInput(
        issuer_name="Acme Demo Issuer",
        certificate_ref="cert:acme-demo:2026-01",
        algorithm_id="rsa-pss-sha256-v1",
        public_key_pem="-----BEGIN PUBLIC KEY-----\nstub\n-----END PUBLIC KEY-----\n",
    )
    verifier_endpoint._register_scanner_trust(
        certificate,
        IssuerVerificationStateInput(
            verified_domains=["acme.example"],
            allow_subdomains=True,
            certificate_active=True,
            certificate_revoked=False,
        ),
        key_state="retired",
        key_not_before=now - timedelta(days=5),
        key_not_after=now - timedelta(days=1),
    )

    record = verifier_endpoint._scanner_record_for("cert:acme-demo:2026-01")

    assert record is not None
    assert record.issuer_state.verified_domains == ["acme.example"]
    assert record.issuer_state.allow_subdomains is True
    assert record.issuer_state.key_state == "retired"
    assert record.issuer_state.key_not_before is not None
    assert record.issuer_state.key_not_after is not None


def test_unregister_scanner_trust_removes_only_that_key() -> None:
    from backend.app.api.endpoints import verifier as verifier_endpoint
    from backend.app.schemas.poc import CertificateRecordInput, IssuerVerificationStateInput

    verifier_endpoint._scanner_trust_store.clear()
    for ref in ("cert:acme-demo:2026-01", "cert:acme-demo:2026-01-r1"):
        verifier_endpoint._register_scanner_trust(
            CertificateRecordInput(
                issuer_name="Acme Demo Issuer",
                certificate_ref=ref,
                algorithm_id="rsa-pss-sha256-v1",
                public_key_pem="-----BEGIN PUBLIC KEY-----\nstub\n-----END PUBLIC KEY-----\n",
            ),
            IssuerVerificationStateInput(verified_domains=["acme.example"]),
        )

    verifier_endpoint._unregister_scanner_trust("cert:acme-demo:2026-01")

    assert verifier_endpoint._scanner_record_for("cert:acme-demo:2026-01") is None
    assert verifier_endpoint._scanner_record_for("cert:acme-demo:2026-01-r1") is not None


def test_demo_materials_reuse_one_key_across_issuances(client: TestClient) -> None:
    """The fix for the single-slot overwrite, asserted end to end."""
    _clear_verifier_rate_limiter()

    first = client.post("/verifier/demo-materials", json={})
    second = client.post("/verifier/demo-materials", json={})

    assert first.status_code == 200
    assert second.status_code == 200
    first_ref = first.json()["certificate"]["certificate_ref"]
    assert second.json()["certificate"]["certificate_ref"] == first_ref
    assert (
        second.json()["certificate"]["public_key_pem"]
        == first.json()["certificate"]["public_key_pem"]
    )

    # The QR issued first still verifies after the second issuance.
    replayed = client.post("/verifier/verify", json=first.json()["verify_request"])
    assert replayed.status_code == 200
    assert replayed.json()["allowed"] is True


def test_demo_materials_rotate_key_mints_a_new_ref_and_retires_the_old(
    client: TestClient,
) -> None:
    _clear_verifier_rate_limiter()

    before = client.post("/verifier/demo-materials", json={})
    rotated = client.post("/verifier/demo-materials", json={"rotate_key": True})

    assert rotated.status_code == 200
    old_ref = before.json()["certificate"]["certificate_ref"]
    new_ref = rotated.json()["certificate"]["certificate_ref"]
    assert new_ref != old_ref
    assert rotated.json()["trust"]["key_ref"] == new_ref
    assert rotated.json()["trust"]["key_state"] == "active"
    assert old_ref in rotated.json()["trust"]["retired_key_refs"]

    # The pre-rotation QR still verifies: it was signed while its key was current.
    replayed = client.post("/verifier/verify", json=before.json()["verify_request"])
    assert replayed.status_code == 200
    assert replayed.json()["allowed"] is True


def test_demo_materials_key_state_revoked_blocks_with_the_key_cause(
    client: TestClient,
) -> None:
    _clear_verifier_rate_limiter()

    demo = client.post("/verifier/demo-materials", json={"key_state": "revoked"})
    assert demo.status_code == 200
    assert demo.json()["trust"]["key_state"] == "revoked"

    result = client.post("/verifier/verify", json=demo.json()["verify_request"])

    assert result.status_code == 200
    assert result.json()["allowed"] is False
    assert result.json()["stage"] == "key_status"
    assert result.json()["cause"] == "key-revoked"


def test_demo_materials_open_ended_expiry_emits_a_null_claim(client: TestClient) -> None:
    _clear_verifier_rate_limiter()

    demo = client.post(
        "/verifier/demo-materials", json={"expires_offset_minutes": None}
    )

    assert demo.status_code == 200
    claims = demo.json()["verify_request"]["envelope"]["claims"]
    assert claims["expires_at"] is None

    result = client.post("/verifier/verify", json=demo.json()["verify_request"])
    assert result.status_code == 200
    assert result.json()["allowed"] is True


def test_demo_materials_finite_expiry_still_caps_at_thirty_days(
    client: TestClient,
) -> None:
    _clear_verifier_rate_limiter()

    too_long = client.post(
        "/verifier/demo-materials",
        json={"expires_offset_minutes": 30 * 24 * 60 + 1},
    )

    assert too_long.status_code == 422


def test_demo_materials_expired_issuer_record_blocks_with_the_record_cause(
    client: TestClient,
) -> None:
    _clear_verifier_rate_limiter()

    demo = client.post(
        "/verifier/demo-materials",
        json={"issuer_record_expires_offset_minutes": -1},
    )
    assert demo.status_code == 200

    result = client.post("/verifier/verify", json=demo.json()["verify_request"])

    assert result.status_code == 200
    assert result.json()["allowed"] is False
    assert result.json()["stage"] == "issuer_status"
    assert result.json()["cause"] == "issuer-record-expired"


def test_trust_store_lists_issuers_and_keys_with_windows(client: TestClient) -> None:
    verifier_endpoint._scanner_trust_store.clear()

    first = client.post("/verifier/demo-materials", json={})
    assert first.status_code == 200
    rotated = client.post("/verifier/demo-materials", json={"rotate_key": True})
    assert rotated.status_code == 200

    response = client.get("/verifier/trust-store")
    assert response.status_code == 200
    listing = TrustStoreResponse.model_validate(response.json())

    assert [issuer.issuer_id for issuer in listing.issuers] == ["Acme Demo Issuer"]
    issuer = listing.issuers[0]
    assert issuer.status == "active"
    assert issuer.root_id == "root:qrtrust-demo"
    assert issuer.expires_at is None
    assert issuer.verified_domains == ["acme.example"]

    states = {entry.key_ref: entry.state for entry in listing.keys}
    assert states == {
        first.json()["trust"]["key_ref"]: "retired",
        rotated.json()["trust"]["key_ref"]: "active",
    }
    retired = next(entry for entry in listing.keys if entry.state == "retired")
    assert retired.not_after is not None
    assert retired.revoked_at is None
    assert all("public_key_pem" not in entry.model_dump() for entry in listing.keys)
    assert listing.generated_at.endswith("+00:00")


def test_trust_store_is_empty_after_clear(client: TestClient) -> None:
    verifier_endpoint._scanner_trust_store.clear()

    response = client.get("/verifier/trust-store")
    assert response.status_code == 200
    assert response.json() == {
        "generated_at": response.json()["generated_at"],
        "issuers": [],
        "keys": [],
    }


def test_trust_store_echoes_a_full_length_revocation_reason(client: TestClient) -> None:
    """Response caps must not sit below the input caps the store accepts.

    A 300-character revocation reason is legal on the way in (512), so the
    listing has to render it rather than fail model validation and 500.
    """
    verifier_endpoint._scanner_trust_store.clear()
    _clear_verifier_rate_limiter()

    reason = "r" * 300
    demo = client.post(
        "/verifier/demo-materials",
        json={"key_state": "revoked", "certificate_revocation_reason": reason},
    )
    assert demo.status_code == 200

    response = client.get("/verifier/trust-store")

    assert response.status_code == 200
    listing = TrustStoreResponse.model_validate(response.json())
    revoked = next(entry for entry in listing.keys if entry.state == "revoked")
    assert revoked.revocation_reason == reason


def test_trust_store_is_readable_without_a_credential_when_auth_disabled(
    client: TestClient,
) -> None:
    """The demo default. The lab and the cross-surface smokes depend on it."""
    verifier_endpoint._scanner_trust_store.clear()
    _clear_verifier_rate_limiter()

    response = client.get("/verifier/trust-store")

    assert response.status_code == 200
    assert response.json()["keys"] == []


def test_trust_store_requires_an_operator_credential_when_auth_enabled(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The listing is operator evidence, gated exactly like /verifier/status."""
    verifier_endpoint._scanner_trust_store.clear()
    _clear_verifier_rate_limiter()
    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["trust-store-admin"])

    denied = client.get("/verifier/trust-store")

    assert denied.status_code == 403
    assert denied.json()["detail"] == (
        "Trust store listing requires an operator credential"
    )

    allowed = client.get(
        "/verifier/trust-store",
        headers={"X-Admin-Token": "trust-store-admin"},
    )

    assert allowed.status_code == 200
    assert allowed.json()["keys"] == []


def test_valid_after_key_revoked_mints_a_new_key_and_leaves_the_old_blocked(
    client: TestClient,
) -> None:
    """Spec Q3: a revoked key blocks every artifact it signed, forever.

    The lab drives exactly this sequence — the key-revoked chip, then the valid
    chip. Reusing the revoked ref for the second issuance re-put it as active,
    which un-revoked the key and let the first QR verify again.
    """
    verifier_endpoint._scanner_trust_store.clear()
    _clear_verifier_rate_limiter()

    revoked = client.post("/verifier/demo-materials", json={"key_state": "revoked"})
    assert revoked.status_code == 200
    revoked_ref = revoked.json()["trust"]["key_ref"]

    valid = client.post("/verifier/demo-materials", json={})
    assert valid.status_code == 200
    valid_ref = valid.json()["trust"]["key_ref"]

    assert valid_ref != revoked_ref
    assert valid.json()["trust"]["key_state"] == "active"

    listing = TrustStoreResponse.model_validate(
        client.get("/verifier/trust-store").json()
    )
    states = {entry.key_ref: entry.state for entry in listing.keys}
    assert states[revoked_ref] == "revoked"
    assert states[valid_ref] == "active"

    first = client.post("/verifier/verify", json=revoked.json()["verify_request"])
    assert first.status_code == 200
    assert first.json()["allowed"] is False
    assert first.json()["cause"] == "key-revoked"

    second = client.post("/verifier/verify", json=valid.json()["verify_request"])
    assert second.status_code == 200
    assert second.json()["allowed"] is True


def test_cycling_the_lab_chips_never_hits_the_terminal_revocation_guard(
    client: TestClient,
) -> None:
    """put_key's guard is unreachable from the demo surface, asserted not assumed.

    Driving the key-revoked and valid chips alternately is the sequence that
    would re-put a revoked ref; every call must stay a 200 and every revoked ref
    must stay revoked in the listing.
    """
    verifier_endpoint._scanner_trust_store.clear()
    _clear_verifier_rate_limiter()

    revoked_refs: list[str] = []
    for _ in range(3):
        revoked = client.post("/verifier/demo-materials", json={"key_state": "revoked"})
        assert revoked.status_code == 200
        revoked_refs.append(revoked.json()["trust"]["key_ref"])

        valid = client.post("/verifier/demo-materials", json={})
        assert valid.status_code == 200
        assert valid.json()["trust"]["key_state"] == "active"
        assert valid.json()["trust"]["key_ref"] not in revoked_refs

    assert len(set(revoked_refs)) == 3

    listing = TrustStoreResponse.model_validate(
        client.get("/verifier/trust-store").json()
    )
    states = {entry.key_ref: entry.state for entry in listing.keys}
    assert [states[ref] for ref in revoked_refs] == ["revoked", "revoked", "revoked"]


def test_demo_materials_starts_from_the_base_key_ref_after_the_fixture_reset(
    client: TestClient,
) -> None:
    """_demo_keys is process-global and append-only.

    The client fixture clears the trust store but used to leave the key list
    alone, so demo serials drifted with test order and any assertion naming a
    concrete ref was order-dependent. The fixture now trims the list back to its
    first, process-stable keypair.
    """
    _clear_verifier_rate_limiter()

    demo = client.post("/verifier/demo-materials", json={})

    assert demo.status_code == 200
    assert demo.json()["trust"]["key_ref"] == "cert:acme-demo:2026-01"
