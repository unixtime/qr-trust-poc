"""Server-owned lifecycle state machines and their scanner-store projections.

The transition tables are the single authority for which status changes the
management endpoints accept; the projection maps translate durable statuses
into the in-memory ScannerTrustStore vocabulary. Terminal enforcement also
exists as database triggers (migration 20260901_0009) — the tables here give
callers a 409 with a useful detail before the trigger would raise.
"""

from dataclasses import dataclass

CERTIFICATE_TRANSITIONS: dict[str, frozenset[str]] = {
    "active": frozenset({"rotated", "suspended", "revoked", "expired"}),
    "rotated": frozenset({"suspended", "revoked", "expired"}),
    "suspended": frozenset({"active", "rotated", "revoked", "expired"}),
    "revoked": frozenset(),
    "expired": frozenset({"revoked"}),
}

TRUST_KEY_TRANSITIONS: dict[str, frozenset[str]] = {
    "active": frozenset({"suspended", "revoked", "expired"}),
    "suspended": frozenset({"active", "revoked", "expired"}),
    "revoked": frozenset(),
    "expired": frozenset({"revoked"}),
}

KEY_PROJECTION: dict[str, str] = {
    "active": "active",
    "rotated": "retired",
    "expired": "retired",
    "suspended": "suspended",
    "revoked": "revoked",
}

ISSUER_PROJECTION: dict[str, str] = {
    "active": "active",
    "suspended": "suspended",
    "revoked": "revoked",
    "expired": "expired",
}


@dataclass(frozen=True)
class TransitionCheck:
    kind: str
    detail: str


def check_transition(
    transitions: dict[str, frozenset[str]], current: str, requested: str
) -> TransitionCheck:
    if requested == current:
        return TransitionCheck(kind="noop", detail=f"status is already '{current}'")
    allowed = transitions.get(current)
    if allowed is None:
        return TransitionCheck(
            kind="disallowed", detail=f"unknown current status '{current}'"
        )
    if not allowed:
        return TransitionCheck(kind="terminal", detail=f"status '{current}' is terminal")
    if requested not in allowed:
        return TransitionCheck(
            kind="disallowed",
            detail=f"transition '{current}' -> '{requested}' is not allowed",
        )
    return TransitionCheck(kind="allowed", detail=f"'{current}' -> '{requested}'")
