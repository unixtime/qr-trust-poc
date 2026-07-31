from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

UsagePolicy = Literal["reusable_public", "one_time", "time_limited"]
GovernanceCacheProfile = Literal["fresh", "stale", "expired"]
ArtifactRenderProfile = Literal["clean", "low-quiet-zone", "payload-mismatch"]
VerifierProfileState = Literal["active", "stale", "revoked"]


class SignedClaimsInput(BaseModel):
    version: str = Field(min_length=1, max_length=8)
    usage_policy: UsagePolicy = "reusable_public"
    certificate_ref: str = Field(min_length=1, max_length=256)
    issued_at: str = Field(min_length=1, max_length=64)
    expires_at: str = Field(min_length=1, max_length=64)
    nonce: str = Field(min_length=1, max_length=256)
    payload: str = Field(min_length=1, max_length=2048)


class SignedEnvelopeInput(BaseModel):
    claims: SignedClaimsInput
    signature: str = Field(min_length=1, max_length=8192)
    code_algorithm_id: str | None = Field(default=None, max_length=64)


class CertificateRecordInput(BaseModel):
    certificate_ref: str = Field(min_length=1, max_length=256)
    issuer_name: str = Field(min_length=1, max_length=256)
    algorithm_id: str = Field(min_length=1, max_length=64)
    public_key_pem: str = Field(min_length=1, max_length=8192)


class IssuerVerificationStateInput(BaseModel):
    verified_domains: list[str] = Field(default_factory=list)
    allow_subdomains: bool = False
    certificate_active: bool = True
    certificate_revoked: bool = False
    certificate_revocation_reason: str | None = Field(default=None, max_length=512)


class NarrowedVerifierRequest(BaseModel):
    envelope: SignedEnvelopeInput
    certificate: CertificateRecordInput
    issuer_state: IssuerVerificationStateInput
    reservation_ttl_seconds: int = Field(default=5, gt=0)
    consumed_ttl_seconds: int = Field(default=60, gt=0)


class ScannedVerifierRequest(BaseModel):
    qr_payload: str = Field(min_length=1, max_length=8192)
    certificate: CertificateRecordInput
    issuer_state: IssuerVerificationStateInput
    reservation_ttl_seconds: int = Field(default=5, gt=0)
    consumed_ttl_seconds: int = Field(default=60, gt=0)


class QRCodeImageDecodeRequest(BaseModel):
    image_base64: str = Field(min_length=1, max_length=8_000_000)


class QRCodeImageDecodeResponse(BaseModel):
    qr_payload: str = Field(min_length=1, max_length=8192)


class ScannerDecisionClientInput(BaseModel):
    platform: str = Field(default="unknown", min_length=1, max_length=64)
    app_version: str | None = Field(default=None, max_length=64)
    verifier_profile_state: VerifierProfileState = "active"


class ScannerDecisionRequest(BaseModel):
    qr_payload: str = Field(min_length=1, max_length=8192)
    image_base64: str | None = Field(default=None, max_length=8_000_000)
    display_text: str | None = Field(default=None, max_length=512)
    prior_opened_hosts: list[str] | None = Field(default=None, max_length=100)
    known_bad_hosts: list[str] = Field(default_factory=list, max_length=100)
    newly_registered_hosts: list[str] = Field(default_factory=list, max_length=100)
    domain_age_days: dict[str, int] = Field(default_factory=dict, max_length=100)
    client: ScannerDecisionClientInput | None = None


class ScannerUXEventLogRequest(BaseModel):
    event_type: Literal["preview", "hold_start", "hold_complete", "open", "cancel"]
    request_id: str | None = Field(default=None, max_length=128)
    decision_id: str | None = Field(default=None, max_length=128)
    decision_state: str = Field(min_length=1, max_length=64)
    risk_score: int = Field(ge=0, le=100)
    risk_level: Literal["green", "amber", "red"]
    reason_codes: list[str] = Field(default_factory=list)
    hold_required: bool
    hold_ms: int = Field(ge=0, le=3000)
    destination_display: str | None = Field(default=None, max_length=256)
    destination_url: str | None = Field(default=None, max_length=2048)
    elapsed_ms: int | None = Field(default=None, ge=0, le=600_000)
    client: ScannerDecisionClientInput | None = None


class ScannerUXEventLogResponse(BaseModel):
    recorded: bool
    event_type: Literal["preview", "hold_start", "hold_complete", "open", "cancel"]


class ScannerUXEventLogEntry(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    recorded_at: str = Field(min_length=1, max_length=64)
    client_host: str = Field(min_length=1, max_length=256)
    event: ScannerUXEventLogRequest


class ScannerUXEventLogListResponse(BaseModel):
    events: list[ScannerUXEventLogEntry]


ScannerUXEventType = Literal["preview", "hold_start", "hold_complete", "open", "cancel"]
ScannerUXRiskLevel = Literal["green", "amber", "red"]
ScannerUXExperimentArm = Literal["control", "treatment"]
ScannerUXExperimentCaseKind = Literal["benign", "mismatch", "high_risk"]


class ScannerUXExperimentEvent(BaseModel):
    scan_id: str = Field(min_length=1, max_length=128)
    arm: ScannerUXExperimentArm
    case_kind: ScannerUXExperimentCaseKind
    event_type: ScannerUXEventType
    elapsed_ms: int = Field(ge=0, le=600_000)
    decision_state: str = Field(min_length=1, max_length=64)
    risk_score: int = Field(ge=0, le=100)
    risk_level: ScannerUXRiskLevel
    reason_codes: list[str] = Field(default_factory=list)
    hold_required: bool
    hold_ms: int = Field(ge=0, le=3000)
    destination_display: str = Field(min_length=1, max_length=256)
    destination_url: str = Field(min_length=1, max_length=2048)


class ScannerUXExperimentArmSummary(BaseModel):
    arm: ScannerUXExperimentArm
    total_scans: int = Field(ge=0)
    flagged_scans: int = Field(ge=0)
    held_open_count: int = Field(ge=0)
    flagged_blind_open_count: int = Field(ge=0)
    flagged_blind_open_rate: float = Field(ge=0, le=1)
    median_benign_decision_ms: int = Field(ge=0)
    false_friction_rate: float = Field(ge=0, le=1)


class ScannerUXExperimentArmResult(BaseModel):
    summary: ScannerUXExperimentArmSummary
    sample_events: list[ScannerUXExperimentEvent]


class ScannerUXExperimentFixtureResponse(BaseModel):
    seed: str = Field(min_length=1, max_length=128)
    participants_per_arm: int = Field(ge=1)
    scans_per_participant: int = Field(ge=1)
    sampled_scans_per_arm: int = Field(ge=1)
    blind_open_window_ms: int = Field(ge=1)
    hold_gate_ms: int = Field(ge=1)
    success_criteria: list[str] = Field(default_factory=list)
    control: ScannerUXExperimentArmResult
    treatment: ScannerUXExperimentArmResult


class ScannerDecisionIssuer(BaseModel):
    name: str | None = Field(default=None, max_length=256)
    tier: str | None = Field(default=None, max_length=128)
    status: str = Field(min_length=1, max_length=64)


class ScannerDecisionDestination(BaseModel):
    display_url: str = Field(min_length=1, max_length=2048)
    host: str | None = Field(default=None, max_length=256)
    binding: str = Field(min_length=1, max_length=64)
    resolver_url: str | None = Field(default=None, max_length=2048)
    final_url: str | None = Field(default=None, max_length=2048)
    redirect_hops: int | None = Field(default=None, ge=0)
    redirect_policy: str | None = Field(default=None, max_length=128)


class ScannerDecisionSignal(BaseModel):
    layer: str = Field(min_length=1, max_length=64)
    state: str = Field(min_length=1, max_length=64)
    message: str | None = Field(default=None, max_length=512)


class ScannerDecisionAction(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=128)
    style: str = Field(min_length=1, max_length=64)


class ScannerDecisionUX(BaseModel):
    risk_score: int = Field(ge=0, le=100)
    risk_level: Literal["green", "amber", "red"]
    risk_stripe: Literal["green", "amber", "red"]
    hold_required: bool
    hold_ms: int = Field(ge=0, le=3000)
    reason_codes: list[str]
    destination_display: str | None = Field(default=None, max_length=256)
    destination_fingerprint: str | None = Field(default=None, max_length=256)
    primary_action: str = Field(min_length=1, max_length=128)


class ScannerDecisionContractDestination(BaseModel):
    display_host: str = Field(min_length=1, max_length=256)
    fingerprint: str = Field(min_length=1, max_length=256)
    url: str = Field(min_length=1, max_length=2048)
    resolver_url: str | None = Field(default=None, max_length=2048)
    final_url: str | None = Field(default=None, max_length=2048)


class ScannerDecisionContractTrustStep(BaseModel):
    status: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=512)
    reason_codes: list[str] = Field(default_factory=list)


class ScannerDecisionContractTrustPath(BaseModel):
    issuer_legitimacy: ScannerDecisionContractTrustStep
    destination_binding: ScannerDecisionContractTrustStep
    runtime_safety: ScannerDecisionContractTrustStep
    scanner_decision: ScannerDecisionContractTrustStep


class ScannerDecisionContractHoldToOpen(BaseModel):
    required: bool
    duration_ms: int = Field(ge=0, le=3000)
    reason_codes: list[str] = Field(default_factory=list)


class ScannerDecisionContractCacheFreshness(BaseModel):
    status: Literal["fresh", "stale", "expired", "unavailable", "not_applicable"]
    cache_generated_at: str | None = Field(default=None, max_length=64)
    cache_expires_at: str | None = Field(default=None, max_length=64)


class ScannerDecisionContract(BaseModel):
    decision_id: str = Field(min_length=1, max_length=128)
    decided_at: str = Field(min_length=1, max_length=64)
    decision_color: Literal["green", "orange", "red"]
    decision_state: str = Field(min_length=1, max_length=64)
    reason_codes: list[str] = Field(default_factory=list)
    risk_score: int = Field(ge=0, le=100)
    destination: ScannerDecisionContractDestination
    trust_path: ScannerDecisionContractTrustPath
    hold_to_open: ScannerDecisionContractHoldToOpen
    cache_freshness: ScannerDecisionContractCacheFreshness
    governance: dict[str, object] = Field(default_factory=dict)


class ScannerDecisionGovernance(BaseModel):
    root_program_id: str = Field(min_length=1, max_length=256)
    delegated_authority_id: str = Field(min_length=1, max_length=256)
    issuer_id: str = Field(min_length=1, max_length=256)
    issuer_namespace_label: str = Field(min_length=1, max_length=768)
    issuer_display_name: str = Field(min_length=1, max_length=256)
    assurance_tier: str = Field(min_length=1, max_length=128)
    destination_policy_id: str = Field(min_length=1, max_length=256)
    cache_entry_id: str = Field(min_length=1, max_length=256)
    cache_freshness_state: str = Field(min_length=1, max_length=64)
    cache_state_published_at: str = Field(min_length=1, max_length=64)
    cache_generated_at: str = Field(min_length=1, max_length=64)
    cache_expires_at: str = Field(min_length=1, max_length=64)
    max_staleness_seconds: int = Field(ge=0)
    stale_behavior: str = Field(min_length=1, max_length=128)
    source_artifacts: dict[str, str]


class ScannerDecisionResponse(BaseModel):
    decision_state: str = Field(min_length=1, max_length=64)
    open_allowed: bool
    usage_policy: UsagePolicy | None = None
    primary_message: str = Field(min_length=1, max_length=512)
    issuer: ScannerDecisionIssuer
    destination: ScannerDecisionDestination
    governance: ScannerDecisionGovernance | None = None
    signals: list[ScannerDecisionSignal]
    actions: list[ScannerDecisionAction]
    scanner_ux: ScannerDecisionUX | None = None
    contract: ScannerDecisionContract | None = None
    verifier_stage: str = Field(min_length=1, max_length=64)
    verifier_reason: str = Field(min_length=1, max_length=512)
    request_id: str | None = Field(default=None, max_length=128)


class NarrowedVerifierResponse(BaseModel):
    allowed: bool
    stage: str
    reason: str
    usage_policy: UsagePolicy
    canonical_claims_sha256: str | None
    matched_rule: str | None
    reservation_state: str | None


class DemoMaterialsRequest(BaseModel):
    payload: str = Field(default="https://acme.example/pay", min_length=1, max_length=2048)
    nonce: str = Field(default="demo-nonce-api-001", min_length=1, max_length=256)
    usage_policy: UsagePolicy = "reusable_public"
    governance_cache_profile: GovernanceCacheProfile = "fresh"
    verified_domains: list[str] = Field(default_factory=lambda: ["acme.example"])
    allow_subdomains: bool = False
    certificate_active: bool = True
    certificate_revoked: bool = False
    certificate_revocation_reason: str | None = Field(default=None, max_length=512)
    issued_offset_minutes: int = -1
    expires_offset_minutes: int = 5
    register_scanner_trust: bool = True
    artifact_profile: ArtifactRenderProfile = "clean"


class DemoMaterialsResponse(BaseModel):
    certificate: CertificateRecordInput
    issuer_state: IssuerVerificationStateInput
    governance: ScannerDecisionGovernance | None = None
    verify_request: NarrowedVerifierRequest
    qr_payload: str = Field(min_length=1, max_length=8192)
    qr_png_base64: str = Field(min_length=1, max_length=8_000_000)


class DemoSessionResponse(DemoMaterialsResponse):
    session_id: str = Field(min_length=1, max_length=64)
    display_path: str = Field(min_length=1, max_length=512)


class VerifierAPIKeyIssueRequest(BaseModel):
    label: str = Field(default="verifier-client", min_length=1, max_length=128)


class VerifierAPIKeyRotateRequest(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=128)


class VerifierAPIKeyRecordResponse(BaseModel):
    key_id: str
    label: str
    source: str
    created_at: str
    active: bool


class VerifierAPIKeyIssueResponse(BaseModel):
    record: VerifierAPIKeyRecordResponse
    plaintext_key: str


class VerifierAPIKeyListResponse(BaseModel):
    records: list[VerifierAPIKeyRecordResponse]


class VerifierAPIKeyRevokeResponse(BaseModel):
    revoked: bool
    key_id: str


NetworkOutboxStatus = Literal["healthy", "degraded", "blocked", "unavailable"]
NetworkOutboxSupervisorState = Literal["observable", "unconfigured", "unavailable"]


class NetworkOutboxFailedRowResponse(BaseModel):
    outbox_id: str
    event_id: str
    event_type: str
    attempts: int = Field(ge=0)
    last_error: str | None = None
    created_at: str


class NetworkOutboxMetricsResponse(BaseModel):
    observed_at: str
    pending_count: int = Field(ge=0)
    publishing_count: int = Field(ge=0)
    published_count: int = Field(ge=0)
    failed_count: int = Field(ge=0)
    quarantined_count: int = Field(default=0, ge=0)
    stale_claim_count: int = Field(ge=0)
    retryable_failed_count: int = Field(ge=0)
    oldest_pending_age_ms: int = Field(ge=0)
    oldest_failed_age_ms: int = Field(ge=0)
    max_attempts: int = Field(ge=0)
    failed_rows: list[NetworkOutboxFailedRowResponse] = Field(default_factory=list)


class NetworkOutboxOperatorStatusResponse(BaseModel):
    status: NetworkOutboxStatus
    supervisor_state: NetworkOutboxSupervisorState
    summary: str
    reasons: list[str] = Field(default_factory=list)
    database_configured: bool
    database_dsn_label: str | None = None
    metrics: NetworkOutboxMetricsResponse | None = None
    error: str | None = None


RuntimeSafetyObservationStatus = Literal["healthy", "degraded", "blocked", "unavailable"]
RuntimeSafetyObservationState = Literal["observable", "unconfigured", "unavailable"]


class RuntimeSafetyProviderReportResponse(BaseModel):
    provider_id: str
    total_count: int = Field(ge=0)
    risky_count: int = Field(ge=0)
    blocked_count: int = Field(ge=0)
    unavailable_count: int = Field(ge=0)
    last_observed_at: str


class RuntimeSafetyHostReportResponse(BaseModel):
    destination_host: str
    verdict: str
    risk_score: int = Field(ge=0, le=100)
    reason_codes: list[str] = Field(default_factory=list)
    observed_at: str
    final_url: str | None = None


class RuntimeSafetyObservationReportResponse(BaseModel):
    observed_at: str
    lookback_seconds: int = Field(ge=1)
    total_count: int = Field(ge=0)
    clear_count: int = Field(ge=0)
    risky_count: int = Field(ge=0)
    blocked_count: int = Field(ge=0)
    unavailable_count: int = Field(ge=0)
    unknown_count: int = Field(default=0, ge=0)
    expired_count: int = Field(ge=0)
    highest_risk_score: int = Field(ge=0, le=100)
    provider_reports: list[RuntimeSafetyProviderReportResponse] = Field(default_factory=list)
    top_hosts: list[RuntimeSafetyHostReportResponse] = Field(default_factory=list)


class RuntimeSafetyObservationOperatorStatusResponse(BaseModel):
    status: RuntimeSafetyObservationStatus
    observation_state: RuntimeSafetyObservationState
    summary: str
    reasons: list[str] = Field(default_factory=list)
    database_configured: bool
    database_dsn_label: str | None = None
    report: RuntimeSafetyObservationReportResponse | None = None
    error: str | None = None


ScannerDecisionPersistenceStatus = Literal["healthy", "degraded", "blocked", "unavailable"]
ScannerDecisionPersistenceState = Literal["observable", "unconfigured", "unavailable"]


class ScannerDecisionRecentResponse(BaseModel):
    decision_id: str
    verifier_id: str
    decision_color: Literal["green", "orange", "red"]
    decision_state: str
    reason_codes: list[str] = Field(default_factory=list)
    risk_score: int | None = Field(default=None, ge=0, le=100)
    destination_fingerprint: str | None = None
    usage_policy: UsagePolicy | None = None
    hold_to_open_required: bool
    hold_to_open_duration_ms: int = Field(ge=0)
    created_at: str


class ScannerDecisionPersistenceReportResponse(BaseModel):
    observed_at: str
    lookback_seconds: int = Field(ge=1)
    total_count: int = Field(ge=0)
    green_count: int = Field(ge=0)
    orange_count: int = Field(ge=0)
    red_count: int = Field(ge=0)
    hold_required_count: int = Field(ge=0)
    highest_risk_score: int = Field(ge=0, le=100)
    recent_decisions: list[ScannerDecisionRecentResponse] = Field(default_factory=list)


class ScannerDecisionOperatorStatusResponse(BaseModel):
    status: ScannerDecisionPersistenceStatus
    persistence_state: ScannerDecisionPersistenceState
    summary: str
    reasons: list[str] = Field(default_factory=list)
    database_configured: bool
    database_dsn_label: str | None = None
    report: ScannerDecisionPersistenceReportResponse | None = None
    error: str | None = None


class VerifierStatusResponse(BaseModel):
    verifier_profile_state: VerifierProfileState = "active"
    api_key_auth_enabled: bool
    admin_api_key_management_enabled: bool
    api_key_header: str = Field(min_length=1, max_length=128)
    admin_header: str = Field(min_length=1, max_length=128)
    redis_connected: bool
    distributed_rate_limiting_enabled: bool
    decode_image_fallback_enabled: bool
    legacy_experimental_api_enabled: bool
    rate_limit_window_seconds: int = Field(ge=1)
    rate_limit_max_requests: int = Field(ge=1)
    decode_rate_limit_max_requests: int = Field(ge=1)
    max_qr_payload_chars: int = Field(ge=1)
    max_decode_image_bytes: int = Field(ge=1)
    network_outbox: NetworkOutboxOperatorStatusResponse
    scanner_decisions: ScannerDecisionOperatorStatusResponse
    runtime_observations: RuntimeSafetyObservationOperatorStatusResponse


class VerifierProviderProfileResponse(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=256)
    summary: str = Field(min_length=1, max_length=512)
    trust_program: str = Field(min_length=1, max_length=256)
    policy: str = Field(min_length=1, max_length=512)
    endpoints: list[str] = Field(min_length=1, max_length=8)
    profile_state: VerifierProfileState = "active"
    signature_status: str = Field(min_length=1, max_length=256)
