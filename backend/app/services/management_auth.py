from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Protocol


_VERIFIER_CLIENT_SCOPE = "verifier:client"


class ManagementUnauthorized(Exception):
    """Raised when a management caller lacks a required credential or scope."""


@dataclass(frozen=True)
class ManagementPrincipal:
    key_id: str | None
    operator_id: str | None
    scopes: frozenset[str]


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
    return ManagementPrincipal(
        key_id=str(row["key_id"]),
        operator_id=operator_id,
        scopes=effective_scopes,
    )


def require_scope(
    principal: ManagementPrincipal,
    required_scope: str,
) -> ManagementPrincipal:
    if required_scope in principal.scopes or "admin:*" in principal.scopes:
        return principal
    raise ManagementUnauthorized(f"missing required scope: {required_scope}")


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
  scopes
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
