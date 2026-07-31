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


CANONICAL_CLAIM_ORDER = (
    "version",
    "usage_policy",
    "certificate_ref",
    "issued_at",
    "expires_at",
    "nonce",
    "payload",
)

SUPPORTED_ALGORITHM_ID = "rsa-pss-sha256-v1"
USAGE_POLICY_REUSABLE_PUBLIC = "reusable_public"
USAGE_POLICY_ONE_TIME = "one_time"
USAGE_POLICY_TIME_LIMITED = "time_limited"
SUPPORTED_USAGE_POLICIES = frozenset(
    {
        USAGE_POLICY_REUSABLE_PUBLIC,
        USAGE_POLICY_ONE_TIME,
        USAGE_POLICY_TIME_LIMITED,
    }
)


class SignedSchemaError(ValueError):
    """Raised when a signed-code envelope or claims mapping is invalid."""


@dataclass(frozen=True)
class CertificateAuthorityRecord:
    certificate_ref: str
    issuer_name: str
    algorithm_id: str
    public_key_pem: str


@dataclass(frozen=True)
class SignedQRCodeClaims:
    version: str
    usage_policy: str
    certificate_ref: str
    issued_at: str
    expires_at: str
    nonce: str
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


def _parse_timestamp(label: str, value: str) -> datetime:
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise SignedSchemaError(f"Field '{label}' must be an ISO-8601 timestamp") from exc

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


def _parse_usage_policy(value: Any) -> str:
    usage_policy = _require_non_empty_string("usage_policy", value)
    if usage_policy not in SUPPORTED_USAGE_POLICIES:
        allowed = sorted(SUPPORTED_USAGE_POLICIES)
        raise SignedSchemaError(
            f"Field 'usage_policy' must be one of: {allowed}"
        )
    return usage_policy


def parse_claims_mapping(data: Mapping[str, Any]) -> SignedQRCodeClaims:
    """
    Parse a mapping into the exact signed-claims contract.

    The parser is strict on purpose. Unknown fields are rejected so the verifier
    contract is explicit and deterministic.
    """
    keys = set(data.keys())
    required = set(CANONICAL_CLAIM_ORDER)
    missing = [field for field in CANONICAL_CLAIM_ORDER if field not in keys]
    extras = sorted(keys - required)

    if missing:
        raise SignedSchemaError(f"Missing required signed claim fields: {missing}")
    if extras:
        raise SignedSchemaError(f"Unknown signed claim fields are not allowed: {extras}")

    version = _require_non_empty_string("version", data["version"])
    if version != "1":
        raise SignedSchemaError("Field 'version' must be exactly '1' for this PoC")

    claims = SignedQRCodeClaims(
        version=version,
        usage_policy=_parse_usage_policy(data["usage_policy"]),
        certificate_ref=_require_non_empty_string("certificate_ref", data["certificate_ref"]),
        issued_at=_require_non_empty_string("issued_at", data["issued_at"]),
        expires_at=_require_non_empty_string("expires_at", data["expires_at"]),
        nonce=_require_non_empty_string("nonce", data["nonce"]),
        payload=_require_non_empty_string("payload", data["payload"]),
    )

    issued_at = _parse_timestamp("issued_at", claims.issued_at)
    expires_at = _parse_timestamp("expires_at", claims.expires_at)
    if expires_at <= issued_at:
        raise SignedSchemaError("Field 'expires_at' must be later than 'issued_at'")

    return claims


def canonicalize_claims(claims: SignedQRCodeClaims) -> str:
    """
    Serialize the signed claims using a fixed field order and compact JSON.
    """
    ordered_claims = {field: getattr(claims, field) for field in CANONICAL_CLAIM_ORDER}
    return json.dumps(ordered_claims, separators=(",", ":"), ensure_ascii=True)


def canonical_claims_sha256(claims: SignedQRCodeClaims) -> str:
    canonical = canonicalize_claims(claims)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


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
