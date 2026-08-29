"""Root-scoped trust store for the scanner PoC.

The store holds two record kinds with independent lifecycles: an issuer record
(who is trusted, under which root, for how long) and key entries (which signing
keys that issuer published, and in what state). A scan resolves the artifact's
``certificate_ref`` to a key, the key to its issuer, and then runs one pure rule
function over both. Keeping the rules pure and separate from the store is what
lets the same logic serve the scanner endpoint and the verifier endpoint without
either one re-deriving it.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta

from backend.app.services.governance_fixture_store import GovernanceTrustProjection
from backend.app.services.signed_schema_poc import (
    SignedQRCodeClaims,
    parse_claim_timestamp,
)

ISSUER_STATUSES: tuple[str, ...] = ("active", "suspended", "revoked")
KEY_STATES: tuple[str, ...] = ("active", "retired", "revoked")


@dataclass(frozen=True)
class IssuerRecord:
    issuer_id: str
    issuer_name: str
    root_id: str
    status: str
    issued_at: datetime
    expires_at: datetime | None
    verified_domains: tuple[str, ...]
    allow_subdomains: bool


@dataclass(frozen=True)
class KeyEntry:
    key_ref: str
    issuer_id: str
    algorithm_id: str
    public_key_pem: str
    state: str
    not_before: datetime
    not_after: datetime | None
    revoked_at: datetime | None = None
    revocation_reason: str | None = None


@dataclass(frozen=True)
class TrustRuleResult:
    allowed: bool
    stage: str
    cause: str | None
    reason: str


_ACCEPTED = TrustRuleResult(
    allowed=True,
    stage="accepted",
    cause=None,
    reason="Issuer record and signing key are in force for this artifact",
)


def evaluate_trust_window(
    *,
    now: datetime,
    claims: SignedQRCodeClaims,
    key: KeyEntry,
    issuer: IssuerRecord,
    skew_seconds: int,
) -> TrustRuleResult:
    """Return the first rule this artifact fails, or an accepting result.

    Order matters and is deliberate: authority state (is this issuer trusted at
    all?) outranks key state, which outranks the artifact's own validity window.
    A scanner that reported "expired" for a code signed by a revoked issuer
    would be telling the truth about the least important failure.
    """
    if issuer.status == "revoked":
        return TrustRuleResult(False, "issuer_status", "issuer-revoked",
                               "Issuer record is revoked")
    if issuer.status != "active":
        return TrustRuleResult(False, "issuer_status", "issuer-inactive",
                               f"Issuer record is {issuer.status}, not active")

    if key.state == "revoked":
        detail = f": {key.revocation_reason}" if key.revocation_reason else ""
        return TrustRuleResult(False, "key_status", "key-revoked",
                               f"Signing key {key.key_ref} is revoked{detail}")

    if now < issuer.issued_at:
        return TrustRuleResult(False, "issuer_status", "issuer-record-not-yet-valid",
                               "Issuer record is not yet in force")
    if issuer.expires_at is not None and now >= issuer.expires_at:
        return TrustRuleResult(False, "issuer_status", "issuer-record-expired",
                               "Issuer record has expired")

    issued_at = parse_claim_timestamp("issued_at", claims.issued_at)
    if issued_at < key.not_before or (key.not_after is not None and issued_at > key.not_after):
        # Checked against the artifact's issued_at, not the wall clock: a key
        # that has since been retired still legitimately signed everything it
        # signed while it was current.
        return TrustRuleResult(False, "key_status", "key-window-mismatch",
                               f"Artifact was issued outside the validity window of key {key.key_ref}")

    skew = timedelta(seconds=skew_seconds)
    if now < issued_at - skew:
        return TrustRuleResult(False, "time_window", "not-yet-valid",
                               "Signed claims are not yet valid")
    if claims.expires_at is not None:
        expires_at = parse_claim_timestamp("expires_at", claims.expires_at)
        if now >= expires_at + skew:
            return TrustRuleResult(False, "time_window", "object-expired",
                                   "Signed claims have expired")

    return _ACCEPTED


class ScannerTrustStore:
    """In-memory issuer/key registry. Process-lifetime only, like the rest of the PoC.

    Concurrency contract: the store is process-local and unsynchronised. Every
    mutation reaches it from an ``async def`` endpoint with no ``await``
    between the read and the write inside ``put_issuer``, ``put_key`` and
    ``retire_keys_for``, so a single event loop cannot interleave two of them
    and no lock is needed. That guarantee ends at the process boundary: run
    the app under more than one worker and each worker gets its own store,
    which is why this is a PoC surface and not a deployable trust registry.
    """

    def __init__(self) -> None:
        self._issuers: dict[str, IssuerRecord] = {}
        self._keys: dict[str, KeyEntry] = {}
        self._governance: dict[str, GovernanceTrustProjection] = {}

    def put_issuer(self, record: IssuerRecord) -> None:
        self._issuers[record.issuer_id] = record

    def put_key(self, entry: KeyEntry) -> None:
        """Publish a signing key, refusing to un-revoke one.

        Revocation is terminal (spec Q3): a revoked key blocks every artifact it
        signed, for good. Re-putting the same ref in any other state would undo
        that, so it raises instead. A same-state re-put stays allowed, which
        keeps the write idempotent and lets a revocation reason be filled in.
        """
        existing = self._keys.get(entry.key_ref)
        if existing is not None and existing.state == "revoked" and entry.state != "revoked":
            raise ValueError(f"key {entry.key_ref!r} is revoked; revocation is terminal")
        self._keys[entry.key_ref] = entry

    def set_governance(self, issuer_id: str, projection: GovernanceTrustProjection) -> None:
        # The whole projection, not a profile string: three live scanner
        # consumers read `.assurance_tier`, `.issuer_namespace_label`, and
        # `.cache_freshness_state()` off it (Task 5).
        self._governance[issuer_id] = projection

    def governance_for(self, issuer_id: str) -> GovernanceTrustProjection | None:
        return self._governance.get(issuer_id)

    def resolve(self, key_ref: str) -> tuple[KeyEntry, IssuerRecord] | None:
        key = self._keys.get(key_ref)
        if key is None:
            return None
        issuer = self._issuers.get(key.issuer_id)
        if issuer is None:
            return None
        return key, issuer

    def retire_keys_for(self, issuer_id: str, *, now: datetime, except_key_ref: str) -> None:
        for key_ref, key in list(self._keys.items()):
            if key.issuer_id != issuer_id or key_ref == except_key_ref:
                continue
            if key.state != "active":
                continue
            self._keys[key_ref] = replace(key, state="retired", not_after=now)

    def remove_key(self, key_ref: str) -> None:
        self._keys.pop(key_ref, None)

    def issuers(self) -> tuple[IssuerRecord, ...]:
        return tuple(self._issuers.values())

    def keys(self) -> tuple[KeyEntry, ...]:
        return tuple(self._keys.values())

    def clear(self) -> None:
        self._issuers.clear()
        self._keys.clear()
        self._governance.clear()
