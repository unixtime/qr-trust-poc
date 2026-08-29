"""
Demonstrate canonical signed-schema behavior.

Usage:
    ./.venv/bin/python scripts/signed_schema_poc_demo.py
"""

from __future__ import annotations

from dataclasses import replace
import logging
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.services.signed_schema_poc import (  # noqa: E402
    SUPPORTED_ALGORITHM_ID,
    SignedQRCodeEnvelope,
    SignedSchemaError,
    build_demo_certificate,
    canonical_claims_sha256,
    canonicalize_claims,
    create_signed_envelope,
    parse_claims_mapping,
    verify_signed_envelope,
)


def main() -> None:
    logging.getLogger("qrcode_api").setLevel(logging.ERROR)

    certificate, private_key_pem = build_demo_certificate()

    claims_mapping_a = {
        "version": "2",
        "certificate_ref": certificate.certificate_ref,
        "issued_at": "2026-04-11T09:00:00+00:00",
        "expires_at": "2026-04-11T09:05:00+00:00",
        "payload": "https://acme.example/pay",
    }
    claims_mapping_b = {
        "payload": "https://acme.example/pay",
        "expires_at": "2026-04-11T09:05:00+00:00",
        "issued_at": "2026-04-11T09:00:00+00:00",
        "certificate_ref": certificate.certificate_ref,
        "version": "2",
    }

    claims_a = parse_claims_mapping(claims_mapping_a)
    claims_b = parse_claims_mapping(claims_mapping_b)

    canonical_a = canonicalize_claims(claims_a)
    canonical_b = canonicalize_claims(claims_b)
    digest_a = canonical_claims_sha256(claims_a)
    digest_b = canonical_claims_sha256(claims_b)

    print("Signed Schema PoC")
    print("=================")
    print("Canonical serialization is deterministic:",
          "PASS" if canonical_a == canonical_b else "FAIL")
    print(f"  canonical_sha256_a: {digest_a}")
    print(f"  canonical_sha256_b: {digest_b}")

    envelope = create_signed_envelope(
        claims_a,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    valid_decision = verify_signed_envelope(envelope, certificate)
    print("Valid envelope verification:",
          "PASS" if valid_decision.allowed else "FAIL")
    print(f"  reason: {valid_decision.reason}")

    tampered_claims = replace(claims_a, payload="https://evil.example/pay")
    tampered_envelope = SignedQRCodeEnvelope(
        claims=tampered_claims,
        signature=envelope.signature,
        code_algorithm_id=envelope.code_algorithm_id,
    )
    tampered_decision = verify_signed_envelope(tampered_envelope, certificate)
    print("Tampered signed field is rejected:",
          "PASS" if not tampered_decision.allowed else "FAIL")
    print(f"  reason: {tampered_decision.reason}")

    conflicting_hint_envelope = SignedQRCodeEnvelope(
        claims=claims_a,
        signature=envelope.signature,
        code_algorithm_id="rsa-pss-sha512-v1",
    )
    conflict_decision = verify_signed_envelope(conflicting_hint_envelope, certificate)
    print("Conflicting algorithm metadata is rejected:",
          "PASS" if not conflict_decision.allowed else "FAIL")
    print(f"  reason: {conflict_decision.reason}")

    try:
        parse_claims_mapping(
            {
                "version": "2",
                "certificate_ref": certificate.certificate_ref,
                "issued_at": "2026-04-11T09:00:00+00:00",
                "expires_at": "2026-04-11T09:05:00+00:00",
            }
        )
    except SignedSchemaError as exc:
        print("Missing required field is rejected: PASS")
        print(f"  reason: {exc}")
    else:
        print("Missing required field is rejected: FAIL")

    try:
        parse_claims_mapping(
            {
                "version": "2",
                "certificate_ref": certificate.certificate_ref,
                "issued_at": "2026-04-11T09:00:00+00:00",
                "expires_at": "2026-04-11T09:05:00+00:00",
                "payload": "https://acme.example/pay",
                "algorithm_id": "rsa-pss-sha512-v1",
            }
        )
    except SignedSchemaError as exc:
        print("Unknown signed field is rejected: PASS")
        print(f"  reason: {exc}")
    else:
        print("Unknown signed field is rejected: FAIL")


if __name__ == "__main__":
    main()
