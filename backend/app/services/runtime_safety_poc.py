from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse


@dataclass(frozen=True)
class RuntimeSafetyVerdict:
    state: str
    reason: str
    decision_state: str
    open_allowed: bool

    @property
    def is_clean(self) -> bool:
        return self.state == "clean"


def evaluate_runtime_safety(destination: str) -> RuntimeSafetyVerdict:
    """
    Deterministic PoC runtime provider.

    The verifier only calls this after issuer legitimacy and destination binding
    pass. Demo query/path markers make the paper's runtime-safety layer visible
    without relying on a third-party reputation feed.
    """
    parsed = urlparse(destination.strip())
    query = parse_qs(parsed.query)
    marker = _first_marker(query)
    path = parsed.path.lower().rstrip("/")

    if marker in {"risky", "warning", "suspicious"} or path.endswith("/risky"):
        return RuntimeSafetyVerdict(
            state="risky",
            reason=(
                "Runtime safety provider reports elevated destination risk after issuer "
                "and destination binding checks passed."
            ),
            decision_state="verified_issuer_destination_risky",
            open_allowed=True,
        )

    if marker in {"blocked", "malware", "phishing"} or path.endswith("/blocked"):
        return RuntimeSafetyVerdict(
            state="blocked",
            reason=(
                "Runtime safety provider reports a high-confidence block condition after "
                "issuer and destination binding checks passed."
            ),
            decision_state="blocked",
            open_allowed=False,
        )

    if marker == "expired":
        return RuntimeSafetyVerdict(
            state="expired",
            reason=(
                "Runtime safety verdict has expired after issuer and destination binding "
                "checks passed. Expired clearance is not live clearance."
            ),
            decision_state="blocked",
            open_allowed=False,
        )

    if marker in {"unavailable", "unknown"}:
        return RuntimeSafetyVerdict(
            state="unavailable",
            reason=(
                "Runtime safety provider was unavailable after issuer and destination "
                "binding checks passed."
            ),
            decision_state="verified_issuer_destination_risky",
            open_allowed=True,
        )

    if marker == "stale":
        return RuntimeSafetyVerdict(
            state="stale",
            reason=(
                "Runtime safety data is stale after issuer and destination binding checks passed."
            ),
            decision_state="verified_issuer_destination_risky",
            open_allowed=True,
        )

    return RuntimeSafetyVerdict(
        state="clean",
        reason="Runtime safety provider found no current block or warning condition.",
        decision_state="verified_issuer",
        open_allowed=True,
    )


def _first_marker(query: dict[str, list[str]]) -> str:
    for key in ("runtime", "risk", "safety"):
        values = query.get(key)
        if values and values[0]:
            return values[0].strip().lower()
    return ""
