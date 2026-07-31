from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from backend.app.schemas.management_contracts import (
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
    OutboxEventRemediationAction,
    RuntimeProviderBehavior,
    RuntimeProviderStatus,
    TrustKeyScope,
    TrustKeyStatus,
)


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


class OperatorRecord(BaseModel):
    operator_id: str
    email: str
    display_name: str
    status: str
    created_at: str
    updated_at: str


class OperatorListResponse(BaseModel):
    records: list[OperatorRecord]


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
    root_program_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    program_scope: str = Field(min_length=1)
    accepted_algorithm_ids: list[str] = Field(min_length=1)
    policy_constraints: dict[str, Any] = Field(default_factory=dict)


class RootProgramUpsertResponse(BaseModel):
    root_program_id: str
    status: str
    event_type: str


class DelegatedAuthorityUpsertRequest(BaseModel):
    root_program_id: str = Field(min_length=1)
    delegated_authority_id: str = Field(min_length=1)
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
    root_program_id: str = Field(min_length=1)
    delegated_authority_id: str = Field(min_length=1)
    issuer_id: str = Field(min_length=1)
    display_name: str = Field(min_length=1)
    issuer_class: IssuerClass
    assurance_tier: IssuerAssuranceTier


class IssuerEnrollmentResponse(BaseModel):
    issuer_id: str
    enrollment_status: str
    event_type: str


class IssuerStatusUpdateRequest(BaseModel):
    root_program_id: str = Field(min_length=1)
    delegated_authority_id: str = Field(min_length=1)
    issuer_id: str = Field(min_length=1)
    enrollment_status: IssuerEnrollmentStatus


class IssuerStatusUpdateResponse(BaseModel):
    issuer_id: str
    enrollment_status: str
    event_type: str


class DomainProofUpsertRequest(BaseModel):
    root_program_id: str = Field(min_length=1)
    delegated_authority_id: str = Field(min_length=1)
    issuer_id: str = Field(min_length=1)
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
    root_program_id: str = Field(min_length=1)
    delegated_authority_id: str = Field(min_length=1)
    issuer_id: str = Field(min_length=1)
    destination_policy_id: str = Field(min_length=1)
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
    root_program_id: str = Field(min_length=1)
    delegated_authority_id: str = Field(min_length=1)
    issuer_id: str = Field(min_length=1)
    destination_policy_id: str = Field(min_length=1)
    status: DestinationPolicyStatus


class DestinationPolicyStatusUpdateResponse(BaseModel):
    destination_policy_id: str
    status: str
    event_type: str


class TrustKeyUpsertRequest(BaseModel):
    key_id: str = Field(min_length=1)
    root_program_id: str = Field(min_length=1)
    delegated_authority_id: str | None = None
    signer_id: str = Field(min_length=1)
    algorithm_id: str = Field(min_length=1)
    public_key_material_ref: str = Field(min_length=1)
    public_key_material_pem: str | None = None
    scope: TrustKeyScope
    key_status: TrustKeyStatus = "active"
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


class TrustKeyStatusUpdateRequest(BaseModel):
    root_program_id: str = Field(min_length=1)
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
