from datetime import datetime, timedelta, timezone

import pytest

from backend.app.services import narrowed_verifier_poc as narrowed_verifier_module
from backend.app.services.narrowed_verifier_poc import (
    ACCEPTED_REASON,
    NarrowedVerifierService,
    TrustContext,
)
from backend.app.services.payload_revalidation_poc import MatchDecision
from backend.app.services.scanner_trust_store import IssuerRecord, KeyEntry
from backend.app.services.signed_schema_poc import (
    SignedQRCodeClaims,
    build_demo_certificate,
    create_signed_envelope,
)


TRUST_NOW = datetime(2026, 3, 1, 12, 0, 0, tzinfo=timezone.utc)


def _trust_issuer(**overrides) -> IssuerRecord:
    base = {
        "issuer_id": "acme-demo",
        "issuer_name": "Acme Demo Issuer",
        "root_id": "root:qrtrust-demo",
        "status": "active",
        "issued_at": TRUST_NOW - timedelta(days=30),
        "expires_at": TRUST_NOW + timedelta(days=30),
        "verified_domains": {"acme.example": None},
        "allow_subdomains": False,
    }
    base.update(overrides)
    return IssuerRecord(**base)


def _trust_key(certificate_ref: str, **overrides) -> KeyEntry:
    base = {
        "key_ref": certificate_ref,
        "issuer_id": "acme-demo",
        "algorithm_id": "rsa-pss-sha256-v1",
        "public_key_pem": "-----BEGIN PUBLIC KEY-----\nstub\n-----END PUBLIC KEY-----\n",
        "state": "active",
        "not_before": TRUST_NOW - timedelta(days=10),
        "not_after": TRUST_NOW + timedelta(days=10),
    }
    base.update(overrides)
    return KeyEntry(**base)


def _trust_context(certificate_ref: str, *, issuer=None, key=None) -> TrustContext:
    return TrustContext(
        key=key or _trust_key(certificate_ref),
        issuer=issuer or _trust_issuer(),
        skew_seconds=300,
    )


@pytest.mark.asyncio
async def test_service_accepts_an_artifact_inside_every_window():
    certificate, private_key_pem = build_demo_certificate()
    claims = SignedQRCodeClaims(
        version="2",
        certificate_ref=certificate.certificate_ref,
        issued_at="2026-03-01T11:55:00Z",
        expires_at="2026-03-01T12:05:00Z",
        payload="https://acme.example/pay",
    )
    envelope = create_signed_envelope(claims, private_key_pem)
    service = NarrowedVerifierService(now_fn=lambda: TRUST_NOW)

    result = await service.verify_presented_code(
        envelope, certificate, _trust_context(certificate.certificate_ref)
    )

    assert result.allowed is True
    assert result.stage == "accepted"
    assert result.cause is None
    assert result.reason == ACCEPTED_REASON
    assert result.matched_domain == "acme.example"


@pytest.mark.asyncio
async def test_service_reports_the_key_revoked_cause_from_the_rule_function():
    certificate, private_key_pem = build_demo_certificate()
    claims = SignedQRCodeClaims(
        version="2",
        certificate_ref=certificate.certificate_ref,
        issued_at="2026-03-01T11:55:00Z",
        expires_at="2026-03-01T12:05:00Z",
        payload="https://acme.example/pay",
    )
    envelope = create_signed_envelope(claims, private_key_pem)
    service = NarrowedVerifierService(now_fn=lambda: TRUST_NOW)
    trust = _trust_context(
        certificate.certificate_ref,
        key=_trust_key(certificate.certificate_ref, state="revoked"),
    )

    result = await service.verify_presented_code(envelope, certificate, trust)

    assert result.allowed is False
    assert result.stage == "key_status"
    assert result.cause == "key-revoked"
    assert result.canonical_claims_sha256 is not None


@pytest.mark.asyncio
async def test_service_accepts_an_artifact_signed_before_the_key_retired():
    """A retired key still verifies what it legitimately signed."""
    certificate, private_key_pem = build_demo_certificate()
    claims = SignedQRCodeClaims(
        version="2",
        certificate_ref=certificate.certificate_ref,
        issued_at="2026-02-28T12:00:00Z",
        expires_at=None,
        payload="https://acme.example/pay",
    )
    envelope = create_signed_envelope(claims, private_key_pem)
    service = NarrowedVerifierService(now_fn=lambda: TRUST_NOW)
    trust = _trust_context(
        certificate.certificate_ref,
        key=_trust_key(
            certificate.certificate_ref,
            state="retired",
            not_after=TRUST_NOW - timedelta(hours=1),
        ),
    )

    result = await service.verify_presented_code(envelope, certificate, trust)

    assert result.allowed is True
    assert result.stage == "accepted"


@pytest.mark.asyncio
async def test_service_blocks_an_artifact_signed_after_the_key_retired():
    certificate, private_key_pem = build_demo_certificate()
    claims = SignedQRCodeClaims(
        version="2",
        certificate_ref=certificate.certificate_ref,
        issued_at="2026-03-01T11:59:00Z",
        expires_at=None,
        payload="https://acme.example/pay",
    )
    envelope = create_signed_envelope(claims, private_key_pem)
    service = NarrowedVerifierService(now_fn=lambda: TRUST_NOW)
    trust = _trust_context(
        certificate.certificate_ref,
        key=_trust_key(
            certificate.certificate_ref,
            state="retired",
            not_after=TRUST_NOW - timedelta(hours=1),
        ),
    )

    result = await service.verify_presented_code(envelope, certificate, trust)

    assert result.allowed is False
    assert result.stage == "key_status"
    assert result.cause == "key-window-mismatch"


@pytest.mark.asyncio
async def test_retired_key_can_self_backdate_a_new_artifact_until_revoked():
    """No independent witness lets the verifier distinguish claimed from real time."""
    certificate, private_key_pem = build_demo_certificate()
    retired_at = TRUST_NOW - timedelta(hours=1)
    actual_signing_time = TRUST_NOW
    self_asserted_issued_at = retired_at - timedelta(days=1)
    claims = SignedQRCodeClaims(
        version="2",
        certificate_ref=certificate.certificate_ref,
        issued_at=self_asserted_issued_at.isoformat(),
        expires_at=(TRUST_NOW + timedelta(days=1)).isoformat(),
        payload="https://acme.example/pay",
    )

    # Envelope creation occurs after the modeled retirement event, but the
    # signed claims contain only the signer's earlier, self-asserted time.
    assert actual_signing_time > retired_at > self_asserted_issued_at
    envelope = create_signed_envelope(claims, private_key_pem)
    service = NarrowedVerifierService(now_fn=lambda: TRUST_NOW)
    retired_key = _trust_key(
        certificate.certificate_ref,
        state="retired",
        not_before=self_asserted_issued_at - timedelta(days=1),
        not_after=retired_at,
    )

    accepted = await service.verify_presented_code(
        envelope,
        certificate,
        _trust_context(certificate.certificate_ref, key=retired_key),
    )
    revoked = await service.verify_presented_code(
        envelope,
        certificate,
        _trust_context(
            certificate.certificate_ref,
            key=_trust_key(
                certificate.certificate_ref,
                state="revoked",
                not_before=retired_key.not_before,
                not_after=retired_key.not_after,
            ),
        ),
    )

    assert accepted.allowed is True
    assert accepted.stage == "accepted"
    assert revoked.allowed is False
    assert revoked.stage == "key_status"
    assert revoked.cause == "key-revoked"


@pytest.mark.asyncio
async def test_service_never_expires_an_open_ended_artifact():
    certificate, private_key_pem = build_demo_certificate()
    claims = SignedQRCodeClaims(
        version="2",
        certificate_ref=certificate.certificate_ref,
        issued_at="2026-02-20T12:00:00Z",
        expires_at=None,
        payload="https://acme.example/pay",
    )
    envelope = create_signed_envelope(claims, private_key_pem)
    service = NarrowedVerifierService(now_fn=lambda: TRUST_NOW)

    result = await service.verify_presented_code(
        envelope, certificate, _trust_context(certificate.certificate_ref)
    )

    assert result.allowed is True


@pytest.mark.asyncio
async def test_service_still_blocks_a_destination_outside_the_verified_domains():
    certificate, private_key_pem = build_demo_certificate()
    claims = SignedQRCodeClaims(
        version="2",
        certificate_ref=certificate.certificate_ref,
        issued_at="2026-03-01T11:55:00Z",
        expires_at="2026-03-01T12:05:00Z",
        payload="https://evil.example/pay",
    )
    envelope = create_signed_envelope(claims, private_key_pem)
    service = NarrowedVerifierService(now_fn=lambda: TRUST_NOW)

    result = await service.verify_presented_code(
        envelope, certificate, _trust_context(certificate.certificate_ref)
    )

    assert result.allowed is False
    assert result.stage == "payload_revalidation"
    assert result.cause is None


@pytest.mark.asyncio
async def test_service_forwards_matched_domain_on_destination_deny(monkeypatch):
    certificate, private_key_pem = build_demo_certificate()
    claims = SignedQRCodeClaims(
        version="2",
        certificate_ref=certificate.certificate_ref,
        issued_at="2026-03-01T11:55:00Z",
        expires_at="2026-03-01T12:05:00Z",
        payload="https://acme.example/pay",
    )
    envelope = create_signed_envelope(claims, private_key_pem)
    service = NarrowedVerifierService(now_fn=lambda: TRUST_NOW)

    monkeypatch.setattr(
        narrowed_verifier_module,
        "match_payload_to_verified_domains",
        lambda *_args, **_kwargs: MatchDecision(
            allowed=False,
            matched_rule=None,
            reason="matched proof is expired",
            cause="destination-not-authorized",
            matched_domain="acme.example",
        ),
    )

    result = await service.verify_presented_code(
        envelope,
        certificate,
        _trust_context(certificate.certificate_ref),
    )

    assert result.allowed is False
    assert result.stage == "payload_revalidation"
    assert result.cause == "destination-not-authorized"
    assert result.matched_domain == "acme.example"


@pytest.mark.asyncio
async def test_blocking_states_precede_signature_check_on_revoked_key_with_no_material():
    """When a key is revoked with no stored material, report key-revoked, not signature failure."""
    certificate, private_key_pem = build_demo_certificate()
    claims = SignedQRCodeClaims(
        version="2",
        certificate_ref=certificate.certificate_ref,
        issued_at="2026-03-01T11:55:00Z",
        expires_at="2026-03-01T12:05:00Z",
        payload="https://acme.example/pay",
    )
    envelope = create_signed_envelope(claims, private_key_pem)
    service = NarrowedVerifierService(now_fn=lambda: TRUST_NOW)
    trust = _trust_context(
        certificate.certificate_ref,
        key=_trust_key(certificate.certificate_ref, state="revoked", public_key_pem=None),
    )

    result = await service.verify_presented_code(envelope, certificate, trust)

    assert result.allowed is False
    assert result.cause == "key-revoked"
    assert "signature" not in result.reason.lower()


@pytest.mark.asyncio
async def test_material_check_fails_closed_for_active_key_with_no_material():
    """When an active key has no stored material, fail closed with trust-state-unavailable."""
    from backend.app.services.signed_schema_poc import CertificateAuthorityRecord

    certificate, private_key_pem = build_demo_certificate()
    claims = SignedQRCodeClaims(
        version="2",
        certificate_ref=certificate.certificate_ref,
        issued_at="2026-03-01T11:55:00Z",
        expires_at="2026-03-01T12:05:00Z",
        payload="https://acme.example/pay",
    )
    envelope = create_signed_envelope(claims, private_key_pem)
    service = NarrowedVerifierService(now_fn=lambda: TRUST_NOW)
    # Create certificate record with None material
    cert_with_no_material = CertificateAuthorityRecord(
        certificate_ref=certificate.certificate_ref,
        issuer_name=certificate.issuer_name,
        algorithm_id=certificate.algorithm_id,
        public_key_pem=None,
    )
    trust = _trust_context(
        certificate.certificate_ref,
        key=_trust_key(certificate.certificate_ref, state="active", public_key_pem=None),
    )

    result = await service.verify_presented_code(envelope, cert_with_no_material, trust)

    assert result.allowed is False
    assert result.cause == "trust-state-unavailable"
    assert result.stage == "key_status"
    assert result.reason == "Signing key has no public material available for verification"
