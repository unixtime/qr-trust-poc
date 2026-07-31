"""
Demonstrate the integrated narrowed verifier pipeline.

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
from backend.app.services.replay_guard_poc import InMemoryReplayGuard  # noqa: E402
from backend.app.services.signed_schema_poc import (  # noqa: E402
    SUPPORTED_ALGORITHM_ID,
    SignedQRCodeClaims,
    build_demo_certificate,
    create_signed_envelope,
)


class FinalizeFailingReplayGuard(InMemoryReplayGuard):
    async def finalize(
        self,
        nonce: str,
        owner_token: str,
        consumed_ttl_seconds: int,
    ) -> bool:
        return False


class ReleaseFailingReplayGuard(InMemoryReplayGuard):
    async def release(self, nonce: str, owner_token: str) -> bool:
        return False


def make_claims(
    nonce: str,
    payload: str = "https://acme.example/pay",
    *,
    usage_policy: str = "one_time",
    issued_offset_minutes: int = -1,
    expires_offset_minutes: int = 5,
) -> SignedQRCodeClaims:
    now = datetime.now(timezone.utc)
    return SignedQRCodeClaims(
        version="1",
        usage_policy=usage_policy,
        certificate_ref="cert:acme-demo:2026-01",
        issued_at=(now + timedelta(minutes=issued_offset_minutes)).isoformat(),
        expires_at=(now + timedelta(minutes=expires_offset_minutes)).isoformat(),
        nonce=nonce,
        payload=payload,
    )


async def run_concurrent_worker(
    verifier: NarrowedVerifierService,
    envelope,
    certificate,
    issuer_state,
    start: asyncio.Event,
):
    await start.wait()
    return await verifier.verify_presented_code(envelope, certificate, issuer_state)


async def main() -> None:
    logging.getLogger("qrcode_api").setLevel(logging.ERROR)

    certificate, private_key_pem = build_demo_certificate(
        certificate_ref="cert:acme-demo:2026-01",
        algorithm_id=SUPPORTED_ALGORITHM_ID,
    )

    # Case 1: valid first scan, then replay block on second attempt.
    guard_a = InMemoryReplayGuard()
    verifier_a = NarrowedVerifierService(guard_a)
    issuer_state_valid = IssuerVerificationState(verified_domains=["acme.example"])
    claims_a = make_claims("demo-nonce-101")
    envelope_a = create_signed_envelope(
        claims_a,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )

    first_scan = await verifier_a.verify_presented_code(
        envelope_a,
        certificate,
        issuer_state_valid,
    )
    second_scan = await verifier_a.verify_presented_code(
        envelope_a,
        certificate,
        issuer_state_valid,
    )

    # Case 2: issuer-state mismatch releases reservation, then later retry succeeds.
    guard_b = InMemoryReplayGuard()
    verifier_b = NarrowedVerifierService(guard_b)
    claims_b = make_claims("demo-nonce-202")
    envelope_b = create_signed_envelope(
        claims_b,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    issuer_state_missing_domain = IssuerVerificationState(verified_domains=[])
    issuer_state_restored = IssuerVerificationState(verified_domains=["acme.example"])

    failed_then_released = await verifier_b.verify_presented_code(
        envelope_b,
        certificate,
        issuer_state_missing_domain,
    )
    retry_after_release = await verifier_b.verify_presented_code(
        envelope_b,
        certificate,
        issuer_state_restored,
    )

    # Case 3: expired credential is blocked before nonce reservation.
    guard_expired = InMemoryReplayGuard()
    verifier_expired = NarrowedVerifierService(guard_expired)
    claims_expired = make_claims(
        "demo-nonce-expired",
        issued_offset_minutes=-10,
        expires_offset_minutes=-1,
    )
    envelope_expired = create_signed_envelope(
        claims_expired,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    expired_result = await verifier_expired.verify_presented_code(
        envelope_expired,
        certificate,
        issuer_state_valid,
    )

    # Case 4: revoked certificate is blocked before nonce reservation.
    guard_revoked = InMemoryReplayGuard()
    verifier_revoked = NarrowedVerifierService(guard_revoked)
    claims_revoked = make_claims("demo-nonce-revoked")
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
    revoked_result = await verifier_revoked.verify_presented_code(
        envelope_revoked,
        certificate,
        issuer_state_revoked,
    )

    # Case 5: release failure is surfaced when payload revalidation fails.
    guard_release_fail = ReleaseFailingReplayGuard()
    verifier_release_fail = NarrowedVerifierService(guard_release_fail)
    claims_release_fail = make_claims("demo-nonce-release-fail")
    envelope_release_fail = create_signed_envelope(
        claims_release_fail,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    release_failed_result = await verifier_release_fail.verify_presented_code(
        envelope_release_fail,
        certificate,
        issuer_state_missing_domain,
    )

    # Case 6: finalize failure is surfaced when consume cannot complete.
    guard_finalize_fail = FinalizeFailingReplayGuard()
    verifier_finalize_fail = NarrowedVerifierService(guard_finalize_fail)
    claims_finalize_fail = make_claims("demo-nonce-finalize-fail")
    envelope_finalize_fail = create_signed_envelope(
        claims_finalize_fail,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    finalize_failed_result = await verifier_finalize_fail.verify_presented_code(
        envelope_finalize_fail,
        certificate,
        issuer_state_valid,
    )

    # Case 7: concurrent valid scans share one nonce; only one may win.
    guard_c = InMemoryReplayGuard()
    verifier_c = NarrowedVerifierService(guard_c)
    claims_c = make_claims("demo-nonce-303")
    envelope_c = create_signed_envelope(
        claims_c,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    start = asyncio.Event()
    tasks = [
        asyncio.create_task(
            run_concurrent_worker(
                verifier_c,
                envelope_c,
                certificate,
                issuer_state_valid,
                start,
            )
        )
        for _ in range(10)
    ]
    start.set()
    concurrent_results = await asyncio.gather(*tasks)
    accepted_count = sum(1 for result in concurrent_results if result.allowed)
    replay_blocked_count = sum(
        1 for result in concurrent_results
        if not result.allowed and result.stage == "replay_guard"
    )

    print("Narrowed Verifier PoC")
    print("=====================")
    print(f"First valid scan: {'ALLOW' if first_scan.allowed else 'BLOCK'}")
    print(f"  stage: {first_scan.stage}")
    print(f"  reason: {first_scan.reason}")
    print(f"  reservation_state: {first_scan.reservation_state}")

    print(f"Second scan of same code: {'ALLOW' if second_scan.allowed else 'BLOCK'}")
    print(f"  stage: {second_scan.stage}")
    print(f"  reason: {second_scan.reason}")
    print(f"  reservation_state: {second_scan.reservation_state}")

    print(
        "Failed verification releases reservation:"
        f" {'PASS' if failed_then_released.reservation_state == 'released' else 'FAIL'}"
    )
    print(f"  stage: {failed_then_released.stage}")
    print(f"  reason: {failed_then_released.reason}")
    print(f"  reservation_state: {failed_then_released.reservation_state}")

    print(f"Retry after issuer state is restored: {'ALLOW' if retry_after_release.allowed else 'BLOCK'}")
    print(f"  stage: {retry_after_release.stage}")
    print(f"  reason: {retry_after_release.reason}")
    print(f"  reservation_state: {retry_after_release.reservation_state}")

    print(f"Expired credential: {'ALLOW' if expired_result.allowed else 'BLOCK'}")
    print(f"  stage: {expired_result.stage}")
    print(f"  reason: {expired_result.reason}")
    print(f"  reservation_state: {expired_result.reservation_state}")

    print(f"Revoked certificate: {'ALLOW' if revoked_result.allowed else 'BLOCK'}")
    print(f"  stage: {revoked_result.stage}")
    print(f"  reason: {revoked_result.reason}")
    print(f"  reservation_state: {revoked_result.reservation_state}")

    print(
        "Release failure is surfaced:"
        f" {'PASS' if release_failed_result.reservation_state == 'release_failed' else 'FAIL'}"
    )
    print(f"  stage: {release_failed_result.stage}")
    print(f"  reason: {release_failed_result.reason}")
    print(f"  reservation_state: {release_failed_result.reservation_state}")

    print(
        "Finalize failure is surfaced:"
        f" {'PASS' if finalize_failed_result.reservation_state == 'finalize_failed' else 'FAIL'}"
    )
    print(f"  stage: {finalize_failed_result.stage}")
    print(f"  reason: {finalize_failed_result.reason}")
    print(f"  reservation_state: {finalize_failed_result.reservation_state}")

    print("Concurrent first scans")
    print(f"  accepted_count: {accepted_count}")
    print(f"  replay_blocked_count: {replay_blocked_count}")


if __name__ == "__main__":
    asyncio.run(main())
