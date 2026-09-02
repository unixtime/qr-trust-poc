from __future__ import annotations

import re
from typing import Literal, TypeAlias

VERIFIER_CLIENT_SCOPE = "verifier:client"
VERIFIER_CLIENT_KEY_ID_PREFIX = "vkey_"
NATS_SUBJECT_DETAIL = (
    "Trust-root NATS subject must match qrtrust.<root>.<family>.<event>.v1 "
    "or qrtrust.<root>.<family>.>; control-plane subjects must be documented "
    "exact management events"
)
CONTROL_PLANE_SUBJECT_ROOT = "control-plane"
CONTROL_PLANE_NATS_SUBJECTS = frozenset(
    {
        "qrtrust.control-plane.runtime.provider.upserted.v1",
        "qrtrust.control-plane.authority.nats-subscriber.authorization.changed.v1",
    }
)
NATS_SUBJECT_FAMILIES = frozenset(
    {
        "root",
        "authority",
        "issuer",
        "destination",
        "certificate",
        "runtime",
        "verifier",
        "scanner",
    }
)
_NATS_SUBJECT_TOKEN_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")


def build_verifier_client_key_id(key_hash: str) -> str:
    return f"{VERIFIER_CLIENT_KEY_ID_PREFIX}{key_hash[:24]}"


def validate_qrtrust_nats_subject(subject: str) -> str:
    tokens = subject.split(".")
    if (
        len(tokens) < 4
        or tokens[0] != "qrtrust"
        or any(not token for token in tokens)
        or tokens[2] not in NATS_SUBJECT_FAMILIES
    ):
        raise ValueError(NATS_SUBJECT_DETAIL)

    for token in tokens:
        if token in {"*", ">"}:
            continue
        if (
            "*" in token
            or ">" in token
            or not _NATS_SUBJECT_TOKEN_PATTERN.fullmatch(token)
        ):
            raise ValueError(NATS_SUBJECT_DETAIL)

    if ">" in tokens[:-1]:
        raise ValueError(NATS_SUBJECT_DETAIL)
    if tokens[1] == CONTROL_PLANE_SUBJECT_ROOT:
        if subject not in CONTROL_PLANE_NATS_SUBJECTS:
            raise ValueError(NATS_SUBJECT_DETAIL)
        return subject
    if tokens[-1] == ">":
        if len(tokens) != 4:
            raise ValueError(NATS_SUBJECT_DETAIL)
    elif tokens[-1] != "v1" or len(tokens) < 5:
        raise ValueError(NATS_SUBJECT_DETAIL)

    return subject


# Governance identifiers are URN-style: the prefix is what tells a consumer
# which registry an id belongs to, so a bare "acme-local-authority" is not a
# shorter spelling of an authority id, it is an unresolvable one.
#
# These mirror EventEnvelopeSchema in network/src/contracts.ts, which is the
# only place the contract was previously enforced. That enforcement happens in
# the outbox publisher — three hops after the management API accepts a
# mutation — so an unprefixed id used to be persisted, published, and only then
# rejected, surfacing as a retry-exhausted outbox row rather than a 422. The
# duplication is deliberate but must stay in step; changing one side alone
# re-opens exactly that gap.
ROOT_PROGRAM_ID_PATTERN = r"^(?:root:|control-plane$)"
DELEGATED_AUTHORITY_ID_PATTERN = r"^authority:"
ISSUER_ID_PATTERN = r"^issuer:"
DESTINATION_POLICY_ID_PATTERN = r"^policy:"

ROOT_PROGRAM_ID_DETAIL = (
    "root_program_id must start with 'root:' or be exactly 'control-plane'"
)
DELEGATED_AUTHORITY_ID_DETAIL = "delegated_authority_id must start with 'authority:'"
ISSUER_ID_DETAIL = "issuer_id must start with 'issuer:'"
DESTINATION_POLICY_ID_DETAIL = "destination_policy_id must start with 'policy:'"

DELEGATED_AUTHORITY_TYPE_CHOICES = (
    "payment_operator",
    "public_service_operator",
    "merchant_operator",
    "enterprise_operator",
    "registry_operator",
)

DelegatedAuthorityType: TypeAlias = Literal[
    "payment_operator",
    "public_service_operator",
    "merchant_operator",
    "enterprise_operator",
    "registry_operator",
]

ISSUER_CLASS_CHOICES = (
    "individual",
    "business",
    "institution",
    "public_service",
    "payment_operator",
    "platform",
)

IssuerClass: TypeAlias = Literal[
    "individual",
    "business",
    "institution",
    "public_service",
    "payment_operator",
    "platform",
]

ISSUER_ASSURANCE_TIER_CHOICES = (
    "self_asserted",
    "domain_controlled",
    "verified_business",
    "regulated_operator",
    "public_authority",
)

IssuerAssuranceTier: TypeAlias = Literal[
    "self_asserted",
    "domain_controlled",
    "verified_business",
    "regulated_operator",
    "public_authority",
]

ISSUER_ENROLLMENT_STATUS_CHOICES = (
    "pending",
    "active",
    "suspended",
    "revoked",
    "expired",
)

IssuerEnrollmentStatus: TypeAlias = Literal[
    "pending",
    "active",
    "suspended",
    "revoked",
    "expired",
]

DOMAIN_PROOF_METHOD_CHOICES = (
    "dns_txt",
    "https_well_known",
    "payment_processor",
    "enterprise_directory",
    "manual_review",
)

DomainProofMethod: TypeAlias = Literal[
    "dns_txt",
    "https_well_known",
    "payment_processor",
    "enterprise_directory",
    "manual_review",
]

DOMAIN_VERIFICATION_STATUS_CHOICES = (
    "pending",
    "verified",
    "failed",
    "expired",
    "revoked",
)

DomainVerificationStatus: TypeAlias = Literal[
    "pending",
    "verified",
    "failed",
    "expired",
    "revoked",
]

DESTINATION_QUERY_POLICY_CHOICES = (
    "none",
    "allow_known_payment_query",
)

DestinationQueryPolicy: TypeAlias = Literal[
    "none",
    "allow_known_payment_query",
]

DESTINATION_USAGE_POLICY_CHOICES = (
    "reusable_public",
    "one_time",
    "time_limited",
)

DestinationUsagePolicy: TypeAlias = Literal[
    "reusable_public",
    "one_time",
    "time_limited",
]

DESTINATION_POLICY_STATUS_CHOICES = (
    "active",
    "suspended",
    "revoked",
    "expired",
)

DestinationPolicyStatus: TypeAlias = Literal[
    "active",
    "suspended",
    "revoked",
    "expired",
]

OPERATOR_STATUS_CHOICES = (
    "active",
    "suspended",
    "retired",
)

OperatorStatus: TypeAlias = Literal[
    "active",
    "suspended",
    "retired",
]

OperatorType: TypeAlias = Literal["person", "service"]

OPERATOR_ROLE_CHOICES = (
    "root_admin",
    "authority_admin",
    "issuer_admin",
    "auditor",
    "runtime_provider_admin",
    "scanner_client_admin",
    "nats_subscriber_admin",
)

OperatorRole: TypeAlias = Literal[
    "root_admin",
    "authority_admin",
    "issuer_admin",
    "auditor",
    "runtime_provider_admin",
    "scanner_client_admin",
    "nats_subscriber_admin",
]

OPERATOR_ROLE_STATUS_CHOICES = (
    "active",
    "suspended",
    "revoked",
)

OperatorRoleStatus: TypeAlias = Literal[
    "active",
    "suspended",
    "revoked",
]

TRUST_KEY_SCOPE_CHOICES = (
    "root_program",
    "delegated_authority",
)

TrustKeyScope: TypeAlias = Literal[
    "root_program",
    "delegated_authority",
]

TRUST_KEY_STATUS_CHOICES = (
    "active",
    "suspended",
    "revoked",
    "expired",
)

TrustKeyStatus: TypeAlias = Literal[
    "active",
    "suspended",
    "revoked",
    "expired",
]

RUNTIME_PROVIDER_BEHAVIOR_CHOICES = (
    "downgrade_to_caution",
    "block",
)

RuntimeProviderBehavior: TypeAlias = Literal[
    "downgrade_to_caution",
    "block",
]

RUNTIME_PROVIDER_STATUS_CHOICES = (
    "active",
    "suspended",
    "retired",
)

RuntimeProviderStatus: TypeAlias = Literal[
    "active",
    "suspended",
    "retired",
]

OUTBOX_EVENT_REMEDIATION_ACTION_CHOICES = (
    "retry",
    "quarantine",
)

OutboxEventRemediationAction: TypeAlias = Literal[
    "retry",
    "quarantine",
]

MANAGEMENT_KEY_SCOPE_CHOICES = (
    "admin:*",
    "audit:read",
    "authority:write",
    "issuer:write",
    "management_keys:read",
    "management_keys:write",
    "nats:read",
    "nats:write",
    "operators:read",
    "operators:write",
    "outbox:read",
    "outbox:write",
    "policy:write",
    "root:write",
    "runtime:read",
    "runtime:write",
    "trust_keys:read",
    "trust_keys:write",
    "verifier_clients:read",
    "verifier_clients:write",
)

MANAGEMENT_KEY_SCOPE_SET = frozenset(MANAGEMENT_KEY_SCOPE_CHOICES)
