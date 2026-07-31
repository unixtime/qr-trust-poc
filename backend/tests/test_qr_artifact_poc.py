from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from io import BytesIO

import numpy as np
import pytest
import qrcode
from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject

from backend.app.core.config import config
from backend.app.services import qr_artifact_poc
from backend.app.services.qr_artifact_poc import (
    QRArtifactError,
    analyze_qr_artifact_container_bytes,
    analyze_qr_artifact_from_png_bytes,
    decode_image_base64,
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


def _render_custom_qr_png(payload: str, *, border: int) -> bytes:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=border,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white").get_image()
    output = BytesIO()
    image.convert("RGB").save(output, format="PNG")
    return output.getvalue()


def _render_colored_qr_png(payload: str) -> bytes:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=4,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    image = qr.make_image(fill_color="#0a66ff", back_color="white").get_image()
    output = BytesIO()
    image.convert("RGB").save(output, format="PNG")
    return output.getvalue()


def _render_pdf_with_qr(payload: str) -> bytes:
    qr_image = Image.open(BytesIO(_render_custom_qr_png(payload, border=4))).convert("RGB")
    page = Image.new("RGB", (600, 800), "white")
    page.paste(qr_image, (160, 240))
    output = BytesIO()
    page.save(output, format="PDF")
    return output.getvalue()


def _render_pdf_with_framed_qr(payload: str) -> bytes:
    qr_image = Image.open(BytesIO(_render_custom_qr_png(payload, border=4))).convert("RGB")
    page = Image.new("RGB", (600, 800), "white")
    draw = ImageDraw.Draw(page)
    qr_left = 160
    qr_top = 240
    page.paste(qr_image, (qr_left, qr_top))
    draw.rectangle(
        (
            qr_left - 12,
            qr_top - 12,
            qr_left + qr_image.width + 12,
            qr_top + qr_image.height + 12,
        ),
        outline="red",
        width=6,
    )
    output = BytesIO()
    page.save(output, format="PDF")
    return output.getvalue()


def _render_pdf_with_vector_framed_qr(payload: str) -> bytes:
    qr_image = Image.open(BytesIO(_render_custom_qr_png(payload, border=4))).convert("RGB")
    qr_left = 160
    qr_top = 240
    pdf_bytes = _render_pdf_with_qr(payload)
    reader = PdfReader(BytesIO(pdf_bytes))
    writer = PdfWriter(clone_from=reader)
    page = writer.pages[0]
    page_height = float(page.mediabox.height)
    x = qr_left - 12
    y = page_height - (qr_top + qr_image.height + 12)
    width = qr_image.width + 24
    height = qr_image.height + 24
    overlay = (
        f"\nq 1 0 0 RG 6 w {x:.2f} {y:.2f} "
        f"{width:.2f} {height:.2f} re S Q\n"
    ).encode("ascii")
    stream = DecodedStreamObject()
    stream.set_data(page.get_contents().get_data() + overlay)
    page.replace_contents(stream)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def _render_email_with_qr_attachment(payload: str, *, border: int) -> bytes:
    message = EmailMessage()
    message["From"] = "sender@example.org"
    message["To"] = "reviewer@example.org"
    message["Subject"] = "QR fixture"
    message.set_content("Synthetic QR email fixture.")
    message.add_attachment(
        _render_custom_qr_png(payload, border=border),
        maintype="image",
        subtype="png",
        filename="qr-fixture.png",
    )
    return message.as_bytes()


def test_qr_artifact_roundtrip_through_png_decode() -> None:
    certificate, private_key_pem = build_demo_certificate()
    now = datetime.now(timezone.utc)
    claims = parse_claims_mapping(
        {
            "version": "1",
            "usage_policy": "reusable_public",
            "certificate_ref": certificate.certificate_ref,
            "issued_at": (now - timedelta(minutes=1)).isoformat(),
            "expires_at": (now + timedelta(minutes=5)).isoformat(),
            "nonce": "qr-artifact-roundtrip-001",
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
    decoded_qr_payload = decode_qr_payload_from_png_bytes(png_bytes)
    decoded_envelope = decode_envelope_from_qr_payload(decoded_qr_payload)

    assert decoded_qr_payload == qr_payload
    assert decoded_envelope == envelope


def test_analyze_qr_artifact_reports_clean_signed_envelope() -> None:
    certificate, private_key_pem = build_demo_certificate()
    now = datetime.now(timezone.utc)
    claims = parse_claims_mapping(
        {
            "version": "1",
            "usage_policy": "reusable_public",
            "certificate_ref": certificate.certificate_ref,
            "issued_at": (now - timedelta(minutes=1)).isoformat(),
            "expires_at": (now + timedelta(minutes=5)).isoformat(),
            "nonce": "qr-artifact-analysis-001",
            "payload": "https://acme.example/pay",
        }
    )
    envelope = create_signed_envelope(
        claims,
        private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )
    qr_payload = encode_envelope_as_qr_payload(envelope)

    analysis = analyze_qr_artifact_from_png_bytes(render_qr_png_bytes(qr_payload))

    assert analysis.payload == qr_payload
    assert analysis.payload_type == "signed_envelope"
    assert analysis.decoded_symbol_count == 1
    assert analysis.artifact_integrity == "pass", analysis.as_dict()
    assert analysis.risk_score == 0
    assert analysis.tamper_indicators == ()
    assert analysis.bounds is not None
    assert analysis.bounds.quiet_zone_ratio >= 0.04


def test_analyze_qr_artifact_warns_on_low_quiet_zone() -> None:
    analysis = analyze_qr_artifact_from_png_bytes(
        _render_custom_qr_png("https://acme.example/pay", border=0)
    )

    assert analysis.payload == "https://acme.example/pay"
    assert analysis.payload_type == "url"
    assert analysis.artifact_integrity == "warn"
    assert "low_quiet_zone" in analysis.tamper_indicators


def test_analyze_qr_artifact_does_not_treat_colored_modules_as_frame() -> None:
    analysis = analyze_qr_artifact_from_png_bytes(
        _render_colored_qr_png("https://acme.example/pay?blue=true")
    )

    assert analysis.payload == "https://acme.example/pay?blue=true"
    assert "colored_overlay_frame" not in analysis.tamper_indicators


def test_analyze_qr_artifact_warns_on_multiple_symbols() -> None:
    left = Image.open(
        BytesIO(_render_custom_qr_png("https://acme.example/pay/one", border=4))
    ).convert("RGB")
    right = Image.open(
        BytesIO(_render_custom_qr_png("https://acme.example/pay/two", border=4))
    ).convert("RGB")
    canvas = Image.new(
        "RGB",
        (left.width + right.width + 96, max(left.height, right.height) + 48),
        "white",
    )
    canvas.paste(left, (24, 24))
    canvas.paste(right, (left.width + 72, 24))
    output = BytesIO()
    canvas.save(output, format="PNG")

    analysis = analyze_qr_artifact_from_png_bytes(output.getvalue())

    assert analysis.decoded_symbol_count >= 2
    assert analysis.artifact_integrity == "warn"
    assert "multiple_qr_symbols" in analysis.tamper_indicators
    assert "conflicting_qr_payloads" in analysis.tamper_indicators


def test_analyze_qr_artifact_reports_all_decoder_payloads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        qr_artifact_poc,
        "_extract_cv_qr_symbols",
        lambda _image: (["https://acme.example/pay/one"], []),
    )
    monkeypatch.setattr(
        qr_artifact_poc,
        "_extract_zxing_payloads",
        lambda _image: [
            "https://acme.example/pay/one",
            "https://acme.example/pay/two",
        ],
    )

    analysis = analyze_qr_artifact_from_png_bytes(
        _render_custom_qr_png("https://acme.example/pay/one", border=4)
    )

    assert analysis.payload == "https://acme.example/pay/one"
    assert analysis.decoded_payloads == (
        "https://acme.example/pay/one",
        "https://acme.example/pay/two",
    )
    assert "conflicting_qr_payloads" in analysis.tamper_indicators


def test_summarize_bounds_orders_detector_quad_points() -> None:
    bounds = qr_artifact_poc._summarize_bounds(
        np.array(
            [
                [10.0, 10.0],
                [90.0, 90.0],
                [90.0, 10.0],
                [10.0, 90.0],
            ],
            dtype=np.float64,
        ),
        image_width=100,
        image_height=100,
    )

    assert bounds is not None
    assert bounds.edge_length_variation == pytest.approx(0.0)


def test_analyze_qr_artifact_container_extracts_pdf_images() -> None:
    analysis = analyze_qr_artifact_container_bytes(
        _render_pdf_with_qr("https://acme.example/pay?pdf=true"),
        content_type="application/pdf",
        filename="invoice.pdf",
    )

    assert analysis.container_type == "pdf"
    assert analysis.extracted_artifact_count == 1
    assert analysis.artifact_integrity == "pass"
    assert analysis.decoded_payloads == ("https://acme.example/pay?pdf=true",)
    assert analysis.items[0].source_label == "pdf-page-1-image-1"


def test_analyze_qr_artifact_container_warns_on_framed_pdf_overlay() -> None:
    analysis = analyze_qr_artifact_container_bytes(
        _render_pdf_with_framed_qr("https://acme.example/pay?overlay=true"),
        content_type="application/pdf",
        filename="invoice.pdf",
    )

    assert analysis.container_type == "pdf"
    assert analysis.extracted_artifact_count == 1
    assert analysis.artifact_integrity == "warn"
    assert analysis.decoded_payloads == ("https://acme.example/pay?overlay=true",)
    assert "colored_overlay_frame" in analysis.tamper_indicators


def test_analyze_qr_artifact_container_uses_rendered_pdf_page_for_vector_overlay() -> None:
    analysis = analyze_qr_artifact_container_bytes(
        _render_pdf_with_vector_framed_qr("https://acme.example/pay?vector=true"),
        content_type="application/pdf",
        filename="invoice.pdf",
    )

    by_source = {item.source_label: item.analysis for item in analysis.items}
    assert analysis.container_type == "pdf"
    assert analysis.extracted_artifact_count == 2
    assert by_source["pdf-page-1-image-1"].artifact_integrity == "pass"
    assert by_source["pdf-page-1-rendered"].artifact_integrity == "warn"
    assert analysis.artifact_integrity == "warn"
    assert analysis.decoded_payloads == ("https://acme.example/pay?vector=true",)
    assert "colored_overlay_frame" in analysis.tamper_indicators


def test_analyze_qr_artifact_container_extracts_email_image_attachments() -> None:
    analysis = analyze_qr_artifact_container_bytes(
        _render_email_with_qr_attachment(
            "https://acme.example/pay?email=true",
            border=0,
        ),
        content_type="message/rfc822",
        filename="message.eml",
    )

    assert analysis.container_type == "email"
    assert analysis.extracted_artifact_count == 1
    assert analysis.artifact_integrity == "warn"
    assert analysis.decoded_payloads == ("https://acme.example/pay?email=true",)
    assert "low_quiet_zone" in analysis.tamper_indicators


def test_decode_envelope_rejects_invalid_json_payload() -> None:
    with pytest.raises(QRArtifactError, match="valid JSON"):
        decode_envelope_from_qr_payload("not-json")


def test_decode_qr_payload_rejects_non_qr_png_bytes() -> None:
    with pytest.raises(QRArtifactError, match="Could not decode PNG bytes"):
        decode_qr_payload_from_png_bytes(b"not-a-real-png")


def test_decode_image_base64_rejects_oversized_image() -> None:
    oversized_bytes = b"a" * (config.MAX_DECODE_IMAGE_BYTES + 1)
    oversized_base64 = base64.b64encode(oversized_bytes).decode("ascii")

    with pytest.raises(QRArtifactError, match="maximum supported size"):
        decode_image_base64(oversized_base64)


def test_render_qr_png_rejects_oversized_payload() -> None:
    oversized_payload = "x" * (config.MAX_QR_PAYLOAD_CHARS + 1)

    with pytest.raises(QRArtifactError, match="maximum supported size"):
        render_qr_png_bytes(oversized_payload)
