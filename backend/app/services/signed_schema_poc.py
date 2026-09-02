"""
PoC support for a canonical signed schema.

This module defines an exact verifier contract:

- the signed claims have a fixed field set and fixed field order
- the certificate reference is signed
- the certificate is the authoritative source of `algorithm_id`
- an outer code-level algorithm hint is allowed only as a mirror and must match
- the verifier rejects unknown fields, missing fields, and metadata conflicts
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Mapping

from backend.app.core.security import generate_key_pair, sign_payload, verify_signature


CANONICAL_CLAIM_ORDER: tuple[str, ...] = (
    "version",
    "certificate_ref",
    "issued_at",
    "expires_at",
    "payload",
)
SUPPORTED_ALGORITHM_ID = "rsa-pss-sha256-v1"
SUPPORTED_CLAIMS_VERSION = "2"


class SignedSchemaError(ValueError):
    """Raised when a signed-code envelope or claims mapping is invalid."""


@dataclass(frozen=True)
class CertificateAuthorityRecord:
    certificate_ref: str
    issuer_name: str
    algorithm_id: str
    public_key_pem: str | None


@dataclass(frozen=True)
class SignedQRCodeClaims:
    version: str
    certificate_ref: str
    issued_at: str
    expires_at: str | None
    payload: str


@dataclass(frozen=True)
class SignedQRCodeEnvelope:
    claims: SignedQRCodeClaims
    signature: str
    code_algorithm_id: str | None = None


@dataclass(frozen=True)
class VerificationDecision:
    allowed: bool
    reason: str
    canonical_claims: str
    certificate_algorithm_id: str


def parse_claim_timestamp(label: str, value: object) -> datetime:
    """Parse one ISO-8601 claim timestamp. Timezone-aware strings only."""
    if not isinstance(value, str):
        raise SignedSchemaError(f"Field '{label}' must be an ISO-8601 timestamp")

    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise SignedSchemaError(
            f"Field '{label}' must be an ISO-8601 timestamp"
        ) from exc

    if parsed.tzinfo is None:
        raise SignedSchemaError(f"Field '{label}' must include timezone information")

    return parsed


def _require_non_empty_string(label: str, value: Any) -> str:
    if not isinstance(value, str):
        raise SignedSchemaError(f"Field '{label}' must be a string")

    normalized = value.strip()
    if not normalized:
        raise SignedSchemaError(f"Field '{label}' must not be empty")
    return normalized


def parse_claims_mapping(data: Mapping[str, Any]) -> SignedQRCodeClaims:
    """
    Parse a mapping into the exact signed-claims contract.

    The parser is strict on purpose. Unknown fields are rejected so the verifier
    contract is explicit and deterministic.
    """
    missing = [field for field in CANONICAL_CLAIM_ORDER if field not in data]
    if missing:
        raise SignedSchemaError(f"Missing required signed claim fields: {missing}")
    # The version check runs before the unknown-field check on purpose: an
    # envelope from an older claims version carries fields this contract has
    # since dropped, and the honest diagnosis is the unsupported version, not
    # the fields that version legitimately carried.
    version = _require_non_empty_string("version", data["version"])
    if version != SUPPORTED_CLAIMS_VERSION:
        raise SignedSchemaError(
            f"Field 'version' must be exactly '{SUPPORTED_CLAIMS_VERSION}' for this PoC"
        )
    extras = sorted(set(data) - set(CANONICAL_CLAIM_ORDER))
    if extras:
        raise SignedSchemaError(f"Unknown signed claim fields are not allowed: {extras}")

    certificate_ref = _require_non_empty_string("certificate_ref", data["certificate_ref"])
    issued_at = parse_claim_timestamp("issued_at", data["issued_at"])

    raw_expires_at = data["expires_at"]
    if raw_expires_at is None:
        expires_at_value: str | None = None
    else:
        expires_at = parse_claim_timestamp("expires_at", raw_expires_at)
        if expires_at <= issued_at:
            raise SignedSchemaError("Field 'expires_at' must be later than 'issued_at'")
        expires_at_value = str(raw_expires_at)

    payload = _require_non_empty_string("payload", data["payload"])

    return SignedQRCodeClaims(
        version=version,
        certificate_ref=certificate_ref,
        issued_at=str(data["issued_at"]),
        expires_at=expires_at_value,
        payload=payload,
    )


def canonicalize_claims(claims: SignedQRCodeClaims) -> str:
    """
    Serialize the signed claims using a fixed field order and compact JSON.
    """
    ordered_claims = {field: getattr(claims, field) for field in CANONICAL_CLAIM_ORDER}
    return json.dumps(ordered_claims, separators=(",", ":"), ensure_ascii=True)


def canonical_claims_sha256(claims: SignedQRCodeClaims) -> str:
    canonical = canonicalize_claims(claims)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def compute_envelope_id(claims: SignedQRCodeClaims, signature: str) -> str:
    """Identity of one issued artifact: sha256(canonical claims + "." + signature)."""
    material = canonicalize_claims(claims) + "." + signature
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def create_signed_envelope(
    claims: SignedQRCodeClaims,
    private_key_pem: str,
    *,
    code_algorithm_id: str | None = None,
) -> SignedQRCodeEnvelope:
    canonical = canonicalize_claims(claims)
    signature = sign_payload(canonical, private_key_pem)
    return SignedQRCodeEnvelope(
        claims=claims,
        signature=signature,
        code_algorithm_id=code_algorithm_id,
    )


def verify_signed_envelope(
    envelope: SignedQRCodeEnvelope,
    certificate: CertificateAuthorityRecord,
) -> VerificationDecision:
    """
    Verify the signed envelope against the authoritative certificate metadata.
    """
    if certificate.algorithm_id != SUPPORTED_ALGORITHM_ID:
        return VerificationDecision(
            allowed=False,
            reason=f"Unsupported certificate algorithm_id: {certificate.algorithm_id}",
            canonical_claims="",
            certificate_algorithm_id=certificate.algorithm_id,
        )

    if envelope.claims.certificate_ref != certificate.certificate_ref:
        return VerificationDecision(
            allowed=False,
            reason=(
                "Signed certificate_ref does not match the authoritative "
                "certificate record"
            ),
            canonical_claims="",
            certificate_algorithm_id=certificate.algorithm_id,
        )

    if (
        envelope.code_algorithm_id is not None
        and envelope.code_algorithm_id != certificate.algorithm_id
    ):
        return VerificationDecision(
            allowed=False,
            reason=(
                "Code metadata algorithm hint conflicts with the authoritative "
                "certificate algorithm_id"
            ),
            canonical_claims="",
            certificate_algorithm_id=certificate.algorithm_id,
        )

    canonical = canonicalize_claims(envelope.claims)
    signature_valid = verify_signature(
        canonical,
        envelope.signature,
        certificate.public_key_pem,
    )

    if not signature_valid:
        return VerificationDecision(
            allowed=False,
            reason="Signature verification failed for canonical signed claims",
            canonical_claims=canonical,
            certificate_algorithm_id=certificate.algorithm_id,
        )

    return VerificationDecision(
        allowed=True,
        reason="Canonical claims verified against the authoritative certificate",
        canonical_claims=canonical,
        certificate_algorithm_id=certificate.algorithm_id,
    )


def build_demo_certificate(
    *,
    issuer_name: str = "Acme Demo Issuer",
    certificate_ref: str = "cert:acme-demo:2026-01",
    algorithm_id: str = SUPPORTED_ALGORITHM_ID,
) -> tuple[CertificateAuthorityRecord, str]:
    private_key_pem, public_key_pem = generate_key_pair()
    certificate = CertificateAuthorityRecord(
        certificate_ref=certificate_ref,
        issuer_name=issuer_name,
        algorithm_id=algorithm_id,
        public_key_pem=public_key_pem,
    )
    return certificate, private_key_pem
