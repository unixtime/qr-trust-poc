from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Protocol


_VERIFIER_CLIENT_SCOPE = "verifier:client"


class ManagementUnauthorized(Exception):
    """Raised when a management caller lacks a required credential or scope."""


@dataclass(frozen=True)
class ResourceAssignment:
    root_program_id: str | None
    delegated_authority_id: str | None
    issuer_id: str | None

    def covers(
        self,
        *,
        root_program_id: str,
        delegated_authority_id: str,
        issuer_id: str,
    ) -> bool:
        if (
            self.root_program_id is None
            and self.delegated_authority_id is None
            and self.issuer_id is None
        ):
            return False
        if self.root_program_id is not None and self.root_program_id != root_program_id:
            return False
        if (
            self.delegated_authority_id is not None
            and self.delegated_authority_id != delegated_authority_id
        ):
            return False
        if self.issuer_id is not None and self.issuer_id != issuer_id:
            return False
        return True


@dataclass(frozen=True)
class ResourceAuthzDecision:
    permitted: bool
    would_block: bool
    detail: str


@dataclass(frozen=True)
class ManagementPrincipal:
    key_id: str | None
    operator_id: str | None
    scopes: frozenset[str]
    resource_assignments: tuple[ResourceAssignment, ...] = ()


class ManagementCredentialStore(Protocol):
    async def fetchrow(self, *args: Any) -> Any: ...

    async def fetch(self, *args: Any) -> list[Any]: ...


def hash_management_key(plaintext_key: str) -> str:
    return sha256(plaintext_key.encode("utf-8")).hexdigest()


async def load_management_principal(
    connection: ManagementCredentialStore,
    plaintext_key: str,
) -> ManagementPrincipal | None:
    row = await connection.fetchrow(
        _MANAGEMENT_KEY_LOOKUP,
        hash_management_key(plaintext_key),
    )
    if row is None:
        return None
    operator_id = _optional_str(row["operator_id"])
    key_scopes = frozenset(str(scope) for scope in row["scopes"])
    if _VERIFIER_CLIENT_SCOPE in key_scopes:
        return None
    effective_scopes = key_scopes
    if operator_id is not None:
        operator_role_scopes = await _load_operator_role_scopes(
            connection,
            operator_id,
        )
        effective_scopes = _intersect_key_and_operator_scopes(
            key_scopes,
            operator_role_scopes,
        )
    assignment_root = _optional_str(row.get("root_program_id"))
    assignment_authority = _optional_str(row.get("delegated_authority_id"))
    assignment_issuer = _optional_str(row.get("issuer_id"))
    resource_assignments: tuple[ResourceAssignment, ...] = ()
    if any(
        value is not None
        for value in (assignment_root, assignment_authority, assignment_issuer)
    ):
        resource_assignments = (
            ResourceAssignment(
                root_program_id=assignment_root,
                delegated_authority_id=assignment_authority,
                issuer_id=assignment_issuer,
            ),
        )
    return ManagementPrincipal(
        key_id=str(row["key_id"]),
        operator_id=operator_id,
        scopes=effective_scopes,
        resource_assignments=resource_assignments,
    )


def require_scope(
    principal: ManagementPrincipal,
    required_scope: str,
) -> ManagementPrincipal:
    if required_scope in principal.scopes or "admin:*" in principal.scopes:
        return principal
    raise ManagementUnauthorized(f"missing required scope: {required_scope}")


def require_issuer_resource(
    principal: ManagementPrincipal,
    scope: str,
    *,
    root_program_id: str,
    delegated_authority_id: str,
    issuer_id: str,
    mode: str,
) -> ResourceAuthzDecision:
    if principal.key_id is None:
        return ResourceAuthzDecision(
            permitted=True,
            would_block=False,
            detail="bootstrap principal bypasses resource scoping",
        )
    for assignment in principal.resource_assignments:
        if assignment.covers(
            root_program_id=root_program_id,
            delegated_authority_id=delegated_authority_id,
            issuer_id=issuer_id,
        ):
            return ResourceAuthzDecision(
                permitted=True,
                would_block=False,
                detail=f"assignment covers issuer '{issuer_id}'",
            )
    detail = (
        f"no resource assignment covers key '{principal.key_id}' "
        f"for scope '{scope}' on root_program '{root_program_id}', "
        f"delegated_authority '{delegated_authority_id}', issuer '{issuer_id}'"
    )
    if mode == "enforce":
        raise ManagementUnauthorized(detail)
    return ResourceAuthzDecision(permitted=True, would_block=True, detail=detail)


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value)


async def _load_operator_role_scopes(
    connection: ManagementCredentialStore,
    operator_id: str,
) -> frozenset[str]:
    rows = await connection.fetch(
        _OPERATOR_ROLE_SCOPE_LOOKUP,
        operator_id,
    )
    scopes: set[str] = set()
    for row in rows:
        scopes.update(_ROLE_SCOPE_GRANTS.get(str(row["role"]), frozenset()))
    return frozenset(scopes)


def _intersect_key_and_operator_scopes(
    key_scopes: frozenset[str],
    operator_scopes: frozenset[str],
) -> frozenset[str]:
    if not operator_scopes:
        return frozenset()
    if "admin:*" in key_scopes and "admin:*" in operator_scopes:
        return frozenset({"admin:*"})
    if "admin:*" in key_scopes:
        return operator_scopes
    if "admin:*" in operator_scopes:
        return key_scopes
    return key_scopes & operator_scopes


_ROLE_SCOPE_GRANTS: Mapping[str, frozenset[str]] = {
    "root_admin": frozenset({"admin:*"}),
    "authority_admin": frozenset(
        {
            "audit:read",
            "authority:write",
            "issuer:write",
            "outbox:read",
            "policy:write",
            "trust_keys:read",
            "trust_keys:write",
        }
    ),
    "issuer_admin": frozenset(
        {
            "audit:read",
            "issuer:write",
            "policy:write",
        }
    ),
    "auditor": frozenset({"audit:read", "outbox:read", "trust_keys:read"}),
    "runtime_provider_admin": frozenset(
        {
            "audit:read",
            "runtime:read",
            "runtime:write",
        }
    ),
    "scanner_client_admin": frozenset(
        {
            "audit:read",
            "verifier_clients:read",
            "verifier_clients:write",
        }
    ),
    "nats_subscriber_admin": frozenset(
        {
            "audit:read",
            "nats:read",
            "nats:write",
            "outbox:read",
        }
    ),
}


_MANAGEMENT_KEY_LOOKUP = """
select
  key_id,
  operator_id::text as operator_id,
  scopes,
  root_program_id,
  delegated_authority_id,
  issuer_id
from qr_trust.management_api_keys
where key_hash = $1
  and status = 'active'
  and not (scopes @> array['verifier:client']::text[])
  and (not_before is null or not_before <= now())
  and (expires_at is null or expires_at > now())
limit 1
""".strip()

_OPERATOR_ROLE_SCOPE_LOOKUP = """
select assignment.role
from qr_trust.operator_role_assignments assignment
join qr_trust.operators operator_record
  on operator_record.operator_id = assignment.operator_id
where assignment.operator_id = $1::uuid
  and assignment.status = 'active'
  and operator_record.status = 'active'
""".strip()


_RESOURCE_AUTHZ_AUDIT_INSERT = """
insert into qr_trust.governance_audit_log (
    actor_operator_id, actor_key_id, action, target_type, target_id,
    root_program_id, delegated_authority_id, issuer_id, after_json, request_id
) values (
    $1::uuid, $2, 'resource_authz.would_block', 'resource_authz', $3,
    $4, $5, $6, jsonb_build_object('scope', $7, 'detail', $8), $9
)
"""


async def record_resource_authz_audit(
    connection: Any,
    principal: ManagementPrincipal,
    scope: str,
    *,
    target_id: str,
    root_program_id: str,
    delegated_authority_id: str,
    issuer_id: str,
    request_id: str,
    detail: str,
) -> None:
    await connection.execute(
        _RESOURCE_AUTHZ_AUDIT_INSERT,
        principal.operator_id,
        principal.key_id,
        target_id,
        root_program_id,
        delegated_authority_id,
        issuer_id,
        scope,
        detail,
        request_id,
    )
