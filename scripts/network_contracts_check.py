#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_DIR = ROOT / "docs" / "public" / "network-contracts"
FIXTURE_DIR = ROOT / "docs" / "public" / "fixtures" / "governance"
EXAMPLE_DIR = CONTRACT_DIR / "examples"

SCHEMA_FIXTURE_MAP = {
    "root-manifest.schema.json": "root-manifest.json",
    "delegated-authority.schema.json": "delegated-operator-manifest.json",
    "issuer-record.schema.json": "issuer-record.json",
    "destination-policy.schema.json": "destination-policy.json",
    "revocation-status-event.schema.json": [
        "revocation-status-event.json",
        "trust-key-status-event.json",
    ],
    "verifier-cache-entry.schema.json": "verifier-cache-entry.json",
}

SCHEMA_EXAMPLE_MAP = {
    "event-envelope.schema.json": [
        "issuer-record-published-event.json",
    ],
    "scanner-decision.schema.json": [
        "scanner-decision-green.json",
        "scanner-decision-orange-unavailable.json",
        "scanner-decision-orange-runtime-risky.json",
        "scanner-decision-red-runtime-blocked.json",
    ],
    "runtime-safety-observation.schema.json": [
        "runtime-observation-clear.json",
        "runtime-observation-risky.json",
        "runtime-observation-blocked.json",
        "runtime-observation-unavailable.json",
        "runtime-observation-stale.json",
    ],
    "deployment-readiness-report.schema.json": [
        "deployment-readiness-reference.json",
        "deployment-readiness-production-blocked.json",
        "deployment-readiness-production-ready.json",
    ],
    "deployment-readiness-bundle.schema.json": [
        "deployment-readiness-bundle-reference.json",
    ],
    "verifier-profile.schema.json": [
        "verifier-profile-reference.json",
    ],
    "scanner-fleet-evidence.schema.json": [
        "scanner-fleet-evidence-reference.json",
    ],
    "ios-provider-profile-evidence.schema.json": [
        "ios-provider-profile-evidence-reference.json",
    ],
    "cross-surface-qr-evidence.schema.json": [
        "cross-surface-qr-evidence-reference.json",
    ],
    "reference-network-adoption-stage.schema.json": [
        "reference-network-adoption-stage-1.json",
    ],
    "signing-custody-audit-export.schema.json": [
        "signing-custody-audit-export-reference.json",
        "signing-custody-publication-audit-export-reference.json",
    ],
    "worker-operations-evidence.schema.json": [
        "worker-operations-evidence-reference.json",
    ],
    "restore-automation-evidence.schema.json": [
        "restore-automation-evidence-reference.json",
    ],
    "packaged-deployment-approval-evidence.schema.json": [
        "packaged-deployment-approval-evidence-reference.json",
    ],
    "operator-evidence-index.schema.json": [
        "operator-evidence-index-reference.json",
        "operator-evidence-index-production-candidate.json",
    ],
    "production-evidence-requirements.schema.json": [
        "production-evidence-requirements-reference.json",
    ],
}

EXPECTED_SQL_TABLES = [
    "root_programs",
    "delegated_authorities",
    "trust_keys",
    "issuers",
    "issuer_domain_proofs",
    "issuer_certificates",
    "destination_policies",
    "published_artifacts",
    "status_events",
    "verifier_cache_entries",
    "runtime_observations",
    "scanner_decisions",
    "event_outbox",
    "artifact_publication_work_items",
    "verifier_cache_work_items",
]

EXPECTED_MARKDOWN_DOCS = [
    "key-rotation-policy.md",
    "signer-recovery-runbook.md",
    "managed-signing-custody-deployment-policy.md",
    "signing-custody-audit-export.md",
    "artifact-publication-runbook.md",
    "postgres-migration-deployment-policy.md",
    "nats-subjects.md",
    "scan-time-validation-sequence.md",
    "runtime-safety-provider-deployment-policy.md",
    "deployment-readiness-operator-guide.md",
    "scanner-decision-http-runtime.md",
    "verifier-profile-distribution.md",
    "scanner-fleet-evidence.md",
    "ios-provider-profile-evidence.md",
    "cross-surface-qr-evidence.md",
    "reference-network-adoption-stage.md",
    "worker-operations-evidence.md",
    "restore-automation-evidence.md",
    "packaged-deployment-approval-evidence.md",
    "operator-evidence-index.md",
    "production-evidence-requirements.md",
    "production-evidence-private-handoff.md",
    "production-evidence-closure-bundle.md",
]

EXPECTED_AUXILIARY_CONTRACT_FILES = [
    "deployment-readiness.evidence.example.json",
    "deployment-readiness.production.env.example",
    "reference-network-adoption.evidence.example.json",
    "reference-network-adoption.production.env.example",
]

DEPLOYMENT_READINESS_CHECK_IDS = [
    "postgres_source_of_truth",
    "migration_ledger",
    "restore_automation",
    "packaged_deployment_ownership",
    "nats_propagation",
    "managed_key_material",
    "managed_signing_custody",
    "custody_audit_export",
    "runtime_safety_provider",
    "scanner_decision_persistence",
    "worker_operations_evidence",
    "operator_runbooks",
]

DEPLOYMENT_READINESS_BUNDLE_FILE_ROLES = [
    "readiness_json_report",
    "readiness_markdown_report",
    "production_env_template",
    "evidence_map",
    "operator_guide",
    "signing_custody_audit_export_contract",
    "signing_custody_publication_audit_export",
    "scanner_decision_runtime_contract",
    "verifier_profile_distribution_contract",
    "scanner_fleet_evidence_contract",
    "scanner_fleet_evidence_packet",
    "cross_surface_qr_evidence_contract",
    "cross_surface_qr_evidence_packet",
    "worker_operations_evidence_contract",
    "worker_operations_evidence_packet",
    "restore_automation_evidence_contract",
    "restore_automation_evidence_packet",
    "packaged_deployment_approval_evidence_contract",
    "packaged_deployment_approval_evidence_packet",
    "operator_evidence_index_contract",
    "operator_evidence_index_packet",
]

DEPLOYMENT_READINESS_STATUSES = {
    "ready_for_reference_drill",
    "blocked_for_production",
    "ready_for_production_drill",
}

SCANNER_FLEET_MINIMUM_FIXTURES = [
    "green_reusable_public",
    "green_one_time_first_pass",
    "red_one_time_replay",
    "red_expired_qr",
    "red_destination_mismatch",
    "red_resolver_final_target_mismatch",
    "orange_plain_url_unrecognized",
    "orange_verifier_unavailable_visible_destination",
    "orange_stale_verifier_profile",
    "red_revoked_verifier_profile",
]

IOS_PROVIDER_PROFILE_EVIDENCE_FIXTURES = [
    "signed_profile_import_active",
    "signed_profile_settings_active",
    "signed_profile_settings_stale",
    "signed_profile_settings_revoked",
    "unsigned_nonlocal_profile_rejected",
    "unsigned_local_reviewer_profile_allowed",
]

IOS_PROVIDER_PROFILE_STATES = {
    "active",
    "stale",
    "revoked",
    "rejected",
    "local_reviewer_exception",
}

IOS_PROVIDER_PROFILE_SIGNALS = {"green", "orange", "red"}
IOS_PROVIDER_PROFILE_REF_RE = re.compile(r"^docs/public/evidence/iphone/[^/]+\.(png|txt)$")

CROSS_SURFACE_QR_EVIDENCE_SURFACES = [
    "contract_fixture",
    "worker_drill",
    "web_lab",
    "backend_scanner_decision",
    "ios_scanner",
]

REFERENCE_NETWORK_ADOPTION_BOUNDARIES = [
    "postgres_source_of_truth",
    "authority_publication",
    "nats_propagation",
    "verifier_cache_read_model",
    "scanner_decision_runtime",
    "scanner_fleet_evidence",
    "cross_surface_qr_evidence",
    "worker_operations_evidence",
    "signing_custody_audit_export",
    "signing_custody",
    "runtime_safety_provider",
    "operator_runbooks",
    "backup_restore",
    "external_governance_audit",
]

REFERENCE_NETWORK_ADOPTION_STAGE_NAMES = {
    0: "local_proof",
    1: "single_operator_pilot",
    2: "multi_authority_reference",
    3: "ecosystem_candidate",
}

REFERENCE_NETWORK_ADOPTION_STAGE_REQUIREMENTS = {
    0: {
        "scanner_decision_runtime",
        "scanner_fleet_evidence",
        "cross_surface_qr_evidence",
    },
    1: {
        "postgres_source_of_truth",
        "authority_publication",
        "verifier_cache_read_model",
        "scanner_decision_runtime",
        "scanner_fleet_evidence",
        "cross_surface_qr_evidence",
        "worker_operations_evidence",
        "signing_custody_audit_export",
        "operator_runbooks",
        "backup_restore",
    },
    2: {
        "postgres_source_of_truth",
        "authority_publication",
        "nats_propagation",
        "verifier_cache_read_model",
        "scanner_decision_runtime",
        "scanner_fleet_evidence",
        "cross_surface_qr_evidence",
        "worker_operations_evidence",
        "signing_custody_audit_export",
        "operator_runbooks",
        "backup_restore",
    },
    3: set(REFERENCE_NETWORK_ADOPTION_BOUNDARIES),
}

REFERENCE_NETWORK_ADOPTION_STATUSES = {
    "ready_for_stage_0_reference",
    "ready_for_stage_1_reference",
    "ready_for_stage_2_reference",
    "ready_for_stage_3_reference",
    "blocked_for_stage_claim",
    "ready_for_production_candidate",
    "blocked_for_production_candidate",
}

SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
PROFILE_FINGERPRINT_RE = re.compile(r"^sha256:[a-f0-9]{64}$")
REVIEW_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
RAW_URL_TOKEN_RE = re.compile(r"://|\?|#|@|\s")
MANAGED_CUSTODY_PROVIDER_RE = re.compile(r"^(kms|hsm|managed)://")
PRIVATE_MATERIAL_TOKEN_RE = re.compile(
    r"BEGIN PRIVATE KEY|END PRIVATE KEY|pem://|env://|file://|private_key|private-key",
    re.IGNORECASE,
)
SIGNING_CUSTODY_AUDIT_RESULTS = {"published", "rejected", "failed", "pending"}
WORKER_OPERATIONS_COMPONENTS = [
    "artifact_publication_worker",
    "event_outbox_worker",
    "verifier_cache_read_model_worker",
    "scanner_decision_runtime",
]
WORKER_OPERATIONS_BOUNDARIES = {
    "artifact_publication_worker": "postgres_source_of_truth",
    "event_outbox_worker": "nats_propagation_only",
    "verifier_cache_read_model_worker": "derived_read_model",
    "scanner_decision_runtime": "scanner_decision_runtime",
}
WORKER_OPERATIONS_STATUSES = {
    "reference_ready",
    "production_ready",
    "blocked",
}
WORKER_OPERATIONS_SIGNALS = [
    "artifact_publication_lag",
    "event_outbox_publish_lag",
    "verifier_cache_staleness",
    "scanner_decision_error_rate",
]
WORKER_OPERATIONS_SIGNAL_COMPONENTS = {
    "artifact_publication_lag": "artifact_publication_worker",
    "event_outbox_publish_lag": "event_outbox_worker",
    "verifier_cache_staleness": "verifier_cache_read_model_worker",
    "scanner_decision_error_rate": "scanner_decision_runtime",
}
WORKER_OPERATIONS_REF_RE = re.compile(r"^(docs/public/|network/)")
WORKER_OPERATIONS_PRIVATE_TOKEN_RE = re.compile(
    r"BEGIN PRIVATE KEY|END PRIVATE KEY|pem://|env://|file://|private[_ -]?key|password|bearer|api[_ -]?key",
    re.IGNORECASE,
)
RESTORE_AUTOMATION_REQUIRED_DRILLS = [
    "scheduled_backup_created",
    "scratch_restore_completed",
    "migration_rollback_rehearsed",
    "operator_failover_handoff",
]
RESTORE_AUTOMATION_STATUSES = {"passed", "failed", "blocked"}
RESTORE_AUTOMATION_REF_RE = re.compile(r"^(docs/public/|network/|ops://qrtrust/)")
RESTORE_AUTOMATION_PRIVATE_TOKEN_RE = re.compile(
    r"BEGIN PRIVATE KEY|END PRIVATE KEY|pem://|env://|file://|private[_ -]?key|password|bearer|api[_ -]?key",
    re.IGNORECASE,
)
PACKAGED_DEPLOYMENT_REQUIRED_GATES = [
    "artifact_fingerprinted",
    "contract_smoke_passed",
    "operator_approval_recorded",
    "rollback_plan_accepted",
]
PACKAGED_DEPLOYMENT_REQUIRED_APPROVAL_ROLES = [
    "release_owner",
    "security_reviewer",
    "operations_reviewer",
]
PACKAGED_DEPLOYMENT_STATUSES = {"passed", "failed", "blocked"}
PACKAGED_DEPLOYMENT_DECISIONS = {"approved", "rejected", "deferred"}
PACKAGED_DEPLOYMENT_REF_RE = re.compile(r"^(docs/public/|network/|ops://qrtrust/)")
PACKAGED_DEPLOYMENT_PRIVATE_TOKEN_RE = re.compile(
    r"BEGIN PRIVATE KEY|END PRIVATE KEY|pem://|env://|file://|private[_ -]?key|password|bearer|api[_ -]?key",
    re.IGNORECASE,
)
OPERATOR_EVIDENCE_CONTROL_IDS = DEPLOYMENT_READINESS_CHECK_IDS
OPERATOR_EVIDENCE_LAYERS = {
    "source_of_truth",
    "propagation",
    "custody",
    "runtime",
    "scanner",
    "operator_readiness",
}
OPERATOR_EVIDENCE_STATUSES = {"reference_backed", "operator_backed", "blocked"}
OPERATOR_EVIDENCE_REF_RE = re.compile(r"^(docs/public/|network/|ops://qrtrust/)")
OPERATOR_EVIDENCE_PRIVATE_TOKEN_RE = re.compile(
    r"BEGIN PRIVATE KEY|END PRIVATE KEY|pem://|env://|file://|private[_ -]?key|password|bearer|api[_ -]?key",
    re.IGNORECASE,
)
PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME = "ops://qrtrust/"
PRODUCTION_EVIDENCE_REVIEW_ROLES = {
    "database_operator",
    "release_owner",
    "security_reviewer",
    "operations_reviewer",
    "custody_operator",
    "runtime_operator",
}
PRODUCTION_EVIDENCE_REF_LIKE_TOKEN_RE = re.compile(r"://|\.\.|docs/public/|network/")
PRODUCTION_EVIDENCE_PRIVATE_TOKEN_RE = OPERATOR_EVIDENCE_PRIVATE_TOKEN_RE


class ContractError(ValueError):
    pass


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ContractError(f"missing JSON file: {path.relative_to(ROOT)}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ContractError(f"invalid JSON in {path.relative_to(ROOT)}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ContractError(f"JSON file must contain an object: {path.relative_to(ROOT)}")
    return payload


def validate_schema_shape(path: Path, schema: dict[str, Any]) -> None:
    if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
        raise ContractError(f"{path.name} must declare JSON Schema Draft 2020-12")
    if schema.get("type") != "object":
        raise ContractError(f"{path.name} must describe a top-level object")
    if not schema.get("title"):
        raise ContractError(f"{path.name} needs a title")
    required = schema.get("required")
    if not isinstance(required, list) or not required:
        raise ContractError(f"{path.name} needs a non-empty required list")


def validate_required_fields(
    schema_path: Path,
    schema: dict[str, Any],
    instance_path: Path,
    instance: dict[str, Any],
) -> None:
    required = schema.get("required")
    if not isinstance(required, list):
        raise ContractError(f"{schema_path.name} required field must be a list")

    missing = [field for field in required if field not in instance]
    if missing:
        fields = ", ".join(missing)
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} missing required fields from "
            f"{schema_path.name}: {fields}"
        )

    artifact_schema = schema.get("properties", {}).get("artifact_type")
    if not isinstance(artifact_schema, dict):
        return

    actual = instance.get("artifact_type")
    if "const" in artifact_schema and actual != artifact_schema["const"]:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} artifact_type mismatch for "
            f"{schema_path.name}: expected {artifact_schema['const']!r}, got {actual!r}"
        )
    if "enum" in artifact_schema and actual not in artifact_schema["enum"]:
        allowed = ", ".join(repr(value) for value in artifact_schema["enum"])
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} artifact_type mismatch for "
            f"{schema_path.name}: expected one of {allowed}, got {actual!r}"
        )


def validate_reference_sql() -> None:
    sql_path = CONTRACT_DIR / "reference-postgres-schema.sql"
    if not sql_path.exists():
        raise ContractError(f"missing SQL file: {sql_path.relative_to(ROOT)}")

    sql = sql_path.read_text(encoding="utf-8")
    missing = [
        table
        for table in EXPECTED_SQL_TABLES
        if f"create table if not exists qr_trust.{table}" not in sql
    ]
    if missing:
        raise ContractError(
            "reference-postgres-schema.sql missing expected tables: "
            + ", ".join(missing)
        )


def validate_markdown_contracts() -> None:
    missing = [
        doc_name
        for doc_name in EXPECTED_MARKDOWN_DOCS
        if not (CONTRACT_DIR / doc_name).exists()
    ]
    if missing:
        raise ContractError("missing markdown contracts: " + ", ".join(missing))


def validate_auxiliary_contract_files() -> None:
    missing = [
        file_name
        for file_name in EXPECTED_AUXILIARY_CONTRACT_FILES
        if not (CONTRACT_DIR / file_name).exists()
    ]
    if missing:
        raise ContractError("missing auxiliary contract files: " + ", ".join(missing))


def validate_deployment_readiness_evidence_map() -> None:
    path = CONTRACT_DIR / "deployment-readiness.evidence.example.json"
    evidence_map = load_json(path)
    if list(evidence_map) != DEPLOYMENT_READINESS_CHECK_IDS:
        raise ContractError(
            f"{path.relative_to(ROOT)} must be keyed by canonical readiness check order"
        )

    for check_id, refs in evidence_map.items():
        if not isinstance(refs, list) or not refs:
            raise ContractError(
                f"{path.relative_to(ROOT)} must include at least one evidence ref for {check_id}"
            )
        for ref in refs:
            validate_evidence_ref(path, check_id, ref)


def validate_reference_network_adoption_evidence_map() -> None:
    path = CONTRACT_DIR / "reference-network-adoption.evidence.example.json"
    evidence_map = load_json(path)
    if list(evidence_map) != REFERENCE_NETWORK_ADOPTION_BOUNDARIES:
        raise ContractError(
            f"{path.relative_to(ROOT)} must be keyed by canonical adoption boundary order"
        )

    for boundary_id, refs in evidence_map.items():
        if not isinstance(refs, list) or not refs:
            raise ContractError(
                f"{path.relative_to(ROOT)} must include at least one evidence ref for {boundary_id}"
            )
        for ref in refs:
            validate_evidence_ref(path, boundary_id, ref)


def validate_evidence_ref(path: Path, check_id: str, ref: Any) -> None:
    if not isinstance(ref, dict):
        raise ContractError(
            f"{path.relative_to(ROOT)} evidence refs for {check_id} must be objects"
        )
    missing = [
        field
        for field in ("label", "uri", "owner", "reviewed_at")
        if not isinstance(ref.get(field), str) or not ref[field].strip()
    ]
    if missing:
        raise ContractError(
            f"{path.relative_to(ROOT)} evidence ref for {check_id} missing fields: "
            + ", ".join(missing)
        )
    if REVIEW_DATE_RE.fullmatch(ref["reviewed_at"]) is None:
        raise ContractError(
            f"{path.relative_to(ROOT)} evidence ref for {check_id} "
            "reviewed_at must be YYYY-MM-DD"
        )


def validate_deployment_readiness_semantics(instance_path: Path, report: dict[str, Any]) -> None:
    if report.get("artifact_type") != "deployment_readiness_report":
        return

    mode = report.get("mode")
    status = report.get("status")
    checks = report.get("checks")
    blocking_checks = report.get("blocking_checks")
    warning_checks = report.get("warning_checks")

    if mode not in {"reference", "production"}:
        raise ContractError(f"{instance_path.relative_to(ROOT)} has unsupported readiness mode")
    if not isinstance(checks, list) or not all(isinstance(check, dict) for check in checks):
        raise ContractError(f"{instance_path.relative_to(ROOT)} readiness checks must be objects")
    if not isinstance(blocking_checks, list) or not isinstance(warning_checks, list):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} blocking_checks and warning_checks must be lists"
        )

    check_ids = [check.get("id") for check in checks]
    if check_ids != DEPLOYMENT_READINESS_CHECK_IDS:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} readiness checks must appear once "
            "in the canonical operator-review order"
        )

    duplicate_ids = sorted({check_id for check_id in check_ids if check_ids.count(check_id) > 1})
    if duplicate_ids:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} duplicates readiness checks: "
            + ", ".join(str(check_id) for check_id in duplicate_ids)
        )

    calculated_blockers = [
        check["id"] for check in checks if check.get("status") == "block"
    ]
    calculated_warnings = [
        check["id"] for check in checks if check.get("status") == "warn"
    ]

    if blocking_checks != calculated_blockers:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} blocking_checks does not match block statuses"
        )
    if warning_checks != calculated_warnings:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} warning_checks does not match warn statuses"
        )

    missing_remediation = [
        check["id"]
        for check in checks
        if check.get("status") in {"block", "warn"} and not check.get("remediation")
    ]
    if missing_remediation:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} missing remediation for non-pass checks: "
            + ", ".join(missing_remediation)
        )

    if mode == "reference":
        if status != "ready_for_reference_drill":
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} reference mode must be ready_for_reference_drill"
            )
        if blocking_checks:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} reference mode must not block production-only controls"
            )
        return

    if warning_checks:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} production mode must not downgrade checks to warnings"
        )

    missing_pass_evidence = [
        check["id"]
        for check in checks
        if check.get("status") == "pass" and not check.get("evidence_refs")
    ]
    if missing_pass_evidence:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} production pass checks need evidence_refs: "
            + ", ".join(missing_pass_evidence)
        )
    for check in checks:
        if check.get("status") != "pass":
            continue
        for ref in check.get("evidence_refs", []):
            validate_evidence_ref(instance_path, str(check["id"]), ref)

    expected_status = (
        "blocked_for_production" if blocking_checks else "ready_for_production_drill"
    )
    if status != expected_status:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} status must be {expected_status!r} "
            "for the current production blocking checks"
        )


def validate_deployment_readiness_bundle_semantics(
    instance_path: Path,
    bundle: dict[str, Any],
) -> None:
    if bundle.get("artifact_type") != "deployment_readiness_bundle":
        return

    if bundle.get("bundle_role") != "operator_handoff":
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} bundle_role must be operator_handoff"
        )
    if not isinstance(bundle.get("generated_at"), str) or not bundle["generated_at"].strip():
        raise ContractError(f"{instance_path.relative_to(ROOT)} generated_at must be non-empty")

    report = bundle.get("report")
    if not isinstance(report, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} report must be an object")
    validate_deployment_readiness_bundle_report(instance_path, report)

    files = bundle.get("files")
    if not isinstance(files, list) or not all(isinstance(file, dict) for file in files):
        raise ContractError(f"{instance_path.relative_to(ROOT)} files must be objects")
    validate_deployment_readiness_bundle_files(instance_path, files)

    review_notes = bundle.get("review_notes")
    if not isinstance(review_notes, list) or not review_notes:
        raise ContractError(f"{instance_path.relative_to(ROOT)} review_notes must be non-empty")
    if not all(isinstance(note, str) and note.strip() for note in review_notes):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} review_notes must contain non-empty strings"
        )


def validate_deployment_readiness_bundle_report(
    instance_path: Path,
    report: dict[str, Any],
) -> None:
    mode = report.get("mode")
    status = report.get("status")
    blocking_checks = report.get("blocking_checks")
    warning_checks = report.get("warning_checks")

    if mode not in {"reference", "production"}:
        raise ContractError(f"{instance_path.relative_to(ROOT)} bundle report mode is invalid")
    if status not in DEPLOYMENT_READINESS_STATUSES:
        raise ContractError(f"{instance_path.relative_to(ROOT)} bundle report status is invalid")
    if not isinstance(blocking_checks, list) or not isinstance(warning_checks, list):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} bundle report check summaries must be lists"
        )

    unknown_checks = [
        check_id
        for check_id in [*blocking_checks, *warning_checks]
        if check_id not in DEPLOYMENT_READINESS_CHECK_IDS
    ]
    if unknown_checks:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} bundle report has unknown check ids: "
            + ", ".join(str(check_id) for check_id in unknown_checks)
        )

    if mode == "reference":
        if status != "ready_for_reference_drill":
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} reference bundle must be ready_for_reference_drill"
            )
        if blocking_checks:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} reference bundle must not list blockers"
            )
        return

    if warning_checks:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} production bundle must not list warnings"
        )

    expected_status = (
        "blocked_for_production"
        if blocking_checks
        else "ready_for_production_drill"
    )
    if status != expected_status:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} production bundle status must be "
            f"{expected_status!r}"
        )


def validate_deployment_readiness_bundle_files(
    instance_path: Path,
    files: list[dict[str, Any]],
) -> None:
    roles = [file.get("role") for file in files]
    if roles != DEPLOYMENT_READINESS_BUNDLE_FILE_ROLES:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} bundle files must appear once "
            "in canonical handoff order"
        )

    for file in files:
        role = file.get("role")
        path = file.get("path")
        sha256 = file.get("sha256")
        bytes_count = file.get("bytes")
        if role not in DEPLOYMENT_READINESS_BUNDLE_FILE_ROLES:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} has unsupported bundle file role: {role!r}"
            )
        if not isinstance(path, str) or not path.strip():
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} bundle file {role!r} needs a path"
            )
        if not isinstance(sha256, str) or SHA256_RE.fullmatch(sha256) is None:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} bundle file {role!r} needs a sha256"
            )
        if not isinstance(bytes_count, int) or bytes_count < 1:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} bundle file {role!r} needs positive bytes"
            )


def validate_verifier_profile_semantics(
    instance_path: Path,
    profile: dict[str, Any],
) -> None:
    if profile.get("artifact_type") != "verifier_profile":
        return

    fingerprint = profile.get("profile_fingerprint")
    if not isinstance(fingerprint, str) or PROFILE_FINGERPRINT_RE.fullmatch(fingerprint) is None:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} profile_fingerprint must be sha256-prefixed"
        )

    endpoint = profile.get("scanner_decision_endpoint")
    if not isinstance(endpoint, str) or not endpoint.startswith("https://"):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} scanner_decision_endpoint must be HTTPS"
        )

    accepted_authorities = profile.get("accepted_delegated_authority_ids")
    if not isinstance(accepted_authorities, list) or not accepted_authorities:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} must accept at least one delegated authority"
        )

    color_policy = profile.get("decision_color_policy")
    if not isinstance(color_policy, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} decision_color_policy is required")

    green_requires = color_policy.get("green_requires")
    expected_green_controls = {
        "issuer_recognized",
        "destination_bound",
        "runtime_clear",
        "cache_fresh",
    }
    green_controls = set(green_requires) if isinstance(green_requires, list) else set()
    if not expected_green_controls.issubset(green_controls):
        missing = sorted(expected_green_controls - green_controls)
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} green policy is missing controls: "
            + ", ".join(missing)
        )

    hold_policy = profile.get("hold_to_open_policy")
    if not isinstance(hold_policy, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} hold_to_open_policy is required")
    if hold_policy.get("enabled") is not True:
        raise ContractError(f"{instance_path.relative_to(ROOT)} hold-to-open must be enabled")
    duration_ms = hold_policy.get("duration_ms")
    if not isinstance(duration_ms, int) or duration_ms < 800:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} hold-to-open duration must be at least 800ms"
        )


# Decision states whose path returns before destination binding is evaluated,
# so an evidence row in one of these states cannot attest to it. The verifier
# reports destination_binding as "not_evaluated" for each. profile_stale is
# deliberately absent: a stale cache still binds against the cached profile.
DESTINATION_BINDING_NOT_EVALUATED_STATES = frozenset(
    {
        "one_time_replay",
        "expired",
        "profile_revoked",
        "plain_url_unrecognized",
        "verifier_unavailable_visible_destination",
    }
)
DESTINATION_BINDING_REASON_CODE = "destination_bound"


def validate_scanner_fleet_evidence_semantics(
    instance_path: Path,
    packet: dict[str, Any],
) -> None:
    if packet.get("artifact_type") != "scanner_fleet_evidence_packet":
        return

    privacy = packet.get("privacy")
    if not isinstance(privacy, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} privacy must be an object")
    if privacy.get("secrets_included") is not False:
        raise ContractError(f"{instance_path.relative_to(ROOT)} must not include secrets")
    if privacy.get("raw_urls_redacted") is not True:
        raise ContractError(f"{instance_path.relative_to(ROOT)} must redact raw URLs")

    active_profile = packet.get("active_verifier_profile")
    if not isinstance(active_profile, dict):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} active_verifier_profile must be an object"
        )
    profile_fingerprint = active_profile.get("profile_fingerprint")
    if (
        not isinstance(profile_fingerprint, str)
        or PROFILE_FINGERPRINT_RE.fullmatch(profile_fingerprint) is None
    ):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} active profile fingerprint must be sha256-prefixed"
        )

    fixtures = packet.get("fixture_matrix")
    evidence_rows = packet.get("evidence_rows")
    if not isinstance(fixtures, list) or not all(isinstance(item, dict) for item in fixtures):
        raise ContractError(f"{instance_path.relative_to(ROOT)} fixture_matrix must contain objects")
    if not isinstance(evidence_rows, list) or not all(
        isinstance(item, dict) for item in evidence_rows
    ):
        raise ContractError(f"{instance_path.relative_to(ROOT)} evidence_rows must contain objects")

    fixture_by_id = {fixture.get("fixture_id"): fixture for fixture in fixtures}
    fixture_ids = list(fixture_by_id)
    duplicate_fixtures = sorted(
        {fixture_id for fixture_id in fixture_ids if fixture_ids.count(fixture_id) > 1}
    )
    if duplicate_fixtures:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} duplicates fixtures: "
            + ", ".join(str(fixture_id) for fixture_id in duplicate_fixtures)
        )

    missing_fixtures = [
        fixture_id
        for fixture_id in SCANNER_FLEET_MINIMUM_FIXTURES
        if fixture_id not in fixture_by_id
    ]
    if missing_fixtures:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} missing scanner fleet fixtures: "
            + ", ".join(missing_fixtures)
        )

    rows_by_fixture_id: dict[str, list[dict[str, Any]]] = {}
    for row in evidence_rows:
        fixture_id = row.get("fixture_id")
        if not isinstance(fixture_id, str):
            raise ContractError(f"{instance_path.relative_to(ROOT)} evidence row needs fixture_id")
        rows_by_fixture_id.setdefault(fixture_id, []).append(row)

    missing_rows = [
        fixture_id
        for fixture_id in SCANNER_FLEET_MINIMUM_FIXTURES
        if fixture_id not in rows_by_fixture_id
    ]
    if missing_rows:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} missing evidence rows for fixtures: "
            + ", ".join(missing_rows)
        )

    unknown_row_fixtures = sorted(set(rows_by_fixture_id) - set(fixture_by_id))
    if unknown_row_fixtures:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} has evidence rows for unknown fixtures: "
            + ", ".join(unknown_row_fixtures)
        )

    for row in evidence_rows:
        fixture = fixture_by_id[str(row["fixture_id"])]
        if row.get("profile_fingerprint") != profile_fingerprint:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {row['fixture_id']} "
                "does not match active profile fingerprint"
            )
        if row.get("decision_color") != fixture.get("expected_color"):
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {row['fixture_id']} "
                "does not match fixture expected_color"
            )
        if row.get("decision_state") != fixture.get("expected_state"):
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {row['fixture_id']} "
                "does not match fixture expected_state"
            )

        row_reason_codes = row.get("reason_codes")
        if (
            row.get("decision_state") in DESTINATION_BINDING_NOT_EVALUATED_STATES
            and isinstance(row_reason_codes, list)
            and DESTINATION_BINDING_REASON_CODE in row_reason_codes
        ):
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {row['fixture_id']} "
                f"claims {DESTINATION_BINDING_REASON_CODE} but decision state "
                f"{row['decision_state']} stops before destination binding is evaluated"
            )

        color = row.get("decision_color")
        if color in {"orange", "red"} and row.get("hold_required") is not True:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {row['fixture_id']} "
                "must require hold-to-open for non-green outcomes"
            )
        if row.get("opened_by_user") is True and row.get("hold_required") is True:
            if row.get("hold_completed") is not True:
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} evidence row {row['fixture_id']} "
                    "opened after a gated decision without hold_completed"
                )

    validate_packet_reviewer(instance_path, packet.get("reviewer"))


def validate_ios_provider_profile_evidence_semantics(
    instance_path: Path,
    packet: dict[str, Any],
) -> None:
    if packet.get("artifact_type") != "ios_provider_profile_evidence_packet":
        return

    privacy = packet.get("privacy")
    if not isinstance(privacy, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} privacy must be an object")
    if privacy.get("secrets_included") is not False:
        raise ContractError(f"{instance_path.relative_to(ROOT)} must not include secrets")
    if privacy.get("raw_endpoints_redacted") is not True:
        raise ContractError(f"{instance_path.relative_to(ROOT)} must redact raw endpoints")

    provider_profile_fixture = packet.get("provider_profile_fixture")
    if not isinstance(provider_profile_fixture, dict):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} provider_profile_fixture must be an object"
        )
    fixture_path = provider_profile_fixture.get("path")
    if not isinstance(fixture_path, str) or not fixture_path.startswith(
        "docs/public/fixtures/ios/"
    ):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} provider profile fixture must stay under "
            "docs/public/fixtures/ios/"
        )
    profile_fingerprint = provider_profile_fixture.get("profile_fingerprint")
    if (
        not isinstance(profile_fingerprint, str)
        or PROFILE_FINGERPRINT_RE.fullmatch(profile_fingerprint) is None
    ):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} provider profile fingerprint must be "
            "sha256-prefixed"
        )

    evidence_rows = packet.get("evidence_rows")
    if not isinstance(evidence_rows, list) or not all(
        isinstance(row, dict) for row in evidence_rows
    ):
        raise ContractError(f"{instance_path.relative_to(ROOT)} evidence_rows must contain objects")

    row_ids = [row.get("fixture_id") for row in evidence_rows]
    if row_ids != IOS_PROVIDER_PROFILE_EVIDENCE_FIXTURES:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} provider-profile evidence rows must follow "
            "the canonical fixture order: "
            + ", ".join(IOS_PROVIDER_PROFILE_EVIDENCE_FIXTURES)
        )

    artifact_refs: set[str] = set()
    for row in evidence_rows:
        fixture_id = row["fixture_id"]
        profile_state = row.get("profile_state")
        if profile_state not in IOS_PROVIDER_PROFILE_STATES:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {fixture_id} has unsupported "
                f"profile_state: {profile_state!r}"
            )

        expected_signal = row.get("expected_user_signal")
        if expected_signal not in IOS_PROVIDER_PROFILE_SIGNALS:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {fixture_id} has unsupported "
                f"expected_user_signal: {expected_signal!r}"
            )

        expected_status = row.get("expected_status")
        if not isinstance(expected_status, str) or not expected_status.strip():
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {fixture_id} needs "
                "expected_status"
            )

        for field in ("screenshot_ref", "accessibility_ref"):
            artifact_ref = row.get(field)
            if (
                not isinstance(artifact_ref, str)
                or IOS_PROVIDER_PROFILE_REF_RE.match(artifact_ref) is None
            ):
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} evidence row {fixture_id} field "
                    f"{field} must stay under docs/public/evidence/iphone/ as png/txt"
                )
            if artifact_ref in artifact_refs:
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} evidence row {fixture_id} repeats "
                    f"artifact ref: {artifact_ref}"
                )
            artifact_refs.add(artifact_ref)

        if not is_non_empty_string_list(row.get("required_labels")):
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {fixture_id} needs "
                "required_labels"
            )

    validate_packet_reviewer(instance_path, packet.get("reviewer"))


def validate_cross_surface_qr_evidence_semantics(
    instance_path: Path,
    packet: dict[str, Any],
) -> None:
    if packet.get("artifact_type") != "cross_surface_qr_evidence_packet":
        return

    privacy = packet.get("privacy")
    if not isinstance(privacy, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} privacy must be an object")
    if privacy.get("secrets_included") is not False:
        raise ContractError(f"{instance_path.relative_to(ROOT)} must not include secrets")
    if privacy.get("raw_urls_redacted") is not True:
        raise ContractError(f"{instance_path.relative_to(ROOT)} must redact raw URLs")

    qr_artifact = packet.get("qr_artifact")
    if not isinstance(qr_artifact, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} qr_artifact must be an object")

    artifact_ref = qr_artifact.get("artifact_ref")
    if not isinstance(artifact_ref, str) or not artifact_ref.strip():
        raise ContractError(f"{instance_path.relative_to(ROOT)} qr_artifact needs artifact_ref")

    payload_hash = qr_artifact.get("payload_hash")
    if (
        not isinstance(payload_hash, str)
        or PROFILE_FINGERPRINT_RE.fullmatch(payload_hash) is None
    ):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} qr_artifact payload_hash must be sha256-prefixed"
        )

    usage_policy = qr_artifact.get("usage_policy")
    if usage_policy not in {"one_time", "reusable_public"}:
        raise ContractError(f"{instance_path.relative_to(ROOT)} qr_artifact usage_policy is invalid")

    destination_fingerprint = qr_artifact.get("destination_fingerprint")
    if (
        not isinstance(destination_fingerprint, str)
        or not destination_fingerprint
        or len(destination_fingerprint) > 80
        or "..." not in destination_fingerprint
        or RAW_URL_TOKEN_RE.search(destination_fingerprint)
    ):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} destination_fingerprint must be compact and redacted"
        )

    final_decision = packet.get("final_decision")
    if not isinstance(final_decision, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} final_decision must be an object")
    final_color = final_decision.get("decision_color")
    final_state = final_decision.get("decision_state")
    final_reasons = final_decision.get("reason_codes")
    if final_color not in {"green", "orange", "red"}:
        raise ContractError(f"{instance_path.relative_to(ROOT)} final_decision color is invalid")
    if not isinstance(final_state, str) or not final_state.strip():
        raise ContractError(f"{instance_path.relative_to(ROOT)} final_decision state is required")
    if not is_non_empty_string_list(final_reasons):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} final_decision reason_codes are required"
        )

    rows = packet.get("surface_evidence")
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise ContractError(f"{instance_path.relative_to(ROOT)} surface_evidence must be objects")

    surfaces = [row.get("surface") for row in rows]
    if surfaces != CROSS_SURFACE_QR_EVIDENCE_SURFACES:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} surface_evidence must use canonical handoff order"
        )

    proof_refs: set[str] = set()
    for row in rows:
        surface = row["surface"]
        proof_ref = row.get("proof_ref")
        if not isinstance(proof_ref, str) or not proof_ref.strip() or ".." in proof_ref:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {surface} needs proof_ref"
            )
        expected_prefix = (
            "docs/public/evidence/iphone/"
            if surface == "ios_scanner"
            else "docs/public/"
        )
        if not proof_ref.startswith(expected_prefix):
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {surface} has invalid proof_ref"
            )
        if proof_ref in proof_refs:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} duplicates cross-surface proof_ref: {proof_ref}"
            )
        proof_refs.add(proof_ref)

        if row.get("artifact_ref") != artifact_ref:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {surface} artifact_ref mismatch"
            )
        if row.get("decision_color") != final_color:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {surface} color mismatch"
            )
        if row.get("decision_state") != final_state:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {surface} state mismatch"
            )
        if not is_non_empty_string_list(row.get("reason_codes")):
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} evidence row {surface} reason_codes are required"
            )

    validate_packet_reviewer(instance_path, packet.get("reviewer"))


def validate_reference_network_adoption_stage_semantics(
    instance_path: Path,
    gate: dict[str, Any],
) -> None:
    if gate.get("artifact_type") != "reference_network_adoption_stage_gate":
        return

    stage = gate.get("stage")
    stage_name = gate.get("stage_name")
    claim_mode = gate.get("claim_mode")
    status = gate.get("status")
    boundaries = gate.get("boundaries")
    blocking_boundaries = gate.get("blocking_boundaries")
    warning_boundaries = gate.get("warning_boundaries")

    if stage not in REFERENCE_NETWORK_ADOPTION_STAGE_NAMES:
        raise ContractError(f"{instance_path.relative_to(ROOT)} adoption stage is invalid")
    expected_stage_name = REFERENCE_NETWORK_ADOPTION_STAGE_NAMES[stage]
    if stage_name != expected_stage_name:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} stage_name must be {expected_stage_name!r}"
        )
    if claim_mode not in {"reference_only", "production_candidate"}:
        raise ContractError(f"{instance_path.relative_to(ROOT)} claim_mode is invalid")
    if status not in REFERENCE_NETWORK_ADOPTION_STATUSES:
        raise ContractError(f"{instance_path.relative_to(ROOT)} status is invalid")
    if not isinstance(boundaries, list) or not all(
        isinstance(boundary, dict) for boundary in boundaries
    ):
        raise ContractError(f"{instance_path.relative_to(ROOT)} boundaries must be objects")
    if not isinstance(blocking_boundaries, list) or not isinstance(warning_boundaries, list):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} blocking_boundaries and warning_boundaries must be lists"
        )

    boundary_ids = [boundary.get("id") for boundary in boundaries]
    if boundary_ids != REFERENCE_NETWORK_ADOPTION_BOUNDARIES:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} boundaries must appear once in canonical stage-gate order"
        )

    duplicate_ids = sorted(
        {boundary_id for boundary_id in boundary_ids if boundary_ids.count(boundary_id) > 1}
    )
    if duplicate_ids:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} duplicates adoption boundaries: "
            + ", ".join(str(boundary_id) for boundary_id in duplicate_ids)
        )

    calculated_blockers = [
        boundary["id"] for boundary in boundaries if boundary.get("status") == "block"
    ]
    calculated_warnings = [
        boundary["id"] for boundary in boundaries if boundary.get("status") == "warn"
    ]

    if blocking_boundaries != calculated_blockers:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} blocking_boundaries does not match block statuses"
        )
    if warning_boundaries != calculated_warnings:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} warning_boundaries does not match warn statuses"
        )

    required_boundaries = REFERENCE_NETWORK_ADOPTION_STAGE_REQUIREMENTS[stage]
    required_warnings = [
        boundary["id"]
        for boundary in boundaries
        if boundary["id"] in required_boundaries and boundary.get("status") == "warn"
    ]
    if required_warnings:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} required stage boundaries cannot warn: "
            + ", ".join(required_warnings)
        )

    for boundary in boundaries:
        boundary_id = str(boundary["id"])
        if boundary.get("status") not in {"pass", "warn", "block"}:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} adoption boundary {boundary_id} has invalid status"
            )
        for field in ("layer", "title", "evidence"):
            if not isinstance(boundary.get(field), str) or not boundary[field].strip():
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} adoption boundary {boundary_id} needs {field}"
                )
        if boundary.get("status") != "pass" and not boundary.get("remediation"):
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} adoption boundary {boundary_id} needs remediation"
            )
        if boundary.get("status") == "pass" and not boundary.get("evidence_refs"):
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} adoption pass boundary needs evidence_refs: {boundary_id}"
            )
        for ref in boundary.get("evidence_refs", []):
            validate_evidence_ref(instance_path, boundary_id, ref)

    if claim_mode == "production_candidate":
        if warning_boundaries:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} production candidates cannot list warnings"
            )
        expected_status = (
            "blocked_for_production_candidate"
            if blocking_boundaries
            else "ready_for_production_candidate"
        )
    else:
        expected_status = (
            "blocked_for_stage_claim"
            if blocking_boundaries
            else f"ready_for_stage_{stage}_reference"
        )

    if status != expected_status:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} status must be {expected_status!r}"
        )

    review_notes = gate.get("review_notes")
    if not isinstance(review_notes, list) or not review_notes:
        raise ContractError(f"{instance_path.relative_to(ROOT)} review_notes must be non-empty")
    if not all(isinstance(note, str) and note.strip() for note in review_notes):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} review_notes must contain non-empty strings"
        )


def validate_signing_custody_audit_export_semantics(
    instance_path: Path,
    audit_export: dict[str, Any],
) -> None:
    if audit_export.get("artifact_type") != "signing_custody_audit_export":
        return

    if audit_export.get("redaction_status") != "public_safe":
        raise ContractError(f"{instance_path.relative_to(ROOT)} must be public_safe")
    if PRIVATE_MATERIAL_TOKEN_RE.search(json.dumps(audit_export)):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} contains private material markers"
        )

    scope = audit_export.get("scope")
    entries = audit_export.get("entries")
    summary = audit_export.get("summary")
    if not isinstance(scope, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} scope must be an object")
    if not isinstance(entries, list) or not entries:
        raise ContractError(f"{instance_path.relative_to(ROOT)} entries must be non-empty")
    if not all(isinstance(entry, dict) for entry in entries):
        raise ContractError(f"{instance_path.relative_to(ROOT)} entries must contain objects")
    if not isinstance(summary, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} summary must be an object")

    root_scope = scope.get("root_program_id")
    authority_scope = scope.get("delegated_authority_id")
    issuer_scope = scope.get("issuer_id")
    if not isinstance(root_scope, str) or not root_scope.strip():
        raise ContractError(f"{instance_path.relative_to(ROOT)} scope root_program_id is required")

    seen_events: set[str] = set()
    provider_refs: set[str] = set()
    calculated_counts = {
        "published": 0,
        "rejected": 0,
        "failed": 0,
        "pending": 0,
    }

    required_string_fields = [
        "audit_event_id",
        "artifact_id",
        "artifact_type",
        "artifact_hash",
        "root_program_id",
        "signer_id",
        "key_id",
        "algorithm_id",
        "custody_provider_ref",
        "provider_audit_id",
        "automation_identity",
        "requested_at",
        "publication_result",
    ]

    for entry in entries:
        missing = [
            field
            for field in required_string_fields
            if not isinstance(entry.get(field), str) or not entry[field].strip()
        ]
        if missing:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} audit entry missing fields: "
                + ", ".join(missing)
            )

        audit_event_id = str(entry["audit_event_id"])
        if audit_event_id in seen_events:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} duplicates audit event: {audit_event_id}"
            )
        seen_events.add(audit_event_id)

        artifact_version = entry.get("artifact_version")
        if not isinstance(artifact_version, int) or artifact_version < 1:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} entry {audit_event_id} "
                "needs positive artifact_version"
            )
        if PROFILE_FINGERPRINT_RE.fullmatch(str(entry["artifact_hash"])) is None:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} entry {audit_event_id} "
                "needs sha256 artifact_hash"
            )

        provider_ref = str(entry["custody_provider_ref"])
        if MANAGED_CUSTODY_PROVIDER_RE.match(provider_ref) is None:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} entry {audit_event_id} "
                "must use managed custody provider refs"
            )
        provider_refs.add(provider_ref)

        result = str(entry["publication_result"])
        if result not in SIGNING_CUSTODY_AUDIT_RESULTS:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} entry {audit_event_id} "
                "has invalid publication_result"
            )
        calculated_counts[result] += 1

        if entry.get("root_program_id") != root_scope:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} entry {audit_event_id} "
                "is outside export root scope"
            )
        if authority_scope and entry.get("delegated_authority_id") != authority_scope:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} entry {audit_event_id} "
                "is outside export authority scope"
            )
        if issuer_scope and entry.get("issuer_id") != issuer_scope:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} entry {audit_event_id} "
                "is outside export issuer scope"
            )
        if "reason_codes" in entry and not is_non_empty_string_list(entry["reason_codes"]):
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} entry {audit_event_id} "
                "reason_codes must be non-empty strings"
            )

    expected_provider_refs = sorted(provider_refs)
    expected_summary = {
        "entry_count": len(entries),
        **calculated_counts,
        "provider_refs": expected_provider_refs,
    }
    for field, expected_value in expected_summary.items():
        if summary.get(field) != expected_value:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} summary {field} must match entries"
            )


def validate_worker_operations_evidence_semantics(
    instance_path: Path,
    packet: dict[str, Any],
) -> None:
    if packet.get("artifact_type") != "worker_operations_evidence_packet":
        return

    claim_mode = packet.get("claim_mode")
    if claim_mode not in {"reference_drill", "production_candidate"}:
        raise ContractError(f"{instance_path.relative_to(ROOT)} claim_mode is invalid")
    if WORKER_OPERATIONS_PRIVATE_TOKEN_RE.search(json.dumps(packet)):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} contains private material markers"
        )

    guardrails = packet.get("guardrails")
    if not isinstance(guardrails, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} guardrails must be an object")
    for field in (
        "postgres_authoritative",
        "nats_propagation_only",
        "verifier_cache_derived_only",
        "no_secret_material",
    ):
        if guardrails.get(field) is not True:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} guardrail {field} must be true"
            )

    components = packet.get("components")
    if not isinstance(components, list) or not all(
        isinstance(component, dict) for component in components
    ):
        raise ContractError(f"{instance_path.relative_to(ROOT)} components must be objects")

    component_ids = [component.get("component_id") for component in components]
    if component_ids != WORKER_OPERATIONS_COMPONENTS:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} components must use canonical worker order"
        )

    for component in components:
        component_id = str(component["component_id"])
        status = component.get("operational_status")
        expected_boundary = WORKER_OPERATIONS_BOUNDARIES[component_id]
        if component.get("authority_boundary") != expected_boundary:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} {component_id} boundary must be "
                f"{expected_boundary}"
            )
        if status not in WORKER_OPERATIONS_STATUSES:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} {component_id} status is invalid"
            )
        if claim_mode == "reference_drill" and status == "blocked":
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} reference drills cannot block {component_id}"
            )
        if claim_mode == "production_candidate" and status != "production_ready":
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} production candidate needs "
                f"production_ready {component_id}"
            )

        for field in ("runtime", "smoke_script"):
            if not isinstance(component.get(field), str) or not component[field].strip():
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} {component_id} needs {field}"
                )
        if not component["smoke_script"].startswith("npm run "):
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} {component_id} smoke_script "
                "must be an npm run command"
            )
        for field in ("input_refs", "output_refs"):
            if not is_non_empty_string_list(component.get(field)):
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} {component_id} {field} "
                    "must be non-empty strings"
                )
        for field in ("runbook_ref", "metrics_ref", "recovery_ref"):
            validate_worker_operations_path_ref(
                instance_path,
                f"{component_id}.{field}",
                component.get(field),
            )

    drills = packet.get("replay_recovery_drills")
    if not isinstance(drills, list) or not all(isinstance(drill, dict) for drill in drills):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} replay_recovery_drills must be objects"
        )
    drill_ids = [drill.get("drill_id") for drill in drills]
    duplicate_drill_ids = sorted(
        {drill_id for drill_id in drill_ids if drill_ids.count(drill_id) > 1}
    )
    if duplicate_drill_ids:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} duplicates worker drills: "
            + ", ".join(str(drill_id) for drill_id in duplicate_drill_ids)
        )

    drilled_components: set[str] = set()
    for drill in drills:
        component_id = drill.get("component_id")
        if component_id not in WORKER_OPERATIONS_COMPONENTS:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} drill has invalid component_id"
            )
        drilled_components.add(str(component_id))
        for field in ("drill_id", "trigger", "expected_recovery"):
            if not isinstance(drill.get(field), str) or not drill[field].strip():
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} worker drill needs {field}"
                )
        validate_worker_operations_path_ref(
            instance_path,
            f"{drill['drill_id']}.evidence_ref",
            drill.get("evidence_ref"),
        )

    missing_drills = [
        component_id
        for component_id in WORKER_OPERATIONS_COMPONENTS
        if component_id not in drilled_components
    ]
    if missing_drills:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} missing replay/recovery drills for: "
            + ", ".join(missing_drills)
        )

    monitoring = packet.get("monitoring")
    if not isinstance(monitoring, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} monitoring must be an object")
    for field in ("stale_work_items_threshold_seconds", "max_publish_lag_seconds"):
        if not isinstance(monitoring.get(field), int) or monitoring[field] < 1:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} monitoring {field} must be positive"
            )
    if not is_non_empty_string_list(monitoring.get("metrics_refs")):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} monitoring metrics_refs must be non-empty"
        )
    for ref in monitoring["metrics_refs"]:
        validate_worker_operations_path_ref(instance_path, "monitoring.metrics_refs", ref)
    signals = monitoring.get("signals")
    if not isinstance(signals, list) or not all(
        isinstance(signal, dict) for signal in signals
    ):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} monitoring signals must be objects"
        )
    signal_ids = [signal.get("signal_id") for signal in signals]
    if signal_ids != WORKER_OPERATIONS_SIGNALS:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} monitoring signals must use canonical order"
        )
    for signal in signals:
        signal_id = str(signal["signal_id"])
        expected_component = WORKER_OPERATIONS_SIGNAL_COMPONENTS[signal_id]
        if signal.get("component_id") != expected_component:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} signal {signal_id} must belong "
                f"to {expected_component}"
            )
        for field in ("threshold", "owner"):
            if not isinstance(signal.get(field), str) or not signal[field].strip():
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} signal {signal_id} needs {field}"
                )
        for field in ("metric_ref", "alert_ref", "replay_or_recovery_ref"):
            validate_worker_operations_path_ref(
                instance_path,
                f"{signal_id}.{field}",
                signal.get(field),
            )

    reviewer = packet.get("reviewer")
    if not isinstance(reviewer, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} reviewer must be an object")
    for field in ("name", "role", "reviewed_at"):
        if not isinstance(reviewer.get(field), str) or not reviewer[field].strip():
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} reviewer needs {field}"
            )
    if REVIEW_DATE_RE.fullmatch(reviewer["reviewed_at"]) is None:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} reviewer reviewed_at must be YYYY-MM-DD"
        )


def validate_restore_automation_evidence_semantics(
    instance_path: Path,
    packet: dict[str, Any],
) -> None:
    if packet.get("artifact_type") != "restore_automation_evidence_packet":
        return

    claim_mode = packet.get("claim_mode")
    if claim_mode not in {"reference_drill", "production_candidate"}:
        raise ContractError(f"{instance_path.relative_to(ROOT)} claim_mode is invalid")
    if RESTORE_AUTOMATION_PRIVATE_TOKEN_RE.search(json.dumps(packet)):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} contains private material markers"
        )

    backup_artifact = packet.get("backup_artifact")
    if not isinstance(backup_artifact, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} backup_artifact must be an object")
    for field in (
        "artifact_id",
        "storage_ref",
        "sha256",
        "created_at",
        "retention_policy",
        "encryption_mode",
    ):
        if not isinstance(backup_artifact.get(field), str) or not backup_artifact[field].strip():
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} backup_artifact needs {field}"
            )
    if SHA256_RE.fullmatch(backup_artifact["sha256"]) is None:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} backup_artifact sha256 is invalid"
        )
    parse_restore_timestamp(instance_path, "backup_artifact.created_at", backup_artifact["created_at"])
    validate_restore_automation_ref(
        instance_path,
        "backup_artifact.storage_ref",
        backup_artifact["storage_ref"],
        production_only=claim_mode == "production_candidate",
    )

    recovery_objective = packet.get("recovery_objective")
    if not isinstance(recovery_objective, dict):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} recovery_objective must be an object"
        )
    for field in ("rpo_minutes", "rto_minutes"):
        if not isinstance(recovery_objective.get(field), int) or recovery_objective[field] < 1:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} recovery_objective {field} must be positive"
            )
    if not isinstance(recovery_objective.get("owner"), str) or not recovery_objective["owner"].strip():
        raise ContractError(f"{instance_path.relative_to(ROOT)} recovery_objective needs owner")
    validate_restore_automation_ref(
        instance_path,
        "recovery_objective.escalation_ref",
        recovery_objective.get("escalation_ref"),
        production_only=claim_mode == "production_candidate",
    )

    guardrails = packet.get("guardrails")
    if not isinstance(guardrails, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} guardrails must be an object")
    for field in (
        "postgres_authoritative",
        "restore_targets_scratch_only",
        "no_secret_material",
        "destructive_restore_requires_operator_approval",
    ):
        if guardrails.get(field) is not True:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} guardrail {field} must be true"
            )

    drills = packet.get("drills")
    if not isinstance(drills, list) or not all(isinstance(drill, dict) for drill in drills):
        raise ContractError(f"{instance_path.relative_to(ROOT)} drills must be objects")
    drill_ids = [drill.get("drill_id") for drill in drills]
    if drill_ids != RESTORE_AUTOMATION_REQUIRED_DRILLS:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} restore drills must use canonical order"
        )

    for drill in drills:
        drill_id = str(drill["drill_id"])
        for field in ("objective", "command_ref", "started_at", "completed_at"):
            if not isinstance(drill.get(field), str) or not drill[field].strip():
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} restore drill {drill_id} needs {field}"
                )
        validate_restore_automation_ref(
            instance_path,
            f"{drill_id}.command_ref",
            drill["command_ref"],
            production_only=False,
        )
        started_at = parse_restore_timestamp(
            instance_path,
            f"{drill_id}.started_at",
            drill["started_at"],
        )
        completed_at = parse_restore_timestamp(
            instance_path,
            f"{drill_id}.completed_at",
            drill["completed_at"],
        )
        if completed_at < started_at:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} restore drill {drill_id} "
                "completed before it started"
            )

        status = drill.get("status")
        if status not in RESTORE_AUTOMATION_STATUSES:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} restore drill {drill_id} status is invalid"
            )
        if status != "passed":
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} restore drill {drill_id} must pass"
            )

        evidence_refs = drill.get("evidence_refs")
        if not isinstance(evidence_refs, list) or not evidence_refs:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} restore drill {drill_id} needs evidence_refs"
            )
        for ref in evidence_refs:
            validate_evidence_ref(instance_path, drill_id, ref)
            validate_restore_automation_ref(
                instance_path,
                f"{drill_id}.evidence_refs",
                ref.get("uri"),
                production_only=claim_mode == "production_candidate",
            )

    validate_packet_reviewer(instance_path, packet.get("reviewer"))


def validate_packaged_deployment_approval_evidence_semantics(
    instance_path: Path,
    packet: dict[str, Any],
) -> None:
    if packet.get("artifact_type") != "packaged_deployment_approval_evidence_packet":
        return

    claim_mode = packet.get("claim_mode")
    if claim_mode not in {"reference_drill", "production_candidate"}:
        raise ContractError(f"{instance_path.relative_to(ROOT)} claim_mode is invalid")
    if PACKAGED_DEPLOYMENT_PRIVATE_TOKEN_RE.search(json.dumps(packet)):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} contains private material markers"
        )
    parse_packaged_deployment_timestamp(
        instance_path,
        "generated_at",
        packet.get("generated_at"),
    )

    deployment_artifact = packet.get("deployment_artifact")
    if not isinstance(deployment_artifact, dict):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} deployment_artifact must be an object"
        )
    for field in ("artifact_id", "version", "artifact_ref", "sha256", "created_at"):
        if (
            not isinstance(deployment_artifact.get(field), str)
            or not deployment_artifact[field].strip()
        ):
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} deployment_artifact needs {field}"
            )
    validate_packaged_deployment_ref(
        instance_path,
        "deployment_artifact.artifact_ref",
        deployment_artifact["artifact_ref"],
        production_only=claim_mode == "production_candidate",
    )
    if SHA256_RE.fullmatch(deployment_artifact["sha256"]) is None:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} deployment_artifact sha256 is invalid"
        )
    parse_packaged_deployment_timestamp(
        instance_path,
        "deployment_artifact.created_at",
        deployment_artifact["created_at"],
    )

    environment = packet.get("environment")
    if not isinstance(environment, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} environment must be an object")
    for field in ("environment_id", "stage", "owner", "boundary_ref"):
        if not isinstance(environment.get(field), str) or not environment[field].strip():
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} environment needs {field}"
            )
    if environment["stage"] not in {
        "reference_lab",
        "staging_candidate",
        "production_candidate",
    }:
        raise ContractError(f"{instance_path.relative_to(ROOT)} environment stage is invalid")
    if claim_mode == "production_candidate" and environment["stage"] != "production_candidate":
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} production candidates must target "
            "production_candidate stage"
        )
    validate_packaged_deployment_ref(
        instance_path,
        "environment.boundary_ref",
        environment["boundary_ref"],
        production_only=claim_mode == "production_candidate",
    )

    guardrails = packet.get("guardrails")
    if not isinstance(guardrails, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} guardrails must be an object")
    for field in (
        "public_repo_contains_no_secrets",
        "operator_controls_remain_external",
        "rollback_plan_required",
        "production_approval_requires_ops_refs",
    ):
        if guardrails.get(field) is not True:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} guardrail {field} must be true"
            )

    gates = packet.get("gates")
    if not isinstance(gates, list) or not all(isinstance(gate, dict) for gate in gates):
        raise ContractError(f"{instance_path.relative_to(ROOT)} gates must be objects")
    gate_ids = [gate.get("gate_id") for gate in gates]
    if gate_ids != PACKAGED_DEPLOYMENT_REQUIRED_GATES:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} packaged deployment gates must use "
            "canonical order"
        )
    for gate in gates:
        gate_id = str(gate["gate_id"])
        status = gate.get("status")
        if status not in PACKAGED_DEPLOYMENT_STATUSES:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} packaged deployment gate "
                f"{gate_id} status is invalid"
            )
        if status != "passed":
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} packaged deployment gate "
                f"{gate_id} must pass"
            )
        for field in ("evidence_ref", "checked_at", "summary"):
            if not isinstance(gate.get(field), str) or not gate[field].strip():
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} packaged deployment gate "
                    f"{gate_id} needs {field}"
                )
        validate_packaged_deployment_ref(
            instance_path,
            f"{gate_id}.evidence_ref",
            gate["evidence_ref"],
            production_only=claim_mode == "production_candidate",
        )
        parse_packaged_deployment_timestamp(
            instance_path,
            f"{gate_id}.checked_at",
            gate["checked_at"],
        )

    approvals = packet.get("approvals")
    if (
        not isinstance(approvals, list)
        or not all(isinstance(approval, dict) for approval in approvals)
    ):
        raise ContractError(f"{instance_path.relative_to(ROOT)} approvals must be objects")
    roles = [approval.get("role") for approval in approvals]
    if roles != PACKAGED_DEPLOYMENT_REQUIRED_APPROVAL_ROLES:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} packaged deployment approvals must use "
            "canonical role order"
        )
    for approval in approvals:
        role = str(approval["role"])
        decision = approval.get("decision")
        if decision not in PACKAGED_DEPLOYMENT_DECISIONS:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} packaged deployment approval "
                f"{role} decision is invalid"
            )
        if decision != "approved":
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} packaged deployment approval "
                f"{role} must be approved"
            )
        for field in ("approver", "approval_ref", "approved_at", "scope"):
            if not isinstance(approval.get(field), str) or not approval[field].strip():
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} packaged deployment approval "
                    f"{role} needs {field}"
                )
        validate_packaged_deployment_ref(
            instance_path,
            f"{role}.approval_ref",
            approval["approval_ref"],
            production_only=claim_mode == "production_candidate",
        )
        parse_packaged_deployment_timestamp(
            instance_path,
            f"{role}.approved_at",
            approval["approved_at"],
        )

    rollback_plan = packet.get("rollback_plan")
    if not isinstance(rollback_plan, dict):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} rollback_plan must be an object"
        )
    for field in ("plan_ref", "rehearsal_ref", "owner", "accepted_at"):
        if not isinstance(rollback_plan.get(field), str) or not rollback_plan[field].strip():
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} rollback_plan needs {field}"
            )
    validate_packaged_deployment_ref(
        instance_path,
        "rollback_plan.plan_ref",
        rollback_plan["plan_ref"],
        production_only=claim_mode == "production_candidate",
    )
    validate_packaged_deployment_ref(
        instance_path,
        "rollback_plan.rehearsal_ref",
        rollback_plan["rehearsal_ref"],
        production_only=claim_mode == "production_candidate",
    )
    parse_packaged_deployment_timestamp(
        instance_path,
        "rollback_plan.accepted_at",
        rollback_plan["accepted_at"],
    )

    validate_packet_reviewer(instance_path, packet.get("reviewer"))


def validate_operator_evidence_index_semantics(
    instance_path: Path,
    index: dict[str, Any],
) -> None:
    if index.get("artifact_type") != "operator_evidence_index":
        return

    claim_mode = index.get("claim_mode")
    if claim_mode not in {"reference_drill", "production_candidate"}:
        raise ContractError(f"{instance_path.relative_to(ROOT)} claim_mode is invalid")
    parse_operator_evidence_timestamp(
        instance_path,
        "generated_at",
        index.get("generated_at"),
    )

    guardrails = index.get("guardrails")
    if not isinstance(guardrails, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} guardrails must be an object")
    for field in (
        "public_repo_contains_no_secrets",
        "evidence_refs_required_for_pass",
        "production_requires_ops_refs",
        "operator_controls_remain_external",
    ):
        if guardrails.get(field) is not True:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} guardrail {field} must be true"
            )

    controls = index.get("controls")
    if not isinstance(controls, list) or not all(
        isinstance(control, dict) for control in controls
    ):
        raise ContractError(f"{instance_path.relative_to(ROOT)} controls must be objects")
    control_ids = [control.get("control_id") for control in controls]
    if control_ids != OPERATOR_EVIDENCE_CONTROL_IDS:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} operator evidence controls must use "
            "canonical order"
        )

    for control in controls:
        control_id = str(control["control_id"])
        layer = control.get("layer")
        status = control.get("status")
        if layer not in OPERATOR_EVIDENCE_LAYERS:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} operator evidence control "
                f"{control_id} layer is invalid"
            )
        if status not in OPERATOR_EVIDENCE_STATUSES:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} operator evidence control "
                f"{control_id} status is invalid"
            )
        if claim_mode == "production_candidate" and status != "operator_backed":
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} production operator evidence "
                f"control {control_id} must be operator_backed"
            )
        for field in ("owner", "summary"):
            if not isinstance(control.get(field), str) or not control[field].strip():
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} operator evidence control "
                    f"{control_id} needs {field}"
                )

        refs = control.get("evidence_refs")
        if not isinstance(refs, list) or not refs or not all(
            isinstance(ref, dict) for ref in refs
        ):
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} operator evidence control "
                f"{control_id} needs evidence_refs"
            )
        for ref in refs:
            for field in ("label", "uri", "owner", "reviewed_at"):
                if not isinstance(ref.get(field), str) or not ref[field].strip():
                    raise ContractError(
                        f"{instance_path.relative_to(ROOT)} operator evidence ref "
                        f"for {control_id} needs {field}"
                    )
            review_role = ref.get("review_role")
            if claim_mode == "production_candidate":
                if not isinstance(review_role, str) or not review_role.strip():
                    raise ContractError(
                        f"{instance_path.relative_to(ROOT)} production operator evidence "
                        f"ref for {control_id} needs review_role"
                    )
                if review_role not in PRODUCTION_EVIDENCE_REVIEW_ROLES:
                    raise ContractError(
                        f"{instance_path.relative_to(ROOT)} production operator evidence "
                        f"ref for {control_id} has unsupported review_role"
                    )
            elif review_role is not None and review_role not in PRODUCTION_EVIDENCE_REVIEW_ROLES:
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} operator evidence ref for "
                    f"{control_id} has unsupported review_role"
                )
            validate_operator_evidence_ref(
                instance_path,
                f"{control_id}.evidence_refs.uri",
                ref["uri"],
                production_only=claim_mode == "production_candidate",
            )
            if REVIEW_DATE_RE.fullmatch(ref["reviewed_at"]) is None:
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} operator evidence ref for "
                    f"{control_id} reviewed_at must be YYYY-MM-DD"
                )

    validate_packet_reviewer(instance_path, index.get("reviewer"))


def validate_production_evidence_requirements_semantics(
    instance_path: Path,
    requirements: dict[str, Any],
) -> None:
    if requirements.get("artifact_type") != "production_evidence_requirements":
        return

    if PRODUCTION_EVIDENCE_PRIVATE_TOKEN_RE.search(json.dumps(requirements)):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} contains private material markers"
        )
    parse_operator_evidence_timestamp(
        instance_path,
        "generated_at",
        requirements.get("generated_at"),
    )

    scope = requirements.get("scope")
    if not isinstance(scope, dict):
        raise ContractError(f"{instance_path.relative_to(ROOT)} scope must be an object")
    if scope.get("claim_mode") != "production_candidate":
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} claim_mode must be production_candidate"
        )
    for field in ("root_program_id", "environment", "boundary"):
        if not isinstance(scope.get(field), str) or not scope[field].strip():
            raise ContractError(f"{instance_path.relative_to(ROOT)} scope needs {field}")

    guardrails = requirements.get("guardrails")
    if not isinstance(guardrails, dict):
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} guardrails must be an object"
        )
    for field in (
        "requirements_are_not_evidence",
        "public_repo_contains_no_operator_secrets",
        "production_claim_requires_ops_refs",
        "operators_own_evidence_storage",
    ):
        if guardrails.get(field) is not True:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} guardrail {field} must be true"
            )

    controls = requirements.get("controls")
    if not isinstance(controls, list) or not all(
        isinstance(control, dict) for control in controls
    ):
        raise ContractError(f"{instance_path.relative_to(ROOT)} controls must be objects")
    control_ids = [control.get("control_id") for control in controls]
    if control_ids != OPERATOR_EVIDENCE_CONTROL_IDS:
        raise ContractError(
            f"{instance_path.relative_to(ROOT)} production evidence controls must use "
            "canonical order"
        )

    for control in controls:
        control_id = str(control["control_id"])
        layer = control.get("layer")
        if layer not in OPERATOR_EVIDENCE_LAYERS:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} production evidence control "
                f"{control_id} layer is invalid"
            )
        if control.get("required_ref_scheme") != PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} production evidence control "
                f"{control_id} must require ops://qrtrust/ refs"
            )
        if control.get("minimum_review_role") not in PRODUCTION_EVIDENCE_REVIEW_ROLES:
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} production evidence control "
                f"{control_id} minimum_review_role is invalid"
            )
        minimum_refs = control.get("minimum_refs")
        if (
            not isinstance(minimum_refs, int)
            or isinstance(minimum_refs, bool)
            or minimum_refs < 1
        ):
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} production evidence control "
                f"{control_id} minimum_refs must be at least 1"
            )
        for field in ("title", "evidence_owner", "retention_policy", "why_required"):
            if not isinstance(control.get(field), str) or not control[field].strip():
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} production evidence control "
                    f"{control_id} needs {field}"
                )
        artifacts = control.get("required_artifacts")
        if not isinstance(artifacts, list) or not artifacts or not all(
            isinstance(artifact, str) and artifact.strip() for artifact in artifacts
        ):
            raise ContractError(
                f"{instance_path.relative_to(ROOT)} production evidence control "
                f"{control_id} needs required_artifacts"
            )
        for artifact in artifacts:
            if PRODUCTION_EVIDENCE_REF_LIKE_TOKEN_RE.search(artifact):
                raise ContractError(
                    f"{instance_path.relative_to(ROOT)} production evidence control "
                    f"{control_id} required_artifacts must describe classes, not refs"
                )

    validate_packet_reviewer(instance_path, requirements.get("reviewer"))


def parse_restore_timestamp(path: Path, field: str, value: Any) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{path.relative_to(ROOT)} {field} must be a timestamp")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError(
            f"{path.relative_to(ROOT)} {field} must be an ISO timestamp"
        ) from exc


def parse_packaged_deployment_timestamp(path: Path, field: str, value: Any) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(
            f"{path.relative_to(ROOT)} packaged deployment {field} must be a timestamp"
        )
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError(
            f"{path.relative_to(ROOT)} packaged deployment {field} must be an ISO timestamp"
        ) from exc


def parse_operator_evidence_timestamp(path: Path, field: str, value: Any) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(
            f"{path.relative_to(ROOT)} operator evidence {field} must be a timestamp"
        )
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError(
            f"{path.relative_to(ROOT)} operator evidence {field} must be an ISO timestamp"
        ) from exc


def validate_packaged_deployment_ref(
    path: Path,
    field: str,
    ref: Any,
    *,
    production_only: bool,
) -> None:
    if not isinstance(ref, str) or not ref.strip() or ".." in ref:
        raise ContractError(
            f"{path.relative_to(ROOT)} packaged deployment ref {field} must be non-empty"
        )
    if PACKAGED_DEPLOYMENT_REF_RE.match(ref) is None:
        raise ContractError(
            f"{path.relative_to(ROOT)} packaged deployment ref {field} must stay under "
            "docs/public/, network/, or ops://qrtrust/"
        )
    if production_only and not ref.startswith("ops://qrtrust/"):
        raise ContractError(
            f"{path.relative_to(ROOT)} production packaged deployment ref {field} "
            "must use ops://qrtrust/"
        )


def validate_operator_evidence_ref(
    path: Path,
    field: str,
    ref: Any,
    *,
    production_only: bool,
) -> None:
    if not isinstance(ref, str) or not ref.strip() or ".." in ref:
        raise ContractError(
            f"{path.relative_to(ROOT)} operator evidence ref {field} must be non-empty"
        )
    if OPERATOR_EVIDENCE_REF_RE.match(ref) is None:
        raise ContractError(
            f"{path.relative_to(ROOT)} operator evidence ref {field} must stay under "
            "docs/public/, network/, or ops://qrtrust/"
        )
    if OPERATOR_EVIDENCE_PRIVATE_TOKEN_RE.search(ref):
        raise ContractError(
            f"{path.relative_to(ROOT)} operator evidence ref {field} contains "
            "private material markers"
        )
    if production_only and not ref.startswith("ops://qrtrust/"):
        raise ContractError(
            f"{path.relative_to(ROOT)} production operator evidence ref {field} "
            "must use ops://qrtrust/"
        )


def validate_restore_automation_ref(
    path: Path,
    field: str,
    ref: Any,
    *,
    production_only: bool,
) -> None:
    if not isinstance(ref, str) or not ref.strip() or ".." in ref:
        raise ContractError(
            f"{path.relative_to(ROOT)} restore automation ref {field} must be non-empty"
        )
    if RESTORE_AUTOMATION_REF_RE.match(ref) is None:
        raise ContractError(
            f"{path.relative_to(ROOT)} restore automation ref {field} must stay under "
            "docs/public/, network/, or ops://qrtrust/"
        )
    if production_only and not ref.startswith("ops://qrtrust/"):
        raise ContractError(
            f"{path.relative_to(ROOT)} production restore automation ref {field} "
            "must use ops://qrtrust/"
        )


def validate_packet_reviewer(path: Path, reviewer: Any) -> None:
    if not isinstance(reviewer, dict):
        raise ContractError(f"{path.relative_to(ROOT)} reviewer must be an object")
    for field in ("name", "role", "reviewed_at"):
        if not isinstance(reviewer.get(field), str) or not reviewer[field].strip():
            raise ContractError(f"{path.relative_to(ROOT)} reviewer needs {field}")
    if REVIEW_DATE_RE.fullmatch(reviewer["reviewed_at"]) is None:
        raise ContractError(
            f"{path.relative_to(ROOT)} reviewer reviewed_at must be YYYY-MM-DD"
        )


def validate_worker_operations_path_ref(path: Path, field: str, ref: Any) -> None:
    if not isinstance(ref, str) or not ref.strip() or ".." in ref:
        raise ContractError(
            f"{path.relative_to(ROOT)} worker operations ref {field} must be non-empty"
        )
    if WORKER_OPERATIONS_REF_RE.match(ref) is None:
        raise ContractError(
            f"{path.relative_to(ROOT)} worker operations ref {field} must stay under "
            "docs/public/ or network/"
        )


def is_non_empty_string_list(value: Any) -> bool:
    return isinstance(value, list) and bool(value) and all(
        isinstance(item, str) and item.strip() for item in value
    )


def main() -> int:
    schema_paths = sorted(CONTRACT_DIR.glob("*.schema.json"))
    if len(schema_paths) < 9:
        raise ContractError(
            f"expected at least 9 network contract schemas, found {len(schema_paths)}"
        )

    schemas = {path.name: load_json(path) for path in schema_paths}
    for path in schema_paths:
        validate_schema_shape(path, schemas[path.name])

    checked_instances = 0
    for schema_name, fixture_names in SCHEMA_FIXTURE_MAP.items():
        schema_path = CONTRACT_DIR / schema_name
        if isinstance(fixture_names, str):
            fixture_names = [fixture_names]
        for fixture_name in fixture_names:
            fixture_path = FIXTURE_DIR / fixture_name
            instance = load_json(fixture_path)
            validate_required_fields(
                schema_path,
                schemas[schema_name],
                fixture_path,
                instance,
            )
            checked_instances += 1

    for schema_name, example_names in SCHEMA_EXAMPLE_MAP.items():
        schema_path = CONTRACT_DIR / schema_name
        for example_name in example_names:
            example_path = EXAMPLE_DIR / example_name
            instance = load_json(example_path)
            validate_required_fields(schema_path, schemas[schema_name], example_path, instance)
            validate_deployment_readiness_semantics(example_path, instance)
            validate_deployment_readiness_bundle_semantics(example_path, instance)
            validate_verifier_profile_semantics(example_path, instance)
            validate_scanner_fleet_evidence_semantics(example_path, instance)
            validate_ios_provider_profile_evidence_semantics(example_path, instance)
            validate_cross_surface_qr_evidence_semantics(example_path, instance)
            validate_reference_network_adoption_stage_semantics(example_path, instance)
            validate_signing_custody_audit_export_semantics(example_path, instance)
            validate_worker_operations_evidence_semantics(example_path, instance)
            validate_restore_automation_evidence_semantics(example_path, instance)
            validate_packaged_deployment_approval_evidence_semantics(
                example_path,
                instance,
            )
            validate_operator_evidence_index_semantics(example_path, instance)
            validate_production_evidence_requirements_semantics(example_path, instance)
            checked_instances += 1

    validate_reference_sql()
    validate_markdown_contracts()
    validate_auxiliary_contract_files()
    validate_deployment_readiness_evidence_map()
    validate_reference_network_adoption_evidence_map()

    print(f"PASS: parsed {len(schema_paths)} network contract schemas")
    print(
        "PASS: smoke-validated "
        f"{checked_instances} fixtures/examples against top-level contract requirements"
    )
    print(f"PASS: found {len(EXPECTED_SQL_TABLES)} reference Postgres tables")
    print(f"PASS: found {len(EXPECTED_MARKDOWN_DOCS)} markdown network contracts")
    print(f"PASS: found {len(EXPECTED_AUXILIARY_CONTRACT_FILES)} auxiliary contract files")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ContractError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
