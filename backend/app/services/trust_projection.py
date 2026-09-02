"""Durable trust projection: qr_trust rows become the scanner's working set.

Postgres is the source of truth for issuer and key lifecycle state; the
in-memory ScannerTrustStore holds a projection of it. This module loads
that projection transactionally, tags every projected entry with
source="projection", and enforces the staleness policy: a verifier that
cannot confirm the governance version token within its budget stops
answering rather than guessing.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Awaitable, Callable, Mapping

from cryptography.hazmat.primitives import serialization

from backend.app.services.scanner_trust_store import (
    IssuerRecord,
    KeyEntry,
    ScannerTrustStore,
)
from backend.app.services.trust_state import TrustStateToken, probe_trust_state
from backend.app.services.trust_transitions import (
    ISSUER_PROJECTION,
    KEY_PROJECTION,
)

logger = logging.getLogger(__name__)

_VERIFYING_STATES = frozenset({"active", "retired"})


class TrustStateUnavailableError(RuntimeError):
    """The governance row is unreadable; the projection cannot be trusted."""


@dataclass(frozen=True)
class ProjectionDefect:
    # "projected-blocking-row": a blocking row shipped without key material.
    # "excluded-verifying-row": a would-verify row the projection refused.
    defect_class: str
    table: str
    row_ref: str
    detail: str


@dataclass(frozen=True)
class TrustSnapshot:
    token: TrustStateToken
    issuers: tuple[IssuerRecord, ...]
    keys: tuple[KeyEntry, ...]
    defects: tuple[ProjectionDefect, ...]


def _usable_public_key(pem: str | None) -> bool:
    if pem is None or not pem.strip():
        return False
    try:
        serialization.load_pem_public_key(pem.encode("ascii"))
    except Exception:
        return False
    return True


def project_certificate_row(
    row: Mapping[str, Any],
) -> tuple[KeyEntry | None, ProjectionDefect | None]:
    row_ref = str(row["certificate_id"])
    raw_status = str(row["key_status"])
    state = KEY_PROJECTION.get(raw_status)
    if state is None:
        return None, ProjectionDefect(
            defect_class="excluded-verifying-row",
            table="issuer_certificates",
            row_ref=row_ref,
            detail=f"unrecognized key_status {raw_status!r}",
        )

    pem = row["public_key_material_pem"]
    usable = _usable_public_key(pem)
    if not usable and state in _VERIFYING_STATES:
        # A verifying key with no material could never check a signature;
        # excluding it here is what keeps Task 9's material-presence arm
        # unreachable for projected keys.
        return None, ProjectionDefect(
            defect_class="excluded-verifying-row",
            table="issuer_certificates",
            row_ref=row_ref,
            detail=f"{state} key has no usable public key material",
        )

    entry = KeyEntry(
        key_ref=row_ref,
        issuer_id=str(row["issuer_id"]),
        algorithm_id=str(row["algorithm_id"]),
        public_key_pem=pem if usable else None,
        state=state,
        not_before=row["not_before"],
        not_after=row["not_after"],
        revoked_at=row["revoked_at"],
        revocation_reason=row["revocation_reason"],
        source="projection",
    )
    if not usable:
        # Blocking rows stay projected so their QRs keep failing with the
        # blocking cause, but the missing material is worth surfacing.
        return entry, ProjectionDefect(
            defect_class="projected-blocking-row",
            table="issuer_certificates",
            row_ref=row_ref,
            detail=f"{state} key projected without public key material",
        )
    return entry, None


def project_issuer_row(
    row: Mapping[str, Any],
    verified_domains: Mapping[str, datetime | None],
) -> IssuerRecord | None:
    status = ISSUER_PROJECTION.get(str(row["enrollment_status"]))
    if status is None:
        # 'pending' (and anything unmapped) is not yet part of the trust
        # surface: no entry, and deliberately no defect.
        return None
    return IssuerRecord(
        issuer_id=str(row["issuer_id"]),
        issuer_name=str(row["display_name"]),
        root_id=str(row["root_program_id"]),
        status=status,
        issued_at=row["created_at"],
        expires_at=row["expires_at"],
        verified_domains=dict(verified_domains),
        allow_subdomains=bool(row["allow_subdomains"]),
        source="projection",
    )


_CERTIFICATE_SQL = """
    select certificate_id, root_program_id, delegated_authority_id, issuer_id,
           algorithm_id, public_key_material_pem, key_status,
           not_before, not_after, revoked_at, revocation_reason
      from qr_trust.issuer_certificates
"""

_ISSUER_SQL = """
    select root_program_id, delegated_authority_id, issuer_id, display_name,
           enrollment_status, allow_subdomains, expires_at, created_at
      from qr_trust.issuers
"""

_DOMAIN_PROOF_SQL = """
    select issuer_id, domain, expires_at
      from qr_trust.issuer_domain_proofs
     where verification_status = 'verified'
"""


async def load_trust_snapshot(connection: Any) -> TrustSnapshot:
    async with connection.transaction(isolation="repeatable_read", readonly=True):
        token = await probe_trust_state(connection)
        if token is None:
            raise TrustStateUnavailableError(
                "governance row 'trust_state' is missing or unreadable"
            )
        proof_rows = await connection.fetch(_DOMAIN_PROOF_SQL)
        issuer_rows = await connection.fetch(_ISSUER_SQL)
        certificate_rows = await connection.fetch(_CERTIFICATE_SQL)

    proofs_by_issuer: dict[str, dict[str, datetime | None]] = {}
    for row in proof_rows:
        proofs_by_issuer.setdefault(str(row["issuer_id"]), {})[
            str(row["domain"])
        ] = row["expires_at"]

    issuers: list[IssuerRecord] = []
    for row in issuer_rows:
        record = project_issuer_row(
            row, proofs_by_issuer.get(str(row["issuer_id"]), {})
        )
        if record is not None:
            issuers.append(record)

    keys: list[KeyEntry] = []
    defects: list[ProjectionDefect] = []
    for row in certificate_rows:
        entry, defect = project_certificate_row(row)
        if entry is not None:
            keys.append(entry)
        if defect is not None:
            defects.append(defect)

    return TrustSnapshot(
        token=token,
        issuers=tuple(issuers),
        keys=tuple(keys),
        defects=tuple(defects),
    )


class TrustProjectionManager:
    """Keeps one store hydrated and answers: may the verifier answer at all?"""

    def __init__(self, *, max_staleness_seconds: int) -> None:
        self._max_staleness_seconds = max_staleness_seconds
        self._token: TrustStateToken | None = None
        self._last_success: datetime | None = None
        self._lock = asyncio.Lock()

    @property
    def token(self) -> TrustStateToken | None:
        return self._token

    async def ensure_fresh(
        self,
        *,
        store: ScannerTrustStore,
        connect: Callable[[], Awaitable[Any]] | None,
        now: datetime,
    ) -> str:
        if connect is None:
            return "inert"
        async with self._lock:
            connection = None
            try:
                connection = await connect()
                probed = await probe_trust_state(connection)
                if probed is None:
                    raise TrustStateUnavailableError("trust state probe failed")
                if self._token is not None and probed == self._token:
                    self._last_success = now
                    return "reused"
                snapshot = await load_trust_snapshot(connection)
                store.replace_projection(
                    issuers=snapshot.issuers,
                    keys=snapshot.keys,
                    defects=snapshot.defects,
                )
                self._token = snapshot.token
                self._last_success = now
                return "fresh"
            except Exception:
                logger.warning(
                    "trust projection refresh failed", exc_info=True
                )
                return self._degrade(now)
            finally:
                if connection is not None:
                    try:
                        await connection.close()
                    except Exception:
                        # The refresh outcome is already decided by now; a close
                        # failure only leaks a connection, so record it and move on.
                        logger.warning(
                            "trust projection connection close failed",
                            exc_info=True,
                        )

    def _degrade(self, now: datetime) -> str:
        # last_success moves only on successful probes, so repeated failures
        # drain the budget instead of resetting it.
        if self._token is None or self._last_success is None:
            return "unavailable"
        age = (now - self._last_success).total_seconds()
        if age <= self._max_staleness_seconds:
            return "stale-served"
        return "unavailable"
