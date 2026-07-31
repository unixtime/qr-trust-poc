from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from secrets import token_urlsafe

import asyncpg

from backend.app.core.config import config
from backend.app.schemas.management_contracts import build_verifier_client_key_id


POSTGRES_VERIFIER_SCOPE = "verifier:client"
POSTGRES_SOURCE = "postgres-management"


class VerifierAPIKeyStoreUnavailable(RuntimeError):
    """Raised when dynamic verifier key management has no Postgres authority."""


@dataclass(frozen=True)
class VerifierAPIKeyRecord:
    key_id: str
    label: str
    source: str
    created_at: str
    active: bool


@dataclass(frozen=True)
class IssuedVerifierAPIKey:
    record: VerifierAPIKeyRecord
    plaintext_key: str


class VerifierAPIKeyService:
    """
    Manage verifier API keys from static config plus dynamic admin-managed keys.

    Dynamic keys use qr_trust.management_api_keys. Static config keys remain a
    read-only local fallback, but admin-managed issue, rotate, and revoke flows
    require Postgres management state.
    """

    @staticmethod
    def build_key_id(plaintext_key: str) -> str:
        return sha256(plaintext_key.encode("utf-8")).hexdigest()

    @staticmethod
    def build_plaintext_key() -> str:
        return f"vkey_{token_urlsafe(32)}"

    def configured_api_keys(self) -> list[str]:
        if not config.VERIFIER_STATIC_API_KEYS_ENABLED:
            return []
        return [key.strip() for key in config.VERIFIER_API_KEYS if key and key.strip()]

    def configured_admin_tokens(self) -> list[str]:
        if not config.VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED:
            return []
        return [token.strip() for token in config.VERIFIER_ADMIN_TOKENS if token and token.strip()]

    def static_records(self) -> list[VerifierAPIKeyRecord]:
        records: list[VerifierAPIKeyRecord] = []
        for index, key in enumerate(self.configured_api_keys(), start=1):
            key_id = self.build_key_id(key)
            records.append(
                VerifierAPIKeyRecord(
                    key_id=key_id,
                    label=f"config-key-{index}",
                    source="config",
                    created_at="static",
                    active=True,
                )
            )
        return records

    async def has_valid_key(self, plaintext_key: str) -> bool:
        if plaintext_key in self.configured_api_keys():
            return True

        key_id = self.build_key_id(plaintext_key)
        if self._postgres_dsn() is not None:
            return await self._postgres_has_key(key_id)
        return False

    async def auth_is_enabled(self) -> bool:
        if self.configured_api_keys():
            return True
        if self.configured_admin_tokens():
            return True
        if self._postgres_dsn() is not None:
            try:
                return await self._postgres_has_active_key()
            except VerifierAPIKeyStoreUnavailable:
                # A configured but unreachable key store should fail closed.
                return True
        return False

    async def issue_key(self, label: str) -> IssuedVerifierAPIKey:
        if self._postgres_dsn() is None:
            raise VerifierAPIKeyStoreUnavailable(
                "Dynamic verifier API keys require Postgres management state",
            )
        normalized_label = label.strip() or "verifier-client"
        plaintext_key = self.build_plaintext_key()
        key_hash = self.build_key_id(plaintext_key)
        key_id = build_verifier_client_key_id(key_hash)
        record = VerifierAPIKeyRecord(
            key_id=key_id,
            label=normalized_label,
            source=POSTGRES_SOURCE,
            created_at=datetime.now(timezone.utc).isoformat(),
            active=True,
        )

        record = await self._postgres_store_record(record, key_hash=key_hash)
        return IssuedVerifierAPIKey(record=record, plaintext_key=plaintext_key)

    async def list_records(self) -> list[VerifierAPIKeyRecord]:
        records = self.static_records()
        if self._postgres_dsn() is not None:
            records.extend(await self._postgres_list_records())
        return sorted(records, key=lambda item: (item.source, item.label, item.key_id))

    async def revoke_key(self, key_id: str) -> bool:
        if self._postgres_dsn() is None:
            raise VerifierAPIKeyStoreUnavailable(
                "Dynamic verifier API keys require Postgres management state",
            )
        return await self._postgres_revoke_key(key_id)

    async def rotate_key(self, key_id: str, label: str | None = None) -> IssuedVerifierAPIKey:
        if self._postgres_dsn() is None:
            raise VerifierAPIKeyStoreUnavailable(
                "Dynamic verifier API keys require Postgres management state",
            )
        existing_records = {record.key_id: record for record in await self.list_records()}
        existing = existing_records.get(key_id)
        if (
            existing is None
            or existing.source == "config"
            or not existing.active
        ):
            raise ValueError("Only active dynamic verifier API keys can be rotated")

        await self.revoke_key(key_id)
        return await self.issue_key(label or existing.label)

    async def reset(self) -> None:
        return None

    def _postgres_dsn(self) -> str | None:
        return config.QRTRUST_NETWORK_DATABASE_URL or config.DATABASE_URL

    async def _postgres_connect(self) -> asyncpg.Connection:
        dsn = self._postgres_dsn()
        if dsn is None:
            raise VerifierAPIKeyStoreUnavailable(
                "Dynamic verifier API keys require Postgres management state",
            )
        try:
            return await asyncpg.connect(
                _asyncpg_dsn(dsn),
                timeout=1.5,
                command_timeout=2.0,
            )
        except Exception as exc:
            raise _postgres_store_unavailable() from exc

    async def _postgres_has_key(self, key_hash: str) -> bool:
        connection: asyncpg.Connection | None = None
        try:
            connection = await self._postgres_connect()
            return bool(
                await connection.fetchval(
                    """
                    select 1
                    from qr_trust.management_api_keys
                    where key_hash = $1
                      and status = 'active'
                      and scopes @> array[$2]::text[]
                      and (not_before is null or not_before <= now())
                      and (expires_at is null or expires_at > now())
                    limit 1
                    """,
                    key_hash,
                    POSTGRES_VERIFIER_SCOPE,
                )
            )
        except VerifierAPIKeyStoreUnavailable:
            raise
        except Exception as exc:
            raise _postgres_store_unavailable() from exc
        finally:
            if connection is not None:
                await connection.close()

    async def _postgres_has_active_key(self) -> bool:
        connection: asyncpg.Connection | None = None
        try:
            connection = await self._postgres_connect()
            return bool(
                await connection.fetchval(
                    """
                    select 1
                    from qr_trust.management_api_keys
                    where status = 'active'
                      and scopes @> array[$1]::text[]
                      and (not_before is null or not_before <= now())
                      and (expires_at is null or expires_at > now())
                    limit 1
                    """,
                    POSTGRES_VERIFIER_SCOPE,
                )
            )
        except VerifierAPIKeyStoreUnavailable:
            raise
        except Exception as exc:
            raise _postgres_store_unavailable() from exc
        finally:
            if connection is not None:
                await connection.close()

    async def _postgres_store_record(
        self,
        record: VerifierAPIKeyRecord,
        *,
        key_hash: str,
    ) -> VerifierAPIKeyRecord:
        connection: asyncpg.Connection | None = None
        try:
            connection = await self._postgres_connect()
            row = await connection.fetchrow(
                """
                insert into qr_trust.management_api_keys (
                  key_id,
                  key_hash,
                  label,
                  scopes,
                  status
                ) values ($1, $2, $3, array[$4]::text[], 'active')
                returning key_id, label, created_at, status
                """,
                record.key_id,
                key_hash,
                record.label,
                POSTGRES_VERIFIER_SCOPE,
            )
            return _postgres_record_from_row(row)
        except VerifierAPIKeyStoreUnavailable:
            raise
        except Exception as exc:
            raise _postgres_store_unavailable() from exc
        finally:
            if connection is not None:
                await connection.close()

    async def _postgres_list_records(self) -> list[VerifierAPIKeyRecord]:
        connection: asyncpg.Connection | None = None
        try:
            connection = await self._postgres_connect()
            rows = await connection.fetch(
                """
                select key_id, label, created_at, status
                from qr_trust.management_api_keys
                where scopes @> array[$1]::text[]
                order by label, key_id
                """,
                POSTGRES_VERIFIER_SCOPE,
            )
            return [_postgres_record_from_row(row) for row in rows]
        except VerifierAPIKeyStoreUnavailable:
            raise
        except Exception as exc:
            raise _postgres_store_unavailable() from exc
        finally:
            if connection is not None:
                await connection.close()

    async def _postgres_revoke_key(self, key_id: str) -> bool:
        connection: asyncpg.Connection | None = None
        try:
            connection = await self._postgres_connect()
            result = await connection.execute(
                """
                update qr_trust.management_api_keys
                set status = 'revoked',
                    revoked_at = now()
                where key_id = $1
                  and scopes @> array[$2]::text[]
                  and status = 'active'
                """,
                key_id,
                POSTGRES_VERIFIER_SCOPE,
            )
            return _command_changed_rows(result)
        except VerifierAPIKeyStoreUnavailable:
            raise
        except Exception as exc:
            raise _postgres_store_unavailable() from exc
        finally:
            if connection is not None:
                await connection.close()


def _asyncpg_dsn(dsn: str) -> str:
    if dsn.startswith("postgresql+asyncpg://"):
        return dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
    return dsn


def _postgres_record_from_row(row: asyncpg.Record) -> VerifierAPIKeyRecord:
    return VerifierAPIKeyRecord(
        key_id=str(row["key_id"]),
        label=str(row["label"]),
        source=POSTGRES_SOURCE,
        created_at=_format_postgres_created_at(row["created_at"]),
        active=str(row["status"]) == "active",
    )


def _format_postgres_created_at(value: object) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


def _command_changed_rows(result: str) -> bool:
    try:
        return int(result.rsplit(" ", maxsplit=1)[-1]) > 0
    except (IndexError, ValueError):
        return False


def _postgres_store_unavailable() -> VerifierAPIKeyStoreUnavailable:
    return VerifierAPIKeyStoreUnavailable(
        "Postgres verifier API key store unavailable",
    )


verifier_api_key_service = VerifierAPIKeyService()
