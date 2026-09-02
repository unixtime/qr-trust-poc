from __future__ import annotations

from typing import Any

import pytest

from backend.app.services.management_auth import (
    ManagementPrincipal,
    ManagementUnauthorized,
    ResourceAssignment,
    load_management_principal,
    record_resource_authz_audit,
    require_issuer_resource,
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


_RESOURCE_TARGET = {
    "root_program_id": "root:qrtrust-demo:2026",
    "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
    "issuer_id": "issuer:acme-demo",
}


def _scoped_principal(
    assignments: tuple[ResourceAssignment, ...] = (),
) -> ManagementPrincipal:
    return ManagementPrincipal(
        key_id="mkey_resource_test",
        operator_id="11111111-1111-1111-1111-111111111111",
        scopes=frozenset({"issuer:write"}),
        resource_assignments=assignments,
    )


def test_resource_assignment_authority_level_covers_nested_issuer() -> None:
    assignment = ResourceAssignment(
        root_program_id="root:qrtrust-demo:2026",
        delegated_authority_id="authority:qrtrust-demo:merchant-web",
        issuer_id=None,
    )
    assert assignment.covers(**_RESOURCE_TARGET) is True


def test_resource_assignment_all_none_covers_nothing() -> None:
    assignment = ResourceAssignment(
        root_program_id=None, delegated_authority_id=None, issuer_id=None
    )
    assert assignment.covers(**_RESOURCE_TARGET) is False


def test_resource_assignment_mismatched_issuer_does_not_cover() -> None:
    assignment = ResourceAssignment(
        root_program_id="root:qrtrust-demo:2026",
        delegated_authority_id="authority:qrtrust-demo:merchant-web",
        issuer_id="issuer:someone-else",
    )
    assert assignment.covers(**_RESOURCE_TARGET) is False


def test_require_issuer_resource_bootstrap_principal_bypasses_enforce() -> None:
    principal = ManagementPrincipal(
        key_id=None, operator_id=None, scopes=frozenset({"admin:*"})
    )
    decision = require_issuer_resource(
        principal, "issuer:write", mode="enforce", **_RESOURCE_TARGET
    )
    assert decision.permitted is True
    assert decision.would_block is False


def test_require_issuer_resource_admin_star_key_still_needs_assignment() -> None:
    principal = ManagementPrincipal(
        key_id="mkey_root_admin",
        operator_id=None,
        scopes=frozenset({"admin:*"}),
    )
    with pytest.raises(ManagementUnauthorized):
        require_issuer_resource(
            principal, "issuer:write", mode="enforce", **_RESOURCE_TARGET
        )


def test_require_issuer_resource_audit_mode_permits_and_flags() -> None:
    decision = require_issuer_resource(
        _scoped_principal(), "issuer:write", mode="audit", **_RESOURCE_TARGET
    )
    assert decision.permitted is True
    assert decision.would_block is True
    assert "no resource assignment covers" in decision.detail


def test_require_issuer_resource_covering_assignment_passes_enforce() -> None:
    assignment = ResourceAssignment(
        root_program_id="root:qrtrust-demo:2026",
        delegated_authority_id=None,
        issuer_id=None,
    )
    decision = require_issuer_resource(
        _scoped_principal((assignment,)),
        "issuer:write",
        mode="enforce",
        **_RESOURCE_TARGET,
    )
    assert decision.permitted is True
    assert decision.would_block is False


@pytest.mark.asyncio
async def test_record_resource_authz_audit_row_shape() -> None:
    class _RecordingConnection:
        def __init__(self) -> None:
            self.calls: list[tuple[Any, ...]] = []

        async def execute(self, sql: str, *args: Any) -> str:
            self.calls.append((sql, *args))
            return "INSERT 0 1"

    connection = _RecordingConnection()
    await record_resource_authz_audit(
        connection,
        _scoped_principal(),
        "issuer:write",
        target_id="cert:acme-demo:2026-09",
        root_program_id="root:qrtrust-demo:2026",
        delegated_authority_id="authority:qrtrust-demo:merchant-web",
        issuer_id="issuer:acme-demo",
        request_id="req_resource_authz",
        detail="no resource assignment covers this write",
    )
    assert len(connection.calls) == 1
    assert "resource_authz.would_block" in str(connection.calls[0][0])
    assert connection.calls[0][1:] == (
        "11111111-1111-1111-1111-111111111111",
        "mkey_resource_test",
        "cert:acme-demo:2026-09",
        "root:qrtrust-demo:2026",
        "authority:qrtrust-demo:merchant-web",
        "issuer:acme-demo",
        "issuer:write",
        "no resource assignment covers this write",
        "req_resource_authz",
    )


@pytest.mark.asyncio
async def test_load_management_principal_collects_resource_assignment() -> None:
    store = FakeCredentialStore(
        management_key_row={
            "key_id": "mkey_scoped",
            "operator_id": None,
            "scopes": ["issuer:write"],
            "root_program_id": "root:qrtrust-demo:2026",
            "delegated_authority_id": None,
            "issuer_id": None,
        }
    )
    principal = await load_management_principal(store, "plaintext_key")
    assert principal is not None
    assert principal.resource_assignments == (
        ResourceAssignment(
            root_program_id="root:qrtrust-demo:2026",
            delegated_authority_id=None,
            issuer_id=None,
        ),
    )
