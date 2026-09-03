from __future__ import annotations

import logging
import re
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from ipaddress import ip_address
from secrets import compare_digest
from typing import Any, cast, get_args
from urllib.parse import ParseResult, urlparse
from uuid import uuid4

import asyncpg
from fastapi import APIRouter, HTTPException, Query, Request, Response

from backend.app.core.config import config
from backend.app.core.request_id import safe_request_id
from backend.app.schemas.poc import (
    ScanActivityDestinationOutcome,
    ScanActivityResponse,
    ScanActivityThrottleResponse,
    CertificateRecordInput,
    DemoMaterialsRequest,
    DemoMaterialsResponse,
    DemoTrustEcho,
    IssuerVerificationStateInput,
    ModelDecisionResponse,
    NarrowedVerifierRequest,
    NarrowedVerifierResponse,
    NetworkOutboxOperatorStatusResponse,
    QRCodeImageDecodeRequest,
    QRCodeImageDecodeResponse,
    ResidualCause,
    ResidualEntry,
    ScannerDecisionAction,
    ScannerDecisionContract,
    ScannerDecisionContractCacheFreshness,
    ScannerDecisionContractDestination,
    ScannerDecisionContractHoldToOpen,
    ScannerDecisionContractTrustPath,
    ScannerDecisionContractTrustStep,
    ScannerDecisionDestination,
    ScannerDecisionGovernance,
    ScannerDecisionIssuer,
    ScannerDecisionOperatorStatusResponse,
    ScannerDecisionRequest,
    ScannerDecisionResponse,
    ScannerDecisionSignal,
    ScannerDecisionUX,
    ScannerOperationalState,
    ScannerUXExperimentFixtureResponse,
    ScannerUXEventLogEntry,
    ScannerUXEventLogListResponse,
    ScannerUXEventLogRequest,
    ScannerUXEventLogResponse,
    ScannedVerifierRequest,
    SignedClaimsInput,
    SignedEnvelopeInput,
    RuntimeSafetyObservationOperatorStatusResponse,
    TrustStoreIssuerResponse,
    TrustStoreKeyResponse,
    TrustStoreResponse,
    VerifierAPIKeyIssueRequest,
    VerifierAPIKeyIssueResponse,
    VerifierAPIKeyListResponse,
    VerifierAPIKeyRevokeResponse,
    VerifierAPIKeyRotateRequest,
    VerifierProfileState,
    VerifierProviderProfileResponse,
    VerifierStatusResponse,
)
from backend.app.services.qr_artifact_poc import (
    QRArtifactAnalysis,
    QRArtifactError,
    analyze_qr_artifact_from_png_bytes,
    decode_image_base64,
    decode_envelope_from_qr_payload,
    decode_qr_payload_from_png_bytes,
    encode_envelope_as_qr_payload,
    render_qr_png_base64,
)
from backend.app.services.narrowed_verifier_poc import (
    NarrowedVerifierService,
    TrustContext,
)
from backend.app.services.payload_revalidation_poc import (
    PolicyResolution,
    load_destination_policy_resolution,
    normalized_verified_domains,
)
from backend.app.services.scanner_trust_store import (
    IssuerRecord,
    KeyEntry,
    ScannerTrustStore,
)
from backend.app.services.trust_state import TrustStateToken
from backend.app.services.trust_projection import TrustProjectionManager
from backend.app.services.governance_fixture_store import (
    GovernanceTrustProjection,
    load_governance_projection,
)
from backend.app.services.request_rate_limiter import RequestRateLimiter
from backend.app.services.redirect_policy_poc import (
    RedirectPolicyVerdict,
    evaluate_unobserved_redirect_policy,
)
from backend.app.services.runtime_safety_poc import (
    RuntimeSafetyVerdict,
    evaluate_runtime_safety,
)
from backend.app.services.trust_residuals_decision import (
    Decision,
    decide as decide_trust_residuals,
)
from backend.app.services import scan_accounting
from backend.app.services.network_outbox_status import load_network_outbox_operator_status
from backend.app.services.network_evidence_recorder import record_scanner_evidence
from backend.app.services.management_auth import (
    ManagementPrincipal,
    ManagementUnauthorized,
    load_management_principal,
    require_scope,
)
from backend.app.services.runtime_observation_status import (
    load_runtime_observation_operator_status,
)
from backend.app.services.scan_activity import (
    DEFAULT_SCAN_ACTIVITY_LOOKBACK_SECONDS,
    load_scan_activity,
    envelope_fingerprint as _envelope_fingerprint,
)
from backend.app.services.scanner_decision_status import load_scanner_decision_operator_status
from backend.app.services.scanner_ux_ab_fixture import build_scanner_ux_ab_fixture
from backend.app.services.verdict_cache import shared_verdict_cache
from backend.app.services.signed_schema_poc import (
    CertificateAuthorityRecord,
    SUPPORTED_ALGORITHM_ID,
    SUPPORTED_CLAIMS_VERSION,
    SignedQRCodeClaims,
    SignedQRCodeEnvelope,
    SignedSchemaError,
    build_demo_certificate,
    compute_envelope_id,
    create_signed_envelope,
    parse_claim_timestamp,
    parse_claims_mapping,
)
from backend.app.services.verifier_api_key_service import (
    VerifierAPIKeyStoreUnavailable,
    verifier_api_key_service,
)
from backend.app.services.redis_service import redis_service

router = APIRouter()
scanner_router = APIRouter()
logger = logging.getLogger(__name__)

_verifier = NarrowedVerifierService()
_request_rate_limiter = RequestRateLimiter()
_verdict_cache = shared_verdict_cache
_scanner_ux_event_log: deque[ScannerUXEventLogEntry] = deque(maxlen=500)
_LEGACY_VERIFIER_ADMIN_API_KEYS_DETAIL = (
    "Verifier API key management moved to /admin/verifier-clients/api-keys. "
    "Use the management API so verifier client key changes are scoped and audited."
)
_VALID_VERIFIER_PROFILE_STATES = frozenset({"active", "stale", "revoked"})
_OPERATOR_STATUS_READ_SCOPES = ("audit:read", "outbox:read", "runtime:read")


@dataclass(frozen=True)
class ScannerTrustRecord:
    certificate: CertificateRecordInput
    issuer_state: IssuerVerificationStateInput
    governance: GovernanceTrustProjection | None = None


# The scanner's registry of who it will trust. The store is keyed by key_ref, so
# two issuances under different keys of the same issuer coexist — the old dict was
# keyed by certificate_ref and each demo call silently evicted the previous QR.
_scanner_trust_store = ScannerTrustStore()

_trust_projection_manager = TrustProjectionManager(
    max_staleness_seconds=config.TRUST_STATE_MAX_STALENESS_SECONDS
)


async def _ensure_trust_projection() -> str:
    dsn = _management_database_url()
    if dsn is None:
        connect = None
    else:
        resolved = _asyncpg_dsn(dsn)

        async def connect() -> asyncpg.Connection:
            return await asyncpg.connect(resolved, timeout=2.0)

    return await _trust_projection_manager.ensure_fresh(
        store=_scanner_trust_store,
        connect=connect,
        now=datetime.now(timezone.utc),
    )


@dataclass(frozen=True)
class _DemoKeyMaterial:
    key_ref: str
    private_key_pem: str
    public_key_pem: str


# Append-only, oldest first. The demo issuer keeps its keys for the life of the
# process so a QR issued five minutes ago still resolves to the key that signed
# it — the previous code minted a fresh keypair per request under one ref.
_demo_keys: list[_DemoKeyMaterial] = []

_DEMO_ISSUER_NAME = "Acme Demo Issuer"
_DEMO_KEY_REF_BASE = "cert:acme-demo:2026-01"


def _mint_demo_key() -> _DemoKeyMaterial:
    serial = len(_demo_keys)
    key_ref = _DEMO_KEY_REF_BASE if serial == 0 else f"{_DEMO_KEY_REF_BASE}-r{serial}"
    certificate, private_key_pem = build_demo_certificate(
        issuer_name=_DEMO_ISSUER_NAME, certificate_ref=key_ref
    )
    material = _DemoKeyMaterial(
        key_ref=key_ref,
        private_key_pem=private_key_pem,
        public_key_pem=certificate.public_key_pem,
    )
    _demo_keys.append(material)
    return material


def _active_demo_key(*, rotate: bool) -> _DemoKeyMaterial:
    """The keypair the next demo issuance signs under.

    Reuse is the default — that is what lets a QR issued five minutes ago still
    resolve to the key that signed it. The exception is a current ref the store
    has already moved off ``active``: signing under it again would re-publish it
    as active, which un-revokes a revoked key and lets every artifact it signed
    verify again (spec Q3 makes revocation terminal). A ref the store has never
    heard of — a fresh process, or a test fixture that cleared the store — is
    reused unchanged, so the demo issuer keeps its base ref.
    """
    if rotate or not _demo_keys:
        return _mint_demo_key()
    current = _demo_keys[-1]
    stored = next(
        (entry for entry in _scanner_trust_store.keys() if entry.key_ref == current.key_ref),
        None,
    )
    if stored is not None and stored.state != "active":
        return _mint_demo_key()
    return current


# Payload encoded into the rendered QR image for the payload-mismatch artifact
# profile. It stands in for an attacker sticker pasted over a legitimate print,
# so it must differ from any signed demo payload.
_ARTIFACT_MISMATCH_OVERLAY_PAYLOAD = "https://evil.example/pay"
_COMMON_MULTI_LABEL_PUBLIC_SUFFIXES = frozenset(
    {
        "ac.uk",
        "co.in",
        "co.jp",
        "co.nz",
        "co.uk",
        "com.au",
        "com.br",
        "com.mx",
        "gov.uk",
        "ne.jp",
        "net.au",
        "org.au",
        "org.uk",
    }
)
_COMMON_SECOND_LEVEL_CCTLD_LABELS = frozenset(
    {
        "ac",
        "co",
        "com",
        "edu",
        "go",
        "gov",
        "mil",
        "ne",
        "net",
        "or",
        "org",
    }
)
_LOCAL_KNOWN_BAD_SCANNER_DOMAINS = frozenset(
    {"evil.example", "malware.example", "phish.example"}
)
_DOMAIN_TEXT_RE = re.compile(
    r"(?<!@)\b(?:https?://)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)\b",
    re.IGNORECASE,
)
def _safe_request_id(value: str | None) -> str:
    return safe_request_id(value)


def _request_id_for_context(request: Request) -> str:
    request_id = getattr(request.state, "request_id", None)
    if isinstance(request_id, str):
        return _safe_request_id(request_id)
    return _safe_request_id(request.headers.get("X-Request-ID"))


def _scanner_governance_response(
    governance: GovernanceTrustProjection | None,
) -> ScannerDecisionGovernance | None:
    if governance is None:
        return None

    return ScannerDecisionGovernance(
        root_program_id=governance.root_program_id,
        delegated_authority_id=governance.delegated_authority_id,
        issuer_id=governance.issuer_id,
        issuer_namespace_label=governance.issuer_namespace_label,
        issuer_display_name=governance.issuer_display_name,
        assurance_tier=governance.assurance_tier,
        destination_policy_id=governance.destination_policy_id,
        cache_entry_id=governance.cache_entry_id,
        cache_freshness_state=governance.cache_freshness_state(),
        cache_state_published_at=governance.cache_state_published_at,
        cache_generated_at=governance.cache_generated_at,
        cache_expires_at=governance.cache_expires_at,
        max_staleness_seconds=governance.max_staleness_seconds,
        stale_behavior=governance.stale_behavior,
        source_artifacts=governance.source_artifacts,
    )


def _configured_verifier_api_keys() -> list[str]:
    return verifier_api_key_service.configured_api_keys()


def _configured_admin_tokens() -> list[str]:
    return verifier_api_key_service.configured_admin_tokens()


def _configured_verifier_profile_state() -> VerifierProfileState:
    state = config.VERIFIER_PROVIDER_PROFILE_STATE.strip().lower()
    if state in _VALID_VERIFIER_PROFILE_STATES:
        return cast(VerifierProfileState, state)
    logger.warning(
        "Ignoring invalid VERIFIER_PROVIDER_PROFILE_STATE=%r; falling back to active",
        config.VERIFIER_PROVIDER_PROFILE_STATE,
    )
    return "active"


def _is_safe_request_base_host(host: str) -> bool:
    normalized = host.strip().strip("[]").lower()
    if normalized in {"localhost", "testserver"}:
        return True
    try:
        address = ip_address(normalized)
    except ValueError:
        return False
    return address.is_loopback or address.is_private


def _request_host_base_url(request: Request) -> str | None:
    raw_host = request.headers.get("host", "").strip()
    if not raw_host:
        return None
    parsed = _parse_url_with_valid_port(f"//{raw_host}")
    if (
        parsed is None
        or parsed.username
        or parsed.password
        or parsed.hostname is None
        or not _is_safe_request_base_host(parsed.hostname)
    ):
        return None
    scheme = str(request.scope.get("scheme") or request.url.scheme or "http")
    return f"{scheme}://{parsed.netloc}"


def _request_public_base_url(request: Request) -> str:
    configured = (config.VERIFIER_PUBLIC_BASE_URL or "").strip().rstrip("/")
    if configured:
        parsed = _parse_url_with_valid_port(configured)
        if (
            parsed is not None
            and parsed.scheme in {"http", "https"}
            and parsed.netloc
            and not parsed.username
            and not parsed.password
        ):
            return f"{parsed.scheme}://{parsed.netloc}"
        logger.warning(
            "Ignoring invalid VERIFIER_PUBLIC_BASE_URL=%r; falling back to request base URL",
            config.VERIFIER_PUBLIC_BASE_URL,
        )
    host_base_url = _request_host_base_url(request)
    if host_base_url is not None:
        return host_base_url
    server = request.scope.get("server")
    if isinstance(server, tuple) and server and server[0]:
        host = str(server[0]).strip("[]")
        port = int(server[1]) if len(server) > 1 and server[1] else None
        scheme = str(request.scope.get("scheme") or request.url.scheme or "http")
        default_port = (scheme == "http" and port == 80) or (
            scheme == "https" and port == 443
        )
        port_label = "" if port is None or default_port else f":{port}"
        return f"{scheme}://{host}{port_label}"
    return "http://127.0.0.1"


def _parse_url_with_valid_port(value: str) -> ParseResult | None:
    try:
        parsed = urlparse(value)
        _ = parsed.port
    except ValueError:
        return None
    return parsed


async def _verifier_auth_enabled() -> bool:
    return await verifier_api_key_service.auth_is_enabled()


async def _request_identity_key(request: Request) -> str:
    provided_api_key = request.headers.get(config.VERIFIER_API_KEY_HEADER)
    if provided_api_key:
        try:
            if await verifier_api_key_service.has_valid_key(provided_api_key):
                digest = sha256(provided_api_key.encode("utf-8")).hexdigest()[:16]
                return f"key:{digest}"
        except Exception as exc:
            # The rule fires on a logger call inside a function that holds a
            # credential-named variable. What is logged is the exception, not
            # provided_api_key -- and the key never leaves this scope except as
            # the truncated sha256 digest above.
            # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
            logger.warning("verifier_api_key_identity_unavailable: %s", exc)

    client = request.client.host if request.client else "unknown"
    return f"ip:{client.strip() or 'unknown'}"


async def _enforce_verifier_api_key(request: Request) -> None:
    if not await _verifier_auth_enabled():
        return

    provided_api_key = request.headers.get(config.VERIFIER_API_KEY_HEADER)
    if not provided_api_key:
        raise HTTPException(
            status_code=401,
            detail="Missing verifier API key",
        )

    try:
        if await verifier_api_key_service.has_valid_key(provided_api_key):
            return
    except VerifierAPIKeyStoreUnavailable as exc:
        # Same shape as the identity path above: the store is unreachable, so
        # there is no credential to disclose. The exception is what gets logged,
        # and the request then fails closed with a 503.
        # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
        logger.warning("verifier_api_key_store_unavailable: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Verifier API key store unavailable",
        ) from exc

    raise HTTPException(
        status_code=403,
        detail="Invalid verifier API key",
    )


def _request_has_valid_admin_token(request: Request) -> bool:
    provided_token = request.headers.get(config.VERIFIER_ADMIN_HEADER)
    if not provided_token:
        return False
    return any(
        compare_digest(provided_token, expected_token)
        for expected_token in _configured_admin_tokens()
    )


def _asyncpg_dsn(dsn: str) -> str:
    if dsn.startswith("postgresql+asyncpg://"):
        return dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
    return dsn


def _management_database_url() -> str | None:
    return config.QRTRUST_NETWORK_DATABASE_URL or config.DATABASE_URL


def _management_principal_can_read_operator_status(
    principal: ManagementPrincipal,
) -> bool:
    for scope in _OPERATOR_STATUS_READ_SCOPES:
        try:
            require_scope(principal, scope)
            return True
        except ManagementUnauthorized:
            continue
    return False


async def _request_has_valid_management_credential(request: Request) -> bool:
    provided_token = request.headers.get(config.VERIFIER_ADMIN_HEADER)
    if not provided_token:
        return False
    if _request_has_valid_admin_token(request):
        return True

    dsn = _management_database_url()
    if dsn is None:
        return False

    connection = None
    try:
        connection = await asyncpg.connect(_asyncpg_dsn(dsn))
        principal = await load_management_principal(connection, provided_token)
    except Exception as exc:
        # The connect/lookup pair failed, so no principal was resolved and
        # provided_token is never interpolated into the message. Logging the
        # exception is what makes an unreachable management database
        # diagnosable; the function still returns False and denies the request.
        # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
        logger.warning("management_status_credential_unavailable: %s", exc)
        return False
    finally:
        if connection is not None:
            await connection.close()

    if principal is None:
        return False
    return _management_principal_can_read_operator_status(principal)


async def _request_can_read_operator_status(request: Request) -> bool:
    if not await _verifier_auth_enabled():
        return True
    return await _request_has_valid_management_credential(request)


def _enforce_verifier_admin_token(request: Request) -> None:
    configured_admin_tokens = _configured_admin_tokens()
    if not configured_admin_tokens:
        raise HTTPException(
            status_code=503,
            detail="Verifier admin flow is not configured",
        )

    provided_token = request.headers.get(config.VERIFIER_ADMIN_HEADER)
    if not provided_token:
        raise HTTPException(
            status_code=401,
            detail="Missing verifier admin token",
        )

    if any(compare_digest(provided_token, expected_token) for expected_token in configured_admin_tokens):
        return

    raise HTTPException(
        status_code=403,
        detail="Invalid verifier admin token",
    )


def _raise_legacy_verifier_admin_api_key_route() -> None:
    raise HTTPException(status_code=410, detail=_LEGACY_VERIFIER_ADMIN_API_KEYS_DETAIL)


async def _enforce_verifier_rate_limit(request: Request, *, bucket: str) -> None:
    limit = (
        config.VERIFIER_DECODE_RATE_LIMIT_MAX_REQUESTS
        if bucket == "decode_image"
        else config.VERIFIER_RATE_LIMIT_MAX_REQUESTS
    )
    identity_key = await _request_identity_key(request)
    decision = await _request_rate_limiter.check(
        f"{bucket}:{identity_key}",
        limit=limit,
        window_seconds=config.VERIFIER_RATE_LIMIT_WINDOW_SECONDS,
    )
    if decision.allowed:
        return

    raise HTTPException(
        status_code=429,
        detail="Rate limit exceeded for verifier endpoint",
        headers={"Retry-After": str(decision.retry_after_seconds or 1)},
    )


_LOOPBACK_FORWARDED_ALLOW_IPS = frozenset({"127.0.0.1", "::1", "localhost"})


def _forwarded_ip_trust_configured() -> bool:
    """True when FORWARDED_ALLOW_IPS trusts anything beyond loopback.

    Loopback is uvicorn's default, so an explicit 127.0.0.1 (the compose
    default) changes nothing: X-Forwarded-For from a real proxy is still
    ignored and the per-client limit keys on the proxy's address.
    """
    entries = {
        entry.strip()
        for entry in config.FORWARDED_ALLOW_IPS.split(",")
        if entry.strip()
    }
    return bool(entries - _LOOPBACK_FORWARDED_ALLOW_IPS)


def _issuer_budget_key(certificate_ref: str) -> str:
    return sha256(certificate_ref.encode("utf-8")).hexdigest()[:16]


_VERDICT_SOURCE_HEADER = "X-QR-Trust-Verdict"


def _verdict_cache_key(
    request: NarrowedVerifierRequest,
    fingerprint: str,
    *,
    token: TrustStateToken | None,
    resolution: PolicyResolution | None,
) -> str:
    """``(envelope_fingerprint, request_hash)``: the hash covers the whole
    request plus the governance identity the verdict was computed under —
    the trust_state token (epoch AND version: a healed row restarting at
    version 1 must not collide with the old epoch's version 1) and the
    identity of the destination policy actually evaluated. Hashing the
    validated model dump means normalization runs before hashing, so the
    legacy list spelling and the map spelling of ``verified_domains``
    share one entry."""
    token_part = "ephemeral" if token is None else f"{token.epoch}:{token.version}"
    policy_part = (
        "no-policy"
        if resolution is None
        else f"{resolution.source}:{resolution.name}:{resolution.digest}"
    )
    material = "\n".join((request.model_dump_json(), token_part, policy_part))
    return f"{fingerprint}:{sha256(material.encode('utf-8')).hexdigest()[:32]}"


def _verdict_cache_ttl_seconds(
    expires_at: str | None,
    *,
    consulted_boundaries: Iterable[datetime | None] = (),
) -> int:
    """min(configured TTL, seconds until the claims expire, seconds until
    each consulted trust boundary passes); 0 means do not cache. A boundary
    already in the past never enters the min(): the serve-time rule folded
    it into the verdict, and that verdict stays correct until a row change
    bumps the trust_state token that keys the cache."""
    ttl = config.VERIFIER_VERDICT_CACHE_TTL_SECONDS
    if ttl <= 0:
        return 0
    now = datetime.now(timezone.utc)
    if expires_at is not None:
        # Open-ended claims never expire, so nothing shortens the configured
        # TTL on their account.
        try:
            expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except ValueError:
            return 0
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        until_expiry = int((expiry - now).total_seconds())
        if until_expiry <= 0:
            return 0
        ttl = min(ttl, until_expiry)
    for boundary in consulted_boundaries:
        if boundary is None:
            continue
        if boundary.tzinfo is None:
            boundary = boundary.replace(tzinfo=timezone.utc)
        remaining = int((boundary - now).total_seconds())
        if remaining > 0:
            ttl = min(ttl, remaining)
    return ttl


def _set_verdict_source_header(response: Response, source: str) -> None:
    response.headers[_VERDICT_SOURCE_HEADER] = source


def _scan_flood_budget_key(bucket: str, subject: str) -> str:
    return f"{bucket}:{subject}"


async def _enforce_scan_flood_budget(
    *,
    bucket: str,
    subject: str,
    limit: int,
    detail: str,
) -> None:
    """Shared per-subject budget, keyed by envelope or by issuer.

    Keyed on the subject rather than the caller, so a flood spread across many
    source addresses still lands in one bucket. Uses the same limiter as the
    per-client limit: Redis-coordinated when connected, per-process otherwise.
    """
    decision = await _request_rate_limiter.check(
        _scan_flood_budget_key(bucket, subject),
        limit=limit,
        window_seconds=config.VERIFIER_ENVELOPE_RATE_LIMIT_WINDOW_SECONDS,
    )
    if decision.allowed:
        return
    raise HTTPException(
        status_code=429,
        detail=detail,
        headers={"Retry-After": str(decision.retry_after_seconds or 1)},
    )


def _build_demo_materials_response(
    request: DemoMaterialsRequest,
) -> DemoMaterialsResponse:
    now = datetime.now(timezone.utc)
    material = _active_demo_key(rotate=request.rotate_key)
    certificate_input = CertificateRecordInput(
        issuer_name=_DEMO_ISSUER_NAME,
        certificate_ref=material.key_ref,
        algorithm_id=SUPPORTED_ALGORITHM_ID,
        public_key_pem=material.public_key_pem,
    )
    issued_at = now + timedelta(minutes=request.issued_offset_minutes)
    expires_at = (
        None
        if request.expires_offset_minutes is None
        else (now + timedelta(minutes=request.expires_offset_minutes)).isoformat()
    )
    claims = SignedQRCodeClaims(
        version=SUPPORTED_CLAIMS_VERSION,
        certificate_ref=certificate_input.certificate_ref,
        issued_at=issued_at.isoformat(),
        expires_at=expires_at,
        payload=request.payload,
    )
    envelope = create_signed_envelope(
        claims,
        material.private_key_pem,
        code_algorithm_id=SUPPORTED_ALGORITHM_ID,
    )

    issuer_record_expires_at = (
        None
        if request.issuer_record_expires_offset_minutes is None
        else (
            now + timedelta(minutes=request.issuer_record_expires_offset_minutes)
        ).isoformat()
    )
    # On this surface a revoked certificate means a revoked KEY: the workbench's
    # "revoked" chip is about the code in the user's hand, not about tearing down
    # the issuer. /verifier/verify maps the same legacy flag to issuer status,
    # because there the caller is describing an issuer's state directly.
    key_state = request.key_state or ("revoked" if request.certificate_revoked else "active")
    issuer_status = "active" if request.certificate_active else "suspended"
    issuer_state_input = IssuerVerificationStateInput(
        verified_domains=request.verified_domains,
        allow_subdomains=request.allow_subdomains,
        certificate_active=request.certificate_active,
        certificate_revoked=request.certificate_revoked,
        certificate_revocation_reason=request.certificate_revocation_reason,
        issuer_status=issuer_status,
        issuer_record_expires_at=issuer_record_expires_at,
        key_state=key_state,
        key_revocation_reason=request.certificate_revocation_reason,
    )

    verify_request = NarrowedVerifierRequest(
        envelope=SignedEnvelopeInput(
            claims=SignedClaimsInput(**claims.__dict__),
            signature=envelope.signature,
            code_algorithm_id=envelope.code_algorithm_id,
        ),
        certificate=certificate_input,
        issuer_state=issuer_state_input,
    )
    qr_payload = encode_envelope_as_qr_payload(envelope)

    governance = load_governance_projection(
        certificate_input.certificate_ref,
        cache_profile=request.governance_cache_profile,
    )
    # The rendered PNG normally matches the signed payload with a full quiet
    # zone. The artifact profiles produce tampered prints for the lab: a
    # low-quiet-zone render trips the visual artifact warning, and a
    # payload-mismatch render encodes an attacker payload so the image no
    # longer matches the submitted scanner payload.
    if request.artifact_profile == "low-quiet-zone":
        qr_png_base64 = render_qr_png_base64(qr_payload, border=0)
    elif request.artifact_profile == "payload-mismatch":
        qr_png_base64 = render_qr_png_base64(_ARTIFACT_MISMATCH_OVERLAY_PAYLOAD)
    else:
        qr_png_base64 = render_qr_png_base64(qr_payload)

    # Demo materials normally enroll the certificate in the scanner trust
    # store; skipping enrollment yields a signed envelope whose issuer the
    # scanner does not recognize (the signed_unknown_issuer path).
    if request.register_scanner_trust:
        _register_scanner_trust(
            certificate_input,
            issuer_state_input,
            governance=governance,
        )
        if request.rotate_key:
            _scanner_trust_store.retire_keys_for(
                _DEMO_ISSUER_NAME, now=now, except_key_ref=material.key_ref
            )
    else:
        # The demo certificate_ref is shared across generations, so an earlier
        # demo may have enrolled it; drop it so the ref is genuinely unknown.
        _unregister_scanner_trust(certificate_input.certificate_ref)

    retired_key_refs = [
        entry.key_ref
        for entry in _scanner_trust_store.keys()
        if entry.issuer_id == _DEMO_ISSUER_NAME and entry.state == "retired"
    ]

    return DemoMaterialsResponse(
        certificate=certificate_input,
        issuer_state=issuer_state_input,
        governance=_scanner_governance_response(governance),
        verify_request=verify_request,
        qr_payload=qr_payload,
        qr_png_base64=qr_png_base64,
        envelope_id=compute_envelope_id(claims, envelope.signature),
        trust=DemoTrustEcho(
            key_ref=material.key_ref,
            key_state=key_state,
            issuer_status=issuer_status,
            retired_key_refs=retired_key_refs,
        ),
    )


def _register_scanner_trust(
    certificate: CertificateRecordInput,
    issuer_state: IssuerVerificationStateInput,
    *,
    governance: GovernanceTrustProjection | None = None,
    key_state: str = "active",
    key_not_before: datetime | None = None,
    key_not_after: datetime | None = None,
) -> None:
    """Publish an issuer and one of its signing keys to the scanner's trust store.

    The governance projection is looked up by certificate_ref (that is how the
    fixture file is keyed) but stored under issuer_id (that is the scope it
    actually describes). Keeping both halves explicit is the point: an issuer
    with two keys must not carry two governance rows.
    """
    resolved_governance = (
        governance
        if governance is not None
        else load_governance_projection(certificate.certificate_ref)
    )
    issuer_id = certificate.issuer_name
    _scanner_trust_store.put_issuer(
        IssuerRecord(
            issuer_id=issuer_id,
            issuer_name=certificate.issuer_name,
            root_id="root:qrtrust-demo",
            status=_legacy_issuer_status(issuer_state),
            issued_at=_bounded_trust_timestamp(
                "issuer_record_issued_at",
                issuer_state.issuer_record_issued_at,
                default=_UNBOUNDED_PAST,
            ),
            expires_at=_optional_trust_timestamp(
                "issuer_record_expires_at", issuer_state.issuer_record_expires_at
            ),
            verified_domains=dict(issuer_state.verified_domains),
            allow_subdomains=issuer_state.allow_subdomains,
        )
    )
    _scanner_trust_store.put_key(
        KeyEntry(
            key_ref=certificate.certificate_ref,
            issuer_id=issuer_id,
            algorithm_id=certificate.algorithm_id,
            public_key_pem=certificate.public_key_pem,
            state=issuer_state.key_state or key_state,
            not_before=key_not_before or _UNBOUNDED_PAST,
            not_after=key_not_after,
            revocation_reason=issuer_state.key_revocation_reason
            or issuer_state.certificate_revocation_reason,
        )
    )
    if resolved_governance is not None:
        _scanner_trust_store.set_governance(issuer_id, resolved_governance)


def _scanner_record_for(key_ref: str) -> ScannerTrustRecord | None:
    """Rebuild the record shape the scanner consumers already read.

    The store is the storage; this is a view over it. Round-tripping through
    IssuerVerificationStateInput means _run_scanned_verifier's TrustContext is
    re-derived by the same adapter /verifier/verify uses, so both surfaces judge
    an artifact identically.
    """
    resolved = _scanner_trust_store.resolve(key_ref)
    if resolved is None:
        return None

    key, issuer = resolved
    return ScannerTrustRecord(
        certificate=CertificateRecordInput(
            issuer_name=issuer.issuer_name,
            certificate_ref=key.key_ref,
            algorithm_id=key.algorithm_id,
            public_key_pem=key.public_key_pem,
        ),
        issuer_state=IssuerVerificationStateInput(
            verified_domains=dict(issuer.verified_domains),
            allow_subdomains=issuer.allow_subdomains,
            certificate_active=issuer.status == "active",
            certificate_revoked=issuer.status == "revoked",
            certificate_revocation_reason=key.revocation_reason,
            issuer_status=issuer.status,
            issuer_record_issued_at=issuer.issued_at.isoformat(),
            issuer_record_expires_at=(
                issuer.expires_at.isoformat() if issuer.expires_at is not None else None
            ),
            key_state=key.state,
            key_not_before=key.not_before.isoformat(),
            key_not_after=(
                key.not_after.isoformat() if key.not_after is not None else None
            ),
            key_revocation_reason=key.revocation_reason,
        ),
        governance=_scanner_trust_store.governance_for(issuer.issuer_id),
    )


def _unregister_scanner_trust(key_ref: str) -> None:
    _scanner_trust_store.remove_key(key_ref)


def _parsed_http_url(value: str) -> ParseResult | None:
    parsed = urlparse(value)
    if parsed.scheme.lower() not in {"http", "https"}:
        return None
    return parsed


def _url_host(value: str) -> str | None:
    parsed = _parsed_http_url(value)
    if parsed is None or parsed.hostname is None:
        return None
    return parsed.hostname.strip(".").lower() or None


def _looks_like_url(value: str) -> bool:
    return _url_host(value) is not None


def _scanner_destination(
    value: str,
    *,
    binding: str,
    resolver_url: str | None = None,
    final_url: str | None = None,
    redirect_hops: int | None = None,
    redirect_policy: str | None = None,
) -> ScannerDecisionDestination:
    return ScannerDecisionDestination(
        display_url=value[:2048],
        host=_url_host(value),
        binding=binding,
        resolver_url=resolver_url[:2048] if resolver_url else None,
        final_url=final_url[:2048] if final_url else None,
        redirect_hops=redirect_hops,
        redirect_policy=redirect_policy,
    )


def _scanner_actions(*, decision_state: str, open_allowed: bool) -> list[ScannerDecisionAction]:
    if decision_state == "blocked":
        return [
            ScannerDecisionAction(id="dismiss", label="Do not open", style="danger"),
            ScannerDecisionAction(id="copy_destination", label="Copy destination", style="secondary"),
        ]
    if decision_state == "verified_issuer":
        return [
            ScannerDecisionAction(id="open_destination", label="Open verified destination", style="primary"),
            ScannerDecisionAction(id="copy_destination", label="Copy destination", style="secondary"),
        ]
    if open_allowed:
        return [
            ScannerDecisionAction(id="continue_caution", label="Continue with caution", style="warning"),
            ScannerDecisionAction(id="copy_destination", label="Copy destination", style="secondary"),
        ]
    return [
        ScannerDecisionAction(id="dismiss", label="Do not open", style="danger"),
        ScannerDecisionAction(id="copy_payload", label="Copy payload", style="secondary"),
    ]


def _registrable_domain(host: str | None) -> str | None:
    if not host:
        return None

    normalized = host.strip().strip(".").lower()
    if not normalized:
        return None
    if normalized == "localhost" or normalized.replace(".", "").isdigit():
        return normalized

    labels = [label for label in normalized.split(".") if label]
    if len(labels) < 2:
        return normalized
    suffix = ".".join(labels[-2:])
    if suffix in _COMMON_MULTI_LABEL_PUBLIC_SUFFIXES and len(labels) >= 3:
        return ".".join(labels[-3:])
    second_level = labels[-2]
    tld = labels[-1]
    if (
        len(tld) == 2
        and second_level in _COMMON_SECOND_LEVEL_CCTLD_LABELS
        and len(labels) >= 3
    ):
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def _domain_fingerprint(domain: str | None) -> str | None:
    if not domain:
        return None

    labels = domain.split(".")
    if len(labels) < 2:
        return domain

    tld = labels[-1]
    body = ".".join(labels[:-1])
    if len(body) <= 8:
        return domain
    return f"{body[:3]}...{body[-3:]}.{tld}"


def _is_https_absent(value: str) -> bool:
    parsed = _parsed_http_url(value)
    return parsed is not None and parsed.scheme.lower() == "http"


def _has_embedded_credentials(value: str) -> bool:
    parsed = _parsed_http_url(value)
    if parsed is None:
        return False
    return parsed.username is not None or parsed.password is not None


def _normalized_host(value: str | None) -> str | None:
    if not value:
        return None

    parsed = _parsed_http_url(value)
    host = parsed.hostname if parsed is not None else value
    normalized = host.strip().strip(".").lower()
    return normalized or None


def _host_identity_set(value: str | None) -> set[str]:
    host = _normalized_host(value)
    if not host:
        return set()

    return {item for item in {host, _registrable_domain(host)} if item}


def _request_host_set(values: list[str] | None) -> set[str]:
    hosts: set[str] = set()
    for value in values or []:
        hosts.update(_host_identity_set(value))
    return hosts


def _scanner_risk_hosts(response: ScannerDecisionResponse) -> list[str]:
    hosts: list[str] = []
    for value in _scanner_risk_urls(response):
        hosts.extend(_host_identity_set(value))
    hosts.extend(_host_identity_set(response.destination.host))
    return list(dict.fromkeys(hosts))


def _caption_domains(value: str | None) -> set[str]:
    domains: set[str] = set()
    if not value:
        return domains

    for match in _DOMAIN_TEXT_RE.finditer(value):
        domains.update(_host_identity_set(match.group(1)))
    return domains


def _domain_age_for_host(
    request: ScannerDecisionRequest | None,
    host: str,
) -> int | None:
    if request is None:
        return None

    for identity in _host_identity_set(host):
        value = request.domain_age_days.get(identity)
        if value is not None:
            return value
    return None


def _scanner_risk_urls(response: ScannerDecisionResponse) -> list[str]:
    urls = [
        response.destination.display_url,
        response.destination.resolver_url,
        response.destination.final_url,
    ]
    return list(dict.fromkeys(url for url in urls if url))


_SCANNER_CONTRACT_LAYER_LABELS = {
    "issuer_legitimacy": "Issuer legitimacy",
    "destination_binding": "Destination binding",
    "runtime_safety": "Runtime safety",
    "scanner_decision": "Scanner decision",
}

_SCANNER_CONTRACT_DEFAULT_MESSAGES = {
    "issuer_legitimacy": "Issuer enrollment was not confirmed.",
    "destination_binding": "Destination binding was not evaluated.",
    "runtime_safety": "Runtime safety was not evaluated.",
    "scanner_decision": "Scanner-visible decision was produced.",
}

# `model_decision` is the protocol/conformance surface. `decision_state` is a
# product state whose presentation may be stricter, but never less attentive,
# than the model result attached to the same response. Keeping the operational
# vocabulary here makes a newly emitted state fail closed until its UX posture
# is reviewed and mapped.
_SCANNER_OPERATIONAL_STATES = frozenset(get_args(ScannerOperationalState))
_MODEL_ATTENTION_RANK = {
    "positive": 0,
    "neutral": 1,
    "warning": 2,
    "block": 3,
}
_SCANNER_UX_ATTENTION_RANK = {"green": 0, "amber": 2, "red": 3}


def _assert_scanner_conformance_mapping(
    response: ScannerDecisionResponse,
    scanner_ux: ScannerDecisionUX,
) -> None:
    model = response.model_decision
    if model is None:
        raise ValueError("scanner response is missing authoritative model_decision")
    if response.decision_state not in _SCANNER_OPERATIONAL_STATES:
        raise ValueError(
            f"unmapped scanner decision_state {response.decision_state!r}"
        )
    operational_rank = _SCANNER_UX_ATTENTION_RANK[scanner_ux.risk_level]
    model_rank = _MODEL_ATTENTION_RANK[model.attention_level]
    if operational_rank < model_rank:
        raise ValueError(
            "scanner decision_state undercuts model_decision attention: "
            f"{response.decision_state!r} < {model.attention_level!r}"
        )


def _scanner_contract_color(risk_level: str) -> str:
    if risk_level == "amber":
        return "orange"
    if risk_level == "red":
        return "red"
    return "green"


def _scanner_contract_cache_freshness(
    response: ScannerDecisionResponse,
) -> ScannerDecisionContractCacheFreshness:
    if response.governance is None:
        return ScannerDecisionContractCacheFreshness(status="not_applicable")

    status = response.governance.cache_freshness_state
    if status not in {"fresh", "stale", "expired"}:
        status = "unavailable"
    return ScannerDecisionContractCacheFreshness(
        status=status,
        cache_generated_at=response.governance.cache_generated_at,
        cache_expires_at=response.governance.cache_expires_at,
    )


def _scanner_contract_step(
    layer: str,
    *,
    response: ScannerDecisionResponse,
    scanner_ux: ScannerDecisionUX,
) -> ScannerDecisionContractTrustStep:
    signal = next((item for item in response.signals if item.layer == layer), None)
    status = signal.state if signal else "not_evaluated"
    message = (
        signal.message
        if signal and signal.message
        else (
            response.primary_message
            if layer == "scanner_decision"
            else _SCANNER_CONTRACT_DEFAULT_MESSAGES[layer]
        )
    )
    return ScannerDecisionContractTrustStep(
        status=status,
        label=_SCANNER_CONTRACT_LAYER_LABELS[layer],
        message=message,
        reason_codes=scanner_ux.reason_codes if layer == "scanner_decision" else [],
    )


def _scanner_decision_contract(
    response: ScannerDecisionResponse,
    *,
    scanner_ux: ScannerDecisionUX,
    decision_id: str,
) -> ScannerDecisionContract:
    display_host = (
        scanner_ux.destination_display
        or response.destination.host
        or _url_host(response.destination.display_url)
        or "unreadable"
    )
    fingerprint = (
        scanner_ux.destination_fingerprint
        or _domain_fingerprint(display_host)
        or display_host
    )
    return ScannerDecisionContract(
        decision_id=decision_id,
        decided_at=datetime.now(timezone.utc).isoformat(),
        decision_color=_scanner_contract_color(scanner_ux.risk_level),
        decision_state=response.decision_state,
        reason_codes=scanner_ux.reason_codes,
        risk_score=scanner_ux.risk_score,
        destination=ScannerDecisionContractDestination(
            display_host=display_host,
            fingerprint=fingerprint,
            url=response.destination.display_url,
            resolver_url=response.destination.resolver_url,
            final_url=response.destination.final_url,
        ),
        trust_path=ScannerDecisionContractTrustPath(
            issuer_legitimacy=_scanner_contract_step(
                "issuer_legitimacy",
                response=response,
                scanner_ux=scanner_ux,
            ),
            destination_binding=_scanner_contract_step(
                "destination_binding",
                response=response,
                scanner_ux=scanner_ux,
            ),
            runtime_safety=_scanner_contract_step(
                "runtime_safety",
                response=response,
                scanner_ux=scanner_ux,
            ),
            scanner_decision=_scanner_contract_step(
                "scanner_decision",
                response=response,
                scanner_ux=scanner_ux,
            ),
        ),
        hold_to_open=ScannerDecisionContractHoldToOpen(
            required=scanner_ux.hold_required,
            duration_ms=scanner_ux.hold_ms,
            reason_codes=scanner_ux.reason_codes if scanner_ux.hold_required else [],
        ),
        cache_freshness=_scanner_contract_cache_freshness(response),
        governance=(
            response.governance.model_dump(mode="json")
            if response.governance is not None
            else {}
        ),
    )


def _scanner_ux_for_response(
    response: ScannerDecisionResponse,
    *,
    request: ScannerDecisionRequest | None = None,
) -> ScannerDecisionUX:
    reason_codes: list[str] = []
    score = 0
    runtime_signal = next(
        (signal for signal in response.signals if signal.layer == "runtime_safety"),
        None,
    )
    artifact_signal = next(
        (signal for signal in response.signals if signal.layer == "artifact_integrity"),
        None,
    )

    if response.decision_state == "verified_issuer":
        score = 0
    elif response.decision_state == "verified_issuer_destination_risky":
        score += 35
        runtime_state = runtime_signal.state if runtime_signal is not None else "risky"
        if runtime_state in {"stale", "unavailable"}:
            reason_codes.append(f"runtime_{runtime_state}")
        else:
            reason_codes.append("runtime_risky")
    elif response.decision_state == "stale_trust_state":
        score += 40
        reason_codes.append("stale_trust_state")
    elif response.decision_state == "profile_stale":
        score += 40
        reason_codes.append("verifier_profile_stale")
    elif response.decision_state == "profile_revoked":
        score += 80
        reason_codes.append("verifier_profile_revoked")
    elif response.decision_state == "signed_unknown_issuer":
        score += 35
        reason_codes.append("issuer_unknown")
    elif response.decision_state == "unverified":
        score += 30
        reason_codes.append("plain_url" if response.open_allowed else "unreadable_payload")
    elif response.decision_state == "unknown":
        # Missing decision-grade evidence is fail-closed. Keep the reason tied
        # to the evidence family: redirect observation and durable trust-state
        # availability are different failures even though both render red.
        score += 60
        reason_codes.append(
            "redirect_unobserved"
            if response.destination.binding == "redirect_unobserved"
            else "trust_cache_unavailable"
        )
    elif response.decision_state == "blocked":
        score += 60

    if artifact_signal is not None:
        if artifact_signal.state == "warn":
            score += 30
            reason_codes.append("artifact_warning")
        elif artifact_signal.state == "block":
            score += 60
            reason_codes.append("artifact_integrity_block")

    match response.verifier_stage:
        case "payload_revalidation":
            reason_codes.append("destination_mismatch")
        case "redirect_policy":
            reason_codes.append(
                "redirect_unobserved"
                if response.destination.binding == "redirect_unobserved"
                else "redirect_policy_block"
            )
        case "runtime_safety":
            if not any(reason.startswith("runtime_") for reason in reason_codes):
                reason_codes.append("runtime_blocked")
        case "governance_cache":
            if "stale_trust_state" not in reason_codes:
                reason_codes.append("trust_cache_unavailable")
        case "signed_schema":
            reason_codes.append("signature_invalid")
        case "artifact_integrity":
            if "artifact_integrity_block" not in reason_codes:
                reason_codes.append("artifact_integrity_block")

    if response.destination.redirect_hops and response.destination.redirect_hops > 1:
        score += 10
        reason_codes.append("redirect_chain")

    risk_urls = _scanner_risk_urls(response)
    if any(_is_https_absent(url) for url in risk_urls):
        score += 15
        reason_codes.append("https_absent")

    if any(_has_embedded_credentials(url) for url in risk_urls):
        score += 15
        reason_codes.append("embedded_credentials")

    risk_hosts = _scanner_risk_hosts(response)
    destination_identities: set[str] = set()
    for host in risk_hosts:
        destination_identities.update(_host_identity_set(host))
    allow_client_domain_hints = response.decision_state in {
        "signed_unknown_issuer",
        "unverified",
    }

    caption_domains = _caption_domains(request.display_text if request else None)
    if (
        caption_domains
        and destination_identities
        and caption_domains.isdisjoint(destination_identities)
    ):
        score += 25
        reason_codes.append("caption_domain_mismatch")

    request_known_bad_hosts = (
        _request_host_set(request.known_bad_hosts if request else [])
        if allow_client_domain_hints
        else set()
    )
    known_bad_hosts = request_known_bad_hosts | set(_LOCAL_KNOWN_BAD_SCANNER_DOMAINS)
    if destination_identities & known_bad_hosts:
        score += 35
        reason_codes.append("known_bad_domain")

    newly_registered_hosts = _request_host_set(
        request.newly_registered_hosts if request and allow_client_domain_hints else []
    )
    has_new_domain = bool(destination_identities & newly_registered_hosts)
    if allow_client_domain_hints and not has_new_domain:
        for host in destination_identities:
            age_days = _domain_age_for_host(request, host)
            if age_days is not None and age_days <= 14:
                has_new_domain = True
                break
    if has_new_domain:
        score += 35
        reason_codes.append("newly_registered_domain")

    if (
        allow_client_domain_hints
        and request is not None
        and request.prior_opened_hosts is not None
    ):
        prior_hosts = _request_host_set(request.prior_opened_hosts)
        if destination_identities and destination_identities.isdisjoint(prior_hosts):
            score += 10
            reason_codes.append("net_new_domain")

    score = min(score, 100)
    if score >= 60:
        risk_level = "red"
    elif score >= 30:
        risk_level = "amber"
    else:
        risk_level = "green"

    destination_display = _registrable_domain(response.destination.host)
    hold_required = response.open_allowed and score >= 30
    primary_action = "Open"
    if not response.open_allowed:
        primary_action = "Do not open"
    elif hold_required:
        primary_action = "Open with caution"

    return ScannerDecisionUX(
        risk_score=score,
        risk_level=risk_level,
        risk_stripe=risk_level,
        hold_required=hold_required,
        hold_ms=800 if hold_required else 0,
        reason_codes=sorted(set(reason_codes)),
        destination_display=destination_display,
        destination_fingerprint=_domain_fingerprint(destination_display),
        primary_action=primary_action,
    )


def _with_scanner_ux(
    response: ScannerDecisionResponse,
    *,
    request: ScannerDecisionRequest | None = None,
) -> ScannerDecisionResponse:
    request_id = _safe_request_id(response.request_id)
    decision_id = f"scan_{uuid4().hex}"
    response_with_id = response.model_copy(update={"request_id": request_id})
    scanner_ux = _scanner_ux_for_response(response_with_id, request=request)
    _assert_scanner_conformance_mapping(response_with_id, scanner_ux)
    return response_with_id.model_copy(
        update={
            "scanner_ux": scanner_ux,
            "contract": _scanner_decision_contract(
                response_with_id,
                scanner_ux=scanner_ux,
                decision_id=decision_id,
            ),
        },
    )


def _unverified_scanner_decision(
    payload: str,
    *,
    reason: str,
    request_id: str | None,
    cause: ResidualCause = "no-trust-claim",
    extra_reason_codes: tuple[str, ...] = (),
) -> ScannerDecisionResponse:
    trimmed_payload = payload.strip()
    has_url_destination = _looks_like_url(trimmed_payload)
    primary = (
        "No recognized trust signal is available for this QR. Review the destination before continuing."
        if has_url_destination
        else "This QR does not contain a scanner-verifiable URL or signed trust envelope."
    )
    destination_message = (
        "This is a regular URL QR. No issuer-approved destination binding was available."
        if has_url_destination
        else "This payload is neither a URL nor a signed QR Trust envelope."
    )
    verifier_reason = (
        "Plain URL QR without a signed QR Trust envelope"
        if has_url_destination
        else reason
    )
    vector = _unverified_residual_vector(cause)
    _, decision = _apply_trust_residual_gate("unverified", vector)
    entries, model = _residual_payload(vector, decision, extra_reason_codes=extra_reason_codes)
    return ScannerDecisionResponse(
        decision_state="unverified",
        open_allowed=has_url_destination,
        residual_vector=entries,
        model_decision=model,
        primary_message=primary,
        issuer=ScannerDecisionIssuer(status="none"),
        destination=_scanner_destination(
            trimmed_payload or "unreadable QR payload",
            binding="unverified",
        ),
        signals=[
            ScannerDecisionSignal(layer="issuer_legitimacy", state="none", message="No signed trust path was found."),
            ScannerDecisionSignal(layer="destination_binding", state="unverified", message=destination_message),
            ScannerDecisionSignal(layer="runtime_safety", state="not_evaluated", message="Runtime safety is not evaluated without a trust path."),
            ScannerDecisionSignal(layer="scanner_decision", state="caution" if has_url_destination else "blocked"),
        ],
        actions=_scanner_actions(decision_state="unverified", open_allowed=has_url_destination),
        verifier_stage="qr_decode",
        verifier_reason=verifier_reason,
        request_id=request_id,
    )


def _signed_unknown_issuer_decision(
    envelope: SignedQRCodeEnvelope,
    *,
    request_id: str | None,
) -> ScannerDecisionResponse:
    destination = envelope.claims.payload
    # The envelope parsed, but this verifier holds no issuer state for its
    # certificate reference, so only R_I carries evidence. No cause from the
    # closed vocabulary describes an unenrolled issuer; the tier is the claim.
    vector = _unverified_residual_vector(cause=None)
    vector["issuer_chain"] = _entry("unaccepted-issuer")
    _, decision = _apply_trust_residual_gate("signed_unknown_issuer", vector)
    entries, model = _residual_payload(vector, decision)
    return ScannerDecisionResponse(
        decision_state="signed_unknown_issuer",
        open_allowed=_looks_like_url(destination),
        residual_vector=entries,
        model_decision=model,
        primary_message=(
            "The QR uses the signed-envelope format, but this verifier has no registered issuer state "
            "for its certificate reference."
        ),
        issuer=ScannerDecisionIssuer(
            name=None,
            tier=None,
            status="unknown",
        ),
        destination=_scanner_destination(destination, binding="unknown"),
        signals=[
            ScannerDecisionSignal(
                layer="issuer_legitimacy",
                state="unknown",
                message=f"No trust record for {envelope.claims.certificate_ref}.",
            ),
            ScannerDecisionSignal(layer="destination_binding", state="unknown", message="Destination policy was not available."),
            ScannerDecisionSignal(layer="runtime_safety", state="not_evaluated"),
            ScannerDecisionSignal(layer="scanner_decision", state="caution"),
        ],
        actions=_scanner_actions(decision_state="signed_unknown_issuer", open_allowed=_looks_like_url(destination)),
        verifier_stage="issuer_lookup",
        verifier_reason="Signed envelope issuer is not enrolled in this verifier instance",
        request_id=request_id,
        envelope_id=compute_envelope_id(envelope.claims, envelope.signature),
    )


def _scanned_envelope_fingerprint(qr_payload: str) -> str | None:
    """The scanned envelope's fingerprint, or None for URL/unreadable payloads.

    Scan activity is keyed by envelope identity, so this is the same value the
    verify path derives from the parsed claims and signature."""
    trimmed_payload = qr_payload.strip()
    if not trimmed_payload or _looks_like_url(trimmed_payload):
        return None
    try:
        envelope = decode_envelope_from_qr_payload(trimmed_payload)
    except QRArtifactError:
        return None
    return _envelope_fingerprint(compute_envelope_id(envelope.claims, envelope.signature))


def _scanner_claimed_destination_from_payload(qr_payload: str) -> str:
    trimmed_payload = qr_payload.strip()
    if _looks_like_url(trimmed_payload):
        return trimmed_payload

    try:
        envelope = decode_envelope_from_qr_payload(trimmed_payload)
    except QRArtifactError:
        return trimmed_payload or "unreadable QR payload"

    return envelope.claims.payload


def _verifier_profile_state_decision(
    request: ScannerDecisionRequest,
    *,
    request_id: str | None,
) -> ScannerDecisionResponse | None:
    client_profile_state = (
        request.client.verifier_profile_state
        if request.client is not None
        else "active"
    )
    profile_state = _strictest_verifier_profile_state(
        _configured_verifier_profile_state(),
        client_profile_state,
    )
    if profile_state == "active":
        return None

    destination = _scanner_claimed_destination_from_payload(request.qr_payload)
    has_url_destination = _looks_like_url(destination)
    is_revoked = profile_state == "revoked"
    decision_state = "profile_revoked" if is_revoked else "profile_stale"
    open_allowed = has_url_destination and not is_revoked
    issuer_status = "profile_revoked" if is_revoked else "profile_stale"
    destination_binding = "not_evaluated" if is_revoked else "unverified"
    scanner_state = "blocked" if is_revoked else ("caution" if has_url_destination else "blocked")
    primary_message = (
        "This scanner's verifier profile has been revoked. Do not rely on this QR result until a trusted profile is installed."
        if is_revoked
        else (
            "This scanner's verifier profile is stale. A destination was found, but current issuer and destination trust were not confirmed."
            if has_url_destination
            else "This scanner's verifier profile is stale, and this QR did not expose a safe destination to review."
        )
    )
    verifier_reason = (
        "Verifier profile is revoked"
        if is_revoked
        else "Verifier profile is stale"
    )
    # A stale or revoked verifier profile means no evidence about this QR was
    # gathered at all: every family reports that it was not checked rather than
    # claiming an absence of findings.
    profile_vector: ResidualVector = {
        "issuer_chain": _entry("not-checked"),
        "destination_policy": _entry("not-checked"),
        "redirect_flow": _entry("not-applicable"),
        "runtime_safety": _entry("not-checked"),
        "freshness": _entry("not-checked"),
        "artifact_integrity": _entry("pass"),
    }
    _, profile_decision = _apply_trust_residual_gate(decision_state, profile_vector)
    profile_entries, profile_model = _residual_payload(profile_vector, profile_decision)
    return ScannerDecisionResponse(
        decision_state=decision_state,
        open_allowed=open_allowed,
        residual_vector=profile_entries,
        model_decision=profile_model,
        primary_message=primary_message,
        issuer=ScannerDecisionIssuer(
            name=None,
            tier=None,
            status=issuer_status,
        ),
        destination=_scanner_destination(
            destination,
            binding=destination_binding,
        ),
        signals=[
            ScannerDecisionSignal(
                layer="issuer_legitimacy",
                state="profile_revoked" if is_revoked else "not_checked",
                message=(
                    "The installed verifier profile is revoked, so issuer enrollment was not trusted."
                    if is_revoked
                    else "The verifier profile is stale, so current issuer enrollment was not confirmed."
                ),
            ),
            ScannerDecisionSignal(
                layer="destination_binding",
                state=destination_binding,
                message=(
                    "Destination binding was not evaluated because the verifier profile is revoked."
                    if is_revoked
                    else "A destination was read from the QR, but it was not checked against current issuer policy."
                ),
            ),
            ScannerDecisionSignal(
                layer="runtime_safety",
                state="not_evaluated",
                message=(
                    "Runtime safety is not evaluated with a revoked verifier profile."
                    if is_revoked
                    else "Current destination safety was not evaluated because the verifier profile is stale."
                ),
            ),
            ScannerDecisionSignal(
                layer="scanner_decision",
                state=scanner_state,
            ),
        ],
        actions=_scanner_actions(
            decision_state=decision_state,
            open_allowed=open_allowed,
        ),
        verifier_stage="verifier_profile",
        verifier_reason=verifier_reason,
        request_id=request_id,
    )


def _strictest_verifier_profile_state(
    *states: VerifierProfileState,
) -> VerifierProfileState:
    if "revoked" in states:
        return "revoked"
    if "stale" in states:
        return "stale"
    return "active"


def _redacted_network_outbox_status() -> NetworkOutboxOperatorStatusResponse:
    return NetworkOutboxOperatorStatusResponse(
        status="unavailable",
        supervisor_state="unavailable",
        summary="Network outbox status requires an authorized operator read.",
        reasons=["operator_status_auth_required"],
        database_configured=False,
        database_dsn_label=None,
        metrics=None,
        error=None,
    )


def _redacted_scanner_decision_status() -> ScannerDecisionOperatorStatusResponse:
    return ScannerDecisionOperatorStatusResponse(
        status="unavailable",
        persistence_state="unavailable",
        summary="Scanner-decision evidence requires an authorized operator read.",
        reasons=["operator_status_auth_required"],
        database_configured=False,
        database_dsn_label=None,
        report=None,
        error=None,
    )


def _redacted_runtime_observation_status() -> RuntimeSafetyObservationOperatorStatusResponse:
    return RuntimeSafetyObservationOperatorStatusResponse(
        status="unavailable",
        observation_state="unavailable",
        summary="Runtime observation evidence requires an authorized operator read.",
        reasons=["operator_status_auth_required"],
        database_configured=False,
        database_dsn_label=None,
        report=None,
        error=None,
    )


async def _build_verifier_status_response(
    *,
    include_operator_evidence: bool,
) -> VerifierStatusResponse:
    if include_operator_evidence:
        network_outbox = await load_network_outbox_operator_status()
        scanner_decisions = await load_scanner_decision_operator_status()
        runtime_observations = await load_runtime_observation_operator_status()
    else:
        network_outbox = _redacted_network_outbox_status()
        scanner_decisions = _redacted_scanner_decision_status()
        runtime_observations = _redacted_runtime_observation_status()

    return VerifierStatusResponse(
        verifier_profile_state=_configured_verifier_profile_state(),
        api_key_auth_enabled=await _verifier_auth_enabled(),
        admin_api_key_management_enabled=bool(_configured_admin_tokens()),
        api_key_header=config.VERIFIER_API_KEY_HEADER,
        admin_header=config.VERIFIER_ADMIN_HEADER,
        redis_connected=redis_service.redis_client is not None,
        distributed_rate_limiting_enabled=redis_service.redis_client is not None,
        decode_image_fallback_enabled=True,
        rate_limit_window_seconds=config.VERIFIER_RATE_LIMIT_WINDOW_SECONDS,
        rate_limit_max_requests=config.VERIFIER_RATE_LIMIT_MAX_REQUESTS,
        decode_rate_limit_max_requests=config.VERIFIER_DECODE_RATE_LIMIT_MAX_REQUESTS,
        envelope_rate_limit_window_seconds=config.VERIFIER_ENVELOPE_RATE_LIMIT_WINDOW_SECONDS,
        envelope_rate_limit_max_requests=config.VERIFIER_ENVELOPE_RATE_LIMIT_MAX_REQUESTS,
        issuer_rate_limit_max_requests=config.VERIFIER_ISSUER_RATE_LIMIT_MAX_REQUESTS,
        verdict_cache_enabled=config.VERIFIER_VERDICT_CACHE_TTL_SECONDS > 0,
        verdict_cache_ttl_seconds=max(0, config.VERIFIER_VERDICT_CACHE_TTL_SECONDS),
        scan_spike_alerts_enabled=scan_accounting.scan_spike_monitor_enabled(),
        scan_spike_window_seconds=max(1, config.VERIFIER_SCAN_SPIKE_WINDOW_SECONDS),
        scan_spike_baseline_seconds=max(1, config.VERIFIER_SCAN_SPIKE_BASELINE_SECONDS),
        scan_spike_ratio=max(0.0, config.VERIFIER_SCAN_SPIKE_RATIO),
        scan_spike_min_scans=max(0, config.VERIFIER_SCAN_SPIKE_MIN_SCANS),
        forwarded_ip_trust_configured=_forwarded_ip_trust_configured(),
        max_qr_payload_chars=config.MAX_QR_PAYLOAD_CHARS,
        max_decode_image_bytes=config.MAX_DECODE_IMAGE_BYTES,
        network_outbox=network_outbox,
        scanner_decisions=scanner_decisions,
        runtime_observations=runtime_observations,
    )


def _scanner_binding_for_stage(stage: str, allowed: bool) -> str:
    if allowed:
        return "bound"
    if stage == "payload_revalidation":
        return "mismatch"
    return "not_evaluated"


def _scanner_primary_message(
    result: NarrowedVerifierResponse,
    *,
    redirect_verdict: RedirectPolicyVerdict | None = None,
    runtime_verdict: RuntimeSafetyVerdict | None = None,
    artifact_analysis: QRArtifactAnalysis | None = None,
) -> str:
    if result.allowed:
        if redirect_verdict and redirect_verdict.is_redirect_flow and redirect_verdict.state == "unknown":
            return "Resolver unresolved. The final destination of the redirect flow was not observed."
        if redirect_verdict and redirect_verdict.is_redirect_flow and redirect_verdict.is_blocked:
            return "Resolver mismatch. The final destination is not approved by the issuer."
        if runtime_verdict and runtime_verdict.state == "risky":
            return (
                "Verified issuer, but destination risk was detected at scan time. "
                "Review before opening."
            )
        if runtime_verdict and runtime_verdict.state == "blocked":
            return "Verified issuer, but runtime safety blocked this destination."
        if runtime_verdict and runtime_verdict.state == "expired":
            return (
                "Verified issuer, but the runtime safety verdict has expired. "
                "This destination is blocked until a fresh verdict is available."
            )
        if runtime_verdict and runtime_verdict.state == "unavailable":
            return (
                "Verified issuer and destination, but runtime safety could not be checked "
                "right now. Continue only if you trust the context."
            )
        if runtime_verdict and runtime_verdict.state == "stale":
            return (
                "Verified issuer and destination, but runtime safety data is stale. "
                "Review before opening."
            )
        if redirect_verdict and redirect_verdict.is_redirect_flow:
            return "Verified resolver QR. The final destination is still approved by the issuer."
        if artifact_analysis and artifact_analysis.artifact_integrity == "warn":
            return (
                "Verified issuer and destination, but the QR artifact has visual "
                "or structural warnings. Review before opening."
            )
        return "Verified signed QR. This destination is still approved by the issuer."
    match result.stage:
        case "payload_revalidation":
            return "Destination mismatch. The signed QR no longer points to an issuer-approved destination."
        case "time_window":
            return "Expired or not-yet-valid QR. The scanner stopped before destination evaluation."
        case "issuer_status":
            return "Issuer credential is inactive or revoked in the verifier state."
        case "key_status":
            return "The signing key behind this code is revoked or was not in force when the code was signed."
        case "signed_schema":
            return "Signature verification failed for the canonical signed claims."
        case _:
            return result.reason


def _scanner_issuer_legitimacy_message(record: ScannerTrustRecord) -> str:
    if record.governance is None:
        return "Issuer record resolved in verifier trust state."

    return (
        "Issuer resolved through fixture governance namespace "
        f"{record.governance.issuer_namespace_label}."
    )


def _scanner_destination_binding_message(
    redirect_verdict: RedirectPolicyVerdict | None,
) -> str:
    if redirect_verdict and redirect_verdict.is_redirect_flow:
        return redirect_verdict.reason
    return "Destination matches issuer policy."


def _governance_cache_blocking_decision(
    envelope: SignedQRCodeEnvelope,
    record: ScannerTrustRecord,
    *,
    request_id: str | None,
) -> ScannerDecisionResponse | None:
    governance = record.governance
    if governance is None:
        return None

    freshness_state = governance.cache_freshness_state()
    if freshness_state == "fresh":
        return None

    is_expired = freshness_state == "expired"
    decision_state = "blocked" if is_expired else "stale_trust_state"
    open_allowed = not is_expired and _looks_like_url(envelope.claims.payload)
    primary_message = (
        "Required trust state has expired. Ask for a fresh or trusted QR before continuing."
        if is_expired
        else (
            "The QR is signed by a previously recognized issuer, but the verifier's "
            "trust cache is stale. Review before opening or refresh trust state."
        )
    )
    verifier_reason = (
        "Required governance cache state is expired"
        if is_expired
        else "Required governance cache state is stale"
    )
    # Stale or expired required trust state is stale freshness evidence: R_F
    # blocks when the cache expired and cautions while it is merely stale. No
    # cause in the closed vocabulary names a cache lifetime, so the tier stands
    # alone and the governance block on the response carries the detail.
    governance_vector: ResidualVector = {
        "issuer_chain": _entry("not-checked"),
        "destination_policy": _entry("not-checked"),
        "redirect_flow": _entry("not-applicable"),
        "runtime_safety": _entry("not-checked"),
        "freshness": _entry("block" if is_expired else "warn"),
        "artifact_integrity": _entry("pass"),
    }
    _, governance_decision = _apply_trust_residual_gate(decision_state, governance_vector)
    governance_entries, governance_model = _residual_payload(governance_vector, governance_decision)
    return ScannerDecisionResponse(
        decision_state=decision_state,
        open_allowed=open_allowed,
        residual_vector=governance_entries,
        model_decision=governance_model,
        primary_message=primary_message,
        issuer=ScannerDecisionIssuer(
            name=record.certificate.issuer_name,
            tier=governance.assurance_tier,
            status=freshness_state,
        ),
        destination=_scanner_destination(
            envelope.claims.payload,
            binding="not_evaluated",
        ),
        governance=_scanner_governance_response(governance),
        signals=[
            ScannerDecisionSignal(
                layer="issuer_legitimacy",
                state=freshness_state,
                message=(
                    "The issuer namespace is known, but its required verifier cache "
                    f"entry is {freshness_state}."
                ),
            ),
            ScannerDecisionSignal(
                layer="destination_binding",
                state="not_evaluated",
                message=(
                    "Destination binding is not trusted because required governance "
                    f"cache state is {freshness_state}."
                ),
            ),
            ScannerDecisionSignal(
                layer="runtime_safety",
                state="not_evaluated",
                message="Runtime safety is not evaluated without fresh required trust state.",
            ),
            ScannerDecisionSignal(
                layer="scanner_decision",
                state="blocked" if is_expired else "caution",
            ),
        ],
        actions=_scanner_actions(
            decision_state=decision_state,
            open_allowed=open_allowed,
        ),
        verifier_stage="governance_cache",
        verifier_reason=verifier_reason,
        request_id=request_id,
        envelope_id=compute_envelope_id(envelope.claims, envelope.signature),
    )


def _scanner_artifact_analysis_for_request(
    request: ScannerDecisionRequest,
) -> QRArtifactAnalysis | None:
    if request.image_base64 is None:
        return None
    image_bytes = decode_image_base64(request.image_base64)
    return analyze_qr_artifact_from_png_bytes(image_bytes)


def _scanner_artifact_signal(
    artifact_analysis: QRArtifactAnalysis,
    *,
    force_block: bool = False,
) -> ScannerDecisionSignal:
    if force_block:
        return ScannerDecisionSignal(
            layer="artifact_integrity",
            state="block",
            message=(
                "The decoded image artifact and submitted scanner payload do not match."
            ),
        )

    if artifact_analysis.artifact_integrity == "pass":
        return ScannerDecisionSignal(
            layer="artifact_integrity",
            state="pass",
            message="QR artifact inspection found no structural warning.",
        )

    indicators = ", ".join(artifact_analysis.tamper_indicators) or "artifact warning"
    return ScannerDecisionSignal(
        layer="artifact_integrity",
        state="warn",
        message=f"QR artifact inspection reported: {indicators}.",
    )


def _with_artifact_signal(
    signals: list[ScannerDecisionSignal],
    artifact_analysis: QRArtifactAnalysis | None,
) -> list[ScannerDecisionSignal]:
    if artifact_analysis is None:
        return signals

    scanner_index = next(
        (index for index, signal in enumerate(signals) if signal.layer == "scanner_decision"),
        len(signals),
    )
    return [
        *signals[:scanner_index],
        _scanner_artifact_signal(artifact_analysis),
        *signals[scanner_index:],
    ]


def _artifact_payload_mismatch_decision(
    request_payload: str,
    artifact_analysis: QRArtifactAnalysis,
    *,
    request_id: str | None,
) -> ScannerDecisionResponse:
    destination = _scanner_claimed_destination_from_payload(artifact_analysis.payload)
    # The submitted payload contradicts the artifact it claims to come from:
    # blocking artifact-layer evidence, with nothing downstream evaluated.
    mismatch_vector: ResidualVector = {
        "issuer_chain": _entry("not-checked"),
        "destination_policy": _entry("not-checked"),
        "redirect_flow": _entry("not-applicable"),
        "runtime_safety": _entry("not-checked"),
        "freshness": _entry("not-checked"),
        "artifact_integrity": _entry("block", "container-mismatch"),
    }
    _, mismatch_decision = _apply_trust_residual_gate("blocked", mismatch_vector)
    mismatch_entries, mismatch_model = _residual_payload(mismatch_vector, mismatch_decision)
    return ScannerDecisionResponse(
        decision_state="blocked",
        open_allowed=False,
        residual_vector=mismatch_entries,
        model_decision=mismatch_model,
        primary_message=(
            "The submitted scanner payload does not match the QR image artifact. "
            "Do not open this destination."
        ),
        issuer=ScannerDecisionIssuer(status="not_evaluated"),
        destination=_scanner_destination(
            destination or request_payload or "unreadable QR payload",
            binding="not_evaluated",
        ),
        signals=[
            ScannerDecisionSignal(
                layer="issuer_legitimacy",
                state="not_evaluated",
                message="Issuer trust was not evaluated because artifact integrity failed.",
            ),
            ScannerDecisionSignal(
                layer="destination_binding",
                state="not_evaluated",
                message="Destination binding was not evaluated because artifact integrity failed.",
            ),
            ScannerDecisionSignal(
                layer="runtime_safety",
                state="not_evaluated",
                message="Runtime safety was not evaluated because artifact integrity failed.",
            ),
            _scanner_artifact_signal(artifact_analysis, force_block=True),
            ScannerDecisionSignal(layer="scanner_decision", state="blocked"),
        ],
        actions=_scanner_actions(decision_state="blocked", open_allowed=False),
        verifier_stage="artifact_integrity",
        verifier_reason="QR image artifact payload does not match submitted scanner payload",
        request_id=request_id,
    )


def _scanner_signals_for_result(
    result: NarrowedVerifierResponse,
    *,
    record: ScannerTrustRecord,
    redirect_verdict: RedirectPolicyVerdict | None = None,
    runtime_verdict: RuntimeSafetyVerdict | None = None,
    artifact_analysis: QRArtifactAnalysis | None = None,
) -> list[ScannerDecisionSignal]:
    if result.allowed:
        if (
            redirect_verdict
            and redirect_verdict.is_redirect_flow
            and redirect_verdict.state == "unknown"
        ):
            return _with_artifact_signal([
                ScannerDecisionSignal(
                    layer="issuer_legitimacy",
                    state="recognized",
                    message=_scanner_issuer_legitimacy_message(record),
                ),
                ScannerDecisionSignal(
                    layer="destination_binding",
                    state="redirect_unobserved",
                    message=redirect_verdict.reason,
                ),
                ScannerDecisionSignal(
                    layer="runtime_safety",
                    state="not_opened",
                    message=(
                        "Runtime safety is not evaluated because the redirect "
                        "destination was not observed."
                    ),
                ),
                ScannerDecisionSignal(layer="scanner_decision", state="unknown"),
            ], artifact_analysis)
        if redirect_verdict and redirect_verdict.is_redirect_flow and redirect_verdict.is_blocked:
            return _with_artifact_signal([
                ScannerDecisionSignal(
                    layer="issuer_legitimacy",
                    state="recognized",
                    message=_scanner_issuer_legitimacy_message(record),
                ),
                ScannerDecisionSignal(
                    layer="destination_binding",
                    state="redirect_mismatch",
                    message=redirect_verdict.reason,
                ),
                ScannerDecisionSignal(
                    layer="runtime_safety",
                    state="not_opened",
                    message="Runtime safety is not evaluated because redirect policy blocked the final destination.",
                ),
                ScannerDecisionSignal(layer="scanner_decision", state="blocked"),
            ], artifact_analysis)
        if runtime_verdict and not runtime_verdict.is_clean:
            return _with_artifact_signal([
                ScannerDecisionSignal(
                    layer="issuer_legitimacy",
                    state="recognized",
                    message=_scanner_issuer_legitimacy_message(record),
                ),
                ScannerDecisionSignal(
                    layer="destination_binding",
                    state="bound",
                    message=_scanner_destination_binding_message(redirect_verdict),
                ),
                ScannerDecisionSignal(
                    layer="runtime_safety",
                    state=runtime_verdict.state,
                    message=runtime_verdict.reason,
                ),
                ScannerDecisionSignal(
                    layer="scanner_decision",
                    state=runtime_verdict.decision_state,
                ),
            ], artifact_analysis)
        runtime_message = "Signature and validity checks passed."
        return _with_artifact_signal([
            ScannerDecisionSignal(
                layer="issuer_legitimacy",
                state="recognized",
                message=_scanner_issuer_legitimacy_message(record),
            ),
            ScannerDecisionSignal(
                layer="destination_binding",
                state="bound",
                message=_scanner_destination_binding_message(redirect_verdict),
            ),
            ScannerDecisionSignal(layer="runtime_safety", state="clean", message=runtime_message),
            ScannerDecisionSignal(layer="scanner_decision", state="verified_issuer"),
        ], artifact_analysis)
    if result.cause == "trust-state-unavailable":
        return _with_artifact_signal([
            ScannerDecisionSignal(
                layer="issuer_legitimacy",
                state="unknown",
                message=(
                    "The verifier cannot confirm issuer and key status because "
                    "durable trust state is unavailable."
                ),
            ),
            ScannerDecisionSignal(layer="destination_binding", state="not_evaluated"),
            ScannerDecisionSignal(layer="runtime_safety", state="not_evaluated"),
            ScannerDecisionSignal(layer="scanner_decision", state="blocked"),
        ], artifact_analysis)
    if result.stage == "payload_revalidation":
        return _with_artifact_signal([
            ScannerDecisionSignal(
                layer="issuer_legitimacy",
                state="recognized",
                message=_scanner_issuer_legitimacy_message(record),
            ),
            ScannerDecisionSignal(layer="destination_binding", state="mismatch", message=result.reason),
            ScannerDecisionSignal(layer="runtime_safety", state="not_opened", message="The destination is blocked before opening."),
            ScannerDecisionSignal(layer="scanner_decision", state="blocked"),
        ], artifact_analysis)
    if result.stage in _TRUST_FAILURE_STAGES:
        return _with_artifact_signal([
            ScannerDecisionSignal(layer="issuer_legitimacy", state="revoked", message=result.reason),
            ScannerDecisionSignal(layer="destination_binding", state="not_evaluated"),
            ScannerDecisionSignal(layer="runtime_safety", state="not_evaluated"),
            ScannerDecisionSignal(layer="scanner_decision", state="blocked"),
        ], artifact_analysis)
    return _with_artifact_signal([
        ScannerDecisionSignal(
            layer="issuer_legitimacy",
            state="failed" if result.stage == "signed_schema" else "recognized",
            message=(
                result.reason
                if result.stage == "signed_schema"
                else _scanner_issuer_legitimacy_message(record)
            ),
        ),
        ScannerDecisionSignal(layer="destination_binding", state="not_evaluated"),
        ScannerDecisionSignal(layer="runtime_safety", state=result.stage, message=result.reason),
        ScannerDecisionSignal(layer="scanner_decision", state="blocked"),
    ], artifact_analysis)


# The scanner pipeline is "bounded-online": it degrades boundedly when the
# runtime-safety provider is unavailable, but blocks expired verdicts outright
# where the bounded reference profile only cautions. It therefore matches no
# single corpus profile; Δ evaluates it under bounded semantics, which the
# pipeline may exceed (block more) but never undercut.
_RUNTIME_DECISION_PROFILE = "bounded-online"

# Reason code carried when a scan decodes as an artifact but declares a claims
# version this build does not support.
UNSUPPORTED_CLAIMS_VERSION_REASON = "unsupported_claims_version"
UNSUPPORTED_ENVELOPE_REASON = "unsupported_envelope"
NO_SIGNED_ENVELOPE_REASON = "no_signed_envelope"
_UNSUPPORTED_VERSION_PREFIX = "Field 'version' must be exactly"

_RUNTIME_SAFETY_RESIDUAL_TIERS = {
    "clean": "pass",
    "risky": "warn",
    "blocked": "block",
    # An expired verdict is stale runtime-safety evidence owned by R_S (D14).
    "expired": "stale",
    "stale": "stale",
    "unavailable": "unavailable",
}
_RUNTIME_SAFETY_RESIDUAL_CAUSES: dict[str, ResidualCause] = {
    "risky": "verdict-warn",
    "blocked": "verdict-block",
    "expired": "verdict-expired",
    "stale": "verdict-stale",
    "unavailable": "provider-unavailable",
}
_ARTIFACT_INDICATOR_CAUSES: tuple[tuple[str, ResidualCause], ...] = (
    ("conflicting_qr_payloads", "conflicting-symbols"),
    ("colored_overlay_frame", "overlay-suspected"),
    ("multiple_qr_symbols", "framed-symbol-anomaly"),
    ("low_quiet_zone", "framed-symbol-anomaly"),
    ("perspective_distortion", "framed-symbol-anomaly"),
)

# Stages where the trust store found the issuer record or signing key not in force.
# Both land on R_I: a human does not care which half of the credential failed, but
# the cause slug still distinguishes them.
_TRUST_FAILURE_STAGES = frozenset({"issuer_status", "key_status"})

# Failing verifier stages, keyed to the residual family that owns the evidence.
_FAILED_STAGE_RESIDUALS: dict[str, tuple[str, str]] = {
    "signed_schema": ("issuer_chain", "invalid-managed-claim"),
    "issuer_status": ("issuer_chain", "revoked-issuer"),
    "key_status": ("issuer_chain", "revoked-issuer"),
    "payload_revalidation": ("destination_policy", "fail"),
    "time_window": ("freshness", "block"),
}

# A residual family maps to its tier plus the cause that produced it. The tier
# is what Delta reasons over; the cause is what the scanner surfaces to a human.
ResidualVector = dict[str, dict[str, str | None]]


def _entry(
    tier: str,
    cause: ResidualCause | None = None,
) -> dict[str, str | None]:
    return {"tier": tier, "cause": cause}


def _stage_cause(result: NarrowedVerifierResponse) -> ResidualCause:
    """The displayable cause behind a failing verifier stage.

    Every trust and freshness failure now arrives with a structured cause from
    evaluate_trust_window, so this prefers it. The two stages that never carry one —
    schema verification and destination revalidation happen outside the rule
    function — keep deriving theirs from the reason string.
    """
    if result.cause is not None:
        return result.cause
    if result.stage == "signed_schema":
        if result.reason.startswith(_UNSUPPORTED_VERSION_PREFIX):
            return "invalid-trust-claim"
        return "invalid-signature"
    if result.stage == "payload_revalidation":
        return "destination-not-authorized"
    raise ValueError(f"verifier stage {result.stage!r} has no protocol cause")


def _artifact_residual_cause(
    analysis: QRArtifactAnalysis,
) -> ResidualCause | None:
    if analysis.artifact_integrity == "pass":
        return None
    indicators = set(analysis.tamper_indicators)
    for indicator, cause in _ARTIFACT_INDICATOR_CAUSES:
        if indicator in indicators:
            return cause
    raise ValueError(
        "artifact analysis has no protocol cause for indicators "
        f"{sorted(indicators)!r}"
    )


def _residual_vector_for_result(
    result: NarrowedVerifierResponse,
    *,
    redirect_verdict: RedirectPolicyVerdict | None,
    runtime_verdict: RuntimeSafetyVerdict | None,
    artifact_analysis: QRArtifactAnalysis | None,
) -> ResidualVector:
    residuals: ResidualVector = {
        "issuer_chain": _entry("pass"),
        "destination_policy": _entry("pass" if result.allowed else "not-applicable"),
        "redirect_flow": _entry("not-applicable"),
        "runtime_safety": _entry("not-checked"),
        "freshness": _entry("pass" if result.allowed else "not-applicable"),
        # A payload-only scan presents no artifact container, so there is no
        # artifact-layer evidence to hold against it.
        "artifact_integrity": _entry("pass"),
    }
    if not result.allowed and result.stage in _FAILED_STAGE_RESIDUALS:
        family, tier = _FAILED_STAGE_RESIDUALS[result.stage]
        residuals[family] = _entry(tier, _stage_cause(result))
    if redirect_verdict is not None and redirect_verdict.is_redirect_flow:
        if redirect_verdict.state == "unknown":
            residuals["redirect_flow"] = _entry(
                "unavailable",
                "resolution-unavailable",
            )
        elif redirect_verdict.is_blocked:
            if redirect_verdict.cause is None:
                raise ValueError("blocked redirect verdict is missing a protocol cause")
            residuals["redirect_flow"] = _entry("fail", redirect_verdict.cause)
        else:
            residuals["redirect_flow"] = _entry("pass")
    if runtime_verdict is not None:
        tier = _RUNTIME_SAFETY_RESIDUAL_TIERS.get(runtime_verdict.state, runtime_verdict.state)
        # A clean verdict is evidence of safety, not a cause to display.
        runtime_cause: ResidualCause | None = None
        if tier != "pass":
            runtime_cause = _RUNTIME_SAFETY_RESIDUAL_CAUSES.get(runtime_verdict.state)
            if runtime_cause is None:
                raise ValueError(
                    f"runtime verdict {runtime_verdict.state!r} has no protocol cause"
                )
        residuals["runtime_safety"] = _entry(tier, runtime_cause)
    if artifact_analysis is not None:
        residuals["artifact_integrity"] = _entry(
            artifact_analysis.artifact_integrity,
            _artifact_residual_cause(artifact_analysis),
        )
    return residuals


def _unverified_residual_vector(cause: ResidualCause | None) -> ResidualVector:
    """The vector for a scan that never produced a signed envelope to evaluate.

    Nothing downstream of the issuer chain was checked, so only R_I carries
    evidence; the rest stay honest about not having been evaluated.
    """
    return {
        "issuer_chain": _entry("no-issuer", cause),
        "destination_policy": _entry("not-applicable"),
        "redirect_flow": _entry("not-applicable"),
        "runtime_safety": _entry("not-checked"),
        "freshness": _entry("not-applicable"),
        "artifact_integrity": _entry("pass"),
    }


def _apply_trust_residual_gate(
    decision_state: str,
    residual_vector: ResidualVector,
) -> tuple[str, Decision]:
    """D15 totality on the live path: the positive terminal requires Δ agreement.

    Any residual tier outside the positive-eligible sets — including verdict
    states or verifier stages added later that the mapping above passes through
    unmodeled — fails closed to a caution instead of implicit trust. The gate is
    one-way: it never upgrades a state the pipeline already decided to withhold.
    """
    tiers = {family: str(entry["tier"]) for family, entry in residual_vector.items()}
    model_decision = decide_trust_residuals(
        tiers,
        profile=_RUNTIME_DECISION_PROFILE,
    )
    if decision_state == "verified_issuer" and model_decision.primary_state != "verified-issuer":
        return "unverified", model_decision
    return decision_state, model_decision


def _residual_payload(
    vector: ResidualVector,
    decision: Decision,
    *,
    extra_reason_codes: tuple[str, ...] = (),
) -> tuple[dict[str, ResidualEntry], ModelDecisionResponse]:
    """The wire form of a residual vector and the model decision it produced."""
    entries = {
        family: ResidualEntry(
            # `no-issuer` is Delta's internal categorical R_I value. On the
            # residual wire it is unknown evidence qualified by the cause; it
            # is not a seventh severity outside the protocol lattice.
            tier="unknown" if entry["tier"] == "no-issuer" else str(entry["tier"]),
            cause=entry["cause"],
        )
        for family, entry in vector.items()
    }
    data = decision.as_dict()
    reason_codes = list(data["reason_codes"])
    for code in extra_reason_codes:
        if code not in reason_codes:
            reason_codes.append(code)
    return entries, ModelDecisionResponse(
        profile=_RUNTIME_DECISION_PROFILE,
        primary_state=data["primary_state"],
        annotations=list(data["annotations"]),
        reason_codes=reason_codes,
        attention_level=data["attention_level"],
    )


def _scanner_decision_from_result(
    envelope: SignedQRCodeEnvelope,
    result: NarrowedVerifierResponse,
    record: ScannerTrustRecord,
    *,
    request_id: str | None,
    artifact_analysis: QRArtifactAnalysis | None = None,
    envelope_id: str | None = None,
) -> ScannerDecisionResponse:
    redirect_verdict = (
        evaluate_unobserved_redirect_policy(envelope.claims.payload)
        if result.allowed
        else None
    )
    effective_destination = (
        redirect_verdict.effective_url
        if redirect_verdict is not None
        else envelope.claims.payload
    )
    runtime_verdict = (
        evaluate_runtime_safety(effective_destination)
        if result.allowed and not (redirect_verdict and redirect_verdict.is_blocked)
        else None
    )
    decision_state = "verified_issuer" if result.allowed else "blocked"
    open_allowed = result.allowed
    verifier_stage = result.stage
    verifier_reason = result.reason
    destination_binding = _scanner_binding_for_stage(result.stage, result.allowed)
    if redirect_verdict and redirect_verdict.is_redirect_flow:
        if redirect_verdict.state == "unknown":
            decision_state = "unknown"
            open_allowed = False
            verifier_stage = "redirect_policy"
            verifier_reason = redirect_verdict.reason
            destination_binding = "redirect_unobserved"
        elif redirect_verdict.is_blocked:
            decision_state = "blocked"
            open_allowed = False
            verifier_stage = "redirect_policy"
            verifier_reason = redirect_verdict.reason
            destination_binding = "redirect_mismatch"
        else:
            destination_binding = "bound"
    if runtime_verdict is not None:
        decision_state = runtime_verdict.decision_state
        open_allowed = runtime_verdict.open_allowed
        if not runtime_verdict.is_clean:
            verifier_stage = "runtime_safety"
            verifier_reason = runtime_verdict.reason
    primary_message = _scanner_primary_message(
        result,
        redirect_verdict=redirect_verdict,
        runtime_verdict=runtime_verdict,
        artifact_analysis=artifact_analysis,
    )
    residual_vector = _residual_vector_for_result(
        result,
        redirect_verdict=redirect_verdict,
        runtime_verdict=runtime_verdict,
        artifact_analysis=artifact_analysis,
    )
    gated_state, model_decision = _apply_trust_residual_gate(decision_state, residual_vector)
    if gated_state != decision_state:
        decision_state = gated_state
        verifier_stage = "trust_residuals"
        verifier_reason = "Residual evidence outside positive-eligible tiers: " + ", ".join(
            model_decision.reason_codes,
        )
        primary_message = (
            "Verification evidence is incomplete for this QR code. "
            "Proceed only with caution."
        )
    issuer_status = (
        "recognized" if result.stage not in _TRUST_FAILURE_STAGES else "revoked"
    )
    if result.cause == "trust-state-unavailable":
        # Spec 2.5: an outage past the staleness budget is an unknown verdict,
        # not a judgment about the issuer or key.
        decision_state = "unknown"
        open_allowed = False
        issuer_status = "unknown"
        primary_message = (
            "The verifier cannot confirm issuer and key status right now. "
            "Do not open this destination until verification is available."
        )
    entries, model = _residual_payload(residual_vector, model_decision)
    return ScannerDecisionResponse(
        decision_state=decision_state,
        open_allowed=open_allowed,
        envelope_id=envelope_id,
        residual_vector=entries,
        model_decision=model,
        primary_message=primary_message,
        issuer=ScannerDecisionIssuer(
            name=record.certificate.issuer_name,
            tier=record.governance.assurance_tier if record.governance else "demo",
            status=issuer_status,
        ),
        destination=_scanner_destination(
            effective_destination,
            binding=destination_binding,
            resolver_url=redirect_verdict.resolver_url if redirect_verdict else None,
            final_url=redirect_verdict.final_url if redirect_verdict else None,
            redirect_hops=redirect_verdict.hop_count if redirect_verdict else None,
            redirect_policy=redirect_verdict.policy_label if redirect_verdict else None,
        ),
        governance=_scanner_governance_response(record.governance),
        signals=_scanner_signals_for_result(
            result,
            record=record,
            redirect_verdict=redirect_verdict,
            runtime_verdict=runtime_verdict,
            artifact_analysis=artifact_analysis,
        ),
        actions=_scanner_actions(decision_state=decision_state, open_allowed=open_allowed),
        verifier_stage=verifier_stage,
        verifier_reason=verifier_reason,
        verdict_source=result.verdict_source,
        request_id=request_id,
    )


async def _run_scanner_decision(
    request: ScannerDecisionRequest,
    *,
    request_id: str | None,
) -> ScannerDecisionResponse:
    verifier_profile_decision = _verifier_profile_state_decision(
        request,
        request_id=request_id,
    )
    if verifier_profile_decision is not None:
        return verifier_profile_decision

    qr_payload = request.qr_payload.strip()
    try:
        artifact_analysis = _scanner_artifact_analysis_for_request(request)
    except QRArtifactError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if artifact_analysis is not None and artifact_analysis.payload.strip() != qr_payload:
        return _artifact_payload_mismatch_decision(
            qr_payload,
            artifact_analysis,
            request_id=request_id,
        )

    try:
        envelope = decode_envelope_from_qr_payload(qr_payload)
    except ValueError as exc:
        # A payload that does not decode still gets a verdict, never an error:
        # the scanner route answers every scan. The cause stays in the protocol
        # vocabulary; implementation reason codes distinguish a plain URL, an
        # unreadable envelope, and an unsupported claims version.
        reason = str(exc)
        cause: ResidualCause = "no-trust-claim"
        extra_reason_codes: tuple[str, ...] = (NO_SIGNED_ENVELOPE_REASON,)
        if reason.startswith(_UNSUPPORTED_VERSION_PREFIX):
            cause = "invalid-trust-claim"
            extra_reason_codes = (UNSUPPORTED_CLAIMS_VERSION_REASON,)
        elif not _looks_like_url(qr_payload):
            cause = "invalid-trust-claim"
            extra_reason_codes = (UNSUPPORTED_ENVELOPE_REASON,)
        return _unverified_scanner_decision(
            qr_payload,
            reason=reason,
            request_id=request_id,
            cause=cause,
            extra_reason_codes=extra_reason_codes,
        )

    # Ensure the projection is fresh before resolving the record from it:
    # _run_narrowed_verifier repeats this call (cheaply reused when nothing
    # changed), but resolving the record first would let a scan judge an
    # issuer against a store that governance has already moved past.
    await _ensure_trust_projection()
    record = _scanner_record_for(envelope.claims.certificate_ref)
    if record is None:
        return _signed_unknown_issuer_decision(envelope, request_id=request_id)

    governance_cache_decision = _governance_cache_blocking_decision(
        envelope,
        record,
        request_id=request_id,
    )
    if governance_cache_decision is not None:
        return governance_cache_decision

    result = await _run_scanned_verifier(
        ScannedVerifierRequest(
            qr_payload=qr_payload,
            certificate=record.certificate,
            issuer_state=record.issuer_state,
        ),
        # The decision endpoint records the cached hit itself, with the colour
        # the user actually saw.
        count_cache_hit=False,
    )
    return _scanner_decision_from_result(
        envelope,
        result,
        record,
        request_id=request_id,
        artifact_analysis=artifact_analysis,
        envelope_id=compute_envelope_id(envelope.claims, envelope.signature),
    )


# Absent window bounds mean "unbounded", not "now". A legacy request carries no
# issuer record or key window, and must verify exactly as it did before the store.
_UNBOUNDED_PAST = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _optional_trust_timestamp(label: str, value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        return parse_claim_timestamp(label, value)
    except SignedSchemaError as exc:
        # A malformed trust input is the caller's error, not the artifact's. Raising
        # 422 here keeps it out of the evidence log and off the blocked path.
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _bounded_trust_timestamp(label: str, value: str | None, *, default: datetime) -> datetime:
    parsed = _optional_trust_timestamp(label, value)
    return default if parsed is None else parsed


def _legacy_issuer_status(state: IssuerVerificationStateInput) -> str:
    """Fold the legacy certificate flags onto an issuer-record status.

    Revoked outranks inactive so the cause slug stays `issuer-revoked` for a request
    that sets both, matching the pre-store behaviour exactly.
    """
    if state.issuer_status is not None:
        return state.issuer_status
    if state.certificate_revoked:
        return "revoked"
    if not state.certificate_active:
        return "suspended"
    return "active"


def _trust_context_from_state(
    certificate: CertificateAuthorityRecord,
    state: IssuerVerificationStateInput,
) -> TrustContext:
    issuer_issued_at = _bounded_trust_timestamp(
        "issuer_record_issued_at", state.issuer_record_issued_at, default=_UNBOUNDED_PAST
    )
    issuer_expires_at = _optional_trust_timestamp(
        "issuer_record_expires_at", state.issuer_record_expires_at
    )
    if issuer_expires_at is not None and issuer_expires_at <= issuer_issued_at:
        raise HTTPException(
            status_code=422,
            detail="Field 'issuer_record_expires_at' must be after 'issuer_record_issued_at'",
        )
    key_not_before = _bounded_trust_timestamp(
        "key_not_before", state.key_not_before, default=_UNBOUNDED_PAST
    )
    key_not_after = _optional_trust_timestamp("key_not_after", state.key_not_after)
    if key_not_after is not None and key_not_after <= key_not_before:
        raise HTTPException(
            status_code=422, detail="Field 'key_not_after' must be after 'key_not_before'"
        )
    issuer = IssuerRecord(
        issuer_id=certificate.issuer_name,
        issuer_name=certificate.issuer_name,
        # This endpoint is a stateless rehearsal surface: the caller supplies the whole
        # issuer state on every request, so there is no published root to scope it to.
        # Nothing in evaluate_trust_window keys off root_id or issuer_id; the
        # display name is carried so the scanner surface can render it (Task 5).
        root_id="root:request-supplied",
        status=_legacy_issuer_status(state),
        issued_at=issuer_issued_at,
        expires_at=issuer_expires_at,
        verified_domains=dict(state.verified_domains),
        allow_subdomains=state.allow_subdomains,
    )
    key = KeyEntry(
        key_ref=certificate.certificate_ref,
        issuer_id=issuer.issuer_id,
        algorithm_id=certificate.algorithm_id,
        public_key_pem=certificate.public_key_pem,
        state=state.key_state or "active",
        not_before=key_not_before,
        not_after=key_not_after,
        revocation_reason=state.key_revocation_reason or state.certificate_revocation_reason,
    )
    return TrustContext(key=key, issuer=issuer, skew_seconds=config.VERIFIER_CLOCK_SKEW_SECONDS)


async def _run_narrowed_verifier(
    request: NarrowedVerifierRequest,
    *,
    count_cache_hit: bool = True,
) -> NarrowedVerifierResponse:
    projection_state = await _ensure_trust_projection()
    if projection_state == "unavailable":
        cause = "trust-state-unavailable"
        return NarrowedVerifierResponse(
            allowed=False,
            stage="key_status",
            reason=(
                "trust state unavailable: the verifier cannot confirm "
                "issuer and key status"
            ),
            canonical_claims_sha256=None,
            matched_rule=None,
            cause=cause,
        )

    try:
        claims = parse_claims_mapping(request.envelope.claims.model_dump())
    except SignedSchemaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    envelope = SignedQRCodeEnvelope(
        claims=claims,
        signature=request.envelope.signature,
        code_algorithm_id=request.envelope.code_algorithm_id,
    )
    certificate = CertificateAuthorityRecord(
        certificate_ref=request.certificate.certificate_ref,
        issuer_name=request.certificate.issuer_name,
        algorithm_id=request.certificate.algorithm_id,
        public_key_pem=request.certificate.public_key_pem,
    )
    trust = _trust_context_from_state(certificate, request.issuer_state)

    # Every presented code is budgeted, and the subject is the envelope
    # itself: a tampered signature is a different envelope with its own
    # budget, so a forged flood cannot exhaust a genuine code's allowance.
    fingerprint = _envelope_fingerprint(
        compute_envelope_id(claims, request.envelope.signature)
    )
    cache_key: str | None = None
    cache_ttl = _verdict_cache_ttl_seconds(claims.expires_at)
    if cache_ttl > 0:
        # Cache first: a crowd scanning one poster gets the verdict computed
        # moments ago without a signature check, a budget spend, or a row.
        cache_key = _verdict_cache_key(
            request,
            fingerprint,
            token=_trust_projection_manager.token,
            resolution=load_destination_policy_resolution(),
        )
        cached = await _verdict_cache.get(cache_key)
        if cached is not None:
            cached_response = NarrowedVerifierResponse.model_validate(
                {**cached, "verdict_source": "cached"}
            )
            if count_cache_hit:
                # A cached verdict writes no evidence row, so count it here or
                # the scan-activity card under-reports the crowd. Callers that
                # own richer bookkeeping (the scanner decision endpoint records
                # its own decision colour) opt out instead of double-counting.
                await _verdict_cache.record_hit(
                    fingerprint,
                    "green" if cached_response.allowed else "red",
                    window_seconds=DEFAULT_SCAN_ACTIVITY_LOOKBACK_SECONDS,
                )
            return cached_response
    # Before the signature check: a forged flood must be cheap to refuse.
    await _enforce_scan_flood_budget(
        bucket="envelope",
        subject=fingerprint,
        limit=config.VERIFIER_ENVELOPE_RATE_LIMIT_MAX_REQUESTS,
        detail="Rate limit exceeded for this QR code",
    )

    result = await _verifier.verify_presented_code(envelope, certificate, trust)

    if result.stage != "signed_schema":
        # After the signature check: only genuinely signed codes spend the
        # issuer's budget, so an attacker cannot exhaust it with forgeries.
        await _enforce_scan_flood_budget(
            bucket="issuer",
            subject=_issuer_budget_key(certificate.certificate_ref),
            limit=config.VERIFIER_ISSUER_RATE_LIMIT_MAX_REQUESTS,
            detail="Rate limit exceeded for this issuer",
        )

    response = NarrowedVerifierResponse(
        allowed=result.allowed,
        stage=result.stage,
        reason=result.reason,
        canonical_claims_sha256=result.canonical_claims_sha256,
        matched_rule=result.matched_rule,
        cause=result.cause,
    )
    if cache_key is not None and result.stage != "signed_schema":
        # Never cache a forgery verdict: the next forged envelope hashes
        # differently anyway, and a real one must be checked, not remembered.
        # The write-time TTL re-clamps to every boundary this verdict
        # consulted: the issuer record's expiry always (over-clamping an
        # early-stage deny only shortens an entry), and the matched
        # domain's proof expiry exactly when the decision relied on
        # domain verification.
        boundaries: list[datetime | None] = [
            _optional_trust_timestamp(
                "issuer_record_expires_at",
                request.issuer_state.issuer_record_expires_at,
            )
        ]
        if result.matched_domain is not None:
            boundaries.append(
                normalized_verified_domains(request.issuer_state.verified_domains).get(
                    result.matched_domain
                )
            )
        write_ttl = _verdict_cache_ttl_seconds(
            claims.expires_at, consulted_boundaries=boundaries
        )
        if write_ttl > 0:
            await _verdict_cache.set(cache_key, response.model_dump(), write_ttl)
    return response


async def _run_scanned_verifier(
    request: ScannedVerifierRequest,
    *,
    count_cache_hit: bool = True,
) -> NarrowedVerifierResponse:
    try:
        envelope = decode_envelope_from_qr_payload(request.qr_payload)
    except QRArtifactError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    translated_request = NarrowedVerifierRequest(
        envelope=SignedEnvelopeInput(
            claims=SignedClaimsInput(**envelope.claims.__dict__),
            signature=envelope.signature,
            code_algorithm_id=envelope.code_algorithm_id,
        ),
        certificate=request.certificate,
        issuer_state=request.issuer_state,
    )
    return await _run_narrowed_verifier(translated_request, count_cache_hit=count_cache_hit)


@router.post("/demo-materials", response_model=DemoMaterialsResponse)
async def get_verifier_demo_materials(
    request_context: Request,
    request: DemoMaterialsRequest,
) -> DemoMaterialsResponse:
    """
    Generate a self-contained certificate, keypair, and verification request
    for the narrowed verifier reference endpoint.
    """
    await _enforce_verifier_api_key(request_context)
    await _enforce_verifier_rate_limit(request_context, bucket="demo_materials")
    try:
        return _build_demo_materials_response(request)
    except SignedSchemaError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/status", response_model=VerifierStatusResponse)
async def get_verifier_status(request_context: Request) -> VerifierStatusResponse:
    await _enforce_verifier_rate_limit(request_context, bucket="status")
    return await _build_verifier_status_response(
        include_operator_evidence=await _request_can_read_operator_status(
            request_context,
        ),
    )


def _isoformat_or_none(value: datetime | None) -> str | None:
    return None if value is None else value.isoformat()


@router.get("/trust-store", response_model=TrustStoreResponse)
async def get_trust_store(request_context: Request) -> TrustStoreResponse:
    """
    Operator-only, read-only listing of the scanner's trust store: every issuer
    record and every signing key with its state and validity window. Cycle 2 has
    no mutation surface — the store is written by ``demo-materials`` only.

    The listing is the same class of operator evidence ``/verifier/status``
    redacts, so it is gated the same way: ``_request_can_read_operator_status``
    returns True whenever verifier auth is disabled (the demo default, which the
    lab and the cross-surface smokes rely on), and otherwise demands a valid
    management credential on the admin header. A caller without one gets a 403
    rather than a silently empty listing, so a missing credential cannot be
    mistaken for an empty store.
    """
    await _enforce_verifier_rate_limit(request_context, bucket="status")
    if not await _request_can_read_operator_status(request_context):
        raise HTTPException(
            status_code=403,
            detail="Trust store listing requires an operator credential",
        )
    return TrustStoreResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        issuers=[
            TrustStoreIssuerResponse(
                issuer_id=record.issuer_id,
                issuer_name=record.issuer_name,
                root_id=record.root_id,
                status=record.status,
                issued_at=record.issued_at.isoformat(),
                expires_at=_isoformat_or_none(record.expires_at),
                verified_domains=list(record.verified_domains),
                allow_subdomains=record.allow_subdomains,
            )
            for record in _scanner_trust_store.issuers()
        ],
        keys=[
            TrustStoreKeyResponse(
                key_ref=entry.key_ref,
                issuer_id=entry.issuer_id,
                algorithm_id=entry.algorithm_id,
                state=entry.state,
                not_before=entry.not_before.isoformat(),
                not_after=_isoformat_or_none(entry.not_after),
                revoked_at=_isoformat_or_none(entry.revoked_at),
                revocation_reason=entry.revocation_reason,
            )
            for entry in _scanner_trust_store.keys()
        ],
    )


@router.get("/scan-activity", response_model=ScanActivityResponse)
async def get_scan_activity(
    request_context: Request,
    envelope_id: str = Query(
        min_length=64,
        max_length=64,
        pattern=r"^[0-9a-f]{64}$",
        description="The envelope identifier the signed claims and signature hash to.",
    ),
) -> ScanActivityResponse:
    """
    Report whether the QR carrying ``envelope_id`` has been scanned, by whom,
    and how the scanner decided. Counts come from the scanner-decision evidence
    store, plus the cached verdicts this process served.
    """
    await _enforce_verifier_api_key(request_context)
    await _enforce_verifier_rate_limit(request_context, bucket="scan_activity")
    fingerprint = _envelope_fingerprint(envelope_id)
    activity = await load_scan_activity(fingerprint)
    update: dict[str, Any] = {
        "destination_outcome": _scan_activity_destination_outcome(activity.latest),
    }
    update.update(await _scan_activity_throttle_update(activity, fingerprint))
    return activity.model_copy(update=update)


async def _scan_activity_throttle_update(
    activity: ScanActivityResponse,
    fingerprint: str,
) -> dict[str, Any]:
    """The ``throttle`` block for this envelope, plus the cached scans folded
    into the counts when there is a real evidence store to fold them into."""
    hits = await _verdict_cache.hit_summary(fingerprint)
    limit = config.VERIFIER_ENVELOPE_RATE_LIMIT_MAX_REQUESTS
    window_seconds = config.VERIFIER_ENVELOPE_RATE_LIMIT_WINDOW_SECONDS
    remaining = await _request_rate_limiter.remaining(
        _scan_flood_budget_key("envelope", fingerprint),
        limit=limit,
        window_seconds=window_seconds,
    )
    update: dict[str, Any] = {
        "throttle": ScanActivityThrottleResponse(
            cached_verdicts=hits.total,
            last_cached_at=hits.last_hit_at,
            verdict_cache_ttl_seconds=max(0, config.VERIFIER_VERDICT_CACHE_TTL_SECONDS),
            envelope_budget_limit=limit,
            envelope_budget_remaining=remaining,
            envelope_budget_window_seconds=window_seconds,
        )
    }
    if hits.total and activity.persistence_state == "observable":
        # Cached scans are real scans; without a store the counts stay at
        # zero rather than showing hits against an empty history.
        update.update(
            scan_count=activity.scan_count + hits.total,
            green_count=activity.green_count + hits.green,
            orange_count=activity.orange_count + hits.orange,
            red_count=activity.red_count + hits.red,
        )
        if hits.last_hit_at and (
            activity.last_scanned_at is None or hits.last_hit_at > activity.last_scanned_at
        ):
            update["last_scanned_at"] = hits.last_hit_at
    return update


_DESTINATION_OUTCOME_BY_EVENT: dict[str, ScanActivityDestinationOutcome] = {
    "open": "opened",
    "cancel": "cancelled",
    "hold_complete": "held",
    "hold_start": "previewed",
    "preview": "previewed",
}
_DESTINATION_OUTCOME_RANK: dict[ScanActivityDestinationOutcome, int] = {
    "unreported": 0,
    "previewed": 1,
    "held": 2,
    "cancelled": 3,
    "opened": 4,
}


def _scan_activity_destination_outcome(
    latest: ScanActivityDecisionResponse | None,
) -> ScanActivityDestinationOutcome | None:
    """
    What the scanner did after its latest decision, from the UX events it
    reported for that ``decision_id``. The most conclusive event wins (an
    ``open`` outranks the ``hold_complete`` that preceded it). The event log
    is in-memory for this process, so ``unreported`` only says no event
    reached this verifier.
    """
    if latest is None:
        return None
    outcome: ScanActivityDestinationOutcome = "unreported"
    for entry in _scanner_ux_event_log:
        if entry.event.decision_id != latest.decision_id:
            continue
        candidate = _DESTINATION_OUTCOME_BY_EVENT.get(entry.event.event_type)
        if candidate and _DESTINATION_OUTCOME_RANK[candidate] > _DESTINATION_OUTCOME_RANK[outcome]:
            outcome = candidate
    return outcome


@router.post("/verify", response_model=NarrowedVerifierResponse)
async def verify_presented_code(
    request_context: Request,
    request: NarrowedVerifierRequest,
    response: Response,
) -> NarrowedVerifierResponse:
    """
    Run the narrowed verifier reference pipeline against a presented code.
    """
    await _enforce_verifier_api_key(request_context)
    await _enforce_verifier_rate_limit(request_context, bucket="verify")
    result = await _run_narrowed_verifier(request)
    _set_verdict_source_header(response, result.verdict_source)
    return result


@router.post("/verify-scanned", response_model=NarrowedVerifierResponse)
async def verify_scanned_code(
    request_context: Request,
    request: ScannedVerifierRequest,
    response: Response,
) -> NarrowedVerifierResponse:
    """
    Run the narrowed verifier pipeline against a scanned QR payload string.
    """
    await _enforce_verifier_api_key(request_context)
    await _enforce_verifier_rate_limit(request_context, bucket="verify_scanned")
    result = await _run_scanned_verifier(request)
    _set_verdict_source_header(response, result.verdict_source)
    return result


@scanner_router.get("/provider-profile", response_model=VerifierProviderProfileResponse)
async def get_scanner_provider_profile(
    request_context: Request,
) -> VerifierProviderProfileResponse:
    """
    Return the current scanner-side provider profile.

    Production scanners should refresh this profile from app state so provider
    staleness or revocation can change without rebuilding or reinstalling.
    """
    endpoint = _request_public_base_url(request_context)
    return VerifierProviderProfileResponse(
        id="local-qrtrust-demo-provider",
        name="QR Trust local provider",
        summary=(
            "A managed verifier profile served by the local QR Trust provider "
            "for scanner-side issuer, destination, and runtime decisions."
        ),
        trust_program="Demo issuer trust program",
        policy=(
            "Issuer legitimacy, destination binding, runtime safety, "
            "and scanner decision state"
        ),
        endpoints=[endpoint],
        profile_state=_configured_verifier_profile_state(),
        signature_status="Local reviewer profile; signature envelope not production-verified",
    )


@scanner_router.post("/decisions", response_model=ScannerDecisionResponse)
async def decide_scanned_qr(
    request_context: Request,
    request: ScannerDecisionRequest,
    http_response: Response,
) -> ScannerDecisionResponse:
    """
    End-user scanner decision endpoint.

    Unlike /verifier/verify-scanned, the client sends only the scanned QR
    payload. The verifier resolves issuer state from its local trust cache and
    returns a user-facing decision state.
    """
    await _enforce_verifier_rate_limit(request_context, bucket="scanner_decisions")
    response = await _run_scanner_decision(
        request,
        request_id=_request_id_for_context(request_context),
    )
    decorated_response = _with_scanner_ux(response, request=request)
    _set_verdict_source_header(http_response, decorated_response.verdict_source)
    fingerprint = _scanned_envelope_fingerprint(request.qr_payload)
    if decorated_response.verdict_source == "cached":
        # A cached verdict writes no evidence row; count it so the lab card's
        # scan count stays honest without paying for a row per scan.
        contract = decorated_response.contract
        if fingerprint is not None and contract is not None:
            await _verdict_cache.record_hit(
                fingerprint,
                contract.decision_color,
                window_seconds=DEFAULT_SCAN_ACTIVITY_LOOKBACK_SECONDS,
            )
            # The spike detector reads this minute bucket; without it a warm
            # cache would hide the flood (no evidence row, no budget spend).
            await _verdict_cache.record_cached_scan(
                fingerprint,
                retain_seconds=max(1, config.VERIFIER_SCAN_SPIKE_BASELINE_SECONDS) + 60,
            )
        return decorated_response
    recording_result = await record_scanner_evidence(
        decorated_response,
        envelope_fingerprint=fingerprint,
        client_platform=request.client.platform if request.client else None,
    )
    if recording_result is not None and recording_result.error:
        logger.warning(
            "scanner_evidence_recording_failed request_id=%s error=%s",
            decorated_response.request_id,
            recording_result.error,
        )
    return decorated_response


@scanner_router.post("/ux-events", response_model=ScannerUXEventLogResponse)
async def record_scanner_ux_event(
    request_context: Request,
    request: ScannerUXEventLogRequest,
) -> ScannerUXEventLogResponse:
    """
    Record scanner preview, hold, open, and cancel events for PoC evaluation.

    The first implementation is intentionally log-backed with an in-process
    export buffer so the interaction contract can stabilize before adding
    durable experiment storage.
    """
    await _enforce_verifier_rate_limit(request_context, bucket="scanner_ux_events")
    client_host = request_context.client.host if request_context.client else "unknown"
    entry = ScannerUXEventLogEntry(
        id=f"uxevt_{uuid4().hex}",
        recorded_at=datetime.now(timezone.utc).isoformat(),
        client_host=client_host,
        event=request,
    )
    _scanner_ux_event_log.append(entry)
    logger.info(
        "scanner_ux_event",
        extra={
            "scanner_ux_event": entry.model_dump(mode="json"),
            "client_host": client_host,
        },
    )
    return ScannerUXEventLogResponse(recorded=True, event_type=request.event_type)


@scanner_router.get("/ux-ab-fixture", response_model=ScannerUXExperimentFixtureResponse)
async def get_scanner_ux_ab_fixture(
    request_context: Request,
    seed: str = "reviewer-demo",
) -> ScannerUXExperimentFixtureResponse:
    """
    Return deterministic control/treatment scanner UX fixture logs.

    This is a reviewer-facing scaffold for the hold-to-open experiment. It
    keeps the user-study shape concrete without pretending local PoC fixtures
    are production analytics storage.
    """
    await _enforce_verifier_rate_limit(request_context, bucket="scanner_ux_events")
    bounded_seed = seed.strip()[:128] or "reviewer-demo"
    return build_scanner_ux_ab_fixture(bounded_seed)


@scanner_router.get("/ux-events", response_model=ScannerUXEventLogListResponse)
async def list_scanner_ux_events(
    request_context: Request,
    limit: int = 50,
    request_id: str | None = None,
    decision_id: str | None = None,
) -> ScannerUXEventLogListResponse:
    """Return recent scanner UX events for local demos and review packets."""
    await _enforce_verifier_rate_limit(request_context, bucket="scanner_ux_events")
    bounded_limit = max(1, min(limit, 200))
    events = list(_scanner_ux_event_log)
    if request_id:
        events = [event for event in events if event.event.request_id == request_id]
    if decision_id:
        events = [event for event in events if event.event.decision_id == decision_id]
    return ScannerUXEventLogListResponse(events=events[-bounded_limit:])


@router.post("/decode-image", response_model=QRCodeImageDecodeResponse)
async def decode_qr_image(
    request_context: Request,
    request: QRCodeImageDecodeRequest,
) -> QRCodeImageDecodeResponse:
    """
    Decode a QR payload string from base64 image content.
    """
    await _enforce_verifier_api_key(request_context)
    await _enforce_verifier_rate_limit(request_context, bucket="decode_image")
    try:
        image_bytes = decode_image_base64(request.image_base64)
        qr_payload = decode_qr_payload_from_png_bytes(image_bytes)
    except QRArtifactError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return QRCodeImageDecodeResponse(qr_payload=qr_payload)


@router.get("/admin/api-keys", response_model=VerifierAPIKeyListResponse)
async def list_verifier_api_keys(request_context: Request) -> VerifierAPIKeyListResponse:
    _raise_legacy_verifier_admin_api_key_route()


@router.post("/admin/api-keys/issue", response_model=VerifierAPIKeyIssueResponse)
async def issue_verifier_api_key(
    request_context: Request,
    request: VerifierAPIKeyIssueRequest,
) -> VerifierAPIKeyIssueResponse:
    _raise_legacy_verifier_admin_api_key_route()


@router.post("/admin/api-keys/{key_id}/rotate", response_model=VerifierAPIKeyIssueResponse)
async def rotate_verifier_api_key(
    key_id: str,
    request_context: Request,
    request: VerifierAPIKeyRotateRequest,
) -> VerifierAPIKeyIssueResponse:
    _raise_legacy_verifier_admin_api_key_route()


@router.delete("/admin/api-keys/{key_id}", response_model=VerifierAPIKeyRevokeResponse)
async def revoke_verifier_api_key(
    key_id: str,
    request_context: Request,
) -> VerifierAPIKeyRevokeResponse:
    _raise_legacy_verifier_admin_api_key_route()
