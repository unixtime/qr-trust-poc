from __future__ import annotations

import base64
import copy
from datetime import datetime, timezone
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
    ScanActivityReplayGuardResponse,
    ScanActivityResponse,
)
from backend.app.services import verifier_api_key_service as api_key_service_module
from backend.app.services.scan_activity import nonce_fingerprint
from backend.app.services.qr_artifact_poc import decode_qr_payload_from_png_bytes


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


def test_verifier_reference_api_accepts_then_blocks_replay(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={"nonce": "api-accept-001", "usage_policy": "one_time"},
    )
    assert demo_response.status_code == 200

    demo_payload = demo_response.json()
    assert "private_key_pem" not in demo_payload

    verify_request = demo_payload["verify_request"]

    first_result = client.post("/verifier/verify", json=verify_request)
    assert first_result.status_code == 200
    assert first_result.json()["allowed"] is True
    assert first_result.json()["stage"] == "accepted"

    second_result = client.post("/verifier/verify", json=verify_request)
    assert second_result.status_code == 200
    assert second_result.json()["allowed"] is False
    assert second_result.json()["stage"] == "replay_guard"


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
                        usage_policy="reusable_public",
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
            "nonce": "api-expired-001",
            "issued_offset_minutes": -10,
            "expires_offset_minutes": -1,
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
            "nonce": "api-revoked-001",
            "certificate_revoked": True,
            "certificate_revocation_reason": "revoked for test",
        },
    )
    revoked_request = revoked_demo.json()["verify_request"]
    revoked_result = client.post("/verifier/verify", json=revoked_request)
    assert revoked_result.status_code == 200
    assert revoked_result.json()["allowed"] is False
    assert revoked_result.json()["stage"] == "certificate_status"


def test_verifier_reference_api_rejects_malformed_payload_port(
    client: TestClient,
) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "nonce": "api-malformed-port-001",
            "payload": "https://acme.example:99999/pay",
            "usage_policy": "reusable_public",
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


def test_verifier_demo_materials_support_expired_reusable_public_lab_case(
    client: TestClient,
) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "nonce": "api-expired-reusable-public-001",
            "usage_policy": "reusable_public",
            "issued_offset_minutes": -10,
            "expires_offset_minutes": -2,
            "verified_domains": ["acme.example"],
        },
    )
    assert demo_response.status_code == 200

    demo_payload = demo_response.json()
    assert demo_payload["verify_request"]["envelope"]["claims"]["usage_policy"] == (
        "reusable_public"
    )

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
        json={"nonce": "api-profile-revoked-001", "usage_policy": "reusable_public"},
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
        json={"nonce": "api-scan-001", "usage_policy": "one_time"},
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
    assert second_result.json()["allowed"] is False
    assert second_result.json()["stage"] == "replay_guard"


def test_scanner_decision_api_resolves_registered_demo_qr(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={"nonce": "api-scanner-decision-001", "usage_policy": "one_time"},
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
    assert second_payload["decision_state"] == "blocked"
    assert second_payload["open_allowed"] is False
    assert second_payload["verifier_stage"] == "replay_guard"
    assert second_payload["usage_policy"] == "one_time"
    assert second_payload["scanner_ux"]["risk_level"] == "red"
    assert "one_time_used" in second_payload["scanner_ux"]["reason_codes"]
    replay_contract = second_payload["contract"]
    assert replay_contract["decision_color"] == "red"
    assert replay_contract["hold_to_open"]["required"] is False
    assert "one_time_used" in replay_contract["reason_codes"]
    assert replay_contract["trust_path"]["runtime_safety"]["status"] == "replay_blocked"


def test_scanner_decision_api_flags_unregistered_demo_qr(client: TestClient) -> None:
    registered = client.post(
        "/verifier/demo-materials",
        json={"nonce": "api-scanner-registered-001"},
    )
    assert registered.status_code == 200

    unregistered = client.post(
        "/verifier/demo-materials",
        json={
            "nonce": "api-scanner-unregistered-001",
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
            "nonce": "api-scanner-artifact-warning-001",
            "usage_policy": "reusable_public",
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
            "nonce": "api-scanner-artifact-mismatch-001",
            "usage_policy": "reusable_public",
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
            "nonce": "api-artifact-profile-quiet-zone-001",
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
            "nonce": "api-artifact-profile-mismatch-001",
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
            "nonce": "api-scanner-reused-request-id-001",
            "usage_policy": "reusable_public",
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
            "nonce": "api-scanner-invalid-request-id-001",
            "usage_policy": "reusable_public",
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
            "nonce": "api-scanner-recording-001",
            "usage_policy": "reusable_public",
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


def test_scanner_decision_api_allows_reusable_public_qr_multiple_times(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={"nonce": "api-scanner-reusable-001", "usage_policy": "reusable_public"},
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
    assert first_payload["usage_policy"] == "reusable_public"
    assert first_payload["issuer"]["tier"] == "verified_business"
    assert first_payload["governance"]["assurance_tier"] == "verified_business"
    assert first_payload["governance"]["destination_policy_id"] == "policy:acme-demo:web-payments:v1"
    assert first_payload["governance"]["source_artifacts"]["destination_policy_ref"] == "destination-policy.json"
    assert "fixture governance namespace" in first_payload["signals"][0]["message"]
    assert second_payload["decision_state"] == "verified_issuer"
    assert second_payload["open_allowed"] is True
    assert second_payload["verifier_stage"] == "accepted"
    assert second_payload["usage_policy"] == "reusable_public"
    assert second_payload["scanner_ux"]["risk_level"] == "green"
    assert second_payload["scanner_ux"]["hold_required"] is False


def test_demo_materials_exposes_non_normative_governance_projection(client: TestClient) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={"nonce": "api-governance-projection-001", "usage_policy": "reusable_public"},
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
            "nonce": "api-stale-cache-001",
            "usage_policy": "reusable_public",
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
            "nonce": "api-expired-cache-001",
            "usage_policy": "reusable_public",
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


def test_scanner_decision_downgrades_stale_verifier_profile_without_consuming_nonce(
    client: TestClient,
) -> None:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={
            "nonce": "api-stale-profile-001",
            "usage_policy": "one_time",
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
            "nonce": "api-revoked-profile-001",
            "usage_policy": "reusable_public",
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
            "nonce": "api-scanner-runtime-risky-001",
            "payload": "https://acme.example/pay?runtime=risky",
            "usage_policy": "reusable_public",
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
            "nonce": f"api-scanner-runtime-{runtime_state}-001",
            "payload": f"https://acme.example/pay?runtime={runtime_state}",
            "usage_policy": "reusable_public",
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
            "nonce": "api-scanner-client-hint-001",
            "usage_policy": "reusable_public",
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
            "nonce": "api-scanner-runtime-blocked-001",
            "payload": "https://acme.example/pay?runtime=blocked",
            "usage_policy": "reusable_public",
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
            "nonce": "api-scanner-direct-path-mismatch-001",
            "payload": "https://acme.example/admin",
            "verified_domains": ["acme.example"],
            "usage_policy": "reusable_public",
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
            "nonce": "api-scanner-redirect-approved-001",
            "payload": resolver_url,
            "verified_domains": ["qr.acme.example"],
            "usage_policy": "reusable_public",
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
            "nonce": "api-scanner-redirect-host-mismatch-001",
            "payload": resolver_url,
            "verified_domains": ["qr.acme.example"],
            "usage_policy": "reusable_public",
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
            "nonce": "api-scanner-redirect-hops-001",
            "payload": resolver_url,
            "verified_domains": ["qr.acme.example"],
            "usage_policy": "reusable_public",
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
            "nonce": "api-scanner-redirect-nested-001",
            "payload": resolver_url,
            "verified_domains": ["qr.acme.example"],
            "usage_policy": "reusable_public",
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
            "nonce": "api-scanner-mismatch-001",
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
    assert payload["scanner_ux"]["risk_score"] == 60
    assert payload["scanner_ux"]["risk_level"] == "red"
    assert payload["scanner_ux"]["hold_required"] is True
    assert payload["scanner_ux"]["destination_display"] == "example.zip"
    assert payload["scanner_ux"]["destination_fingerprint"] == "example.zip"
    assert "plain_url" in payload["scanner_ux"]["reason_codes"]
    assert "embedded_credentials" in payload["scanner_ux"]["reason_codes"]
    assert "suspicious_tld" in payload["scanner_ux"]["reason_codes"]
    assert payload["contract"]["destination"]["display_host"] == "example.zip"
    assert payload["contract"]["decision_color"] == "red"


def test_verifier_decode_image_endpoint_returns_qr_payload(client: TestClient) -> None:
    demo_response = client.post("/verifier/demo-materials", json={"nonce": "api-image-001"})
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

    demo_response = client.post("/verifier/demo-materials", json={"nonce": "api-rate-limit-001"})
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

    missing_key_response = client.post("/verifier/demo-materials", json={"nonce": "api-auth-001"})
    invalid_key_response = client.post(
        "/verifier/demo-materials",
        json={"nonce": "api-auth-001"},
        headers={"X-API-Key": "wrong-key"},
    )
    valid_key_response = client.post(
        "/verifier/demo-materials",
        json={"nonce": "api-auth-001"},
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
        json={"nonce": "dynamic-auth-unavailable"},
        headers={"X-API-Key": "unavailable-key"},
    )

    assert issue_response.status_code == 410
    assert protected_response.status_code == 503


def _scan_activity_fixture(
    fingerprint: str,
    *,
    usage_policy: str,
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
        usage_policy=usage_policy,
        client_platform="ios",
        created_at="2026-08-25T10:00:00Z",
    )
    return ScanActivityResponse(
        nonce_fingerprint=fingerprint,
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
        replay_guard=ScanActivityReplayGuardResponse(applies=False, state="not_applicable"),
    )


def test_scan_activity_requires_nonce(client: TestClient) -> None:
    assert client.get("/verifier/scan-activity").status_code == 422


def test_scan_activity_reports_unconfigured_store_without_database(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "")

    response = client.get("/verifier/scan-activity", params={"nonce": "lab-nonce-001"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["nonce_fingerprint"] == nonce_fingerprint("lab-nonce-001")
    assert payload["persistence_state"] == "unconfigured"
    assert payload["scan_count"] == 0
    assert payload["latest"] is None
    assert payload["replay_guard"] == {
        "applies": False,
        "state": "not_applicable",
        "expires_at": None,
    }


def test_scan_activity_reports_one_time_replay_guard_state(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fingerprint = nonce_fingerprint("api-scan-activity-one-time-001")

    async def fake_load(requested_fingerprint: str, **_: Any) -> ScanActivityResponse:
        assert requested_fingerprint == fingerprint
        return _scan_activity_fixture(fingerprint, usage_policy="one_time")

    monkeypatch.setattr(verifier_endpoint, "load_scan_activity", fake_load)

    unused = client.get(
        "/verifier/scan-activity",
        params={"nonce": "api-scan-activity-one-time-001"},
    )
    assert unused.status_code == 200
    assert unused.json()["replay_guard"] == {
        "applies": True,
        "state": "unused",
        "expires_at": None,
    }

    demo_response = client.post(
        "/verifier/demo-materials",
        json={"nonce": "api-scan-activity-one-time-001", "usage_policy": "one_time"},
    )
    assert demo_response.status_code == 200
    scan_response = client.post(
        "/scanner/decisions",
        json={"qr_payload": demo_response.json()["qr_payload"]},
    )
    assert scan_response.status_code == 200
    assert scan_response.json()["decision_state"] == "verified_issuer"

    consumed = client.get(
        "/verifier/scan-activity",
        params={"nonce": "api-scan-activity-one-time-001"},
    )
    assert consumed.status_code == 200
    replay_guard = consumed.json()["replay_guard"]
    assert replay_guard["applies"] is True
    assert replay_guard["state"] == "consumed"
    assert replay_guard["expires_at"].endswith("Z")
    assert consumed.json()["latest"]["client_platform"] == "ios"


def test_scan_activity_uses_caller_usage_policy_when_store_is_unconfigured(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", "")

    response = client.get(
        "/verifier/scan-activity",
        params={"nonce": "api-scan-activity-unscanned-001", "usage_policy": "one_time"},
    )

    assert response.status_code == 200
    assert response.json()["persistence_state"] == "unconfigured"
    assert response.json()["replay_guard"]["state"] == "unused"


def test_scan_activity_scopes_history_to_the_issuance(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A fixed lab nonce is reused across regenerations, so the card asks about
    one issuance: history before ``issued_at`` belongs to an earlier code."""
    captured: dict[str, Any] = {}

    async def fake_load(requested_fingerprint: str, **kwargs: Any) -> ScanActivityResponse:
        captured["fingerprint"] = requested_fingerprint
        captured.update(kwargs)
        return _scan_activity_fixture(requested_fingerprint, usage_policy="reusable_public")

    monkeypatch.setattr(verifier_endpoint, "load_scan_activity", fake_load)
    response = client.get(
        "/verifier/scan-activity",
        params={
            "nonce": "api-scan-activity-issued-001",
            "usage_policy": "reusable_public",
            "issued_at": "2026-08-25T17:36:59Z",
        },
    )

    assert response.status_code == 200
    assert captured["fingerprint"] == nonce_fingerprint("api-scan-activity-issued-001")
    assert captured["issued_at"] == datetime(2026, 8, 25, 17, 36, 59, tzinfo=timezone.utc)


def test_scan_activity_rejects_an_unparseable_issued_at(client: TestClient) -> None:
    response = client.get(
        "/verifier/scan-activity",
        params={"nonce": "api-scan-activity-issued-002", "issued_at": "yesterday"},
    )
    assert response.status_code == 422


def test_scan_activity_scopes_cached_hits_to_the_issuance(client: TestClient) -> None:
    _clear_verifier_rate_limiter()
    nonce = "api-verdict-cache-issuance-001"
    demo_response = client.post(
        "/verifier/demo-materials",
        json={"nonce": nonce, "usage_policy": "reusable_public"},
    )
    assert demo_response.status_code == 200
    demo = demo_response.json()
    issued_at = demo["verify_request"]["envelope"]["claims"]["issued_at"]
    base_params = {"nonce": nonce, "usage_policy": "reusable_public"}

    try:
        first = client.post("/scanner/decisions", json={"qr_payload": demo["qr_payload"]})
        second = client.post("/scanner/decisions", json={"qr_payload": demo["qr_payload"]})
        unscoped = client.get("/verifier/scan-activity", params=base_params)
        this_issuance = client.get(
            "/verifier/scan-activity",
            params={**base_params, "issued_at": issued_at},
        )
        # The same nonce regenerated later: a fresh code with no scans yet.
        later_issuance = client.get(
            "/verifier/scan-activity",
            params={**base_params, "issued_at": "2036-01-01T00:00:00Z"},
        )
    finally:
        _clear_verifier_rate_limiter()

    assert first.status_code == 200
    assert second.headers["X-QR-Trust-Verdict"] == "cached"
    assert unscoped.json()["throttle"]["cached_verdicts"] == 1
    assert this_issuance.json()["throttle"]["cached_verdicts"] == 1
    assert later_issuance.json()["issued_at"] == "2036-01-01T00:00:00Z"
    assert later_issuance.json()["throttle"]["cached_verdicts"] == 0
    assert later_issuance.json()["throttle"]["last_cached_at"] is None
    # The nonce budget is the flood control; it must not reset on reissue.
    assert (
        later_issuance.json()["throttle"]["nonce_budget_remaining"]
        == this_issuance.json()["throttle"]["nonce_budget_remaining"]
    )


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
    fingerprint = nonce_fingerprint("api-scan-activity-outcome-001")

    async def fake_load(requested_fingerprint: str, **_: Any) -> ScanActivityResponse:
        return _scan_activity_fixture(fingerprint, usage_policy="reusable_public")

    monkeypatch.setattr(verifier_endpoint, "load_scan_activity", fake_load)
    params = {"nonce": "api-scan-activity-outcome-001"}

    # No UX event for this decision reached the verifier yet: say so, do not
    # guess that the phone never opened anything.
    unreported = client.get("/verifier/scan-activity", params=params)
    assert unreported.status_code == 200
    assert unreported.json()["destination_outcome"] == "unreported"
    assert unreported.json()["first_verified_at"] == "2026-08-25T10:00:00Z"
    assert unreported.json()["blocked_since_verified"] == 0

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
    fingerprint = nonce_fingerprint("api-scan-activity-unscanned-002")

    async def fake_load(requested_fingerprint: str, **_: Any) -> ScanActivityResponse:
        return _scan_activity_fixture(fingerprint, usage_policy="reusable_public").model_copy(
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
        params={"nonce": "api-scan-activity-unscanned-002"},
    )
    assert response.status_code == 200
    assert response.json()["destination_outcome"] is None
    assert response.json()["blocked_since_verified"] == 0


def test_scanner_decision_records_nonce_fingerprint_and_platform(
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
        json={"nonce": "api-scan-activity-fingerprint-001", "usage_policy": "reusable_public"},
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
    assert captured["nonce_fingerprint"] == nonce_fingerprint("api-scan-activity-fingerprint-001")
    assert captured["client_platform"] == "browser_lab"


def test_scanner_decision_skips_nonce_fingerprint_for_plain_urls(
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
    assert captured["nonce_fingerprint"] is None


def _clear_verifier_rate_limiter() -> None:
    verifier_endpoint._request_rate_limiter._records.clear()
    verifier_endpoint._verdict_cache.clear()


def _disable_verdict_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    # The budget tests replay one envelope; with the cache on, the replay is
    # a hit and never reaches the budget. Turn it off to test the budget alone.
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_VERDICT_CACHE_TTL_SECONDS", 0)


def _demo_verify_request(client: TestClient, nonce: str, usage_policy: str) -> dict[str, Any]:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={"nonce": nonce, "usage_policy": usage_policy},
    )
    assert demo_response.status_code == 200
    return demo_response.json()["verify_request"]


def test_verifier_nonce_budget_rejects_flood_before_signature_verification(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _disable_verdict_cache(monkeypatch)
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_NONCE_RATE_LIMIT_MAX_REQUESTS", 1)
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_NONCE_RATE_LIMIT_WINDOW_SECONDS", 60)
    _clear_verifier_rate_limiter()
    verify_request = _demo_verify_request(client, "api-nonce-budget-001", "reusable_public")

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


def test_scanner_decision_nonce_budget_returns_429_without_recording_evidence(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _disable_verdict_cache(monkeypatch)
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_NONCE_RATE_LIMIT_MAX_REQUESTS", 1)
    _clear_verifier_rate_limiter()
    demo_response = client.post(
        "/verifier/demo-materials",
        json={"nonce": "api-nonce-budget-scanner-001", "usage_policy": "reusable_public"},
    )
    assert demo_response.status_code == 200
    qr_payload = demo_response.json()["qr_payload"]

    recorded_fingerprints: list[str | None] = []
    original_record = verifier_endpoint.record_scanner_evidence

    async def tracking_record(*args: Any, **kwargs: Any) -> Any:
        recorded_fingerprints.append(kwargs.get("nonce_fingerprint"))
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
    assert recorded_fingerprints == [nonce_fingerprint("api-nonce-budget-scanner-001")]


def test_verifier_nonce_budget_is_scoped_to_the_nonce_and_skips_one_time(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _disable_verdict_cache(monkeypatch)
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_NONCE_RATE_LIMIT_MAX_REQUESTS", 1)
    _clear_verifier_rate_limiter()
    reusable_a = _demo_verify_request(client, "api-nonce-budget-a", "reusable_public")
    reusable_b = _demo_verify_request(client, "api-nonce-budget-b", "time_limited")
    one_time = _demo_verify_request(client, "api-nonce-budget-one-time", "one_time")

    try:
        assert client.post("/verifier/verify", json=reusable_a).status_code == 200
        assert client.post("/verifier/verify", json=reusable_a).status_code == 429
        # Same caller identity, different nonce: its own budget, untouched.
        assert client.post("/verifier/verify", json=reusable_b).status_code == 200
        assert client.post("/verifier/verify", json=reusable_b).status_code == 429
        # one_time codes self-limit through the replay guard and stay exempt.
        first_one_time = client.post("/verifier/verify", json=one_time)
        second_one_time = client.post("/verifier/verify", json=one_time)
    finally:
        _clear_verifier_rate_limiter()

    assert first_one_time.status_code == 200
    assert first_one_time.json()["allowed"] is True
    assert second_one_time.status_code == 200
    assert second_one_time.json()["stage"] == "replay_guard"


def test_verifier_issuer_budget_counts_only_signature_verified_requests(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _disable_verdict_cache(monkeypatch)
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_ISSUER_RATE_LIMIT_MAX_REQUESTS", 1)
    _clear_verifier_rate_limiter()
    verify_request = _demo_verify_request(client, "api-issuer-budget-001", "reusable_public")
    forged_request = copy.deepcopy(verify_request)
    forged_request["envelope"]["claims"]["nonce"] = "api-issuer-budget-forged"

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
    assert payload["nonce_rate_limit_window_seconds"] == 60
    assert payload["nonce_rate_limit_max_requests"] == 300
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
    verify_request = _demo_verify_request(client, "api-verdict-cache-001", "reusable_public")
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


def test_verifier_verdict_cache_wins_over_nonce_budget_but_not_for_tampered_envelope(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(verifier_endpoint.config, "VERIFIER_NONCE_RATE_LIMIT_MAX_REQUESTS", 1)
    _clear_verifier_rate_limiter()
    verify_request = _demo_verify_request(client, "api-verdict-cache-budget-001", "reusable_public")
    tampered = copy.deepcopy(verify_request)
    tampered["envelope"]["signature"] = "AAAA" + tampered["envelope"]["signature"][4:]

    try:
        first = client.post("/verifier/verify", json=verify_request)
        replay = client.post("/verifier/verify", json=verify_request)
        forged = client.post("/verifier/verify", json=tampered)
    finally:
        _clear_verifier_rate_limiter()

    assert first.status_code == 200
    # A crowd scanning the same poster gets the cached verdict, not a 429 ...
    assert replay.status_code == 200
    assert replay.headers["X-QR-Trust-Verdict"] == "cached"
    # ... while a different envelope under the same nonce still meets the budget.
    assert forged.status_code == 429
    assert forged.json()["detail"] == "Rate limit exceeded for this QR code"


def test_scanner_decision_cached_verdict_skips_evidence_and_reports_throttle(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_verifier_rate_limiter()
    nonce = "api-verdict-cache-scanner-001"
    demo_response = client.post(
        "/verifier/demo-materials",
        json={"nonce": nonce, "usage_policy": "reusable_public"},
    )
    assert demo_response.status_code == 200
    qr_payload = demo_response.json()["qr_payload"]

    recorded_fingerprints: list[str | None] = []
    original_record = verifier_endpoint.record_scanner_evidence

    async def tracking_record(*args: Any, **kwargs: Any) -> Any:
        recorded_fingerprints.append(kwargs.get("nonce_fingerprint"))
        return await original_record(*args, **kwargs)

    monkeypatch.setattr(verifier_endpoint, "record_scanner_evidence", tracking_record)

    try:
        first = client.post("/scanner/decisions", json={"qr_payload": qr_payload})
        second = client.post("/scanner/decisions", json={"qr_payload": qr_payload})
        activity = client.get(
            "/verifier/scan-activity",
            params={"nonce": nonce, "usage_policy": "reusable_public"},
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
    assert recorded_fingerprints == [nonce_fingerprint(nonce)]

    assert activity.status_code == 200
    payload = activity.json()
    throttle = payload["throttle"]
    assert throttle["cached_verdicts"] == 1
    assert throttle["last_cached_at"]
    assert throttle["verdict_cache_ttl_seconds"] == config.VERIFIER_VERDICT_CACHE_TTL_SECONDS
    assert throttle["nonce_budget_limit"] == config.VERIFIER_NONCE_RATE_LIMIT_MAX_REQUESTS
    assert throttle["nonce_budget_window_seconds"] == config.VERIFIER_NONCE_RATE_LIMIT_WINDOW_SECONDS
    # Only the computed scan spent budget.
    assert throttle["nonce_budget_remaining"] == config.VERIFIER_NONCE_RATE_LIMIT_MAX_REQUESTS - 1
    # Without an evidence store the row counts stay honest: no fabricated scans.
    assert payload["persistence_state"] == "unconfigured"
    assert payload["scan_count"] == 0


def test_verifier_verdict_cache_skips_one_time_codes(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_verifier_rate_limiter()
    nonce = "api-verdict-cache-one-time-001"
    verify_request = _demo_verify_request(client, nonce, "one_time")
    checks = _count_signature_checks(monkeypatch)

    try:
        first = client.post("/verifier/verify", json=verify_request)
        second = client.post("/verifier/verify", json=verify_request)
        activity = client.get(
            "/verifier/scan-activity",
            params={"nonce": nonce, "usage_policy": "one_time"},
        )
    finally:
        _clear_verifier_rate_limiter()

    assert first.status_code == 200
    assert first.json()["allowed"] is True
    assert second.status_code == 200
    assert second.headers["X-QR-Trust-Verdict"] == "computed"
    assert second.json()["stage"] == "replay_guard"
    assert checks[0] == 2
    # one_time codes have no scan-flood budget or cache, so no throttle block.
    assert activity.json()["throttle"] is None


def test_verifier_verdict_cache_misses_when_issuer_state_changes(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _clear_verifier_rate_limiter()
    verify_request = _demo_verify_request(client, "api-verdict-cache-revoked-001", "reusable_public")
    revoked = copy.deepcopy(verify_request)
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
    verify_request = _demo_verify_request(client, "api-verdict-cache-off-001", "reusable_public")
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
