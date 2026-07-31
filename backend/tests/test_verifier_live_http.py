from __future__ import annotations

import httpx


def test_live_http_verifier_flow(
    live_http_client: httpx.Client,
    live_verifier_server,
) -> None:
    status_response = live_http_client.get("/verifier/status")
    assert status_response.status_code == 200
    status_payload = status_response.json()
    assert status_payload["api_key_auth_enabled"] is True
    assert status_payload["admin_api_key_management_enabled"] is True
    assert status_payload["redis_connected"] is False

    missing_key_response = live_http_client.post(
        "/verifier/demo-materials",
        json={"nonce": "live-http-missing-key"},
    )
    assert missing_key_response.status_code == 401

    unavailable_issue_response = live_http_client.post(
        "/admin/verifier-clients/api-keys/issue",
        json={"label": "live-http-client"},
        headers={"X-Admin-Token": live_verifier_server.admin_token},
    )
    assert unavailable_issue_response.status_code == 503
    issued_key = live_verifier_server.verifier_key

    demo_response = live_http_client.post(
        "/verifier/demo-materials",
        json={"nonce": "live-http-valid", "usage_policy": "one_time"},
        headers={"X-API-Key": issued_key},
    )
    assert demo_response.status_code == 200
    demo_payload = demo_response.json()

    verify_response = live_http_client.post(
        "/verifier/verify-scanned",
        json={
            "qr_payload": demo_payload["qr_payload"],
            "certificate": demo_payload["certificate"],
            "issuer_state": demo_payload["issuer_state"],
        },
        headers={"X-API-Key": issued_key},
    )
    assert verify_response.status_code == 200
    assert verify_response.json()["stage"] == "accepted"

    replay_response = live_http_client.post(
        "/verifier/verify-scanned",
        json={
            "qr_payload": demo_payload["qr_payload"],
            "certificate": demo_payload["certificate"],
            "issuer_state": demo_payload["issuer_state"],
        },
        headers={"X-API-Key": issued_key},
    )
    assert replay_response.status_code == 200
    assert replay_response.json()["stage"] == "replay_guard"
