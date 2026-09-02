from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    Field,
    field_validator,
    model_validator,
)

from backend.app.schemas.management_contracts import (
    DELEGATED_AUTHORITY_ID_DETAIL,
    DELEGATED_AUTHORITY_ID_PATTERN,
    DESTINATION_POLICY_ID_DETAIL,
    DESTINATION_POLICY_ID_PATTERN,
    ISSUER_ID_DETAIL,
    ISSUER_ID_PATTERN,
    ROOT_PROGRAM_ID_DETAIL,
    ROOT_PROGRAM_ID_PATTERN,
    DelegatedAuthorityType,
    DestinationPolicyStatus,
    DestinationQueryPolicy,
    DestinationUsagePolicy,
    DomainProofMethod,
    DomainVerificationStatus,
    IssuerAssuranceTier,
    IssuerClass,
    IssuerEnrollmentStatus,
    OperatorRole,
    OperatorRoleStatus,
    OperatorStatus,
    OperatorType,
    OutboxEventRemediationAction,
    RuntimeProviderBehavior,
    RuntimeProviderStatus,
    TrustKeyScope,
    TrustKeyStatus,
)


def _prefix_check(pattern: str, detail: str) -> AfterValidator:
    """Enforce `pattern`, but report `detail` when it fails.

    Pydantic's own `Field(pattern=...)` rejects with "String should match
    pattern '^(?:root:|control-plane$)'", which hands an operator a regex
    instead of the rule it encodes. Raising ValueError from an AfterValidator
    renders as "Value error, <detail>" instead. The regex still reaches
    generated clients through `json_schema_extra` below, so the machine
    readable form of the constraint is not lost.
    """
    compiled = re.compile(pattern)

    def _check(value: str) -> str:
        if compiled.match(value) is None:
            raise ValueError(detail)
        return value

    return AfterValidator(_check)


# Request-side only. Responses and audit records echo whatever is already
# stored, and rows written before this constraint existed must stay readable —
# validating them on the way out would turn a legacy row into a 500 on a read.
RootProgramId = Annotated[
    str,
    Field(
        min_length=1,
        description=ROOT_PROGRAM_ID_DETAIL,
        json_schema_extra={"pattern": ROOT_PROGRAM_ID_PATTERN},
    ),
    _prefix_check(ROOT_PROGRAM_ID_PATTERN, ROOT_PROGRAM_ID_DETAIL),
]
DelegatedAuthorityId = Annotated[
    str,
    Field(
        min_length=1,
        description=DELEGATED_AUTHORITY_ID_DETAIL,
        json_schema_extra={"pattern": DELEGATED_AUTHORITY_ID_PATTERN},
    ),
    _prefix_check(DELEGATED_AUTHORITY_ID_PATTERN, DELEGATED_AUTHORITY_ID_DETAIL),
]
IssuerId = Annotated[
    str,
    Field(
        min_length=1,
        description=ISSUER_ID_DETAIL,
        json_schema_extra={"pattern": ISSUER_ID_PATTERN},
    ),
    _prefix_check(ISSUER_ID_PATTERN, ISSUER_ID_DETAIL),
]
DestinationPolicyId = Annotated[
    str,
    Field(
        min_length=1,
        description=DESTINATION_POLICY_ID_DETAIL,
        json_schema_extra={"pattern": DESTINATION_POLICY_ID_PATTERN},
    ),
    _prefix_check(DESTINATION_POLICY_ID_PATTERN, DESTINATION_POLICY_ID_DETAIL),
]


class ManagementHealthResponse(BaseModel):
    status: str = Field(pattern="^ready$")
    source_of_truth: str = Field(pattern="^postgres$")
    normal_mutation_surface: str = Field(pattern="^management_api$")


class ManagementApiKeyIssueRequest(BaseModel):
    label: str = Field(min_length=1)
    scopes: list[str] = Field(min_length=1)
    operator_id: str | None = None
    expires_at: datetime | None = None

    @field_validator("expires_at")
    @classmethod
    def _expires_at_must_be_future(
        cls,
        value: datetime | None,
    ) -> datetime | None:
        return _future_expires_at(value)


class ManagementApiKeyRecord(BaseModel):
    key_id: str
    label: str
    operator_id: str | None = None
    scopes: list[str]
    status: str
    created_at: str
    expires_at: str | None = None
    revoked_at: str | None = None


class ManagementApiKeyIssueResponse(BaseModel):
    record: ManagementApiKeyRecord
    plaintext_key: str


class ManagementApiKeyListResponse(BaseModel):
    records: list[ManagementApiKeyRecord]


class ManagementApiKeyRevokeResponse(BaseModel):
    record: ManagementApiKeyRecord


class OperatorUpsertRequest(BaseModel):
    email: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    status: OperatorStatus = "active"
    operator_type: OperatorType = "person"


class OperatorRecord(BaseModel):
    operator_id: str
    email: str
    display_name: str
    status: str
    operator_type: str
    created_at: str
    updated_at: str


class OperatorListResponse(BaseModel):
    records: list[OperatorRecord]


class ResourceAuthzReadinessResponse(BaseModel):
    window_minutes: int
    would_block_events: int
    principals_lacking_coverage: int
    keys_without_operator: int
    projected_blocking_rows: int
    excluded_verifying_rows: int


class OperatorRoleAssignmentUpsertRequest(BaseModel):
    operator_id: str = Field(min_length=1)
    role: OperatorRole
    root_program_id: str | None = None
    delegated_authority_id: str | None = None
    issuer_id: str | None = None
    status: OperatorRoleStatus = "active"

    @model_validator(mode="after")
    def _validate_role_scope(self) -> OperatorRoleAssignmentUpsertRequest:
        root_program_id = _clean_optional_scope(self.root_program_id)
        delegated_authority_id = _clean_optional_scope(self.delegated_authority_id)
        issuer_id = _clean_optional_scope(self.issuer_id)
        if self.role == "root_admin":
            if root_program_id is None:
                raise ValueError("root_admin assignments require root_program_id")
            if delegated_authority_id is not None or issuer_id is not None:
                raise ValueError(
                    "root_admin assignments cannot include delegated_authority_id "
                    "or issuer_id"
                )
        if self.role == "authority_admin":
            if root_program_id is None or delegated_authority_id is None:
                raise ValueError(
                    "authority_admin assignments require root_program_id "
                    "and delegated_authority_id"
                )
            if issuer_id is not None:
                raise ValueError("authority_admin assignments cannot include issuer_id")
        if self.role == "issuer_admin":
            if root_program_id is None:
                raise ValueError("issuer_admin assignments require root_program_id")
            if delegated_authority_id is None:
                raise ValueError(
                    "issuer_admin assignments require delegated_authority_id"
                )
            if issuer_id is None:
                raise ValueError("issuer_admin assignments require issuer_id")
        return self


class OperatorRoleAssignmentRecord(BaseModel):
    assignment_id: str
    operator_id: str
    role: str
    root_program_id: str | None = None
    delegated_authority_id: str | None = None
    issuer_id: str | None = None
    status: str
    created_at: str


class OperatorRoleAssignmentListResponse(BaseModel):
    records: list[OperatorRoleAssignmentRecord]


class VerifierClientApiKeyIssueRequest(BaseModel):
    label: str = Field(min_length=1)
    expires_at: datetime | None = None

    @field_validator("expires_at")
    @classmethod
    def _expires_at_must_be_future(
        cls,
        value: datetime | None,
    ) -> datetime | None:
        return _future_expires_at(value)


class RootProgramUpsertRequest(BaseModel):
    root_program_id: RootProgramId
    name: str = Field(min_length=1)
    program_scope: str = Field(min_length=1)
    accepted_algorithm_ids: list[str] = Field(min_length=1)
    policy_constraints: dict[str, Any] = Field(default_factory=dict)


class RootProgramUpsertResponse(BaseModel):
    root_program_id: str
    status: str
    event_type: str


class DelegatedAuthorityUpsertRequest(BaseModel):
    root_program_id: RootProgramId
    delegated_authority_id: DelegatedAuthorityId
    name: str = Field(min_length=1)
    authority_type: DelegatedAuthorityType
    scope: dict[str, Any] = Field(default_factory=dict)
    assurance_requirements: dict[str, Any] = Field(default_factory=dict)


class DelegatedAuthorityUpsertResponse(BaseModel):
    root_program_id: str
    delegated_authority_id: str
    status: str
    event_type: str


class IssuerEnrollmentRequest(BaseModel):
    root_program_id: RootProgramId
    delegated_authority_id: DelegatedAuthorityId
    issuer_id: IssuerId
    display_name: str = Field(min_length=1)
    issuer_class: IssuerClass
    assurance_tier: IssuerAssuranceTier


class IssuerEnrollmentResponse(BaseModel):
    issuer_id: str
    enrollment_status: str
    event_type: str


class IssuerStatusUpdateRequest(BaseModel):
    root_program_id: RootProgramId
    delegated_authority_id: DelegatedAuthorityId
    issuer_id: IssuerId
    enrollment_status: IssuerEnrollmentStatus


class IssuerStatusUpdateResponse(BaseModel):
    issuer_id: str
    enrollment_status: str
    event_type: str


class DomainProofUpsertRequest(BaseModel):
    root_program_id: RootProgramId
    delegated_authority_id: DelegatedAuthorityId
    issuer_id: IssuerId
    domain: str = Field(min_length=1)
    proof_method: DomainProofMethod = "dns_txt"
    verification_status: DomainVerificationStatus = "pending"
    expires_at: datetime | None = None
    evidence_ref: str | None = None

    @model_validator(mode="after")
    def _validate_domain_proof_window(self) -> DomainProofUpsertRequest:
        _timezone_aware_datetime(self.expires_at, "expires_at")
        if (
            self.verification_status == "verified"
            and self.expires_at is not None
            and self.expires_at <= datetime.now(timezone.utc)
        ):
            raise ValueError("verified domain proof expires_at must be in the future")
        return self


class DomainProofUpsertResponse(BaseModel):
    root_program_id: str
    delegated_authority_id: str
    issuer_id: str
    domain: str
    verification_status: str
    event_type: str


class DestinationPolicyApprovedDestination(BaseModel):
    destination_id: str = Field(min_length=1)
    expected_final_url: str = Field(min_length=1)
    allowed_hosts: list[str] = Field(min_length=1)
    allow_subdomains: bool = False
    path_prefixes: list[str] = Field(default_factory=list)
    query_policy: DestinationQueryPolicy = "none"


class DestinationPolicyUpsertRequest(BaseModel):
    root_program_id: RootProgramId
    delegated_authority_id: DelegatedAuthorityId
    issuer_id: IssuerId
    destination_policy_id: DestinationPolicyId
    usage_policy: DestinationUsagePolicy = "reusable_public"
    approved_destinations: list[DestinationPolicyApprovedDestination] = Field(
        min_length=1
    )
    redirect_policy: dict[str, Any] = Field(default_factory=dict)
    runtime_safety_policy: dict[str, Any] = Field(default_factory=dict)


class DestinationPolicyUpsertResponse(BaseModel):
    destination_policy_id: str
    status: str
    event_type: str
    required_hosts: list[str]


class DestinationPolicyStatusUpdateRequest(BaseModel):
    root_program_id: RootProgramId
    delegated_authority_id: DelegatedAuthorityId
    issuer_id: IssuerId
    destination_policy_id: DestinationPolicyId
    status: DestinationPolicyStatus


class DestinationPolicyStatusUpdateResponse(BaseModel):
    destination_policy_id: str
    status: str
    event_type: str


class TrustKeyUpsertRequest(BaseModel):
    key_id: str = Field(min_length=1)
    root_program_id: RootProgramId
    delegated_authority_id: DelegatedAuthorityId | None = None
    signer_id: str = Field(min_length=1)
    algorithm_id: str = Field(min_length=1)
    public_key_material_ref: str = Field(min_length=1)
    public_key_material_pem: str | None = None
    scope: TrustKeyScope
    not_before: datetime | None = None
    not_after: datetime | None = None

    @model_validator(mode="after")
    def _validity_window_must_be_usable(self) -> "TrustKeyUpsertRequest":
        _timezone_aware_datetime(self.not_before, "not_before")
        _timezone_aware_datetime(self.not_after, "not_after")
        if self.not_after is not None:
            if self.not_after <= datetime.now(timezone.utc):
                raise ValueError("not_after must be in the future")
            if self.not_before is not None and self.not_after <= self.not_before:
                raise ValueError("not_after must be later than not_before")
        return self


class IssuerCertificateEnrollRequest(BaseModel):
    certificate_id: str
    issuer_id: str
    root_program_id: str
    delegated_authority_id: str
    algorithm_id: str
    public_key_ref: str
    public_key_material_pem: str
    not_before: datetime
    not_after: datetime | None = None


class IssuerCertificateMutationResponse(BaseModel):
    certificate_id: str
    issuer_id: str
    key_status: str
    event_type: str


class IssuerCertificateStatusRequest(BaseModel):
    certificate_id: str
    key_status: Literal["active", "rotated", "suspended", "revoked", "expired"]
    revocation_reason: str | None = None


class TrustKeyStatusUpdateRequest(BaseModel):
    root_program_id: RootProgramId
    key_id: str = Field(min_length=1)
    key_status: TrustKeyStatus


class TrustKeyMutationResponse(BaseModel):
    key_id: str
    key_status: str
    event_type: str


class TrustKeyRecord(BaseModel):
    key_id: str
    root_program_id: str
    delegated_authority_id: str | None = None
    signer_id: str
    algorithm_id: str
    public_key_material_ref: str
    public_key_material_pem: str | None = None
    scope: str
    key_status: str
    not_before: str | None = None
    not_after: str | None = None
    created_at: str


class TrustKeyListResponse(BaseModel):
    records: list[TrustKeyRecord]


class RuntimeProviderUpsertRequest(BaseModel):
    provider_id: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    base_url: str | None = None
    verdict_ttl_seconds: int = Field(default=300, gt=0)
    stale_behavior: RuntimeProviderBehavior = "downgrade_to_caution"
    unavailable_behavior: RuntimeProviderBehavior = "downgrade_to_caution"
    status: RuntimeProviderStatus = "active"


class RuntimeProviderUpsertResponse(BaseModel):
    provider_id: str
    status: str
    event_type: str


class RuntimeProviderRecord(BaseModel):
    provider_id: str
    display_name: str
    base_url: str | None = None
    verdict_ttl_seconds: int
    stale_behavior: str
    unavailable_behavior: str
    status: str


class RuntimeProviderListResponse(BaseModel):
    providers: list[RuntimeProviderRecord]


class NatsSubscriberAuthorizationRequest(BaseModel):
    subscriber_id: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    durable_name: str = Field(min_length=1)
    description: str = ""
    subjects: list[str] = Field(min_length=1)


class NatsSubscriberAuthorizationResponse(BaseModel):
    subscriber_id: str
    status: str
    event_type: str
    subjects: list[str]


class NatsSubscriberRecord(BaseModel):
    subscriber_id: str
    display_name: str
    durable_name: str
    description: str
    status: str
    subjects: list[str]


class NatsSubscriberListResponse(BaseModel):
    subscribers: list[NatsSubscriberRecord]


class ManagementOutboxEventRecord(BaseModel):
    outbox_id: str
    event_id: str
    event_type: str
    aggregate_type: str
    aggregate_id: str
    publish_status: str
    attempts: int = Field(ge=0)
    last_error: str | None = None
    created_at: str
    published_at: str | None = None


class ManagementOutboxStatusResponse(BaseModel):
    status_counts: dict[str, int]
    recent_events: list[ManagementOutboxEventRecord]


class ScanAccountingIssuerDayRecord(BaseModel):
    """Scans attributed to one issuer on one UTC day (None = unattributed)."""

    issuer_id: str | None
    day: str
    scan_count: int = Field(ge=0)
    green_count: int = Field(ge=0)
    orange_count: int = Field(ge=0)
    red_count: int = Field(ge=0)
    distinct_envelopes: int = Field(ge=0)


class ScanSpikeRecord(BaseModel):
    """One envelope whose recent scan burst exceeds its own baseline."""

    envelope_fingerprint: str
    issuer_id: str | None
    # Root program the envelope was verified under; None for unsigned payloads.
    root_program_id: str | None = None
    recent_count: int = Field(ge=0)
    baseline_count: int = Field(ge=0)
    # Portion of the counts above served from the verdict cache (no evidence row).
    cached_recent_count: int = Field(default=0, ge=0)
    cached_baseline_count: int = Field(default=0, ge=0)
    baseline_per_window: float = Field(ge=0)
    ratio: float | None = Field(default=None, ge=0)
    threshold_ratio: float = Field(ge=0)
    min_scans: int = Field(ge=0)
    window_seconds: int = Field(ge=1)
    baseline_seconds: int = Field(ge=1)
    observed_at: str


class ScanAccountingResponse(BaseModel):
    window_start: str
    window_end: str
    days: int = Field(ge=1)
    issuers: list[ScanAccountingIssuerDayRecord]
    spikes: list[ScanSpikeRecord]
    spike_alerts_enabled: bool
    spike_window_seconds: int = Field(ge=1)
    spike_baseline_seconds: int = Field(ge=1)
    spike_threshold_ratio: float = Field(ge=0)
    spike_min_scans: int = Field(ge=0)


class ManagementOutboxEventRemediationRequest(BaseModel):
    event_id: str = Field(min_length=1)
    action: OutboxEventRemediationAction
    reason: str | None = None


class ManagementOutboxEventRemediationResponse(BaseModel):
    event_id: str
    publish_status: str
    attempts: int = Field(ge=0)
    last_error: str | None = None


class ManagementAuditRecord(BaseModel):
    audit_id: str
    actor_key_id: str | None = None
    action: str
    target_type: str
    target_id: str
    root_program_id: str | None = None
    delegated_authority_id: str | None = None
    issuer_id: str | None = None
    before_json: dict[str, Any] | None = None
    after_json: dict[str, Any] | None = None
    request_id: str | None = None
    idempotency_key: str | None = None
    created_at: str


class ManagementAuditListResponse(BaseModel):
    audit_rows: list[ManagementAuditRecord]


def _future_expires_at(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    _timezone_aware_datetime(value, "expires_at")
    if value <= datetime.now(timezone.utc):
        raise ValueError("expires_at must be in the future")
    return value


def _timezone_aware_datetime(value: datetime | None, field_name: str) -> None:
    if value is None:
        return
    if value.tzinfo is None:
        raise ValueError(f"{field_name} must include a timezone")
    if value.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone")


def _clean_optional_scope(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None
