from __future__ import annotations

from backend.app.services.signed_schema_poc import (
    SUPPORTED_ALGORITHM_ID,
    SignedSchemaError,
    build_demo_certificate,
    canonical_claims_sha256,
    create_signed_envelope,
    parse_claims_mapping,
    verify_signed_envelope,
)


def _build_claims():
    return parse_claims_mapping(
        {
            "version": "1",
            "usage_policy": "one_time",
            "certificate_ref": "cert:acme-demo:2026-01",
            "issued_at": "2026-01-01T00:00:00+00:00",
            "expires_at": "2026-01-01T00:05:00+00:00",
            "nonce": "nonce-001",
            "payload": "https://acme.example/pay",
        }
    )


def test_parse_claims_rejects_unknown_field() -> None:
    try:
        parse_claims_mapping(
            {
                "version": "1",
                "usage_policy": "one_time",
                "certificate_ref": "cert:acme-demo:2026-01",
                "issued_at": "2026-01-01T00:00:00+00:00",
                "expires_at": "2026-01-01T00:05:00+00:00",
                "nonce": "nonce-001",
                "payload": "https://acme.example/pay",
                "extra": "not-allowed",
            }
        )
    except SignedSchemaError as exc:
        assert "Unknown signed claim fields" in str(exc)
    else:
        raise AssertionError("Expected SignedSchemaError")


def test_parse_claims_rejects_unsupported_usage_policy() -> None:
    try:
        parse_claims_mapping(
            {
                "version": "1",
                "usage_policy": "printed_forever",
                "certificate_ref": "cert:acme-demo:2026-01",
                "issued_at": "2026-01-01T00:00:00+00:00",
                "expires_at": "2026-01-01T00:05:00+00:00",
                "nonce": "nonce-001",
                "payload": "https://acme.example/pay",
            }
        )
    except SignedSchemaError as exc:
        assert "usage_policy" in str(exc)
    else:
        raise AssertionError("Expected SignedSchemaError")


def test_canonical_claims_digest_is_stable() -> None:
    claims_a = _build_claims()
    claims_b = _build_claims()

    assert canonical_claims_sha256(claims_a) == canonical_claims_sha256(claims_b)


def test_verify_signed_envelope_accepts_matching_certificate() -> None:
    certificate, private_key_pem = build_demo_certificate(
        certificate_ref="cert:acme-demo:2026-01",
        algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    claims = _build_claims()
    envelope = create_signed_envelope(
        claims,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )

    decision = verify_signed_envelope(envelope, certificate)

    assert decision.allowed is True


def test_verify_signed_envelope_rejects_algorithm_conflict() -> None:
    certificate, private_key_pem = build_demo_certificate(
        certificate_ref="cert:acme-demo:2026-01",
        algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    claims = _build_claims()
    envelope = create_signed_envelope(
        claims,
        private_key_pem,
        code_algorithm_id="conflicting-algorithm",
    )

    decision = verify_signed_envelope(envelope, certificate)

    assert decision.allowed is False
    assert "algorithm hint conflicts" in decision.reason
