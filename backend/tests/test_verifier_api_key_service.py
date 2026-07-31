from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest

from backend.app.core.config import config
from backend.app.services import verifier_api_key_service as service_module
from backend.app.services.verifier_api_key_service import (
    VerifierAPIKeyService,
    VerifierAPIKeyStoreUnavailable,
)


class _FakeManagementAPIKeyConnection:
    def __init__(self) -> None:
        self.records: dict[str, dict[str, Any]] = {}
        self.closed = False

    async def fetchrow(self, _query: str, *args: Any) -> dict[str, Any]:
        key_id, key_hash, label, scope = args
        record = {
            "key_id": key_id,
            "key_hash": key_hash,
            "label": label,
            "scopes": [scope],
            "status": "active",
            "created_at": datetime(2026, 5, 25, tzinfo=timezone.utc),
        }
        self.records[key_id] = record
        return record

    async def fetchval(self, _query: str, *args: Any) -> int | None:
        if len(args) == 1:
            (scope,) = args
            return next(
                (
                    1
                    for record in self.records.values()
                    if record["status"] == "active" and scope in record["scopes"]
                ),
                None,
            )

        key_hash, scope = args
        for record in self.records.values():
            if (
                record["key_hash"] == key_hash
                and record["status"] == "active"
                and scope in record["scopes"]
            ):
                return 1
        return None

    async def fetch(self, _query: str, *args: Any) -> list[dict[str, Any]]:
        (scope,) = args
        return [
            record
            for record in self.records.values()
            if scope in record["scopes"]
        ]

    async def execute(self, _query: str, *args: Any) -> str:
        key_id, scope = args
        record = self.records.get(key_id)
        if (
            record is None
            or record["status"] != "active"
            or scope not in record["scopes"]
        ):
            return "UPDATE 0"
        record["status"] = "revoked"
        return "UPDATE 1"

    async def close(self) -> None:
        self.closed = True


class _BrokenManagementAPIKeyConnection:
    async def fetchrow(self, _query: str, *_args: Any) -> dict[str, Any]:
        raise RuntimeError("missing qr_trust.management_api_keys")

    async def close(self) -> None:
        return None


@pytest.mark.asyncio
async def test_configured_verifier_api_keys_require_static_key_flag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = VerifierAPIKeyService()
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", None)
    monkeypatch.setattr(config, "DATABASE_URL", None)
    monkeypatch.setattr(config, "VERIFIER_API_KEYS", [" static-local-key "])
    monkeypatch.setattr(
        config,
        "VERIFIER_STATIC_API_KEYS_ENABLED",
        False,
        raising=False,
    )

    assert service.configured_api_keys() == []
    assert await service.has_valid_key("static-local-key") is False
    assert await service.auth_is_enabled() is False


@pytest.mark.asyncio
async def test_configured_verifier_api_keys_accept_static_key_flag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = VerifierAPIKeyService()
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", None)
    monkeypatch.setattr(config, "DATABASE_URL", None)
    monkeypatch.setattr(config, "VERIFIER_API_KEYS", [" static-local-key "])
    monkeypatch.setattr(
        config,
        "VERIFIER_STATIC_API_KEYS_ENABLED",
        True,
        raising=False,
    )

    assert service.configured_api_keys() == ["static-local-key"]
    assert await service.has_valid_key("static-local-key") is True
    assert await service.auth_is_enabled() is True


def test_configured_admin_tokens_require_bootstrap_flag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = VerifierAPIKeyService()
    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [" local-lab-admin "])
    monkeypatch.setattr(
        config,
        "VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED",
        False,
        raising=False,
    )

    assert service.configured_admin_tokens() == []


def test_configured_admin_tokens_accept_explicit_bootstrap_flag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = VerifierAPIKeyService()
    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [" local-lab-admin "])
    monkeypatch.setattr(
        config,
        "VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED",
        True,
        raising=False,
    )

    assert service.configured_admin_tokens() == ["local-lab-admin"]


@pytest.mark.asyncio
async def test_dynamic_verifier_keys_use_postgres_management_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _FakeManagementAPIKeyConnection()
    service = VerifierAPIKeyService()

    async def _fake_connect(
        *_args: Any,
        **_kwargs: Any,
    ) -> _FakeManagementAPIKeyConnection:
        return connection

    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(config, "DATABASE_URL", None)
    monkeypatch.setattr(config, "VERIFIER_API_KEYS", [])
    monkeypatch.setattr(service_module.asyncpg, "connect", _fake_connect)

    assert await service.auth_is_enabled() is False

    issued = await service.issue_key("managed verifier")
    assert issued.record.key_id.startswith("vkey_")
    assert issued.record.key_id != service.build_key_id(issued.plaintext_key)
    assert issued.record.source == "postgres-management"
    assert await service.auth_is_enabled() is True
    assert await service.has_valid_key(issued.plaintext_key) is True

    listed = await service.list_records()
    assert [record.key_id for record in listed] == [issued.record.key_id]

    rotated = await service.rotate_key(issued.record.key_id)
    assert await service.has_valid_key(issued.plaintext_key) is False
    assert await service.has_valid_key(rotated.plaintext_key) is True

    assert await service.revoke_key(rotated.record.key_id) is True
    assert await service.has_valid_key(rotated.plaintext_key) is False
    assert connection.closed is True


@pytest.mark.asyncio
async def test_revoked_dynamic_verifier_key_cannot_be_rotated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _FakeManagementAPIKeyConnection()
    service = VerifierAPIKeyService()

    async def _fake_connect(
        *_args: Any,
        **_kwargs: Any,
    ) -> _FakeManagementAPIKeyConnection:
        return connection

    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(config, "DATABASE_URL", None)
    monkeypatch.setattr(config, "VERIFIER_API_KEYS", [])
    monkeypatch.setattr(service_module.asyncpg, "connect", _fake_connect)

    issued = await service.issue_key("managed verifier")
    assert await service.revoke_key(issued.record.key_id) is True

    with pytest.raises(ValueError, match="active dynamic verifier API keys"):
        await service.rotate_key(issued.record.key_id)


@pytest.mark.asyncio
async def test_dynamic_verifier_keys_do_not_use_local_mutable_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = VerifierAPIKeyService()
    monkeypatch.setattr(config, "QRTRUST_NETWORK_DATABASE_URL", None)
    monkeypatch.setattr(config, "DATABASE_URL", None)
    monkeypatch.setattr(config, "VERIFIER_API_KEYS", ["static-local-key"])
    monkeypatch.setattr(config, "VERIFIER_ADMIN_TOKENS", [])

    assert await service.has_valid_key("static-local-key") is True
    assert await service.has_valid_key("unknown-dynamic-key") is False
    assert [record.source for record in await service.list_records()] == ["config"]

    with pytest.raises(VerifierAPIKeyStoreUnavailable):
        await service.issue_key("local dynamic key")

    with pytest.raises(VerifierAPIKeyStoreUnavailable):
        await service.rotate_key("missing-key")

    with pytest.raises(VerifierAPIKeyStoreUnavailable):
        await service.revoke_key("missing-key")


@pytest.mark.asyncio
async def test_postgres_verifier_key_store_errors_are_wrapped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = VerifierAPIKeyService()
    monkeypatch.setattr(
        config,
        "QRTRUST_NETWORK_DATABASE_URL",
        "postgresql://user:pass@db/qr",
    )
    monkeypatch.setattr(config, "DATABASE_URL", None)

    async def _failed_connect(*_args: Any, **_kwargs: Any) -> None:
        raise OSError("connection refused")

    monkeypatch.setattr(service_module.asyncpg, "connect", _failed_connect)

    with pytest.raises(VerifierAPIKeyStoreUnavailable):
        await service.issue_key("managed verifier")

    async def _broken_connect(
        *_args: Any,
        **_kwargs: Any,
    ) -> _BrokenManagementAPIKeyConnection:
        return _BrokenManagementAPIKeyConnection()

    monkeypatch.setattr(service_module.asyncpg, "connect", _broken_connect)

    with pytest.raises(VerifierAPIKeyStoreUnavailable):
        await service.issue_key("managed verifier")
