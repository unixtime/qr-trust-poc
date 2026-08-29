from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

import pytest

from backend.app.services.signed_schema_poc import (
    CANONICAL_CLAIM_ORDER,
    SUPPORTED_ALGORITHM_ID,
    SUPPORTED_CLAIMS_VERSION,
    SignedSchemaError,
    build_demo_certificate,
    canonical_claims_sha256,
    canonicalize_claims,
    compute_envelope_id,
    create_signed_envelope,
    parse_claim_timestamp,
    parse_claims_mapping,
    verify_signed_envelope,
)


def _claims_mapping(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "version": "2",
        "certificate_ref": "cert:acme-demo:2026-01",
        "issued_at": "2026-08-26T10:00:00Z",
        "expires_at": "2026-08-26T10:05:00Z",
        "payload": "https://acme.example/pay",
    }
    base.update(overrides)
    return base


def _build_claims():
    return parse_claims_mapping(_claims_mapping())


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


def test_canonical_claim_order_is_the_five_paper_fields():
    assert CANONICAL_CLAIM_ORDER == (
        "version",
        "certificate_ref",
        "issued_at",
        "expires_at",
        "payload",
    )
    assert SUPPORTED_CLAIMS_VERSION == "2"


def test_parse_claims_mapping_accepts_version_2_five_fields():
    claims = parse_claims_mapping(_claims_mapping())
    assert claims.version == "2"
    assert claims.certificate_ref == "cert:acme-demo:2026-01"
    assert claims.payload == "https://acme.example/pay"
    assert not hasattr(claims, "nonce")
    assert not hasattr(claims, "usage_policy")


def test_parse_claims_mapping_rejects_version_1_before_anything_else():
    with pytest.raises(SignedSchemaError, match="Field 'version' must be exactly '2'"):
        parse_claims_mapping(_claims_mapping(version="1"))


def test_parse_claims_mapping_rejects_legacy_nonce_and_usage_policy_fields():
    with pytest.raises(SignedSchemaError, match="Unknown signed claim fields"):
        parse_claims_mapping(_claims_mapping(nonce="demo-nonce-api-001"))
    with pytest.raises(SignedSchemaError, match="Unknown signed claim fields"):
        parse_claims_mapping(_claims_mapping(usage_policy="reusable_public"))


def test_parse_claims_mapping_requires_expiry_after_issuance():
    with pytest.raises(SignedSchemaError, match="'expires_at' must be later than 'issued_at'"):
        parse_claims_mapping(_claims_mapping(expires_at="2026-08-26T10:00:00Z"))


def test_canonicalize_claims_has_no_nonce_or_usage_policy():
    claims = parse_claims_mapping(_claims_mapping())
    canonical = canonicalize_claims(claims)
    assert json.loads(canonical) == {
        "version": "2",
        "certificate_ref": "cert:acme-demo:2026-01",
        "issued_at": "2026-08-26T10:00:00Z",
        "expires_at": "2026-08-26T10:05:00Z",
        "payload": "https://acme.example/pay",
    }
    assert list(json.loads(canonical)) == list(CANONICAL_CLAIM_ORDER)


def test_compute_envelope_id_hashes_canonical_claims_and_signature():
    claims = parse_claims_mapping(_claims_mapping())
    signature = "c2lnbmF0dXJl"
    expected = hashlib.sha256(
        (canonicalize_claims(claims) + "." + signature).encode("utf-8")
    ).hexdigest()
    envelope_id = compute_envelope_id(claims, signature)
    assert envelope_id == expected
    assert len(envelope_id) == 64
    assert compute_envelope_id(claims, "other") != envelope_id


def test_parse_claims_mapping_rejects_version_1_carrying_legacy_fields():
    """A real legacy envelope carries the removed fields alongside version 1.

    The version check has to run before the unknown-field check, or a genuine
    v1 envelope is reported as "unknown signed claim fields" -- an answer that
    hides the one thing the scanner needs to say about it.
    """
    legacy = _claims_mapping(
        version="1",
        nonce="legacy-001",
        usage_policy="reusable_public",
    )
    with pytest.raises(SignedSchemaError, match="Field 'version' must be exactly"):
        parse_claims_mapping(legacy)


def test_parse_claims_mapping_accepts_null_expires_at():
    claims = parse_claims_mapping(_claims_mapping(expires_at=None))

    assert claims.expires_at is None


def test_canonicalize_claims_emits_null_in_position_for_open_ended_expiry():
    claims = parse_claims_mapping(_claims_mapping(expires_at=None))

    canonical = canonicalize_claims(claims)

    assert canonical == (
        '{"version":"2",'
        '"certificate_ref":"cert:acme-demo:2026-01",'
        '"issued_at":"2026-08-26T10:00:00Z",'
        '"expires_at":null,'
        '"payload":"https://acme.example/pay"}'
    )


def test_null_expiry_envelope_round_trips_through_signature_verification():
    certificate, private_key_pem = build_demo_certificate()
    claims = parse_claims_mapping(_claims_mapping(expires_at=None))

    envelope = create_signed_envelope(claims, private_key_pem)
    decision = verify_signed_envelope(envelope, certificate)

    assert decision.allowed is True


def test_expires_at_key_is_still_required_even_though_it_may_be_null():
    mapping = _claims_mapping()
    del mapping["expires_at"]

    with pytest.raises(SignedSchemaError, match="Missing required signed claim fields"):
        parse_claims_mapping(mapping)


def test_non_null_expires_at_still_must_be_later_than_issued_at():
    with pytest.raises(
        SignedSchemaError, match="'expires_at' must be later than 'issued_at'"
    ):
        parse_claims_mapping(_claims_mapping(expires_at="2026-08-26T09:59:00Z"))


def test_parse_claim_timestamp_rejects_a_non_string_value():
    with pytest.raises(SignedSchemaError, match="'issued_at' must be an ISO-8601 timestamp"):
        parse_claim_timestamp("issued_at", 1756202400)


def test_parse_claim_timestamp_rejects_a_naive_timestamp():
    with pytest.raises(SignedSchemaError, match="'issued_at' must include timezone"):
        parse_claim_timestamp("issued_at", "2026-08-26T10:00:00")


def test_parse_claim_timestamp_normalizes_a_trailing_z():
    parsed = parse_claim_timestamp("issued_at", "2026-08-26T10:00:00Z")

    assert parsed == datetime(2026, 8, 26, 10, 0, 0, tzinfo=timezone.utc)
