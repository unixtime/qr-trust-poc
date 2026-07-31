"""
Integrated PoC for the narrowed verifier pipeline.

This service composes the three mechanism-level PoCs used by the public
reference flow:

- canonical signed-schema verification
- atomic replay reservation / finalize / release
- verification-time destination revalidation against issuer state
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

from backend.app.services.payload_revalidation_poc import (
    match_payload_to_verified_domains,
)
from backend.app.services.replay_guard_poc import InMemoryReplayGuard
from backend.app.services.signed_schema_poc import (
    CertificateAuthorityRecord,
    SignedQRCodeEnvelope,
    USAGE_POLICY_ONE_TIME,
    USAGE_POLICY_REUSABLE_PUBLIC,
    USAGE_POLICY_TIME_LIMITED,
    canonical_claims_sha256,
    verify_signed_envelope,
)


@dataclass(frozen=True)
class IssuerVerificationState:
    verified_domains: list[str]
    allow_subdomains: bool = False
    certificate_active: bool = True
    certificate_revoked: bool = False
    certificate_revocation_reason: str | None = None


@dataclass(frozen=True)
class NarrowedVerificationResult:
    allowed: bool
    stage: str
    reason: str
    usage_policy: str
    canonical_claims_sha256: str | None
    matched_rule: str | None
    reservation_state: str | None


class NarrowedVerifierService:
    """
    Compose the narrowed verification pipeline into one service contract.
    """

    def __init__(
        self,
        replay_guard: InMemoryReplayGuard,
        *,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        self._replay_guard = replay_guard
        self._now_fn = now_fn or (lambda: datetime.now(timezone.utc))

    def _parse_claim_timestamp(self, value: str) -> datetime:
        normalized = value.strip()
        if normalized.endswith("Z"):
            normalized = normalized[:-1] + "+00:00"
        return datetime.fromisoformat(normalized)

    def _accepted_reason(self, usage_policy: str) -> str:
        if usage_policy == USAGE_POLICY_ONE_TIME:
            return (
                "Signed schema verified, nonce consumed, and destination "
                "matches the issuer's current verified state"
            )
        if usage_policy == USAGE_POLICY_TIME_LIMITED:
            return (
                "Signed schema verified, QR is inside its validity window, "
                "and destination matches the issuer's current verified state"
            )
        return (
            "Signed schema verified, reusable public QR remains issuer-approved, "
            "and destination matches the issuer's current verified state"
        )

    async def verify_presented_code(
        self,
        envelope: SignedQRCodeEnvelope,
        certificate: CertificateAuthorityRecord,
        issuer_state: IssuerVerificationState,
        *,
        reservation_ttl_seconds: int = 5,
        consumed_ttl_seconds: int = 60,
    ) -> NarrowedVerificationResult:
        """
        Verify a presented signed code against schema, replay rules, and the
        issuer's current destination state.
        """
        claims_digest = canonical_claims_sha256(envelope.claims)
        usage_policy = envelope.claims.usage_policy
        now = self._now_fn()

        schema_decision = verify_signed_envelope(envelope, certificate)
        if not schema_decision.allowed:
            return NarrowedVerificationResult(
                allowed=False,
                stage="signed_schema",
                reason=schema_decision.reason,
                usage_policy=usage_policy,
                canonical_claims_sha256=claims_digest,
                matched_rule=None,
                reservation_state=None,
            )

        if issuer_state.certificate_revoked:
            reason = "Certificate is revoked"
            revocation_reason = (
                issuer_state.certificate_revocation_reason.strip()
                if issuer_state.certificate_revocation_reason
                else ""
            )
            if revocation_reason:
                reason = (
                    f"{reason}: {revocation_reason}"
                )
            return NarrowedVerificationResult(
                allowed=False,
                stage="certificate_status",
                reason=reason,
                usage_policy=usage_policy,
                canonical_claims_sha256=claims_digest,
                matched_rule=None,
                reservation_state=None,
            )

        if not issuer_state.certificate_active:
            return NarrowedVerificationResult(
                allowed=False,
                stage="certificate_status",
                reason="Certificate is not currently active for verification",
                usage_policy=usage_policy,
                canonical_claims_sha256=claims_digest,
                matched_rule=None,
                reservation_state=None,
            )

        issued_at = self._parse_claim_timestamp(envelope.claims.issued_at)
        expires_at = self._parse_claim_timestamp(envelope.claims.expires_at)
        if now < issued_at:
            return NarrowedVerificationResult(
                allowed=False,
                stage="time_window",
                reason="Credential is not yet valid",
                usage_policy=usage_policy,
                canonical_claims_sha256=claims_digest,
                matched_rule=None,
                reservation_state=None,
            )
        if now >= expires_at:
            return NarrowedVerificationResult(
                allowed=False,
                stage="time_window",
                reason="Credential has expired",
                usage_policy=usage_policy,
                canonical_claims_sha256=claims_digest,
                matched_rule=None,
                reservation_state=None,
            )

        if usage_policy in {
            USAGE_POLICY_REUSABLE_PUBLIC,
            USAGE_POLICY_TIME_LIMITED,
        }:
            payload_decision = match_payload_to_verified_domains(
                envelope.claims.payload,
                issuer_state.verified_domains,
                allow_subdomains=issuer_state.allow_subdomains,
            )
            if not payload_decision.allowed:
                return NarrowedVerificationResult(
                    allowed=False,
                    stage="payload_revalidation",
                    reason=payload_decision.reason,
                    usage_policy=usage_policy,
                    canonical_claims_sha256=claims_digest,
                    matched_rule=payload_decision.matched_rule,
                    reservation_state="not_required",
                )

            return NarrowedVerificationResult(
                allowed=True,
                stage="accepted",
                reason=self._accepted_reason(usage_policy),
                usage_policy=usage_policy,
                canonical_claims_sha256=claims_digest,
                matched_rule=payload_decision.matched_rule,
                reservation_state="not_required",
            )

        owner_token = await self._replay_guard.try_reserve(
            envelope.claims.nonce,
            reservation_ttl_seconds=reservation_ttl_seconds,
        )
        if not owner_token:
            return NarrowedVerificationResult(
                allowed=False,
                stage="replay_guard",
                reason="Nonce is already reserved or consumed",
                usage_policy=usage_policy,
                canonical_claims_sha256=claims_digest,
                matched_rule=None,
                reservation_state="blocked",
            )

        payload_decision = match_payload_to_verified_domains(
            envelope.claims.payload,
            issuer_state.verified_domains,
            allow_subdomains=issuer_state.allow_subdomains,
        )
        if not payload_decision.allowed:
            released = await self._replay_guard.release(envelope.claims.nonce, owner_token)
            return NarrowedVerificationResult(
                allowed=False,
                stage="payload_revalidation",
                reason=payload_decision.reason,
                usage_policy=usage_policy,
                canonical_claims_sha256=claims_digest,
                matched_rule=payload_decision.matched_rule,
                reservation_state="released" if released else "release_failed",
            )

        finalized = await self._replay_guard.finalize(
            envelope.claims.nonce,
            owner_token,
            consumed_ttl_seconds=consumed_ttl_seconds,
        )
        if not finalized:
            return NarrowedVerificationResult(
                allowed=False,
                stage="replay_guard",
                reason="Reservation could not be finalized",
                usage_policy=usage_policy,
                canonical_claims_sha256=claims_digest,
                matched_rule=payload_decision.matched_rule,
                reservation_state="finalize_failed",
            )

        return NarrowedVerificationResult(
            allowed=True,
            stage="accepted",
            reason=self._accepted_reason(usage_policy),
            usage_policy=usage_policy,
            canonical_claims_sha256=claims_digest,
            matched_rule=payload_decision.matched_rule,
            reservation_state="consumed",
        )
