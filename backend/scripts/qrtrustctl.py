from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.schemas.management import (
    DelegatedAuthorityUpsertRequest,
    DestinationPolicyStatusUpdateRequest,
    DestinationPolicyUpsertRequest,
    DomainProofUpsertRequest,
    IssuerEnrollmentRequest,
    IssuerStatusUpdateRequest,
    ManagementApiKeyIssueRequest,
    ManagementOutboxEventRemediationRequest,
    NatsSubscriberAuthorizationRequest,
    OperatorRoleAssignmentUpsertRequest,
    OperatorUpsertRequest,
    RootProgramUpsertRequest,
    RuntimeProviderUpsertRequest,
    TrustKeyStatusUpdateRequest,
    TrustKeyUpsertRequest,
    VerifierClientApiKeyIssueRequest,
)
from backend.app.schemas.management_contracts import (
    DELEGATED_AUTHORITY_TYPE_CHOICES,
    DESTINATION_POLICY_STATUS_CHOICES,
    DESTINATION_USAGE_POLICY_CHOICES,
    DOMAIN_PROOF_METHOD_CHOICES,
    DOMAIN_VERIFICATION_STATUS_CHOICES,
    ISSUER_ASSURANCE_TIER_CHOICES,
    ISSUER_CLASS_CHOICES,
    ISSUER_ENROLLMENT_STATUS_CHOICES,
    MANAGEMENT_KEY_SCOPE_CHOICES,
    OPERATOR_ROLE_CHOICES,
    OPERATOR_ROLE_STATUS_CHOICES,
    OPERATOR_STATUS_CHOICES,
    OUTBOX_EVENT_REMEDIATION_ACTION_CHOICES,
    RUNTIME_PROVIDER_BEHAVIOR_CHOICES,
    RUNTIME_PROVIDER_STATUS_CHOICES,
    TRUST_KEY_SCOPE_CHOICES,
    TRUST_KEY_STATUS_CHOICES,
    validate_qrtrust_nats_subject,
)

GOVERNANCE_MATERIALIZER_SUBJECTS = [
    "qrtrust.*.root.manifest.published.v1",
    "qrtrust.*.authority.manifest.published.v1",
    "qrtrust.*.issuer.record.published.v1",
    "qrtrust.*.issuer.status.changed.v1",
    "qrtrust.*.destination.policy.published.v1",
    "qrtrust.*.destination.policy.revoked.v1",
    "qrtrust.*.certificate.status.changed.v1",
]
RUNTIME_OBSERVATION_SUBJECTS = ["qrtrust.*.runtime.verdict.observed.v1"]


def env_flag(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def default_base_url() -> str:
    explicit = os.getenv("QRTRUSTCTL_BASE_URL", "").strip()
    if explicit:
        return explicit

    host = os.getenv("API_PUBLISH_HOST", "127.0.0.1").strip() or "127.0.0.1"
    if host in {"0.0.0.0", "::", "[::]"}:
        host = "127.0.0.1"
    port = os.getenv("API_PUBLISH_PORT", "8000").strip() or "8000"
    scheme = "https" if port == "8444" else "http"
    return f"{scheme}://{host}:{port}"


def qrtrust_nats_subject(value: str) -> str:
    try:
        return validate_qrtrust_nats_subject(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="qrtrustctl")
    parser.add_argument(
        "--base-url",
        default=default_base_url(),
    )
    parser.add_argument("--admin-token", default=os.getenv("QRTRUSTCTL_ADMIN_TOKEN"))
    parser.add_argument("--idempotency-key")
    parser.add_argument(
        "--insecure-tls",
        action="store_true",
        default=env_flag("QRTRUSTCTL_INSECURE_TLS"),
        help=(
            "Disable TLS certificate verification for local self-signed "
            "development endpoints only."
        ),
    )

    subcommands = parser.add_subparsers(dest="command", required=True)

    demo_bootstrap = subcommands.add_parser("demo-bootstrap")
    demo_bootstrap.add_argument("--idempotency-prefix")
    demo_bootstrap.add_argument(
        "--root-program-id",
        default="root:qrtrust-demo:2026",
    )
    demo_bootstrap.add_argument(
        "--delegated-authority-id",
        default="authority:qrtrust-demo:merchant-web",
    )
    demo_bootstrap.add_argument("--issuer-id", default="issuer:acme-demo")
    demo_bootstrap.add_argument("--domain", default="acme.example")
    demo_bootstrap.add_argument(
        "--expected-final-url",
        default="https://acme.example/pay",
    )
    demo_bootstrap.add_argument(
        "--subscriber-id",
        default="subscriber:reference-governance",
    )
    demo_bootstrap.add_argument(
        "--runtime-subscriber-id",
        default="subscriber:runtime-observations",
    )

    management_live_drill = subcommands.add_parser("management-live-drill")
    management_live_drill.add_argument("--idempotency-prefix")
    management_live_drill.add_argument(
        "--root-program-id",
        default="root:qrtrust-demo:2026",
    )
    management_live_drill.add_argument(
        "--delegated-authority-id",
        default="authority:qrtrust-demo:merchant-web",
    )
    management_live_drill.add_argument("--issuer-id", default="issuer:acme-demo")
    management_live_drill.add_argument("--domain", default="acme.example")
    management_live_drill.add_argument(
        "--expected-final-url",
        default="https://acme.example/pay",
    )
    management_live_drill.add_argument(
        "--subscriber-id",
        default="subscriber:reference-governance",
    )
    management_live_drill.add_argument(
        "--runtime-subscriber-id",
        default="subscriber:runtime-observations",
    )
    management_live_drill.add_argument("--outbox-retry-event-id")
    management_live_drill.add_argument(
        "--require-outbox-retry",
        action="store_true",
        help=(
            "Fail unless --outbox-retry-event-id is provided and remediated. "
            "Use for production evidence runs."
        ),
    )

    root_program = subcommands.add_parser("root-program-upsert")
    root_program.add_argument("--root-program-id", required=True)
    root_program.add_argument("--name", required=True)
    root_program.add_argument("--program-scope", required=True)
    root_program.add_argument("--accepted-algorithm-id", action="append", required=True)
    root_program.add_argument("--policy-constraints-json", default="{}")

    delegated_authority = subcommands.add_parser("delegated-authority-upsert")
    delegated_authority.add_argument("--root-program-id", required=True)
    delegated_authority.add_argument("--delegated-authority-id", required=True)
    delegated_authority.add_argument("--name", required=True)
    delegated_authority.add_argument(
        "--authority-type",
        default="merchant_operator",
        choices=DELEGATED_AUTHORITY_TYPE_CHOICES,
    )
    delegated_authority.add_argument("--scope-json", default="{}")
    delegated_authority.add_argument("--assurance-requirements-json", default="{}")

    management_key_issue = subcommands.add_parser("management-key-issue")
    management_key_issue.add_argument("--label", required=True)
    management_key_issue.add_argument(
        "--scope",
        action="append",
        required=True,
        choices=MANAGEMENT_KEY_SCOPE_CHOICES,
    )
    management_key_issue.add_argument("--operator-id")
    management_key_issue.add_argument("--expires-at")

    management_key_list = subcommands.add_parser("management-key-list")
    management_key_list.add_argument("--limit", type=int, default=50)

    management_key_revoke = subcommands.add_parser("management-key-revoke")
    management_key_revoke.add_argument("--key-id", required=True)

    operator_upsert = subcommands.add_parser("operator-upsert")
    operator_upsert.add_argument("--email", required=True)
    operator_upsert.add_argument("--display-name", required=True)
    operator_upsert.add_argument(
        "--status",
        default="active",
        choices=OPERATOR_STATUS_CHOICES,
    )

    operator_list = subcommands.add_parser("operator-list")
    operator_list.add_argument("--limit", type=int, default=50)

    operator_role_upsert = subcommands.add_parser("operator-role-upsert")
    operator_role_upsert.add_argument("--operator-id", required=True)
    operator_role_upsert.add_argument(
        "--role",
        required=True,
        choices=OPERATOR_ROLE_CHOICES,
    )
    operator_role_upsert.add_argument("--root-program-id")
    operator_role_upsert.add_argument("--delegated-authority-id")
    operator_role_upsert.add_argument("--issuer-id")
    operator_role_upsert.add_argument(
        "--status",
        default="active",
        choices=OPERATOR_ROLE_STATUS_CHOICES,
    )

    operator_role_list = subcommands.add_parser("operator-role-list")
    operator_role_list.add_argument("--operator-id")
    operator_role_list.add_argument("--limit", type=int, default=50)

    trust_key_upsert = subcommands.add_parser("trust-key-upsert")
    trust_key_upsert.add_argument("--key-id", required=True)
    trust_key_upsert.add_argument("--root-program-id", required=True)
    trust_key_upsert.add_argument("--delegated-authority-id")
    trust_key_upsert.add_argument("--signer-id", required=True)
    trust_key_upsert.add_argument("--algorithm-id", required=True)
    trust_key_upsert.add_argument("--public-key-material-ref", required=True)
    trust_key_upsert.add_argument("--public-key-material-pem")
    trust_key_upsert.add_argument(
        "--scope",
        required=True,
        choices=TRUST_KEY_SCOPE_CHOICES,
    )
    trust_key_upsert.add_argument(
        "--key-status",
        default="active",
        choices=TRUST_KEY_STATUS_CHOICES,
    )
    trust_key_upsert.add_argument("--not-before")
    trust_key_upsert.add_argument("--not-after")

    trust_key_status = subcommands.add_parser("trust-key-status-update")
    trust_key_status.add_argument("--root-program-id", required=True)
    trust_key_status.add_argument("--key-id", required=True)
    trust_key_status.add_argument(
        "--key-status",
        required=True,
        choices=TRUST_KEY_STATUS_CHOICES,
    )

    trust_key_list = subcommands.add_parser("trust-key-list")
    trust_key_list.add_argument("--root-program-id")
    trust_key_list.add_argument("--delegated-authority-id")
    trust_key_list.add_argument("--limit", type=int, default=50)

    verifier_client_key_issue = subcommands.add_parser("verifier-client-key-issue")
    verifier_client_key_issue.add_argument("--label", required=True)
    verifier_client_key_issue.add_argument("--expires-at")

    subcommands.add_parser("verifier-client-key-list")

    verifier_client_key_revoke = subcommands.add_parser("verifier-client-key-revoke")
    verifier_client_key_revoke.add_argument("--key-id", required=True)

    issuer = subcommands.add_parser("issuer-enroll")
    issuer.add_argument("--root-program-id", required=True)
    issuer.add_argument("--delegated-authority-id", required=True)
    issuer.add_argument("--issuer-id", required=True)
    issuer.add_argument("--display-name", required=True)
    issuer.add_argument(
        "--issuer-class",
        default="business",
        choices=ISSUER_CLASS_CHOICES,
    )
    issuer.add_argument(
        "--assurance-tier",
        default="domain_controlled",
        choices=ISSUER_ASSURANCE_TIER_CHOICES,
    )

    issuer_status = subcommands.add_parser("issuer-status-update")
    issuer_status.add_argument("--root-program-id", required=True)
    issuer_status.add_argument("--delegated-authority-id", required=True)
    issuer_status.add_argument("--issuer-id", required=True)
    issuer_status.add_argument(
        "--enrollment-status",
        required=True,
        choices=ISSUER_ENROLLMENT_STATUS_CHOICES,
    )

    domain_proof = subcommands.add_parser("domain-proof-upsert")
    domain_proof.add_argument("--root-program-id", required=True)
    domain_proof.add_argument("--delegated-authority-id", required=True)
    domain_proof.add_argument("--issuer-id", required=True)
    domain_proof.add_argument("--domain", required=True)
    domain_proof.add_argument(
        "--proof-method",
        default="dns_txt",
        choices=DOMAIN_PROOF_METHOD_CHOICES,
    )
    domain_proof.add_argument(
        "--verification-status",
        default="pending",
        choices=DOMAIN_VERIFICATION_STATUS_CHOICES,
    )
    domain_proof.add_argument("--expires-at")
    domain_proof.add_argument("--evidence-ref")

    destination_policy = subcommands.add_parser("destination-policy-upsert")
    destination_policy.add_argument("--root-program-id", required=True)
    destination_policy.add_argument("--delegated-authority-id", required=True)
    destination_policy.add_argument("--issuer-id", required=True)
    destination_policy.add_argument("--destination-policy-id", required=True)
    destination_policy.add_argument(
        "--usage-policy",
        default="reusable_public",
        choices=DESTINATION_USAGE_POLICY_CHOICES,
    )
    destination_policy.add_argument("--approved-destinations-json", required=True)
    destination_policy.add_argument("--redirect-policy-json", default=None)
    destination_policy.add_argument("--runtime-safety-policy-json", default=None)

    destination_policy_status = subcommands.add_parser(
        "destination-policy-status-update"
    )
    destination_policy_status.add_argument("--root-program-id", required=True)
    destination_policy_status.add_argument("--delegated-authority-id", required=True)
    destination_policy_status.add_argument("--issuer-id", required=True)
    destination_policy_status.add_argument("--destination-policy-id", required=True)
    destination_policy_status.add_argument(
        "--status",
        required=True,
        choices=DESTINATION_POLICY_STATUS_CHOICES,
    )

    runtime_provider = subcommands.add_parser("runtime-provider-upsert")
    runtime_provider.add_argument("--provider-id", required=True)
    runtime_provider.add_argument("--display-name", required=True)
    runtime_provider.add_argument("--provider-base-url")
    runtime_provider.add_argument("--verdict-ttl-seconds", type=int, default=300)
    runtime_provider.add_argument(
        "--stale-behavior",
        default="downgrade_to_caution",
        choices=RUNTIME_PROVIDER_BEHAVIOR_CHOICES,
    )
    runtime_provider.add_argument(
        "--unavailable-behavior",
        default="downgrade_to_caution",
        choices=RUNTIME_PROVIDER_BEHAVIOR_CHOICES,
    )
    runtime_provider.add_argument(
        "--status",
        default="active",
        choices=RUNTIME_PROVIDER_STATUS_CHOICES,
    )

    subcommands.add_parser("runtime-provider-list")

    nats_authorize = subcommands.add_parser("nats-subscriber-authorize")
    nats_authorize.add_argument("--subscriber-id", required=True)
    nats_authorize.add_argument("--display-name", required=True)
    nats_authorize.add_argument("--durable-name", required=True)
    nats_authorize.add_argument("--description", default="")
    nats_authorize.add_argument(
        "--subject",
        action="append",
        required=True,
        type=qrtrust_nats_subject,
    )

    subcommands.add_parser("nats-subscriber-list")

    outbox = subcommands.add_parser("outbox-status")
    outbox.add_argument("--limit", type=int, default=100)

    outbox_remediate = subcommands.add_parser("outbox-event-remediate")
    outbox_remediate.add_argument("--event-id", required=True)
    outbox_remediate.add_argument(
        "--action",
        required=True,
        choices=OUTBOX_EVENT_REMEDIATION_ACTION_CHOICES,
    )
    outbox_remediate.add_argument("--reason")

    audit = subcommands.add_parser("audit-list")
    audit.add_argument("--limit", type=int, default=50)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    headers = {}
    if args.admin_token:
        headers["X-Admin-Token"] = args.admin_token
    if args.idempotency_key and args.command not in {
        "demo-bootstrap",
        "management-live-drill",
    }:
        headers["Idempotency-Key"] = args.idempotency_key

    if args.command == "demo-bootstrap":
        idempotency_prefix = (
            args.idempotency_prefix
            or args.idempotency_key
            or "qrtrust-demo-bootstrap"
        )
        with _http_client(args) as client:
            steps = []
            for step_id, path, payload in _demo_bootstrap_steps(args):
                step_headers = dict(headers)
                step_headers["Idempotency-Key"] = f"{idempotency_prefix}:{step_id}"
                response = client.post(path, headers=step_headers, json=payload)
                response.raise_for_status()
                response_json = response.json()
                steps.append(
                    {
                        "step": step_id,
                        "path": path,
                        "event_type": response_json.get("event_type"),
                    }
                )
            print(
                json.dumps(
                    {
                        "demo_bootstrap": "completed",
                        "idempotency_prefix": idempotency_prefix,
                        "steps": steps,
                    },
                    indent=2,
                    sort_keys=True,
                )
            )
        return 0

    if args.command == "management-live-drill":
        idempotency_prefix = (
            args.idempotency_prefix
            or args.idempotency_key
            or "qrtrust-management-live-drill"
        )
        if args.require_outbox_retry and not args.outbox_retry_event_id:
            raise SystemExit(
                "management live drill requires --outbox-retry-event-id when "
                "--require-outbox-retry is set"
            )
        checks = []
        with _http_client(args) as client:
            precondition_response = client.post(
                "/admin/destination-policies",
                headers=dict(headers),
                json=_precondition_destination_policy_payload(args),
            )
            if precondition_response.status_code != 409:
                raise SystemExit(
                    "management live drill expected destination-policy "
                    f"precondition HTTP 409, got {precondition_response.status_code}"
                )
            checks.append(
                {
                    "check": "transaction_precondition",
                    "status": "passed",
                    "http_status": precondition_response.status_code,
                }
            )

            bootstrap_steps = _demo_bootstrap_steps(args)
            root_step_id, root_path, root_payload = bootstrap_steps[0]
            root_headers = _drill_step_headers(
                headers,
                idempotency_prefix,
                root_step_id,
            )
            root_response = client.post(
                root_path,
                headers=root_headers,
                json=root_payload,
            )
            root_response.raise_for_status()
            replay_response = client.post(
                root_path,
                headers=root_headers,
                json=root_payload,
            )
            replay_response.raise_for_status()
            checks.append(
                {
                    "check": "idempotent_replay",
                    "status": "passed",
                    "event_type": replay_response.json().get("event_type"),
                }
            )

            destination_event_type = None
            allowed_subscribers = []
            for step_id, path, payload in bootstrap_steps[1:]:
                response = client.post(
                    path,
                    headers=_drill_step_headers(
                        headers,
                        idempotency_prefix,
                        step_id,
                    ),
                    json=payload,
                )
                response.raise_for_status()
                if step_id == "destination-policy":
                    destination_event_type = response.json().get("event_type")
                if path == "/admin/nats/subscribers":
                    allowed_subscribers.append(
                        {
                            "subscriber_id": payload["subscriber_id"],
                            "subjects": payload["subjects"],
                        }
                    )
            checks.append(
                {
                    "check": "issuer_enrollment_to_publication",
                    "status": "passed",
                    "event_type": destination_event_type,
                }
            )

            denied_response = client.post(
                "/admin/nats/subscribers",
                headers=dict(headers),
                json={
                    "subscriber_id": f"{args.subscriber_id}:deny-drill",
                    "display_name": "Denied broad subscriber",
                    "durable_name": "qrtrust_broad_deny_drill",
                    "description": (
                        "Management live drill proof that broad NATS grants fail."
                    ),
                    "subjects": ["qrtrust.>"],
                },
            )
            if denied_response.status_code != 422:
                raise SystemExit(
                    "management live drill expected broad NATS grant HTTP 422, "
                    f"got {denied_response.status_code}"
                )
            checks.append(
                {
                    "check": "nats_subscriber_allow_deny",
                    "status": "passed",
                    "allowed_subscribers": allowed_subscribers,
                    "deny_http_status": denied_response.status_code,
                }
            )

            verifier_client_response = client.post(
                "/admin/verifier-clients/api-keys/issue",
                headers=dict(headers),
                json={"label": "management-live-drill verifier client"},
            )
            verifier_client_response.raise_for_status()
            verifier_client_payload = verifier_client_response.json()
            verifier_client_key = verifier_client_payload.get("plaintext_key")
            if not isinstance(verifier_client_key, str) or not verifier_client_key:
                raise SystemExit(
                    "management live drill expected verifier client plaintext key"
                )
            admin_boundary_response = client.get(
                "/admin/health",
                headers={"X-Admin-Token": verifier_client_key},
            )
            if admin_boundary_response.status_code != 401:
                raise SystemExit(
                    "management live drill expected verifier client key to be "
                    "rejected by /admin/health with HTTP 401, got "
                    f"{admin_boundary_response.status_code}"
                )
            checks.append(
                {
                    "check": "verifier_client_admin_boundary",
                    "status": "passed",
                    "verifier_client_key_id": (
                        verifier_client_payload.get("record", {}).get("key_id")
                        if isinstance(verifier_client_payload.get("record"), dict)
                        else None
                    ),
                    "admin_health_http_status": admin_boundary_response.status_code,
                }
            )

            if args.outbox_retry_event_id:
                retry_response = client.post(
                    "/admin/outbox/events/remediate",
                    headers=dict(headers),
                    json={
                        "event_id": args.outbox_retry_event_id,
                        "action": "retry",
                        "reason": "management live drill broker outage recovery",
                    },
                )
                retry_response.raise_for_status()
                retry_payload = retry_response.json()
                checks.append(
                    {
                        "check": "outbox_retry_after_broker_outage",
                        "status": "passed",
                        "event_id": retry_payload.get("event_id"),
                        "publish_status": retry_payload.get("publish_status"),
                    }
                )
            else:
                checks.append(
                    {
                        "check": "outbox_retry_after_broker_outage",
                        "status": "skipped",
                        "reason": "no --outbox-retry-event-id supplied",
                    }
                )

        print(
            json.dumps(
                {
                    "management_live_drill": "completed",
                    "idempotency_prefix": idempotency_prefix,
                    "checks": checks,
                },
                indent=2,
                sort_keys=True,
            )
        )
        return 0

    if args.command == "management-key-issue":
        payload = {
            "label": args.label,
            "scopes": args.scope,
            "operator_id": args.operator_id,
            "expires_at": args.expires_at,
        }
        _validate_management_request(ManagementApiKeyIssueRequest, payload)
        with _http_client(args) as client:
            response = client.post(
                "/admin/management-keys/issue",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "management-key-list":
        with _http_client(args) as client:
            response = client.get(
                "/admin/management-keys",
                headers=headers,
                params={"limit": args.limit},
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "management-key-revoke":
        with _http_client(args) as client:
            response = client.post(
                f"/admin/management-keys/{args.key_id}/revoke",
                headers=headers,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "operator-upsert":
        payload = {
            "email": args.email,
            "display_name": args.display_name,
            "status": args.status,
        }
        _validate_management_request(OperatorUpsertRequest, payload)
        with _http_client(args) as client:
            response = client.post(
                "/admin/operators",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "operator-list":
        with _http_client(args) as client:
            response = client.get(
                "/admin/operators",
                headers=headers,
                params={"limit": args.limit},
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "operator-role-upsert":
        payload = {
            "operator_id": args.operator_id,
            "role": args.role,
            "root_program_id": args.root_program_id,
            "delegated_authority_id": args.delegated_authority_id,
            "issuer_id": args.issuer_id,
            "status": args.status,
        }
        _validate_management_request(OperatorRoleAssignmentUpsertRequest, payload)
        with _http_client(args) as client:
            response = client.post(
                "/admin/operator-role-assignments",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "operator-role-list":
        with _http_client(args) as client:
            response = client.get(
                "/admin/operator-role-assignments",
                headers=headers,
                params={
                    "operator_id": args.operator_id,
                    "limit": args.limit,
                },
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "trust-key-upsert":
        payload = {
            "key_id": args.key_id,
            "root_program_id": args.root_program_id,
            "delegated_authority_id": args.delegated_authority_id,
            "signer_id": args.signer_id,
            "algorithm_id": args.algorithm_id,
            "public_key_material_ref": args.public_key_material_ref,
            "public_key_material_pem": args.public_key_material_pem,
            "scope": args.scope,
            "key_status": args.key_status,
            "not_before": args.not_before,
            "not_after": args.not_after,
        }
        _validate_management_request(TrustKeyUpsertRequest, payload)
        with _http_client(args) as client:
            response = client.post(
                "/admin/trust-keys",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "trust-key-status-update":
        payload = {
            "root_program_id": args.root_program_id,
            "key_id": args.key_id,
            "key_status": args.key_status,
        }
        _validate_management_request(TrustKeyStatusUpdateRequest, payload)
        with _http_client(args) as client:
            response = client.post(
                "/admin/trust-keys/status",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "trust-key-list":
        with _http_client(args) as client:
            response = client.get(
                "/admin/trust-keys",
                headers=headers,
                params={
                    "root_program_id": args.root_program_id,
                    "delegated_authority_id": args.delegated_authority_id,
                    "limit": args.limit,
                },
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "verifier-client-key-issue":
        payload = {
            "label": args.label,
            "expires_at": args.expires_at,
        }
        _validate_management_request(VerifierClientApiKeyIssueRequest, payload)
        with _http_client(args) as client:
            response = client.post(
                "/admin/verifier-clients/api-keys/issue",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "verifier-client-key-list":
        with _http_client(args) as client:
            response = client.get(
                "/admin/verifier-clients/api-keys",
                headers=headers,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "verifier-client-key-revoke":
        with _http_client(args) as client:
            response = client.post(
                f"/admin/verifier-clients/api-keys/{args.key_id}/revoke",
                headers=headers,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "issuer-enroll":
        payload = {
            "root_program_id": args.root_program_id,
            "delegated_authority_id": args.delegated_authority_id,
            "issuer_id": args.issuer_id,
            "display_name": args.display_name,
            "issuer_class": args.issuer_class,
            "assurance_tier": args.assurance_tier,
        }
        _validate_management_request(IssuerEnrollmentRequest, payload)
        with _http_client(args) as client:
            response = client.post("/admin/issuers", headers=headers, json=payload)
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "issuer-status-update":
        payload = {
            "root_program_id": args.root_program_id,
            "delegated_authority_id": args.delegated_authority_id,
            "issuer_id": args.issuer_id,
            "enrollment_status": args.enrollment_status,
        }
        _validate_management_request(IssuerStatusUpdateRequest, payload)
        with _http_client(args) as client:
            response = client.post(
                "/admin/issuers/status",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "domain-proof-upsert":
        payload = {
            "root_program_id": args.root_program_id,
            "delegated_authority_id": args.delegated_authority_id,
            "issuer_id": args.issuer_id,
            "domain": args.domain,
            "proof_method": args.proof_method,
            "verification_status": args.verification_status,
            "expires_at": args.expires_at,
            "evidence_ref": args.evidence_ref,
        }
        _validate_management_request(DomainProofUpsertRequest, payload)
        with _http_client(args) as client:
            response = client.post(
                "/admin/domain-proofs",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "destination-policy-upsert":
        payload = {
            "root_program_id": args.root_program_id,
            "delegated_authority_id": args.delegated_authority_id,
            "issuer_id": args.issuer_id,
            "destination_policy_id": args.destination_policy_id,
            "usage_policy": args.usage_policy,
            "approved_destinations": _json_array_arg(
                args.approved_destinations_json,
                "--approved-destinations-json",
            ),
            "redirect_policy": _default_redirect_policy(),
            "runtime_safety_policy": _default_runtime_safety_policy(),
        }
        if args.redirect_policy_json is not None:
            payload["redirect_policy"] = _default_redirect_policy() | _json_object_arg(
                args.redirect_policy_json,
                "--redirect-policy-json",
            )
        if args.runtime_safety_policy_json is not None:
            payload["runtime_safety_policy"] = (
                _default_runtime_safety_policy()
                | _json_object_arg(
                    args.runtime_safety_policy_json,
                    "--runtime-safety-policy-json",
                )
            )
        _validate_management_request(DestinationPolicyUpsertRequest, payload)
        with _http_client(args) as client:
            response = client.post(
                "/admin/destination-policies",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "destination-policy-status-update":
        payload = {
            "root_program_id": args.root_program_id,
            "delegated_authority_id": args.delegated_authority_id,
            "issuer_id": args.issuer_id,
            "destination_policy_id": args.destination_policy_id,
            "status": args.status,
        }
        _validate_management_request(DestinationPolicyStatusUpdateRequest, payload)
        with _http_client(args) as client:
            response = client.post(
                "/admin/destination-policies/status",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "root-program-upsert":
        payload = {
            "root_program_id": args.root_program_id,
            "name": args.name,
            "program_scope": args.program_scope,
            "accepted_algorithm_ids": args.accepted_algorithm_id,
            "policy_constraints": _json_object_arg(
                args.policy_constraints_json,
                "--policy-constraints-json",
            ),
        }
        _validate_management_request(RootProgramUpsertRequest, payload)
        with _http_client(args) as client:
            response = client.post("/admin/root-programs", headers=headers, json=payload)
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "delegated-authority-upsert":
        payload = {
            "root_program_id": args.root_program_id,
            "delegated_authority_id": args.delegated_authority_id,
            "name": args.name,
            "authority_type": args.authority_type,
            "scope": _json_object_arg(args.scope_json, "--scope-json"),
            "assurance_requirements": _json_object_arg(
                args.assurance_requirements_json,
                "--assurance-requirements-json",
            ),
        }
        _validate_management_request(DelegatedAuthorityUpsertRequest, payload)
        with _http_client(args) as client:
            response = client.post(
                "/admin/delegated-authorities",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "runtime-provider-upsert":
        payload = {
            "provider_id": args.provider_id,
            "display_name": args.display_name,
            "base_url": args.provider_base_url,
            "verdict_ttl_seconds": args.verdict_ttl_seconds,
            "stale_behavior": args.stale_behavior,
            "unavailable_behavior": args.unavailable_behavior,
            "status": args.status,
        }
        _validate_management_request(RuntimeProviderUpsertRequest, payload)
        with _http_client(args) as client:
            response = client.post(
                "/admin/runtime-providers",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "runtime-provider-list":
        with _http_client(args) as client:
            response = client.get("/admin/runtime-providers", headers=headers)
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "nats-subscriber-authorize":
        payload = {
            "subscriber_id": args.subscriber_id,
            "display_name": args.display_name,
            "durable_name": args.durable_name,
            "description": args.description,
            "subjects": args.subject,
        }
        _validate_management_request(NatsSubscriberAuthorizationRequest, payload)
        with _http_client(args) as client:
            response = client.post(
                "/admin/nats/subscribers",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "nats-subscriber-list":
        with _http_client(args) as client:
            response = client.get("/admin/nats/subscribers", headers=headers)
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "outbox-status":
        with _http_client(args) as client:
            response = client.get(
                "/admin/outbox",
                headers=headers,
                params={"limit": args.limit},
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "outbox-event-remediate":
        payload = {
            "event_id": args.event_id,
            "action": args.action,
            "reason": args.reason,
        }
        _validate_management_request(ManagementOutboxEventRemediationRequest, payload)
        with _http_client(args) as client:
            response = client.post(
                "/admin/outbox/events/remediate",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    if args.command == "audit-list":
        with _http_client(args) as client:
            response = client.get(
                "/admin/audit",
                headers=headers,
                params={"limit": args.limit},
            )
            response.raise_for_status()
            print(json.dumps(response.json(), indent=2, sort_keys=True))
        return 0

    raise SystemExit(f"unsupported command: {args.command}")


def _json_object_arg(value: str, flag_name: str) -> dict[str, object]:
    decoded = json.loads(value)
    if not isinstance(decoded, dict):
        raise SystemExit(f"{flag_name} must be a JSON object")
    return decoded


def _http_client(args: argparse.Namespace) -> httpx.Client:
    return httpx.Client(
        base_url=args.base_url,
        timeout=10.0,
        verify=not bool(args.insecure_tls),
    )


def _json_array_arg(value: str, flag_name: str) -> list[object]:
    decoded = json.loads(value)
    if not isinstance(decoded, list):
        raise SystemExit(f"{flag_name} must be a JSON array")
    return decoded


def _validate_management_request(
    request_model: type[Any],
    payload: dict[str, Any],
) -> None:
    try:
        request_model(**payload)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc


def _demo_bootstrap_steps(
    args: argparse.Namespace,
) -> list[tuple[str, str, dict[str, Any]]]:
    destination = {
        "destination_id": "dest:acme-demo:pay",
        "expected_final_url": args.expected_final_url,
        "allowed_hosts": [args.domain],
        "allow_subdomains": False,
        "path_prefixes": ["/pay"],
        "query_policy": "allow_known_payment_query",
    }
    return [
        (
            "root-program",
            "/admin/root-programs",
            {
                "root_program_id": args.root_program_id,
                "name": "QR Trust Demo Root",
                "program_scope": "demo merchant QR trust",
                "accepted_algorithm_ids": ["Ed25519", "ES256"],
                "policy_constraints": {
                    "managed_bootstrap": True,
                    "fixture_scope": "local-demo",
                },
            },
        ),
        (
            "delegated-authority",
            "/admin/delegated-authorities",
            {
                "root_program_id": args.root_program_id,
                "delegated_authority_id": args.delegated_authority_id,
                "name": "QR Trust Demo Merchant Authority",
                "authority_type": "merchant_operator",
                "scope": {
                    "domains": [args.domain],
                    "demo_fixture": True,
                },
                "assurance_requirements": {
                    "domain_control_required": True,
                },
            },
        ),
        (
            "runtime-provider",
            "/admin/runtime-providers",
            {
                "provider_id": "deterministic-runtime-safety",
                "display_name": "Deterministic runtime safety",
                "base_url": None,
                "verdict_ttl_seconds": 300,
                "stale_behavior": "downgrade_to_caution",
                "unavailable_behavior": "downgrade_to_caution",
                "status": "active",
            },
        ),
        (
            "issuer",
            "/admin/issuers",
            {
                "root_program_id": args.root_program_id,
                "delegated_authority_id": args.delegated_authority_id,
                "issuer_id": args.issuer_id,
                "display_name": "ACME Demo Issuer",
                "issuer_class": "business",
                "assurance_tier": "domain_controlled",
            },
        ),
        (
            "domain-proof",
            "/admin/domain-proofs",
            {
                "root_program_id": args.root_program_id,
                "delegated_authority_id": args.delegated_authority_id,
                "issuer_id": args.issuer_id,
                "domain": args.domain,
                "proof_method": "manual_review",
                "verification_status": "verified",
                "evidence_ref": f"operator://qrtrustctl/demo-bootstrap/{args.domain}",
            },
        ),
        (
            "issuer-status",
            "/admin/issuers/status",
            {
                "root_program_id": args.root_program_id,
                "delegated_authority_id": args.delegated_authority_id,
                "issuer_id": args.issuer_id,
                "enrollment_status": "active",
            },
        ),
        (
            "destination-policy",
            "/admin/destination-policies",
            {
                "root_program_id": args.root_program_id,
                "delegated_authority_id": args.delegated_authority_id,
                "issuer_id": args.issuer_id,
                "destination_policy_id": "policy:acme-demo:web-payments:v1",
                "usage_policy": "reusable_public",
                "approved_destinations": [destination],
                "redirect_policy": _default_redirect_policy()
                | {
                    "expected_final_destinations": [args.expected_final_url],
                    "allowed_redirect_hosts": [args.domain],
                },
                "runtime_safety_policy": _default_runtime_safety_policy(),
            },
        ),
        (
            "nats-subscriber",
            "/admin/nats/subscribers",
            {
                "subscriber_id": args.subscriber_id,
                "display_name": "Reference governance subscriber",
                "durable_name": "qrtrust-governance-subscriber",
                "description": (
                    "Consumes managed QR Trust governance events for the demo."
                ),
                "subjects": GOVERNANCE_MATERIALIZER_SUBJECTS,
            },
        ),
        (
            "runtime-nats-subscriber",
            "/admin/nats/subscribers",
            {
                "subscriber_id": args.runtime_subscriber_id,
                "display_name": "Runtime observation subscriber",
                "durable_name": "qrtrust_runtime_subscriber_worker",
                "description": (
                    "Consumes managed QR Trust runtime observation events for "
                    "the demo."
                ),
                "subjects": RUNTIME_OBSERVATION_SUBJECTS,
            },
        ),
    ]


def _precondition_destination_policy_payload(args: argparse.Namespace) -> dict[str, Any]:
    payload = _demo_bootstrap_steps(args)[6][2].copy()
    payload["issuer_id"] = f"{args.issuer_id}:missing-precondition"
    payload["destination_policy_id"] = "policy:qrtrust-drill:precondition:v1"
    return payload


def _drill_step_headers(
    headers: dict[str, str],
    idempotency_prefix: str,
    step_id: str,
) -> dict[str, str]:
    step_headers = dict(headers)
    step_headers["Idempotency-Key"] = f"{idempotency_prefix}:{step_id}"
    return step_headers


def _default_redirect_policy() -> dict[str, object]:
    return {
        "resolver_urls": [],
        "expected_final_destinations": [],
        "allowed_redirect_hosts": [],
        "max_redirect_hops": 0,
        "nested_shorteners_allowed": False,
        "scanner_must_display_resolver_and_final_destination": True,
    }


def _default_runtime_safety_policy() -> dict[str, object]:
    return {
        "provider": "deterministic-runtime-safety",
        "verdict_ttl_seconds": 300,
        "stale_behavior": "downgrade_to_caution",
        "unavailable_behavior": "downgrade_to_caution",
    }


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
