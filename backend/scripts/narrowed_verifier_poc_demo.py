"""
Demonstrate the integrated narrowed verifier pipeline.

The verifier keeps no per-presentation state: it checks the signed schema,
certificate status, validity window, and destination revalidation on every
presentation, so a repeated presentation of the same signed artifact is
evaluated identically each time.

Usage:
    ./.venv/bin/python scripts/narrowed_verifier_poc_demo.py
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import logging
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.services.narrowed_verifier_poc import (  # noqa: E402
    IssuerVerificationState,
    NarrowedVerifierService,
)
from backend.app.services.signed_schema_poc import (  # noqa: E402
    SUPPORTED_ALGORITHM_ID,
    SignedQRCodeClaims,
    build_demo_certificate,
    create_signed_envelope,
)


def make_claims(
    payload: str = "https://acme.example/pay",
    *,
    issued_offset_minutes: int = -1,
    expires_offset_minutes: int = 5,
) -> SignedQRCodeClaims:
    now = datetime.now(timezone.utc)
    return SignedQRCodeClaims(
        version="2",
        certificate_ref="cert:acme-demo:2026-01",
        issued_at=(now + timedelta(minutes=issued_offset_minutes)).isoformat(),
        expires_at=(now + timedelta(minutes=expires_offset_minutes)).isoformat(),
        payload=payload,
    )


async def main() -> None:
    logging.getLogger("qrcode_api").setLevel(logging.ERROR)

    certificate, private_key_pem = build_demo_certificate(
        certificate_ref="cert:acme-demo:2026-01",
        algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    verifier = NarrowedVerifierService()
    issuer_state_valid = IssuerVerificationState(verified_domains=["acme.example"])

    # Case 1: a valid envelope is accepted, and accepted again on a repeated
    # presentation — there is no per-presentation state to consume or block on.
    claims_valid = make_claims()
    envelope_valid = create_signed_envelope(
        claims_valid,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    first_scan = await verifier.verify_presented_code(
        envelope_valid,
        certificate,
        issuer_state_valid,
    )
    second_scan = await verifier.verify_presented_code(
        envelope_valid,
        certificate,
        issuer_state_valid,
    )

    # Case 2: expired credential is blocked at the time_window stage.
    claims_expired = make_claims(
        issued_offset_minutes=-10,
        expires_offset_minutes=-1,
    )
    envelope_expired = create_signed_envelope(
        claims_expired,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    expired_result = await verifier.verify_presented_code(
        envelope_expired,
        certificate,
        issuer_state_valid,
    )

    # Case 3: not-yet-valid credential is blocked at the time_window stage.
    claims_not_yet_valid = make_claims(
        issued_offset_minutes=1,
        expires_offset_minutes=6,
    )
    envelope_not_yet_valid = create_signed_envelope(
        claims_not_yet_valid,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    not_yet_valid_result = await verifier.verify_presented_code(
        envelope_not_yet_valid,
        certificate,
        issuer_state_valid,
    )

    # Case 4: revoked certificate is blocked at the certificate_status stage.
    claims_revoked = make_claims()
    envelope_revoked = create_signed_envelope(
        claims_revoked,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    issuer_state_revoked = IssuerVerificationState(
        verified_domains=["acme.example"],
        certificate_revoked=True,
        certificate_revocation_reason="Issuer revoked credential after merchant offboarding",
    )
    revoked_result = await verifier.verify_presented_code(
        envelope_revoked,
        certificate,
        issuer_state_revoked,
    )

    # Case 5: destination mismatch is blocked at the payload_revalidation stage.
    claims_mismatch = make_claims(payload="https://evil.example/pay")
    envelope_mismatch = create_signed_envelope(
        claims_mismatch,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    mismatch_result = await verifier.verify_presented_code(
        envelope_mismatch,
        certificate,
        issuer_state_valid,
    )

    print("Narrowed Verifier PoC")
    print("=====================")
    print(f"First valid scan: {'ALLOW' if first_scan.allowed else 'BLOCK'}")
    print(f"  stage: {first_scan.stage}")
    print(f"  reason: {first_scan.reason}")

    print(
        "Repeated presentation of the same code:"
        f" {'ALLOW' if second_scan.allowed else 'BLOCK'}"
    )
    print(f"  stage: {second_scan.stage}")
    print(f"  reason: {second_scan.reason}")
    print(
        "  no per-presentation state:"
        f" {'PASS' if first_scan.stage == second_scan.stage else 'FAIL'}"
    )

    print(f"Expired credential: {'ALLOW' if expired_result.allowed else 'BLOCK'}")
    print(f"  stage: {expired_result.stage}")
    print(f"  reason: {expired_result.reason}")

    print(f"Not-yet-valid credential: {'ALLOW' if not_yet_valid_result.allowed else 'BLOCK'}")
    print(f"  stage: {not_yet_valid_result.stage}")
    print(f"  reason: {not_yet_valid_result.reason}")

    print(f"Revoked certificate: {'ALLOW' if revoked_result.allowed else 'BLOCK'}")
    print(f"  stage: {revoked_result.stage}")
    print(f"  reason: {revoked_result.reason}")

    print(f"Destination mismatch: {'ALLOW' if mismatch_result.allowed else 'BLOCK'}")
    print(f"  stage: {mismatch_result.stage}")
    print(f"  reason: {mismatch_result.reason}")


if __name__ == "__main__":
    asyncio.run(main())
