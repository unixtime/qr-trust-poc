"""
Helpers for turning a signed envelope into a scannable QR artifact.

This module keeps the QR layer narrow:

- the QR payload is a compact JSON encoding of the signed envelope
- PNG bytes can be rendered deterministically for tests and demos
- PNG bytes can be decoded back into the QR payload for end-to-end validation
"""

from __future__ import annotations

import base64
import json
from collections import OrderedDict
from dataclasses import asdict, dataclass
from email import policy
from email.parser import BytesParser
from io import BytesIO
from pathlib import Path
from typing import Any, Mapping
from urllib.parse import urlparse

import cv2
import numpy as np
import qrcode
import zxingcpp
from PIL import Image

from backend.app.core.config import config
from backend.app.services.signed_schema_poc import (
    CANONICAL_CLAIM_ORDER,
    SignedQRCodeEnvelope,
    SignedSchemaError,
    parse_claims_mapping,
)


class QRArtifactError(ValueError):
    """Raised when a QR artifact cannot be encoded or decoded."""


@dataclass(frozen=True)
class QRArtifactBounds:
    """Image-space QR polygon summary used for tamper heuristics."""

    x_min: float
    y_min: float
    x_max: float
    y_max: float
    width: float
    height: float
    min_margin: float
    quiet_zone_ratio: float
    edge_length_variation: float


@dataclass(frozen=True)
class QRArtifactAnalysis:
    """
    Deterministic, network-free QR artifact inspection report.

    This is the local "qrsafe" slice: it does not decide issuer or
    destination trust. It only reports artifact-integrity signals that the
    scanner policy can map to warnings or blocks.
    """

    payload: str
    decoded_payloads: tuple[str, ...]
    payload_type: str
    image_width: int
    image_height: int
    decoded_symbol_count: int
    artifact_integrity: str
    risk_score: int
    tamper_indicators: tuple[str, ...]
    bounds: QRArtifactBounds | None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class QRArtifactContainerItem:
    source_label: str
    content_type: str
    filename: str | None
    analysis: QRArtifactAnalysis


@dataclass(frozen=True)
class QRArtifactContainerAnalysis:
    container_type: str
    extracted_artifact_count: int
    rejected_part_count: int
    items: tuple[QRArtifactContainerItem, ...]

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def artifact_integrity(self) -> str:
        if any(item.analysis.artifact_integrity == "warn" for item in self.items):
            return "warn"
        return "pass"

    @property
    def risk_score(self) -> int:
        return max((item.analysis.risk_score for item in self.items), default=0)

    @property
    def tamper_indicators(self) -> tuple[str, ...]:
        indicators = {
            indicator
            for item in self.items
            for indicator in item.analysis.tamper_indicators
        }
        return tuple(sorted(indicators))

    @property
    def decoded_payloads(self) -> tuple[str, ...]:
        payloads = {
            payload
            for item in self.items
            for payload in item.analysis.decoded_payloads
        }
        return tuple(sorted(payloads))


def _validate_qr_payload_size(qr_payload: str) -> str:
    if not isinstance(qr_payload, str) or not qr_payload.strip():
        raise QRArtifactError("QR payload must be a non-empty string")
    if len(qr_payload) > config.MAX_QR_PAYLOAD_CHARS:
        raise QRArtifactError(
            f"QR payload exceeds the maximum supported size of "
            f"{config.MAX_QR_PAYLOAD_CHARS} characters"
        )
    return qr_payload


def _load_image_for_decode(image_bytes: bytes) -> Image.Image:
    if not image_bytes:
        raise QRArtifactError("PNG bytes must not be empty")
    if len(image_bytes) > config.MAX_DECODE_IMAGE_BYTES:
        raise QRArtifactError(
            f"Image exceeds the maximum supported size of "
            f"{config.MAX_DECODE_IMAGE_BYTES} bytes"
        )

    try:
        image = Image.open(BytesIO(image_bytes))
        image.load()
    except Exception as exc:
        raise QRArtifactError("Could not decode PNG bytes into an image") from exc

    if image.width <= 0 or image.height <= 0:
        raise QRArtifactError("Decoded image must have non-zero dimensions")
    if image.width * image.height > config.MAX_DECODE_IMAGE_PIXELS:
        raise QRArtifactError(
            f"Image exceeds the maximum supported pixel count of "
            f"{config.MAX_DECODE_IMAGE_PIXELS}"
        )
    return image.convert("RGB")


def _classify_qr_payload(qr_payload: str) -> str:
    try:
        decode_envelope_from_qr_payload(qr_payload)
        return "signed_envelope"
    except QRArtifactError:
        parsed = urlparse(qr_payload)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            return "url"
        return "text"


def _extract_cv_qr_symbols(
    image: Image.Image,
) -> tuple[list[str], list[np.ndarray]]:
    cv_image = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
    detector = cv2.QRCodeDetector()
    decoded_payloads: list[str] = []
    polygons: list[np.ndarray] = []

    try:
        ok, decoded_info, points, _ = detector.detectAndDecodeMulti(cv_image)
    except Exception:
        ok, decoded_info, points = False, (), None

    if ok and points is not None:
        for index, raw_payload in enumerate(decoded_info or ()):
            if raw_payload:
                decoded_payloads.append(raw_payload)
            if index < len(points):
                polygons.append(np.asarray(points[index], dtype=np.float64))

    if decoded_payloads or polygons:
        return decoded_payloads, polygons

    try:
        qr_payload, points, _ = detector.detectAndDecode(cv_image)
    except Exception:
        qr_payload, points = "", None
    if qr_payload:
        decoded_payloads.append(qr_payload)
    if points is not None:
        polygons.append(np.asarray(points, dtype=np.float64).reshape(-1, 2))
    return decoded_payloads, polygons


def _extract_zxing_payloads(image: Image.Image) -> list[str]:
    try:
        results = zxingcpp.read_barcodes(image)
    except Exception:
        return []
    return [result.text for result in results if getattr(result, "text", None)]


def _unique_payloads_in_order(payloads: list[str]) -> list[str]:
    seen: set[str] = set()
    unique_payloads: list[str] = []
    for payload in payloads:
        if payload in seen:
            continue
        seen.add(payload)
        unique_payloads.append(payload)
    return unique_payloads


def _ordered_quad_points(points: np.ndarray) -> np.ndarray | None:
    if len(points) != 4:
        return None

    unique_points = np.unique(points, axis=0)
    if len(unique_points) != 4:
        return None

    center = np.mean(points, axis=0)
    angles = np.arctan2(points[:, 1] - center[1], points[:, 0] - center[0])
    ordered = points[np.argsort(angles)]

    x = ordered[:, 0]
    y = ordered[:, 1]
    area = 0.5 * abs(
        float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
    )
    if area <= 1.0:
        return None
    return ordered


def _summarize_bounds(
    polygon: np.ndarray,
    *,
    image_width: int,
    image_height: int,
) -> QRArtifactBounds | None:
    if polygon.size < 8:
        return None

    points = polygon.reshape(-1, 2).astype(np.float64)
    x_min = float(np.min(points[:, 0]))
    y_min = float(np.min(points[:, 1]))
    x_max = float(np.max(points[:, 0]))
    y_max = float(np.max(points[:, 1]))
    width = max(0.0, x_max - x_min)
    height = max(0.0, y_max - y_min)
    min_margin = max(
        0.0,
        min(x_min, y_min, image_width - x_max, image_height - y_max),
    )
    qr_extent = max(width, height, 1.0)
    edge_points = _ordered_quad_points(points)
    edges = (
        [
            float(
                np.linalg.norm(
                    edge_points[(index + 1) % len(edge_points)] - edge_points[index]
                )
            )
            for index in range(len(edge_points))
        ]
        if edge_points is not None
        else []
    )
    mean_edge = float(np.mean(edges)) if edges else 0.0
    edge_length_variation = (
        float((max(edges) - min(edges)) / mean_edge) if mean_edge else 0.0
    )
    return QRArtifactBounds(
        x_min=x_min,
        y_min=y_min,
        x_max=x_max,
        y_max=y_max,
        width=width,
        height=height,
        min_margin=min_margin,
        quiet_zone_ratio=float(min_margin / qr_extent),
        edge_length_variation=edge_length_variation,
    )


def _summarize_dark_pixel_bounds(image: Image.Image) -> QRArtifactBounds | None:
    grayscale = np.array(image.convert("L"))
    dark_points = np.argwhere(grayscale < 245)
    if dark_points.size == 0:
        return None

    y_min, x_min = dark_points.min(axis=0)
    y_max, x_max = dark_points.max(axis=0)
    width = float(x_max - x_min + 1)
    height = float(y_max - y_min + 1)
    min_margin = float(
        max(
            0,
            min(
                int(x_min),
                int(y_min),
                image.width - int(x_max) - 1,
                image.height - int(y_max) - 1,
            ),
        )
    )
    qr_extent = max(width, height, 1.0)
    return QRArtifactBounds(
        x_min=float(x_min),
        y_min=float(y_min),
        x_max=float(x_max),
        y_max=float(y_max),
        width=width,
        height=height,
        min_margin=min_margin,
        quiet_zone_ratio=float(min_margin / qr_extent),
        edge_length_variation=0.0,
    )


def _has_colored_overlay_frame(
    image: Image.Image,
    bounds: QRArtifactBounds | None,
) -> bool:
    if bounds is None:
        return False

    pixels = np.array(image.convert("RGB"))
    expansion_px = max(16, int(max(bounds.width, bounds.height) * 0.25))
    inner_padding_px = 4
    x_min = max(0, int(bounds.x_min - expansion_px))
    y_min = max(0, int(bounds.y_min - expansion_px))
    x_max = min(image.width - 1, int(bounds.x_max + expansion_px))
    y_max = min(image.height - 1, int(bounds.y_max + expansion_px))
    if x_max <= x_min or y_max <= y_min:
        return False

    region = pixels[y_min : y_max + 1, x_min : x_max + 1]
    channel_spread = region.max(axis=2) - region.min(axis=2)
    channel_max = region.max(axis=2)
    saturated_mask = (channel_spread > 60) & (channel_max > 120)

    yy, xx = np.mgrid[y_min : y_max + 1, x_min : x_max + 1]
    inner = (
        (xx >= int(bounds.x_min) - inner_padding_px)
        & (xx <= int(bounds.x_max) + inner_padding_px)
        & (yy >= int(bounds.y_min) - inner_padding_px)
        & (yy <= int(bounds.y_max) + inner_padding_px)
    )
    ring_pixels = region[~inner]
    if ring_pixels.size == 0:
        return False

    channel_spread = ring_pixels.max(axis=1) - ring_pixels.min(axis=1)
    channel_max = ring_pixels.max(axis=1)
    saturated_pixels = (channel_spread > 60) & (channel_max > 120)
    has_saturated_ring = (
        int(saturated_pixels.sum()) >= 250 and saturated_pixels.mean() >= 0.02
    )

    frame_x_min = max(0, int(bounds.x_min - x_min))
    frame_y_min = max(0, int(bounds.y_min - y_min))
    frame_x_max = min(region.shape[1] - 1, int(bounds.x_max - x_min))
    frame_y_max = min(region.shape[0] - 1, int(bounds.y_max - y_min))
    frame_width = frame_x_max - frame_x_min + 1
    frame_height = frame_y_max - frame_y_min + 1
    if frame_width <= 0 or frame_height <= 0:
        return has_saturated_ring

    band_px = max(4, int(min(frame_width, frame_height) * 0.06))
    frame_region = saturated_mask[
        frame_y_min : frame_y_max + 1,
        frame_x_min : frame_x_max + 1,
    ]
    if frame_region.size == 0:
        return has_saturated_ring

    top = frame_region[:band_px, :]
    bottom = frame_region[-band_px:, :]
    left = frame_region[:, :band_px]
    right = frame_region[:, -band_px:]
    center = frame_region[band_px:-band_px, band_px:-band_px]
    center_ratio = float(center.mean()) if center.size else 0.0
    side_ratios = [
        float(side.mean()) if side.size else 0.0
        for side in (top, bottom, left, right)
    ]
    has_rectangular_frame = (
        int(frame_region.sum()) >= 250
        and all(ratio >= 0.10 for ratio in side_ratios)
        and center_ratio <= 0.08
    )
    return has_saturated_ring or has_rectangular_frame


def analyze_qr_artifact_from_png_bytes(png_bytes: bytes) -> QRArtifactAnalysis:
    """
    Inspect a QR PNG for deterministic artifact-integrity signals.

    The analyzer is intentionally network-free. It is useful before issuer,
    destination, redirect, or runtime-safety checks because it catches cases
    where the QR artifact itself should carry a warning.
    """
    image = _load_image_for_decode(png_bytes)
    cv_payloads, polygons = _extract_cv_qr_symbols(image)
    zxing_payloads = _extract_zxing_payloads(image)
    primary_payloads = [payload for payload in cv_payloads if payload]

    if not primary_payloads:
        primary_payloads = [payload for payload in zxing_payloads if payload]

    if not primary_payloads:
        raise QRArtifactError("No QR payload could be decoded from the PNG image")

    payload = _validate_qr_payload_size(primary_payloads[0])
    decoded_payloads = _unique_payloads_in_order(primary_payloads + zxing_payloads)
    unique_payloads = set(decoded_payloads)
    decoded_symbol_count = max(
        len(cv_payloads),
        len(zxing_payloads),
        len(decoded_payloads),
        1,
    )
    bounds = (
        _summarize_bounds(
            polygons[0],
            image_width=image.width,
            image_height=image.height,
        )
        if polygons
        else None
    )
    dark_pixel_bounds = _summarize_dark_pixel_bounds(image)
    reported_bounds = bounds or dark_pixel_bounds
    quiet_zone_ratio = (
        dark_pixel_bounds.quiet_zone_ratio
        if dark_pixel_bounds is not None
        else reported_bounds.quiet_zone_ratio
        if reported_bounds is not None
        else None
    )

    indicators: list[str] = []
    risk_score = 0
    if decoded_symbol_count > 1:
        indicators.append("multiple_qr_symbols")
        risk_score += 35
    if len(unique_payloads) > 1:
        indicators.append("conflicting_qr_payloads")
        risk_score += 45
    if quiet_zone_ratio is not None and quiet_zone_ratio < 0.04:
        indicators.append("low_quiet_zone")
        risk_score += 15
    if _has_colored_overlay_frame(image, reported_bounds):
        indicators.append("colored_overlay_frame")
        risk_score += 25
    if bounds is not None and bounds.edge_length_variation > 0.20:
        indicators.append("perspective_distortion")
        risk_score += 20

    artifact_integrity = "warn" if indicators else "pass"
    return QRArtifactAnalysis(
        payload=payload,
        decoded_payloads=tuple(decoded_payloads),
        payload_type=_classify_qr_payload(payload),
        image_width=image.width,
        image_height=image.height,
        decoded_symbol_count=decoded_symbol_count,
        artifact_integrity=artifact_integrity,
        risk_score=risk_score,
        tamper_indicators=tuple(indicators),
        bounds=reported_bounds,
    )


def _analyze_qr_image_candidate(
    image_bytes: bytes,
    *,
    source_label: str,
    content_type: str,
    filename: str | None = None,
) -> QRArtifactContainerItem:
    return QRArtifactContainerItem(
        source_label=source_label,
        content_type=content_type,
        filename=filename,
        analysis=analyze_qr_artifact_from_png_bytes(image_bytes),
    )


def _pdf_rendered_item_adds_evidence(
    candidate: QRArtifactContainerItem,
    existing_items: list[QRArtifactContainerItem],
) -> bool:
    candidate_payloads = set(candidate.analysis.decoded_payloads)
    candidate_indicators = set(candidate.analysis.tamper_indicators)

    for existing in existing_items:
        existing_payloads = set(existing.analysis.decoded_payloads)
        if not candidate_payloads or not candidate_payloads <= existing_payloads:
            continue

        existing_indicators = set(existing.analysis.tamper_indicators)
        if candidate_indicators <= existing_indicators:
            return False
    return True


def _render_pdf_page_items(
    pdf_bytes: bytes,
) -> tuple[list[QRArtifactContainerItem], int]:
    try:
        import pypdfium2 as pdfium
    except ModuleNotFoundError as exc:  # pragma: no cover - dependency guard
        raise QRArtifactError("PDF page rendering requires pypdfium2") from exc

    try:
        document = pdfium.PdfDocument(pdf_bytes)
    except Exception as exc:
        raise QRArtifactError("Could not render PDF pages") from exc

    items: list[QRArtifactContainerItem] = []
    rejected_part_count = 0
    page_count = len(document)
    page_limit = min(page_count, config.MAX_PDF_RENDER_PAGES)
    if page_count > page_limit:
        rejected_part_count += page_count - page_limit

    try:
        for page_index in range(page_limit):
            page = None
            bitmap = None
            try:
                page = document[page_index]
                bitmap = page.render(scale=float(config.PDF_RENDER_SCALE))
                image = bitmap.to_pil().convert("RGB")
                if image.width * image.height > config.MAX_DECODE_IMAGE_PIXELS:
                    rejected_part_count += 1
                    continue

                output = BytesIO()
                image.save(output, format="PNG")
                rendered_bytes = output.getvalue()
                if len(rendered_bytes) > config.MAX_DECODE_IMAGE_BYTES:
                    rejected_part_count += 1
                    continue

                items.append(
                    _analyze_qr_image_candidate(
                        rendered_bytes,
                        source_label=f"pdf-page-{page_index + 1}-rendered",
                        content_type="application/pdf-page-render",
                    )
                )
            except QRArtifactError:
                rejected_part_count += 1
            except Exception:
                rejected_part_count += 1
            finally:
                if bitmap is not None:
                    bitmap.close()
                if page is not None:
                    page.close()
    finally:
        document.close()

    return items, rejected_part_count


def _analyze_qr_artifact_pdf_bytes(
    pdf_bytes: bytes,
) -> QRArtifactContainerAnalysis:
    try:
        from pypdf import PdfReader
    except ModuleNotFoundError as exc:  # pragma: no cover - dependency guard
        raise QRArtifactError("PDF QR extraction requires pypdf") from exc

    if len(pdf_bytes) > config.MAX_DECODE_IMAGE_BYTES:
        raise QRArtifactError(
            f"PDF exceeds the maximum supported size of "
            f"{config.MAX_DECODE_IMAGE_BYTES} bytes"
        )

    try:
        reader = PdfReader(BytesIO(pdf_bytes))
    except Exception as exc:
        raise QRArtifactError("Could not parse PDF bytes") from exc

    items: list[QRArtifactContainerItem] = []
    rejected_part_count = 0
    for page_index, page in enumerate(reader.pages, start=1):
        try:
            images = page.images
        except Exception:
            rejected_part_count += 1
            continue

        for image_index, image in enumerate(images, start=1):
            image_bytes = getattr(image, "data", b"")
            image_name = getattr(image, "name", None)
            if not image_bytes:
                rejected_part_count += 1
                continue
            try:
                items.append(
                    _analyze_qr_image_candidate(
                        image_bytes,
                        source_label=f"pdf-page-{page_index}-image-{image_index}",
                        content_type="application/pdf-image",
                        filename=image_name,
                    )
                )
            except QRArtifactError:
                rejected_part_count += 1

    rendered_items, render_rejections = _render_pdf_page_items(pdf_bytes)
    rejected_part_count += render_rejections
    for rendered_item in rendered_items:
        if _pdf_rendered_item_adds_evidence(rendered_item, items):
            items.append(rendered_item)

    if not items:
        raise QRArtifactError("No QR image artifacts could be extracted from the PDF")

    return QRArtifactContainerAnalysis(
        container_type="pdf",
        extracted_artifact_count=len(items),
        rejected_part_count=rejected_part_count,
        items=tuple(items),
    )


def _analyze_qr_artifact_email_bytes(
    email_bytes: bytes,
) -> QRArtifactContainerAnalysis:
    if len(email_bytes) > config.MAX_DECODE_IMAGE_BYTES:
        raise QRArtifactError(
            f"Email artifact exceeds the maximum supported size of "
            f"{config.MAX_DECODE_IMAGE_BYTES} bytes"
        )

    try:
        message = BytesParser(policy=policy.default).parsebytes(email_bytes)
    except Exception as exc:
        raise QRArtifactError("Could not parse email artifact bytes") from exc

    items: list[QRArtifactContainerItem] = []
    rejected_part_count = 0
    for part_index, part in enumerate(message.walk(), start=1):
        content_type = part.get_content_type()
        if not content_type.startswith("image/"):
            continue

        try:
            payload = part.get_payload(decode=True)
        except Exception:
            payload = None
        if not payload:
            rejected_part_count += 1
            continue

        try:
            items.append(
                _analyze_qr_image_candidate(
                    payload,
                    source_label=f"email-part-{part_index}",
                    content_type=content_type,
                    filename=part.get_filename(),
                )
            )
        except QRArtifactError:
            rejected_part_count += 1

    if not items:
        raise QRArtifactError("No QR image artifacts could be extracted from the email")

    return QRArtifactContainerAnalysis(
        container_type="email",
        extracted_artifact_count=len(items),
        rejected_part_count=rejected_part_count,
        items=tuple(items),
    )


def _artifact_container_type(
    *,
    content_type: str | None,
    filename: str | None,
) -> str:
    normalized_content_type = (content_type or "").split(";", 1)[0].strip().lower()
    suffix = Path(filename or "").suffix.lower()

    if normalized_content_type.startswith("image/") or suffix in {
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".bmp",
        ".gif",
    }:
        return "image"
    if normalized_content_type == "application/pdf" or suffix == ".pdf":
        return "pdf"
    if normalized_content_type in {"message/rfc822", "application/eml"} or suffix in {
        ".eml",
        ".msg",
    }:
        return "email"
    raise QRArtifactError("Unsupported QR artifact container type")


def analyze_qr_artifact_container_bytes(
    artifact_bytes: bytes,
    *,
    content_type: str | None = None,
    filename: str | None = None,
) -> QRArtifactContainerAnalysis:
    """
    Extract QR image candidates from an artifact container and analyze them.

    Supported containers are direct image bytes, PDFs with embedded images or
    rendered pages, and RFC 5322 email messages with image attachments. The
    extractor never opens destinations and never executes document or message
    content.
    """
    container_type = _artifact_container_type(
        content_type=content_type,
        filename=filename,
    )
    if container_type == "image":
        return QRArtifactContainerAnalysis(
            container_type="image",
            extracted_artifact_count=1,
            rejected_part_count=0,
            items=(
                _analyze_qr_image_candidate(
                    artifact_bytes,
                    source_label="image",
                    content_type=content_type or "image/unknown",
                    filename=filename,
                ),
            ),
        )
    if container_type == "pdf":
        return _analyze_qr_artifact_pdf_bytes(artifact_bytes)
    if container_type == "email":
        return _analyze_qr_artifact_email_bytes(artifact_bytes)
    raise QRArtifactError("Unsupported QR artifact container type")


def decode_image_base64(image_base64: str) -> bytes:
    """
    Decode a base64 image string or data URL into raw image bytes.
    """
    if not isinstance(image_base64, str) or not image_base64.strip():
        raise QRArtifactError("Image payload must be a non-empty base64 string")

    normalized = image_base64.strip()
    if "," in normalized and normalized.lower().startswith("data:image/"):
        normalized = normalized.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(normalized, validate=True)
    except Exception as exc:
        raise QRArtifactError("Image payload must be valid base64 image data") from exc

    if len(image_bytes) > config.MAX_DECODE_IMAGE_BYTES:
        raise QRArtifactError(
            f"Image exceeds the maximum supported size of "
            f"{config.MAX_DECODE_IMAGE_BYTES} bytes"
        )
    return image_bytes


def encode_envelope_as_qr_payload(envelope: SignedQRCodeEnvelope) -> str:
    """
    Serialize the signed envelope into the exact QR payload string.
    """
    claims_mapping = OrderedDict(
        (field, getattr(envelope.claims, field)) for field in CANONICAL_CLAIM_ORDER
    )
    payload_mapping: dict[str, Any] = {
        "claims": claims_mapping,
        "signature": envelope.signature,
    }
    if envelope.code_algorithm_id is not None:
        payload_mapping["code_algorithm_id"] = envelope.code_algorithm_id

    return _validate_qr_payload_size(
        json.dumps(payload_mapping, separators=(",", ":"), ensure_ascii=True)
    )


def decode_envelope_from_qr_payload(qr_payload: str) -> SignedQRCodeEnvelope:
    """
    Parse a scanned QR payload back into the signed envelope contract.
    """
    _validate_qr_payload_size(qr_payload)

    try:
        payload_mapping = json.loads(qr_payload)
    except json.JSONDecodeError as exc:
        raise QRArtifactError("QR payload must be valid JSON") from exc

    if not isinstance(payload_mapping, Mapping):
        raise QRArtifactError("QR payload must decode to an object")

    allowed_keys = {"claims", "signature", "code_algorithm_id"}
    extras = sorted(set(payload_mapping.keys()) - allowed_keys)
    if extras:
        raise QRArtifactError(f"QR payload contains unsupported envelope keys: {extras}")

    claims_raw = payload_mapping.get("claims")
    if not isinstance(claims_raw, Mapping):
        raise QRArtifactError("QR payload must contain a 'claims' object")

    signature = payload_mapping.get("signature")
    if not isinstance(signature, str) or not signature.strip():
        raise QRArtifactError("QR payload must contain a non-empty 'signature' string")

    code_algorithm_id = payload_mapping.get("code_algorithm_id")
    if code_algorithm_id is not None and not isinstance(code_algorithm_id, str):
        raise QRArtifactError("'code_algorithm_id' must be a string when present")

    try:
        claims = parse_claims_mapping(claims_raw)
    except SignedSchemaError as exc:
        raise QRArtifactError(str(exc)) from exc

    return SignedQRCodeEnvelope(
        claims=claims,
        signature=signature.strip(),
        code_algorithm_id=code_algorithm_id.strip() if code_algorithm_id else None,
    )


def render_qr_png_bytes(qr_payload: str, *, border: int = 6) -> bytes:
    """
    Render PNG bytes for the QR payload.

    A border below the QR spec's four-module quiet zone produces an image the
    artifact analyzer flags as low_quiet_zone.
    """
    qr_payload = _validate_qr_payload_size(qr_payload)

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=border,
    )
    qr.add_data(qr_payload)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white")

    buffer = image.get_image().convert("RGB")
    try:
        output = BytesIO()
        buffer.save(output, format="PNG")
        return output.getvalue()
    except Exception as exc:  # pragma: no cover - PIL failures are environmental
        raise QRArtifactError("Failed to render QR PNG bytes") from exc


def render_qr_png_base64(qr_payload: str, *, border: int = 6) -> str:
    """
    Render a base64 PNG string suitable for JSON transport.
    """
    return base64.b64encode(render_qr_png_bytes(qr_payload, border=border)).decode("ascii")


def decode_qr_payload_from_png_bytes(png_bytes: bytes) -> str:
    """
    Decode a QR payload from PNG bytes using OpenCV's QR detector.
    """
    image = _load_image_for_decode(png_bytes)
    try:
        result = zxingcpp.read_barcode(image)
        if result and result.text:
            return _validate_qr_payload_size(result.text)
    except Exception:
        # Fall through to the OpenCV path for environments where zxing-cpp
        # cannot decode a given payload or image variant.
        pass

    cv_image = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)

    detector = cv2.QRCodeDetector()
    candidate_images = [cv_image]

    # OpenCV can fail on very large, high-contrast PNGs. Try a few downscaled
    # variants before giving up so the QR test surface is stable.
    max_dimension = max(cv_image.shape[0], cv_image.shape[1])
    for target_size in (1600, 1200, 900, 700, 500):
        if max_dimension <= target_size:
            continue
        scale = target_size / max_dimension
        resized = cv2.resize(
            cv_image,
            dsize=None,
            fx=scale,
            fy=scale,
            interpolation=cv2.INTER_AREA,
        )
        candidate_images.append(resized)

    for candidate in candidate_images:
        qr_payload, _, _ = detector.detectAndDecode(candidate)
        if qr_payload:
            return _validate_qr_payload_size(qr_payload)

    raise QRArtifactError("No QR payload could be decoded from the PNG image")
