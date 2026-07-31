#!/usr/bin/env python3
from __future__ import annotations

import base64
from email.message import EmailMessage
from io import BytesIO
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "docs/public/evaluation/fixtures"


def render_qr_png(payload: str, *, border: int = 4) -> bytes:
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


def png_image(payload: str, *, border: int = 4) -> Image.Image:
    return Image.open(BytesIO(render_qr_png(payload, border=border))).convert("RGB")


def write_bytes(relative_path: str, content: bytes) -> None:
    path = FIXTURE_DIR / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def build_multiple_qr_png(primary_payload: str, secondary_payload: str) -> bytes:
    left = png_image(primary_payload, border=4)
    right = png_image(secondary_payload, border=4)
    canvas = Image.new(
        "RGB",
        (left.width + right.width + 96, max(left.height, right.height) + 48),
        "white",
    )
    canvas.paste(left, (24, 24))
    canvas.paste(right, (left.width + 72, 24))
    output = BytesIO()
    canvas.save(output, format="PNG")
    return output.getvalue()


def build_invoice_overlay_pdf() -> bytes:
    qr = png_image("https://acme.example/pay?invoice=overlay", border=2)
    page = Image.new("RGB", (900, 1200), "white")
    draw = ImageDraw.Draw(page)
    draw.text((80, 80), "ACME Invoice 2026-05-31", fill="black")
    draw.text((80, 140), "Payment region contains pasted QR overlay fixture.", fill="black")
    page.paste(qr, (560, 760))
    draw.rectangle((548, 748, 560 + qr.width + 12, 760 + qr.height + 12), outline="red", width=6)
    output = BytesIO()
    page.save(output, format="PDF")
    return output.getvalue()


def build_email_fixture() -> bytes:
    payload = "https://acme.example/pay?artifact=altered"
    png_bytes = render_qr_png(payload, border=0)
    message = EmailMessage()
    message["From"] = "security@example.org"
    message["To"] = "reviewer@example.org"
    message["Subject"] = "QR artifact email fixture"
    message.set_content(
        "Synthetic email fixture with a QR PNG attachment for corpus extraction tests."
    )
    message.add_attachment(
        png_bytes,
        maintype="image",
        subtype="png",
        filename="qr-email-attachment.png",
    )
    return message.as_bytes()


def main() -> None:
    write_bytes("qr-clean-url.png", render_qr_png("https://example.org/menu", border=4))
    write_bytes(
        "qr-low-quiet-zone.png",
        render_qr_png("https://acme.example/pay?quality=degraded", border=0),
    )
    write_bytes(
        "qr-multiple-conflicting.png",
        build_multiple_qr_png(
            "https://acme.example/info?extra=true",
            "https://acme.example/info?secondary=true",
        ),
    )
    write_bytes("invoice-overlay.pdf", build_invoice_overlay_pdf())
    write_bytes("email-qr-attachment.eml", build_email_fixture())

    manifest = "\n".join(
        [
            "Generated trust-residual artifact fixtures.",
            "qr-clean-url.png: clean URL QR image.",
            "qr-low-quiet-zone.png: decodable QR with missing quiet zone.",
            "qr-multiple-conflicting.png: two decodable QR symbols in one image.",
            "invoice-overlay.pdf: synthetic invoice PDF with pasted overlay visual.",
            "email-qr-attachment.eml: synthetic email with QR PNG attachment.",
            "",
        ]
    )
    write_bytes("README.txt", manifest.encode("utf-8"))

    png_digest = base64.urlsafe_b64encode(
        render_qr_png("https://example.org/menu", border=4)[:18]
    ).decode("ascii")
    print(f"Wrote fixtures to {FIXTURE_DIR.relative_to(ROOT)} ({png_digest})")


if __name__ == "__main__":
    main()
