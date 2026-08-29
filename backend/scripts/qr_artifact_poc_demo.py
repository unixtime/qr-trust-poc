from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from backend.app.services.narrowed_verifier_poc import (
    IssuerVerificationState,
    NarrowedVerifierService,
)
from backend.app.services.qr_artifact_poc import (
    analyze_qr_artifact_from_png_bytes,
    decode_envelope_from_qr_payload,
    decode_qr_payload_from_png_bytes,
    encode_envelope_as_qr_payload,
    render_qr_png_bytes,
)
from backend.app.services.signed_schema_poc import (
    SUPPORTED_ALGORITHM_ID,
    build_demo_certificate,
    create_signed_envelope,
    parse_claims_mapping,
)


async def main() -> None:
    certificate, private_key_pem = build_demo_certificate()
    now = datetime.now(timezone.utc)
    claims = parse_claims_mapping(
        {
            "version": "2",
            "certificate_ref": certificate.certificate_ref,
            "issued_at": (now - timedelta(minutes=1)).isoformat(),
            "expires_at": (now + timedelta(minutes=5)).isoformat(),
            "payload": "https://acme.example/pay",
        }
    )
    envelope = create_signed_envelope(
        claims,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    qr_payload = encode_envelope_as_qr_payload(envelope)
    png_bytes = render_qr_png_bytes(qr_payload)
    artifact_analysis = analyze_qr_artifact_from_png_bytes(png_bytes)
    decoded_qr_payload = decode_qr_payload_from_png_bytes(png_bytes)
    scanned_envelope = decode_envelope_from_qr_payload(decoded_qr_payload)

    verifier = NarrowedVerifierService()
    issuer_state = IssuerVerificationState(verified_domains=["acme.example"])
    first_result = await verifier.verify_presented_code(
        scanned_envelope,
        certificate,
        issuer_state,
    )
    second_result = await verifier.verify_presented_code(
        scanned_envelope,
        certificate,
        issuer_state,
    )

    print("QR artifact demo")
    print(f"- encoded payload length: {len(qr_payload)}")
    print(f"- png bytes: {len(png_bytes)}")
    print(f"- artifact integrity: {artifact_analysis.artifact_integrity}")
    print(f"- artifact risk score: {artifact_analysis.risk_score}")
    print(f"- artifact indicators: {artifact_analysis.tamper_indicators}")
    print(f"- scan roundtrip exact: {decoded_qr_payload == qr_payload}")
    print(f"- first verification stage: {first_result.stage}")
    print(f"- second verification stage: {second_result.stage}")


if __name__ == "__main__":
    asyncio.run(main())
