"""Narrowed verifier: composes the signed-schema PoC with the payload
revalidation PoC and an explicit validity-window check.

The verifier answers one question per presentation: is this signed artifact,
inside its own validity window, still consistent with the issuer's current
verified state? It keeps no per-presentation state; repeated presentations of
one envelope are evaluated identically.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

from backend.app.services.payload_revalidation_poc import (
    match_payload_to_verified_domains,
)
from backend.app.services.scanner_trust_store import (
    IssuerRecord,
    KeyEntry,
    evaluate_blocking_states,
    evaluate_time_windows,
)
from backend.app.services.signed_schema_poc import (
    CertificateAuthorityRecord,
    SignedQRCodeEnvelope,
    canonical_claims_sha256,
    verify_signed_envelope,
)


ACCEPTED_REASON = (
    "Signed schema verified, artifact is inside its validity window, "
    "and destination matches the issuer's current verified state"
)


@dataclass(frozen=True)
class TrustContext:
    """The trust-store view of one presentation.

    Deliberately carries no clock: `NarrowedVerifierService` owns `now_fn`, and
    a second time source here would eventually disagree with it.
    """

    key: KeyEntry
    issuer: IssuerRecord
    skew_seconds: int


@dataclass(frozen=True)
class NarrowedVerificationResult:
    allowed: bool
    stage: str
    reason: str
    canonical_claims_sha256: str | None = None
    matched_rule: str | None = None
    cause: str | None = None
    matched_domain: str | None = None


class NarrowedVerifierService:
    """
    Compose the narrowed verification pipeline into one service contract.
    """

    def __init__(self, *, now_fn: Callable[[], datetime] | None = None) -> None:
        self._now_fn = now_fn or (lambda: datetime.now(timezone.utc))

    async def verify_presented_code(
        self,
        envelope: SignedQRCodeEnvelope,
        certificate: CertificateAuthorityRecord,
        trust: TrustContext,
    ) -> NarrowedVerificationResult:
        """
        Verify a presented signed code against schema, the issuer record and
        signing key in force for it, and the issuer's current destination state.
        """
        claims_digest = canonical_claims_sha256(envelope.claims)
        now = self._now_fn()

        # 1. Blocking states (key or issuer revoked/suspended/etc.) take precedence
        blocking_result = evaluate_blocking_states(key=trust.key, issuer=trust.issuer)
        if blocking_result is not None:
            return NarrowedVerificationResult(
                allowed=False,
                stage=blocking_result.stage,
                reason=blocking_result.reason,
                canonical_claims_sha256=claims_digest,
                matched_rule=None,
                cause=blocking_result.cause,
            )

        # Unreachable once Task 16's projection excludes material-less
        # verifying keys, but the verifier fails closed regardless.
        if trust.key.public_key_pem is None:
            return NarrowedVerificationResult(
                allowed=False,
                stage="key_status",
                reason="Signing key has no public material available for verification",
                canonical_claims_sha256=claims_digest,
                matched_rule=None,
                cause="trust-state-unavailable",
            )

        # 3. Verify signed schema
        schema_decision = verify_signed_envelope(envelope, certificate)
        if not schema_decision.allowed:
            return NarrowedVerificationResult(
                allowed=False,
                stage="signed_schema",
                reason=schema_decision.reason,
                canonical_claims_sha256=claims_digest,
                matched_rule=None,
            )

        # 4. Time-window checks (key and artifact validity windows)
        time_result = evaluate_time_windows(
            now=now,
            claims=envelope.claims,
            key=trust.key,
            issuer=trust.issuer,
            skew_seconds=trust.skew_seconds,
        )
        if not time_result.allowed:
            return NarrowedVerificationResult(
                allowed=False,
                stage=time_result.stage,
                reason=time_result.reason,
                canonical_claims_sha256=claims_digest,
                matched_rule=None,
                cause=time_result.cause,
            )

        # 5. Payload revalidation against verified domains
        payload_decision = match_payload_to_verified_domains(
            envelope.claims.payload,
            trust.issuer.verified_domains,
            allow_subdomains=trust.issuer.allow_subdomains,
            now=now,
        )
        if not payload_decision.allowed:
            return NarrowedVerificationResult(
                allowed=False,
                stage="payload_revalidation",
                reason=payload_decision.reason,
                canonical_claims_sha256=claims_digest,
                matched_rule=payload_decision.matched_rule,
                cause=payload_decision.cause,
                matched_domain=payload_decision.matched_domain,
            )

        return NarrowedVerificationResult(
            allowed=True,
            stage="accepted",
            reason=ACCEPTED_REASON,
            canonical_claims_sha256=claims_digest,
            matched_rule=payload_decision.matched_rule,
            matched_domain=payload_decision.matched_domain,
        )
