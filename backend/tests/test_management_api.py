from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient


class FakeManagementConnection:
    def __init__(self, changed_rows: int = 1) -> None:
        self.execute_calls: list[tuple[Any, ...]] = []
        self.fetch_calls: list[tuple[Any, ...]] = []
        self.fetchrow_calls: list[tuple[Any, ...]] = []
        self._changed_rows = changed_rows
        self.outbox_remediation_row: dict[str, Any] | None = {
            "event_id": "evt_mgmt_stale_policy",
            "publish_status": "quarantined",
            "attempts": 0,
            "last_error": "stale source policy event",
        }
        self.outbox_remediation_existing_status: str | None = None
        self.management_key_row: dict[str, Any] | None = None
        self.management_key_issue_row: dict[str, Any] = {
            "key_id": "mkey_demo_issuer",
            "label": "demo issuer operator",
            "operator_id": None,
            "scopes": ["audit:read", "outbox:read"],
            "status": "active",
            "created_at": datetime(2026, 5, 25, 10, 2, tzinfo=timezone.utc),
            "expires_at": None,
            "revoked_at": None,
        }
        self.management_key_revoke_row: dict[str, Any] | None = {
            "key_id": "mkey_demo_issuer",
            "label": "demo issuer operator",
            "operator_id": None,
            "scopes": ["audit:read", "outbox:read"],
            "status": "revoked",
            "created_at": datetime(2026, 5, 25, 10, 2, tzinfo=timezone.utc),
            "expires_at": None,
            "revoked_at": datetime(2026, 5, 25, 10, 4, tzinfo=timezone.utc),
        }
        self.management_key_records: list[dict[str, Any]] = [
            {
                "key_id": "mkey_demo_issuer",
                "label": "demo issuer operator",
                "operator_id": None,
                "scopes": ["audit:read", "outbox:read"],
                "status": "active",
                "created_at": datetime(2026, 5, 25, 10, 2, tzinfo=timezone.utc),
                "expires_at": None,
                "revoked_at": None,
            }
        ]
        self.operator_upsert_row: dict[str, Any] = {
            "operator_id": "66666666-6666-4666-8666-666666666666",
            "email": "professor@example.edu",
            "display_name": "Professor Example",
            "status": "active",
            "created_at": datetime(2026, 5, 25, 10, 8, tzinfo=timezone.utc),
            "updated_at": datetime(2026, 5, 25, 10, 8, tzinfo=timezone.utc),
        }
        self.operator_records: list[dict[str, Any]] = [self.operator_upsert_row]
        self.operator_role_assignment_row: dict[str, Any] = {
            "assignment_id": "77777777-7777-4777-8777-777777777777",
            "operator_id": "66666666-6666-4666-8666-666666666666",
            "role": "issuer_admin",
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": None,
            "issuer_id": "issuer:acme-demo",
            "status": "active",
            "created_at": datetime(2026, 5, 25, 10, 9, tzinfo=timezone.utc),
        }
        self.operator_role_assignment_records: list[dict[str, Any]] = [
            self.operator_role_assignment_row
        ]
        self.operator_role_assignment_rows: list[dict[str, Any]] = []
        self.trust_key_records: list[dict[str, Any]] = [
            {
                "key_id": "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
                "root_program_id": "root:qrtrust-demo:2026",
                "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
                "signer_id": "authority:qrtrust-demo:merchant-web",
                "algorithm_id": "ed25519",
                "public_key_material_ref": "managed://qrtrust/authority/public/v1",
                "public_key_material_pem": None,
                "scope": "delegated_authority",
                "key_status": "active",
                "not_before": None,
                "not_after": None,
                "created_at": datetime(2026, 5, 25, 10, 10, tzinfo=timezone.utc),
            }
        ]
        self.verifier_client_key_issue_row: dict[str, Any] = {
            "key_id": "vkey_demo_client_hash",
            "label": "lab verifier client",
            "operator_id": None,
            "scopes": ["verifier:client"],
            "status": "active",
            "created_at": datetime(2026, 5, 25, 10, 6, tzinfo=timezone.utc),
            "expires_at": None,
            "revoked_at": None,
        }
        self.verifier_client_key_revoke_row: dict[str, Any] | None = {
            "key_id": "vkey_demo_client_hash",
            "label": "lab verifier client",
            "operator_id": None,
            "scopes": ["verifier:client"],
            "status": "revoked",
            "created_at": datetime(2026, 5, 25, 10, 6, tzinfo=timezone.utc),
            "expires_at": None,
            "revoked_at": datetime(2026, 5, 25, 10, 7, tzinfo=timezone.utc),
        }
        self.verifier_client_key_records: list[dict[str, Any]] = [
            self.verifier_client_key_issue_row
        ]
        self.closed = False
        self.transaction_committed = False
        self.nats_subscribers: list[dict[str, Any]] = [
            {
                "subscriber_id": "subscriber:reference-governance",
                "display_name": "Reference governance subscriber",
                "durable_name": "qrtrust_governance_subscriber_worker",
                "description": "Consumes governance artifact notifications.",
                "status": "active",
                "subjects": [
                    "qrtrust.*.issuer.>",
                    "qrtrust.*.destination.>",
                ],
            },
        ]
        self.runtime_providers: list[dict[str, Any]] = [
            {
                "provider_id": "deterministic-runtime-safety",
                "display_name": "Deterministic runtime safety",
                "base_url": None,
                "verdict_ttl_seconds": 300,
                "stale_behavior": "downgrade_to_caution",
                "unavailable_behavior": "block",
                "status": "active",
            },
        ]
        self.outbox_status_counts: list[dict[str, Any]] = [
            {"publish_status": "pending", "count": 2},
            {"publish_status": "published", "count": 5},
            {"publish_status": "failed", "count": 1},
        ]
        self.outbox_events: list[dict[str, Any]] = [
            {
                "outbox_id": "11111111-1111-4111-8111-111111111111",
                "event_id": "evt_mgmt_issuer",
                "event_type": "issuer.enrollment.requested",
                "aggregate_type": "issuer",
                "aggregate_id": "issuer:acme-demo",
                "publish_status": "failed",
                "attempts": 3,
                "last_error": "broker unavailable",
                "created_at": datetime(2026, 5, 25, 10, 0, tzinfo=timezone.utc),
                "published_at": None,
            },
        ]
        self.audit_rows: list[dict[str, Any]] = [
            {
                "audit_id": "22222222-2222-4222-8222-222222222222",
                "actor_key_id": "local-admin-token",
                "action": "issuer.enroll",
                "target_type": "issuer",
                "target_id": "issuer:acme-demo",
                "root_program_id": "root:qrtrust-demo:2026",
                "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
                "issuer_id": "issuer:acme-demo",
                "before_json": None,
                "after_json": {"issuer_id": "issuer:acme-demo"},
                "request_id": "req_management",
                "idempotency_key": "idem_management",
                "created_at": datetime(2026, 5, 25, 10, 1, tzinfo=timezone.utc),
            },
        ]

    def transaction(self) -> "FakeManagementTransaction":
        return FakeManagementTransaction(self)

    async def execute(self, *args: Any) -> str:
        self.execute_calls.append(args)
        return "INSERT 0 1"

    async def fetchrow(self, *args: Any) -> dict[str, Any]:
        self.fetchrow_calls.append(args)
        if "insert into qr_trust.operators" in str(args[0]):
            return self.operator_upsert_row
        if "qr_trust.operator_role_assignments" in str(args[0]):
            return self.operator_role_assignment_row
        if "insert into qr_trust.management_api_keys" in str(args[0]):
            if args[5] == ["verifier:client"]:
                return self.verifier_client_key_issue_row
            return self.management_key_issue_row
        if "update qr_trust.management_api_keys" in str(args[0]):
            if "and scopes @> array['verifier:client']" in str(args[0]):
                return self.verifier_client_key_revoke_row
            return self.management_key_revoke_row
        if "from qr_trust.management_api_keys" in str(args[0]):
            return self.management_key_row
        if "update qr_trust.event_outbox" in str(args[0]):
            return self.outbox_remediation_row
        if "select publish_status" in str(args[0]):
            if self.outbox_remediation_existing_status is None:
                return None
            return {"publish_status": self.outbox_remediation_existing_status}
        return {"changed_rows": self._changed_rows}

    async def fetch(self, *args: Any) -> list[dict[str, Any]]:
        self.fetch_calls.append(args)
        query = str(args[0])
        if "from qr_trust.operator_role_assignments" in query and "join qr_trust.operators" in query:
            return self.operator_role_assignment_rows
        if "from qr_trust.operator_role_assignments" in query:
            return self.operator_role_assignment_records
        if "from qr_trust.operators" in query:
            return self.operator_records
        if "from qr_trust.event_outbox" in query and "group by publish_status" in query:
            return self.outbox_status_counts
        if "from qr_trust.event_outbox" in query:
            return self.outbox_events
        if "from qr_trust.governance_audit_log" in query:
            return self.audit_rows
        if "from qr_trust.management_api_keys" in query:
            if "where scopes @> array['verifier:client']" in query:
                return self.verifier_client_key_records
            return self.management_key_records
        if "from qr_trust.runtime_safety_providers" in query:
            return self.runtime_providers
        if "from qr_trust.trust_keys" in query:
            return self.trust_key_records
        return self.nats_subscribers

    async def close(self) -> None:
        self.closed = True


class FakeManagementTransaction:
    def __init__(self, connection: FakeManagementConnection) -> None:
        self.connection = connection

    async def __aenter__(self) -> "FakeManagementTransaction":
        return self

    async def __aexit__(self, exc_type: Any, *_args: Any) -> None:
        if exc_type is None:
            self.connection.transaction_committed = True


def test_management_health_requires_management_key(client: TestClient) -> None:
    response = client.get("/admin/health")

    assert response.status_code == 401
    assert response.json()["detail"] == "management credential required"


def test_config_admin_token_requires_bootstrap_flag(monkeypatch) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED",
        False,
        raising=False,
    )

    assert management_endpoint._local_admin_principal_for_token("local-lab-admin") is None


def test_config_admin_token_accepts_explicit_bootstrap_flag(monkeypatch) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED",
        True,
        raising=False,
    )

    principal = management_endpoint._local_admin_principal_for_token("local-lab-admin")

    assert principal is not None
    assert principal.scopes == frozenset({"admin:*"})


def test_management_health_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.core.config import config

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])

    response = client.get(
        "/admin/health",
        headers={"X-Admin-Token": "local-lab-admin"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "source_of_truth": "postgres",
        "normal_mutation_surface": "management_api",
    }


def test_issue_management_key_accepts_local_admin_token_and_audits(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/management-keys/issue",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "label": " demo issuer operator ",
            "scopes": ["outbox:read", "audit:read", "audit:read"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["plaintext_key"].startswith("mkey_")
    assert payload["record"] == {
        "key_id": "mkey_demo_issuer",
        "label": "demo issuer operator",
        "operator_id": None,
        "scopes": ["audit:read", "outbox:read"],
        "status": "active",
        "created_at": "2026-05-25T10:02:00Z",
        "expires_at": None,
        "revoked_at": None,
    }
    assert connection.closed is True
    assert connection.transaction_committed is True
    assert len(connection.fetchrow_calls) == 1
    assert "qr_trust.management_api_keys" in connection.fetchrow_calls[0][0]
    assert connection.fetchrow_calls[0][5] == ["audit:read", "outbox:read"]
    assert len(connection.execute_calls) == 1
    audit_call = connection.execute_calls[0]
    assert "qr_trust.governance_audit_log" in audit_call[0]
    assert audit_call[3] == "management_key.issue"
    assert audit_call[4] == "management_api_key"
    assert audit_call[5] == "mkey_demo_issuer"
    assert "plaintext_key" not in audit_call[10]


def test_issue_management_key_rejects_expired_expires_at(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/management-keys/issue",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "label": "expired key",
            "scopes": ["audit:read"],
            "expires_at": "2020-01-01T00:00:00Z",
        },
    )

    assert response.status_code == 422
    assert "expires_at must be in the future" in response.text
    assert len(connection.fetchrow_calls) == 0
    assert len(connection.execute_calls) == 0


def test_issue_management_key_rejects_verifier_client_scope(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/management-keys/issue",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={"label": "bad mixed key", "scopes": ["verifier:client"]},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "management key scopes cannot include verifier:client"
    )
    assert connection.closed is False
    assert len(connection.fetchrow_calls) == 0
    assert len(connection.execute_calls) == 0


def test_issue_management_key_rejects_unknown_management_scope(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/management-keys/issue",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={"label": "typo key", "scopes": ["issuer:wriet"]},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "unsupported management key scope: issuer:wriet"
    assert connection.closed is False
    assert len(connection.fetchrow_calls) == 0
    assert len(connection.execute_calls) == 0


def test_issue_management_key_rejects_invalid_operator_id(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/management-keys/issue",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "label": "bad operator",
            "operator_id": "not-a-uuid",
            "scopes": ["audit:read"],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "operator_id must be a valid UUID"
    assert connection.closed is False
    assert len(connection.fetchrow_calls) == 0
    assert len(connection.execute_calls) == 0


def test_list_management_keys_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.get(
        "/admin/management-keys",
        headers={"X-Admin-Token": "local-lab-admin"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "records": [
            {
                "key_id": "mkey_demo_issuer",
                "label": "demo issuer operator",
                "operator_id": None,
                "scopes": ["audit:read", "outbox:read"],
                "status": "active",
                "created_at": "2026-05-25T10:02:00Z",
                "expires_at": None,
                "revoked_at": None,
            }
        ]
    }
    assert connection.closed is True
    assert len(connection.fetch_calls) == 1
    assert "qr_trust.management_api_keys" in connection.fetch_calls[0][0]
    assert "verifier:client" in connection.fetch_calls[0][0]


def test_revoke_management_key_accepts_local_admin_token_and_audits(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/management-keys/mkey_demo_issuer/revoke",
        headers={"X-Admin-Token": "local-lab-admin"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "record": {
            "key_id": "mkey_demo_issuer",
            "label": "demo issuer operator",
            "operator_id": None,
            "scopes": ["audit:read", "outbox:read"],
            "status": "revoked",
            "created_at": "2026-05-25T10:02:00Z",
            "expires_at": None,
            "revoked_at": "2026-05-25T10:04:00Z",
        }
    }
    assert connection.closed is True
    assert connection.transaction_committed is True
    assert len(connection.fetchrow_calls) == 1
    assert "update qr_trust.management_api_keys" in connection.fetchrow_calls[0][0]
    assert connection.fetchrow_calls[0][1] == "mkey_demo_issuer"
    assert len(connection.execute_calls) == 1
    audit_call = connection.execute_calls[0]
    assert audit_call[3] == "management_key.revoke"
    assert audit_call[4] == "management_api_key"
    assert audit_call[5] == "mkey_demo_issuer"


def test_revoke_management_key_returns_404_for_missing_key(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.management_key_revoke_row = None

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/management-keys/mkey_missing/revoke",
        headers={"X-Admin-Token": "local-lab-admin"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "management key not found"
    assert connection.closed is True
    assert connection.transaction_committed is False
    assert len(connection.execute_calls) == 0


def test_upsert_operator_accepts_scoped_management_key_and_audits(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.management_key_row = {
        "key_id": "mkey_operator_admin",
        "operator_id": None,
        "scopes": ["operators:write"],
    }

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/operators",
        headers={"X-Admin-Token": "managed-operator-admin"},
        json={
            "email": " professor@example.edu ",
            "display_name": " Professor Example ",
            "status": "active",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "operator_id": "66666666-6666-4666-8666-666666666666",
        "email": "professor@example.edu",
        "display_name": "Professor Example",
        "status": "active",
        "created_at": "2026-05-25T10:08:00Z",
        "updated_at": "2026-05-25T10:08:00Z",
    }
    assert connection.fetchrow_calls[1][1:4] == (
        "professor@example.edu",
        "Professor Example",
        "active",
    )
    audit_call = connection.execute_calls[0]
    assert audit_call[3] == "operator.upsert"
    assert audit_call[4] == "operator"
    assert audit_call[5] == "66666666-6666-4666-8666-666666666666"


def test_list_operators_requires_operator_read_scope(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.management_key_row = {
        "key_id": "mkey_operator_reader",
        "operator_id": None,
        "scopes": ["operators:read"],
    }

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.get(
        "/admin/operators",
        headers={"X-Admin-Token": "managed-operator-reader"},
    )

    assert response.status_code == 200
    assert response.json()["records"][0]["email"] == "professor@example.edu"
    assert "from qr_trust.operators" in connection.fetch_calls[0][0]


def test_upsert_operator_role_assignment_uses_management_api_and_audit(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.management_key_row = {
        "key_id": "mkey_operator_admin",
        "operator_id": None,
        "scopes": ["operators:write"],
    }

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/operator-role-assignments",
        headers={"X-Admin-Token": "managed-operator-admin"},
        json={
            "operator_id": "66666666-6666-4666-8666-666666666666",
            "role": "issuer_admin",
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
        },
    )

    assert response.status_code == 200
    assert response.json()["assignment_id"] == "77777777-7777-4777-8777-777777777777"
    assert response.json()["role"] == "issuer_admin"
    assert connection.fetchrow_calls[1][1:7] == (
        "66666666-6666-4666-8666-666666666666",
        "issuer_admin",
        "root:qrtrust-demo:2026",
        "authority:qrtrust-demo:merchant-web",
        "issuer:acme-demo",
        "active",
    )
    audit_call = connection.execute_calls[0]
    assert audit_call[3] == "operator_role.upsert"
    assert audit_call[4] == "operator_role_assignment"
    assert audit_call[5] == "77777777-7777-4777-8777-777777777777"


def test_upsert_operator_role_assignment_rejects_issuer_admin_without_authority_scope(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/operator-role-assignments",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "operator_id": "66666666-6666-4666-8666-666666666666",
            "role": "issuer_admin",
            "root_program_id": "root:qrtrust-demo:2026",
            "issuer_id": "issuer:acme-demo",
        },
    )

    assert response.status_code == 422
    assert "issuer_admin assignments require delegated_authority_id" in response.text
    assert connection.closed is False
    assert len(connection.execute_calls) == 0


def test_list_operator_role_assignments_filters_operator_id(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.management_key_row = {
        "key_id": "mkey_operator_reader",
        "operator_id": None,
        "scopes": ["operators:read"],
    }

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.get(
        "/admin/operator-role-assignments",
        headers={"X-Admin-Token": "managed-operator-reader"},
        params={"operator_id": "66666666-6666-4666-8666-666666666666", "limit": 5},
    )

    assert response.status_code == 200
    assert response.json()["records"][0]["role"] == "issuer_admin"
    assert connection.fetch_calls[0][1:] == (
        "66666666-6666-4666-8666-666666666666",
        5,
    )


def test_issue_verifier_client_key_accepts_scoped_management_key_and_audits(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.management_key_row = {
        "key_id": "mkey_verifier_admin",
        "operator_id": None,
        "scopes": ["verifier_clients:write"],
    }

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/verifier-clients/api-keys/issue",
        headers={"X-Admin-Token": "managed-verifier-admin"},
        json={"label": " lab verifier client "},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["plaintext_key"].startswith("vkey_")
    assert payload["record"] == {
        "key_id": "vkey_demo_client_hash",
        "label": "lab verifier client",
        "operator_id": None,
        "scopes": ["verifier:client"],
        "status": "active",
        "created_at": "2026-05-25T10:06:00Z",
        "expires_at": None,
        "revoked_at": None,
    }
    assert connection.closed is True
    assert connection.transaction_committed is True
    assert connection.fetchrow_calls[1][5] == ["verifier:client"]
    assert len(connection.execute_calls) == 1
    audit_call = connection.execute_calls[0]
    assert audit_call[3] == "verifier_client_key.issue"
    assert audit_call[4] == "verifier_client_key"
    assert audit_call[5] == "vkey_demo_client_hash"
    assert "plaintext_key" not in audit_call[10]


def test_issue_verifier_client_key_rejects_expired_expires_at(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.management_key_row = {
        "key_id": "mkey_verifier_admin",
        "operator_id": None,
        "scopes": ["verifier_clients:write"],
    }

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/verifier-clients/api-keys/issue",
        headers={"X-Admin-Token": "managed-verifier-admin"},
        json={
            "label": "expired verifier client",
            "expires_at": "2020-01-01T00:00:00Z",
        },
    )

    assert response.status_code == 422
    assert "expires_at must be in the future" in response.text
    assert len(connection.fetchrow_calls) == 0
    assert len(connection.execute_calls) == 0


def test_list_verifier_client_keys_requires_verifier_client_read_scope(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.management_key_row = {
        "key_id": "mkey_verifier_reader",
        "operator_id": None,
        "scopes": ["verifier_clients:read"],
    }

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.get(
        "/admin/verifier-clients/api-keys",
        headers={"X-Admin-Token": "managed-verifier-reader"},
    )

    assert response.status_code == 200
    assert response.json()["records"][0]["key_id"] == "vkey_demo_client_hash"
    assert response.json()["records"][0]["scopes"] == ["verifier:client"]
    assert "scopes @> array['verifier:client']" in connection.fetch_calls[0][0]


def test_revoke_verifier_client_key_uses_management_api_and_audit(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.management_key_row = {
        "key_id": "mkey_verifier_admin",
        "operator_id": None,
        "scopes": ["verifier_clients:write"],
    }

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/verifier-clients/api-keys/vkey_demo_client_hash/revoke",
        headers={"X-Admin-Token": "managed-verifier-admin"},
    )

    assert response.status_code == 200
    assert response.json()["record"]["status"] == "revoked"
    assert "scopes @> array['verifier:client']" in connection.fetchrow_calls[1][0]
    audit_call = connection.execute_calls[0]
    assert audit_call[3] == "verifier_client_key.revoke"
    assert audit_call[4] == "verifier_client_key"
    assert audit_call[5] == "vkey_demo_client_hash"


def test_upsert_trust_key_uses_management_service_and_outbox(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.management_key_row = {
        "key_id": "mkey_trust_key_admin",
        "operator_id": None,
        "scopes": ["trust_keys:write"],
    }

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/trust-keys",
        headers={"X-Admin-Token": "managed-trust-key-admin"},
        json={
            "key_id": "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "signer_id": "authority:qrtrust-demo:merchant-web",
            "algorithm_id": "ed25519",
            "public_key_material_ref": " managed://qrtrust/authority/public/v1 ",
            "scope": "delegated_authority",
            "key_status": "active",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "key_id": "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
        "key_status": "active",
        "event_type": "trust_key.upserted",
    }
    assert "insert into qr_trust.trust_keys" in connection.execute_calls[0][0]
    assert connection.execute_calls[1][3] == "trust_key.upsert"
    assert connection.execute_calls[2][2] == "trust_key.upserted"


def test_upsert_trust_key_rejects_expired_not_after(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/trust-keys",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "key_id": "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "signer_id": "authority:qrtrust-demo:merchant-web",
            "algorithm_id": "ed25519",
            "public_key_material_ref": "managed://qrtrust/authority/public/v1",
            "scope": "delegated_authority",
            "key_status": "active",
            "not_after": "2020-01-01T00:00:00Z",
        },
    )

    assert response.status_code == 422
    assert "not_after must be in the future" in response.text
    assert len(connection.fetchrow_calls) == 0
    assert len(connection.execute_calls) == 0


def test_upsert_trust_key_rejects_reversed_validity_window(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/trust-keys",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "key_id": "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "signer_id": "authority:qrtrust-demo:merchant-web",
            "algorithm_id": "ed25519",
            "public_key_material_ref": "managed://qrtrust/authority/public/v1",
            "scope": "delegated_authority",
            "key_status": "active",
            "not_before": "2030-01-02T00:00:00Z",
            "not_after": "2030-01-01T00:00:00Z",
        },
    )

    assert response.status_code == 422
    assert "not_after must be later than not_before" in response.text
    assert len(connection.fetchrow_calls) == 0
    assert len(connection.execute_calls) == 0


def test_update_trust_key_status_requires_trust_key_scope(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection(changed_rows=1)
    connection.management_key_row = {
        "key_id": "mkey_trust_key_admin",
        "operator_id": None,
        "scopes": ["trust_keys:write"],
    }

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/trust-keys/status",
        headers={"X-Admin-Token": "managed-trust-key-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "key_id": "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
            "key_status": "revoked",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "key_id": "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
        "key_status": "revoked",
        "event_type": "trust_key.status.changed",
    }
    assert "update qr_trust.trust_keys" in connection.fetchrow_calls[1][0]


def test_list_trust_keys_filters_root_and_authority(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.management_key_row = {
        "key_id": "mkey_trust_key_reader",
        "operator_id": None,
        "scopes": ["trust_keys:read"],
    }

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.get(
        "/admin/trust-keys",
        headers={"X-Admin-Token": "managed-trust-key-reader"},
        params={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
        },
    )

    assert response.status_code == 200
    assert response.json()["records"][0]["public_key_material_pem"] is None
    assert response.json()["records"][0]["key_status"] == "active"
    assert "from qr_trust.trust_keys" in connection.fetch_calls[0][0]
    assert connection.fetch_calls[0][1:] == (
        "root:qrtrust-demo:2026",
        "authority:qrtrust-demo:merchant-web",
        50,
    )


def test_enroll_issuer_requires_management_admin(client: TestClient) -> None:
    response = client.post(
        "/admin/issuers",
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "display_name": "ACME Demo",
            "issuer_class": "business",
            "assurance_tier": "domain_controlled",
        },
    )

    assert response.status_code == 401


def test_upsert_root_program_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/root-programs",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "name": "QR Trust Demo Root",
            "program_scope": "demo merchant QR trust",
            "accepted_algorithm_ids": ["ES256"],
            "policy_constraints": {"max_redirect_hops": 1},
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "root_program_id": "root:qrtrust-demo:2026",
        "status": "active",
        "event_type": "root_program.upserted",
    }
    assert connection.closed is True
    assert connection.transaction_committed is True
    assert len(connection.execute_calls) == 3
    assert "qr_trust.root_programs" in connection.execute_calls[0][0]
    assert "qr_trust.governance_audit_log" in connection.execute_calls[1][0]
    assert connection.execute_calls[1][2] is None
    assert "qr_trust.event_outbox" in connection.execute_calls[2][0]


def test_upsert_delegated_authority_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/delegated-authorities",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "name": "Merchant Web Authority",
            "authority_type": "merchant_operator",
            "scope": {"domains": ["acme.example"]},
            "assurance_requirements": {"domain_proof": "required"},
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "root_program_id": "root:qrtrust-demo:2026",
        "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
        "status": "active",
        "event_type": "delegated_authority.upserted",
    }
    assert connection.closed is True
    assert connection.transaction_committed is True
    assert len(connection.execute_calls) == 3
    assert "qr_trust.delegated_authorities" in connection.execute_calls[0][0]
    assert "qr_trust.governance_audit_log" in connection.execute_calls[1][0]
    assert connection.execute_calls[1][2] is None
    assert "qr_trust.event_outbox" in connection.execute_calls[2][0]


def test_upsert_delegated_authority_rejects_unknown_authority_type(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.core.config import config

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])

    response = client.post(
        "/admin/delegated-authorities",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "name": "Merchant Web Authority",
            "authority_type": "program_operator",
            "scope": {"domains": ["acme.example"]},
            "assurance_requirements": {"domain_proof": "required"},
        },
    )

    assert response.status_code == 422


def test_enroll_issuer_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/issuers",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "display_name": "ACME Demo",
            "issuer_class": "business",
            "assurance_tier": "domain_controlled",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "issuer_id": "issuer:acme-demo",
        "enrollment_status": "pending",
        "event_type": "issuer.enrollment.requested",
    }
    assert connection.closed is True
    assert connection.transaction_committed is True
    assert len(connection.execute_calls) == 3
    assert "qr_trust.issuers" in connection.execute_calls[0][0]
    assert "qr_trust.governance_audit_log" in connection.execute_calls[1][0]
    assert "qr_trust.event_outbox" in connection.execute_calls[2][0]


def test_enroll_issuer_rejects_unknown_class_and_tier(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.core.config import config

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])

    response = client.post(
        "/admin/issuers",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme",
            "display_name": "ACME",
            "issuer_class": "merchant",
            "assurance_tier": "standard",
        },
    )

    assert response.status_code == 422


def test_enroll_issuer_accepts_db_management_key(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config
    from backend.app.services.management_auth import hash_management_key

    connection = FakeManagementConnection()
    connection.management_key_row = {
        "key_id": "mgmt_admin",
        "operator_id": None,
        "scopes": ["admin:*"],
    }

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/issuers",
        headers={"X-Admin-Token": "mgmt_plaintext"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "display_name": "ACME Demo",
            "issuer_class": "business",
            "assurance_tier": "domain_controlled",
        },
    )

    assert response.status_code == 200
    assert connection.closed is True
    assert connection.fetchrow_calls[0][1] == hash_management_key("mgmt_plaintext")
    assert connection.execute_calls[1][2] == "mgmt_admin"


def test_enroll_issuer_rejects_db_management_key_without_scope(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.management_key_row = {
        "key_id": "mgmt_auditor",
        "operator_id": None,
        "scopes": ["audit:read"],
    }

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/issuers",
        headers={"X-Admin-Token": "mgmt_plaintext"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "display_name": "ACME Demo",
            "issuer_class": "business",
            "assurance_tier": "domain_controlled",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "missing required scope: issuer:write"
    assert connection.closed is True
    assert len(connection.execute_calls) == 0


def test_operator_role_allows_matching_route_with_limited_admin_key(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.management_key_row = {
        "key_id": "mkey_scanner_operator",
        "operator_id": "44444444-4444-4444-8444-444444444444",
        "scopes": ["admin:*"],
    }
    connection.operator_role_assignment_rows = [{"role": "scanner_client_admin"}]

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.get(
        "/admin/verifier-clients/api-keys",
        headers={"X-Admin-Token": "managed-scanner-admin"},
    )

    assert response.status_code == 200
    assert response.json()["records"][0]["key_id"] == "vkey_demo_client_hash"
    assert "from qr_trust.operator_role_assignments" in connection.fetch_calls[0][0]


def test_operator_role_blocks_unrelated_route_even_with_admin_key(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.management_key_row = {
        "key_id": "mkey_scanner_operator",
        "operator_id": "55555555-5555-4555-8555-555555555555",
        "scopes": ["admin:*"],
    }
    connection.operator_role_assignment_rows = [{"role": "scanner_client_admin"}]

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/issuers",
        headers={"X-Admin-Token": "managed-scanner-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "display_name": "ACME Demo",
            "issuer_class": "business",
            "assurance_tier": "domain_controlled",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "missing required scope: issuer:write"
    assert "from qr_trust.operator_role_assignments" in connection.fetch_calls[0][0]
    assert len(connection.execute_calls) == 0


def test_upsert_domain_proof_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/domain-proofs",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "domain": "ACME.EXAMPLE.",
            "proof_method": "manual_review",
            "verification_status": "verified",
            "expires_at": "2026-12-31T23:59:59Z",
            "evidence_ref": "operator://manual-review/acme.example",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "root_program_id": "root:qrtrust-demo:2026",
        "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
        "issuer_id": "issuer:acme-demo",
        "domain": "acme.example",
        "verification_status": "verified",
        "event_type": "domain_proof.upserted",
    }
    assert connection.closed is True
    assert connection.transaction_committed is True
    assert len(connection.execute_calls) == 3
    assert "qr_trust.issuer_domain_proofs" in connection.execute_calls[0][0]
    assert connection.execute_calls[0][4] == "acme.example"
    assert "qr_trust.governance_audit_log" in connection.execute_calls[1][0]
    assert connection.execute_calls[1][2] is None
    assert "qr_trust.event_outbox" in connection.execute_calls[2][0]


def test_upsert_domain_proof_rejects_urls(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.core.config import config

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])

    response = client.post(
        "/admin/domain-proofs",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "domain": "https://acme.example/pay",
            "proof_method": "manual_review",
            "verification_status": "verified",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "domain must be a hostname, not a URL"


def test_upsert_domain_proof_rejects_expired_verified_expires_at(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.core.config import config

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])

    response = client.post(
        "/admin/domain-proofs",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "domain": "acme.example",
            "proof_method": "manual_review",
            "verification_status": "verified",
            "expires_at": "2020-01-01T00:00:00Z",
            "evidence_ref": "operator://manual-review/acme.example",
        },
    )

    assert response.status_code == 422
    assert "verified domain proof expires_at must be in the future" in response.text


def test_upsert_domain_proof_rejects_naive_expires_at(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.core.config import config

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])

    response = client.post(
        "/admin/domain-proofs",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "domain": "acme.example",
            "proof_method": "manual_review",
            "verification_status": "pending",
            "expires_at": "2026-12-31T23:59:59",
        },
    )

    assert response.status_code == 422
    assert "expires_at must include a timezone" in response.text


def test_update_issuer_status_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/issuers/status",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "enrollment_status": "active",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "issuer_id": "issuer:acme-demo",
        "enrollment_status": "active",
        "event_type": "issuer.status.changed",
    }
    assert connection.closed is True
    assert connection.transaction_committed is True
    assert len(connection.fetchrow_calls) == 1
    assert len(connection.execute_calls) == 2
    assert "qr_trust.issuers" in connection.fetchrow_calls[0][0]
    assert connection.fetchrow_calls[0][4] == "active"
    assert "qr_trust.governance_audit_log" in connection.execute_calls[0][0]
    assert "qr_trust.event_outbox" in connection.execute_calls[1][0]


def test_update_issuer_status_blocks_missing_issuer(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection(changed_rows=0)

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/issuers/status",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:missing",
            "enrollment_status": "active",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "issuer status update requires an existing issuer enrollment"
    )
    assert len(connection.fetchrow_calls) == 1
    assert len(connection.execute_calls) == 0


def test_upsert_destination_policy_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection(changed_rows=1)

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/destination-policies",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "destination_policy_id": "policy:acme-demo:web-payments:v1",
            "usage_policy": "reusable_public",
            "approved_destinations": [
                {
                    "destination_id": "dest:acme-demo:pay",
                    "expected_final_url": "https://acme.example/pay",
                    "allowed_hosts": ["ACME.EXAMPLE."],
                    "allow_subdomains": False,
                    "path_prefixes": ["/pay"],
                    "query_policy": "allow_known_payment_query",
                }
            ],
            "redirect_policy": {
                "resolver_urls": [],
                "expected_final_destinations": ["https://acme.example/pay"],
                "allowed_redirect_hosts": [],
                "max_redirect_hops": 0,
                "nested_shorteners_allowed": False,
                "scanner_must_display_resolver_and_final_destination": True,
            },
            "runtime_safety_policy": {
                "provider": "deterministic-runtime-safety",
                "verdict_ttl_seconds": 300,
                "stale_behavior": "downgrade_to_caution",
                "unavailable_behavior": "downgrade_to_caution",
            },
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "destination_policy_id": "policy:acme-demo:web-payments:v1",
        "status": "active",
        "event_type": "destination_policy.upserted",
        "required_hosts": ["acme.example"],
    }
    assert connection.closed is True
    assert connection.transaction_committed is True
    assert len(connection.fetchrow_calls) == 1
    assert len(connection.execute_calls) == 2
    assert "qr_trust.destination_policies" in connection.fetchrow_calls[0][0]
    assert connection.fetchrow_calls[0][9] == '[{"allow_subdomains":false,"host":"acme.example"}]'
    assert "qr_trust.governance_audit_log" in connection.execute_calls[0][0]
    assert "qr_trust.event_outbox" in connection.execute_calls[1][0]


def test_upsert_destination_policy_rejects_malformed_expected_final_url_port(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection(changed_rows=1)

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/destination-policies",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "destination_policy_id": "policy:acme-demo:web-payments:v1",
            "approved_destinations": [
                {
                    "destination_id": "dest:acme-demo:pay",
                    "expected_final_url": "https://acme.example:99999/pay",
                    "allowed_hosts": ["acme.example"],
                    "allow_subdomains": False,
                    "path_prefixes": ["/pay"],
                    "query_policy": "allow_known_payment_query",
                }
            ],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "expected_final_url must be a valid URL"
    assert connection.closed is False
    assert len(connection.execute_calls) == 0


def test_upsert_destination_policy_rejects_expected_final_url_credentials(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection(changed_rows=1)

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/destination-policies",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "destination_policy_id": "policy:acme-demo:web-payments:v1",
            "approved_destinations": [
                {
                    "destination_id": "dest:acme-demo:pay",
                    "expected_final_url": "https://user:pass@acme.example/pay",
                    "allowed_hosts": ["acme.example"],
                    "allow_subdomains": False,
                    "path_prefixes": ["/pay"],
                    "query_policy": "allow_known_payment_query",
                }
            ],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "expected_final_url must not include credentials"
    assert connection.closed is False
    assert len(connection.execute_calls) == 0


def test_upsert_destination_policy_rejects_redirect_policy_resolver_credentials(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection(changed_rows=1)

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/destination-policies",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "destination_policy_id": "policy:acme-demo:web-payments:v1",
            "approved_destinations": [
                {
                    "destination_id": "dest:acme-demo:pay",
                    "expected_final_url": "https://acme.example/pay",
                    "allowed_hosts": ["acme.example"],
                    "allow_subdomains": False,
                    "path_prefixes": ["/pay"],
                    "query_policy": "allow_known_payment_query",
                }
            ],
            "redirect_policy": {
                "resolver_urls": ["https://user:pass@qr.acme.example/r/pay"],
                "expected_final_destinations": ["https://acme.example/pay"],
                "allowed_redirect_hosts": ["acme.example"],
                "max_redirect_hops": 1,
                "nested_shorteners_allowed": False,
                "scanner_must_display_resolver_and_final_destination": True,
            },
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "redirect_policy.resolver_urls must not include credentials"
    )
    assert connection.closed is False
    assert len(connection.execute_calls) == 0


def test_upsert_destination_policy_rejects_negative_redirect_hops(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection(changed_rows=1)

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/destination-policies",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "destination_policy_id": "policy:acme-demo:web-payments:v1",
            "approved_destinations": [
                {
                    "destination_id": "dest:acme-demo:pay",
                    "expected_final_url": "https://acme.example/pay",
                    "allowed_hosts": ["acme.example"],
                    "allow_subdomains": False,
                    "path_prefixes": ["/pay"],
                    "query_policy": "allow_known_payment_query",
                }
            ],
            "redirect_policy": {"max_redirect_hops": -1},
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "redirect_policy.max_redirect_hops must be a non-negative integer"
    )
    assert connection.closed is False
    assert len(connection.execute_calls) == 0


def test_upsert_destination_policy_rejects_invalid_runtime_policy_ttl(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection(changed_rows=1)

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/destination-policies",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "destination_policy_id": "policy:acme-demo:web-payments:v1",
            "approved_destinations": [
                {
                    "destination_id": "dest:acme-demo:pay",
                    "expected_final_url": "https://acme.example/pay",
                    "allowed_hosts": ["acme.example"],
                    "allow_subdomains": False,
                    "path_prefixes": ["/pay"],
                    "query_policy": "allow_known_payment_query",
                }
            ],
            "runtime_safety_policy": {"verdict_ttl_seconds": 0},
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "runtime_safety_policy.verdict_ttl_seconds must be a positive integer"
    )
    assert connection.closed is False
    assert len(connection.execute_calls) == 0


def test_upsert_destination_policy_rejects_relative_path_prefixes(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection(changed_rows=1)

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/destination-policies",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "destination_policy_id": "policy:acme-demo:web-payments:v1",
            "approved_destinations": [
                {
                    "destination_id": "dest:acme-demo:pay",
                    "expected_final_url": "https://acme.example/pay",
                    "allowed_hosts": ["acme.example"],
                    "allow_subdomains": False,
                    "path_prefixes": ["pay"],
                    "query_policy": "allow_known_payment_query",
                }
            ],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "path_prefixes must start with /"
    assert connection.closed is False
    assert len(connection.execute_calls) == 0


def test_upsert_destination_policy_blocks_without_active_issuer_or_domain_proof(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection(changed_rows=0)

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/destination-policies",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "destination_policy_id": "policy:acme-demo:web-payments:v1",
            "approved_destinations": [
                {
                    "destination_id": "dest:acme-demo:pay",
                    "expected_final_url": "https://acme.example/pay",
                    "allowed_hosts": ["acme.example"],
                    "allow_subdomains": False,
                    "path_prefixes": ["/pay"],
                    "query_policy": "allow_known_payment_query",
                }
            ],
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "destination policy requires an active issuer and verified domain proof "
        "for every approved host"
    )
    assert len(connection.fetchrow_calls) == 1
    assert len(connection.execute_calls) == 0


def test_upsert_destination_policy_defaults_query_policy_to_none(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection(changed_rows=1)

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/destination-policies",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "destination_policy_id": "policy:acme-demo:web-payments:v1",
            "approved_destinations": [
                {
                    "destination_id": "dest:acme-demo:pay",
                    "expected_final_url": "https://acme.example/pay",
                    "allowed_hosts": ["acme.example"],
                    "allow_subdomains": False,
                    "path_prefixes": ["/pay"],
                }
            ],
        },
    )

    assert response.status_code == 200
    approved_destinations = json.loads(connection.fetchrow_calls[0][6])
    assert approved_destinations == [
        {
            "allowed_hosts": ["acme.example"],
            "allow_subdomains": False,
            "destination_id": "dest:acme-demo:pay",
            "expected_final_url": "https://acme.example/pay",
            "path_prefixes": ["/pay"],
            "query_policy": "none",
        }
    ]


def test_upsert_destination_policy_rejects_unknown_query_policy(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection(changed_rows=1)

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/destination-policies",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "destination_policy_id": "policy:acme-demo:web-payments:v1",
            "approved_destinations": [
                {
                    "destination_id": "dest:acme-demo:pay",
                    "expected_final_url": "https://acme.example/pay",
                    "allowed_hosts": ["acme.example"],
                    "allow_subdomains": False,
                    "path_prefixes": ["/pay"],
                    "query_policy": "allow_none",
                }
            ],
        },
    )

    assert response.status_code == 422
    assert connection.closed is False
    assert len(connection.fetchrow_calls) == 0
    assert len(connection.execute_calls) == 0


def test_update_destination_policy_status_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection(changed_rows=1)

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/destination-policies/status",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "destination_policy_id": "policy:acme-demo:web-payments:v1",
            "status": "revoked",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "destination_policy_id": "policy:acme-demo:web-payments:v1",
        "status": "revoked",
        "event_type": "destination_policy.status.changed",
    }
    assert connection.closed is True
    assert connection.transaction_committed is True
    assert len(connection.fetchrow_calls) == 1
    assert len(connection.execute_calls) == 2
    assert "qr_trust.destination_policies" in connection.fetchrow_calls[0][0]
    assert connection.fetchrow_calls[0][5] == "revoked"
    assert "qr_trust.governance_audit_log" in connection.execute_calls[0][0]
    assert "qr_trust.event_outbox" in connection.execute_calls[1][0]


def test_update_destination_policy_status_blocks_missing_policy(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection(changed_rows=0)

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/destination-policies/status",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "destination_policy_id": "policy:missing",
            "status": "revoked",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "destination policy status update requires an existing destination policy"
    )
    assert len(connection.fetchrow_calls) == 1
    assert len(connection.execute_calls) == 0


def test_enroll_issuer_maps_idempotency_conflict_to_409(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config
    from backend.app.services.management_plane import IdempotencyConflictError

    async def _reject_idempotency_conflict(*_args: Any, **_kwargs: Any) -> None:
        raise IdempotencyConflictError(
            "idempotency key was already used for a different request"
        )

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)
    monkeypatch.setattr(
        management_endpoint.ManagementPlaneService,
        "record_governance_mutation",
        _reject_idempotency_conflict,
    )

    response = client.post(
        "/admin/issuers",
        headers={
            "X-Admin-Token": "local-lab-admin",
            "Idempotency-Key": "idem_conflict",
        },
        json={
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
            "issuer_id": "issuer:acme-demo",
            "display_name": "ACME Demo",
            "issuer_class": "business",
            "assurance_tier": "domain_controlled",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "idempotency key was already used for a different request"
    )


def test_authorize_nats_subscriber_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/nats/subscribers",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "subscriber_id": "subscriber:reference-governance",
            "display_name": "Reference governance subscriber",
            "durable_name": "qrtrust_governance_subscriber_worker",
            "description": "Consumes governance artifact notifications.",
            "subjects": [
                "qrtrust.*.issuer.>",
                "qrtrust.*.destination.>",
            ],
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "subscriber_id": "subscriber:reference-governance",
        "status": "active",
        "event_type": "nats.subscriber.authorization.changed",
        "subjects": [
            "qrtrust.*.destination.>",
            "qrtrust.*.issuer.>",
        ],
    }
    assert connection.closed is True
    assert connection.transaction_committed is True
    assert len(connection.execute_calls) == 3
    assert "qr_trust.nats_subscribers" in connection.execute_calls[0][0]
    assert "qr_trust.nats_subscriber_subjects" in connection.execute_calls[0][0]
    assert "qr_trust.governance_audit_log" in connection.execute_calls[1][0]
    assert "qr_trust.event_outbox" in connection.execute_calls[2][0]


def test_validate_qrtrust_nats_subject_accepts_exact_control_plane_events() -> None:
    from backend.app.schemas.management_contracts import validate_qrtrust_nats_subject

    assert (
        validate_qrtrust_nats_subject(
            "qrtrust.control-plane.runtime.provider.upserted.v1"
        )
        == "qrtrust.control-plane.runtime.provider.upserted.v1"
    )
    assert (
        validate_qrtrust_nats_subject(
            "qrtrust.control-plane.authority.nats-subscriber.authorization.changed.v1"
        )
        == "qrtrust.control-plane.authority.nats-subscriber.authorization.changed.v1"
    )


def test_upsert_runtime_provider_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/runtime-providers",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "provider_id": "deterministic-runtime-safety",
            "display_name": "Deterministic runtime safety",
            "base_url": None,
            "verdict_ttl_seconds": 300,
            "stale_behavior": "downgrade_to_caution",
            "unavailable_behavior": "block",
            "status": "active",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "provider_id": "deterministic-runtime-safety",
        "status": "active",
        "event_type": "runtime_provider.upserted",
    }
    assert connection.closed is True
    assert connection.transaction_committed is True
    assert len(connection.execute_calls) == 3
    state_call = connection.execute_calls[0]
    assert "qr_trust.runtime_safety_providers" in state_call[0]
    assert state_call[1] == "deterministic-runtime-safety"
    assert state_call[4] == 300
    assert state_call[5] == "downgrade_to_caution"
    assert state_call[6] == "block"
    assert state_call[7] == "active"
    assert "qr_trust.governance_audit_log" in connection.execute_calls[1][0]
    assert "qr_trust.event_outbox" in connection.execute_calls[2][0]


def test_upsert_runtime_provider_rejects_insecure_remote_base_url(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/runtime-providers",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "provider_id": "remote-runtime-safety",
            "display_name": "Remote runtime safety",
            "base_url": "http://runtime.example/provider",
            "verdict_ttl_seconds": 300,
            "stale_behavior": "downgrade_to_caution",
            "unavailable_behavior": "block",
            "status": "active",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "runtime provider base_url must use https unless it targets localhost"
    )
    assert connection.closed is False
    assert len(connection.execute_calls) == 0


def test_list_runtime_providers_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.get(
        "/admin/runtime-providers",
        headers={"X-Admin-Token": "local-lab-admin"},
    )

    assert response.status_code == 200
    assert response.json()["providers"] == connection.runtime_providers
    assert connection.closed is True
    assert len(connection.fetch_calls) == 1
    assert "qr_trust.runtime_safety_providers" in connection.fetch_calls[0][0]


def test_authorize_nats_subscriber_rejects_broad_subject(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/nats/subscribers",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "subscriber_id": "subscriber:too-broad",
            "display_name": "Too broad subscriber",
            "durable_name": "too_broad_subscriber",
            "subjects": ["qrtrust.>"],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Trust-root NATS subject must match qrtrust.<root>.<family>.<event>.v1 "
        "or qrtrust.<root>.<family>.>; control-plane subjects must be "
        "documented exact management events"
    )
    assert connection.closed is False
    assert len(connection.execute_calls) == 0


@pytest.mark.parametrize(
    "subject",
    [
        "qrtrust.bad root.issuer.record.v1",
        "qrtrust.root:qrtrust-demo:2026.issuer.record.v1",
        "qrtrust.root-a.issuer.v1",
        "qrtrust.control-plane.issuer.record.published.v1",
        "qrtrust.control-plane.runtime.>",
    ],
)
def test_authorize_nats_subscriber_rejects_malformed_subject_tokens(
    client: TestClient,
    monkeypatch,
    subject: str,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/nats/subscribers",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "subscriber_id": "subscriber:malformed",
            "display_name": "Malformed subscriber",
            "durable_name": "malformed_subscriber",
            "subjects": [subject],
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Trust-root NATS subject must match qrtrust.<root>.<family>.<event>.v1 "
        "or qrtrust.<root>.<family>.>; control-plane subjects must be "
        "documented exact management events"
    )
    assert connection.closed is False
    assert len(connection.execute_calls) == 0


def test_list_nats_subscribers_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.get(
        "/admin/nats/subscribers",
        headers={"X-Admin-Token": "local-lab-admin"},
    )

    assert response.status_code == 200
    assert response.json()["subscribers"] == connection.nats_subscribers
    assert connection.closed is True
    assert len(connection.fetch_calls) == 1
    assert "qr_trust.nats_subscribers" in connection.fetch_calls[0][0]


def test_outbox_status_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.get(
        "/admin/outbox",
        headers={"X-Admin-Token": "local-lab-admin"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "status_counts": {
            "failed": 1,
            "pending": 2,
            "published": 5,
            "publishing": 0,
            "quarantined": 0,
        },
        "recent_events": [
            {
                "outbox_id": "11111111-1111-4111-8111-111111111111",
                "event_id": "evt_mgmt_issuer",
                "event_type": "issuer.enrollment.requested",
                "aggregate_type": "issuer",
                "aggregate_id": "issuer:acme-demo",
                "publish_status": "failed",
                "attempts": 3,
                "last_error": "broker unavailable",
                "created_at": "2026-05-25T10:00:00Z",
                "published_at": None,
            },
        ],
    }
    assert connection.closed is True
    assert len(connection.fetch_calls) == 2
    assert "qr_trust.event_outbox" in connection.fetch_calls[0][0]
    assert "qr_trust.event_outbox" in connection.fetch_calls[1][0]


def test_remediate_outbox_event_quarantines_stale_event(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/outbox/events/remediate",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "event_id": "evt_mgmt_stale_policy",
            "action": "quarantine",
            "reason": "stale source policy event",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "event_id": "evt_mgmt_stale_policy",
        "publish_status": "quarantined",
        "attempts": 0,
        "last_error": "stale source policy event",
    }
    assert connection.closed is True
    assert connection.transaction_committed is True
    assert len(connection.fetchrow_calls) == 1
    assert len(connection.execute_calls) == 1
    assert "qr_trust.event_outbox" in connection.fetchrow_calls[0][0]
    assert connection.fetchrow_calls[0][1:] == (
        "evt_mgmt_stale_policy",
        "quarantine",
        "stale source policy event",
    )
    assert "qr_trust.governance_audit_log" in connection.execute_calls[0][0]
    assert connection.execute_calls[0][3] == "outbox.event.quarantine"


def test_remediate_outbox_event_returns_404_for_missing_event(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.outbox_remediation_row = None

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/outbox/events/remediate",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "event_id": "evt_missing",
            "action": "quarantine",
            "reason": "stale source policy event",
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "outbox event not found"
    assert len(connection.fetchrow_calls) == 2
    assert len(connection.execute_calls) == 0


def test_remediate_outbox_event_rejects_published_event(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()
    connection.outbox_remediation_row = None
    connection.outbox_remediation_existing_status = "published"

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.post(
        "/admin/outbox/events/remediate",
        headers={"X-Admin-Token": "local-lab-admin"},
        json={
            "event_id": "evt_mgmt_published",
            "action": "retry",
            "reason": "broker replay drill",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "published outbox events are immutable; publish a correcting event instead"
    )
    assert len(connection.fetchrow_calls) == 2
    assert len(connection.execute_calls) == 0


def test_audit_log_accepts_local_admin_token(
    client: TestClient,
    monkeypatch,
) -> None:
    from backend.app.api.endpoints import management as management_endpoint
    from backend.app.core.config import config

    connection = FakeManagementConnection()

    async def _fake_connect(*_args: Any, **_kwargs: Any) -> FakeManagementConnection:
        return connection

    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", ["local-lab-admin"])
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(management_endpoint.asyncpg, "connect", _fake_connect)

    response = client.get(
        "/admin/audit",
        headers={"X-Admin-Token": "local-lab-admin"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "audit_rows": [
            {
                "audit_id": "22222222-2222-4222-8222-222222222222",
                "actor_key_id": "local-admin-token",
                "action": "issuer.enroll",
                "target_type": "issuer",
                "target_id": "issuer:acme-demo",
                "root_program_id": "root:qrtrust-demo:2026",
                "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
                "issuer_id": "issuer:acme-demo",
                "before_json": None,
                "after_json": {"issuer_id": "issuer:acme-demo"},
                "request_id": "req_management",
                "idempotency_key": "idem_management",
                "created_at": "2026-05-25T10:01:00Z",
            },
        ],
    }
    assert connection.closed is True
    assert len(connection.fetch_calls) == 1
    assert "qr_trust.governance_audit_log" in connection.fetch_calls[0][0]
