from __future__ import annotations

from typing import Any

import pytest

from backend.app.services.management_auth import (
    ManagementPrincipal,
    ManagementUnauthorized,
    load_management_principal,
    require_scope,
)


class FakeCredentialStore:
    def __init__(
        self,
        *,
        management_key_row: dict[str, Any] | None,
        role_assignment_rows: list[dict[str, Any]] | None = None,
    ) -> None:
        self.management_key_row = management_key_row
        self.role_assignment_rows = role_assignment_rows or []
        self.fetchrow_calls: list[tuple[Any, ...]] = []
        self.fetch_calls: list[tuple[Any, ...]] = []

    async def fetchrow(self, *args: Any) -> dict[str, Any] | None:
        self.fetchrow_calls.append(args)
        return self.management_key_row

    async def fetch(self, *args: Any) -> list[dict[str, Any]]:
        self.fetch_calls.append(args)
        return self.role_assignment_rows


@pytest.mark.asyncio
async def test_load_management_principal_uses_key_scopes_without_operator() -> None:
    store = FakeCredentialStore(
        management_key_row={
            "key_id": "mkey_operatorless",
            "operator_id": None,
            "scopes": ["audit:read", "outbox:read"],
        }
    )

    principal = await load_management_principal(store, "plaintext_key")

    assert principal == ManagementPrincipal(
        key_id="mkey_operatorless",
        operator_id=None,
        scopes=frozenset({"audit:read", "outbox:read"}),
    )
    assert store.fetch_calls == []


@pytest.mark.asyncio
async def test_load_management_principal_intersects_key_and_operator_role_scopes() -> None:
    store = FakeCredentialStore(
        management_key_row={
            "key_id": "mkey_issuer_operator",
            "operator_id": "11111111-1111-4111-8111-111111111111",
            "scopes": ["issuer:write", "policy:write", "nats:write"],
        },
        role_assignment_rows=[
            {"role": "issuer_admin"},
            {"role": "auditor"},
        ],
    )

    principal = await load_management_principal(store, "plaintext_key")

    assert principal == ManagementPrincipal(
        key_id="mkey_issuer_operator",
        operator_id="11111111-1111-4111-8111-111111111111",
        scopes=frozenset({"issuer:write", "policy:write"}),
    )
    assert len(store.fetch_calls) == 1
    assert store.fetch_calls[0][1] == "11111111-1111-4111-8111-111111111111"


@pytest.mark.asyncio
async def test_load_management_principal_does_not_expand_admin_key_past_operator_role() -> None:
    store = FakeCredentialStore(
        management_key_row={
            "key_id": "mkey_admin_limited_by_role",
            "operator_id": "22222222-2222-4222-8222-222222222222",
            "scopes": ["admin:*"],
        },
        role_assignment_rows=[{"role": "scanner_client_admin"}],
    )

    principal = await load_management_principal(store, "plaintext_key")

    assert principal == ManagementPrincipal(
        key_id="mkey_admin_limited_by_role",
        operator_id="22222222-2222-4222-8222-222222222222",
        scopes=frozenset(
            {
                "audit:read",
                "verifier_clients:read",
                "verifier_clients:write",
            }
        ),
    )


@pytest.mark.asyncio
async def test_load_management_principal_fails_closed_without_active_roles() -> None:
    store = FakeCredentialStore(
        management_key_row={
            "key_id": "mkey_orphaned_operator",
            "operator_id": "33333333-3333-4333-8333-333333333333",
            "scopes": ["admin:*"],
        }
    )

    principal = await load_management_principal(store, "plaintext_key")

    assert principal == ManagementPrincipal(
        key_id="mkey_orphaned_operator",
        operator_id="33333333-3333-4333-8333-333333333333",
        scopes=frozenset(),
    )


@pytest.mark.asyncio
async def test_load_management_principal_rejects_verifier_client_key() -> None:
    store = FakeCredentialStore(
        management_key_row={
            "key_id": "vkey_scanner_client",
            "operator_id": None,
            "scopes": ["verifier:client"],
        }
    )

    principal = await load_management_principal(store, "plaintext_key")

    assert principal is None
    assert store.fetch_calls == []


def test_require_scope_accepts_matching_scope() -> None:
    principal = ManagementPrincipal(
        key_id="mgmt_test",
        operator_id=None,
        scopes=frozenset({"issuer:write", "audit:read"}),
    )

    assert require_scope(principal, "issuer:write") is principal


def test_require_scope_accepts_admin_wildcard() -> None:
    principal = ManagementPrincipal(
        key_id="mgmt_test",
        operator_id=None,
        scopes=frozenset({"admin:*"}),
    )

    assert require_scope(principal, "issuer:write") is principal


def test_require_scope_rejects_missing_scope() -> None:
    principal = ManagementPrincipal(
        key_id="mgmt_test",
        operator_id=None,
        scopes=frozenset({"audit:read"}),
    )

    with pytest.raises(ManagementUnauthorized, match="missing required scope"):
        require_scope(principal, "issuer:write")
