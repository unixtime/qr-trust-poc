from __future__ import annotations

from pathlib import Path


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
    / "20260525_0001_qr_trust_management_plane.py"
)
REFERENCE_SCHEMA_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
    / "20260525_0002_qr_trust_reference_schema.py"
)
OUTBOX_REMEDIATION_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
    / "20260525_0003_outbox_quarantine_status.py"
)
ASSURANCE_STATUS_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
    / "20260525_0004_assurance_status_artifacts.py"
)
MANAGEMENT_OUTBOX_ENVELOPE_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
    / "20260525_0005_management_outbox_envelopes.py"
)
CONTROL_PLANE_OUTBOX_ROOT_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
    / "20260525_0006_control_plane_outbox_root.py"
)
MAKEFILE_PATH = Path(__file__).resolve().parents[2] / "Makefile"
REFERENCE_SCHEMA_SQL_PATH = (
    Path(__file__).resolve().parents[2]
    / "docs"
    / "public"
    / "network-contracts"
    / "reference-postgres-schema.sql"
)


def test_management_plane_migration_declares_required_tables() -> None:
    migration = MIGRATION_PATH.read_text(encoding="utf-8")

    required_fragments = [
        "create schema if not exists qr_trust",
        "create table if not exists qr_trust.operators",
        "create table if not exists qr_trust.operator_role_assignments",
        "create table if not exists qr_trust.management_api_keys",
        "create table if not exists qr_trust.idempotency_keys",
        "create table if not exists qr_trust.governance_audit_log",
        "create table if not exists qr_trust.runtime_safety_providers",
        "create table if not exists qr_trust.nats_subscribers",
        "create table if not exists qr_trust.nats_subscriber_subjects",
        "alter table if exists qr_trust.root_programs",
        "alter table if exists qr_trust.issuers",
        "alter table if exists qr_trust.destination_policies",
    ]

    for fragment in required_fragments:
        assert fragment in migration


def test_makefile_uses_backend_alembic_as_shared_infra_migration_owner() -> None:
    makefile = MAKEFILE_PATH.read_text(encoding="utf-8")

    assert "apply-backend-migrations:" in makefile
    assert "check-backend-migrations:" in makefile

    apply_backend_body = _make_target_body(makefile, "apply-backend-migrations")
    assert "./.venv/bin/alembic -c alembic.ini upgrade head" in apply_backend_body
    assert "DB_HOST='$(EXTERNAL_DB_SETUP_HOST)'" in apply_backend_body

    apply_network_body = _make_target_body(makefile, "apply-network-migrations")
    assert "$(MAKE) apply-backend-migrations" in apply_network_body
    assert "npm run postgres:apply-migrations" not in apply_network_body

    retry_body = _make_target_body(makefile, "check-network-live-outbox-retry")
    assert "npm run event-outbox:live-retry-drill" in retry_body
    assert "$(MAKE) apply-backend-migrations" in retry_body


def _make_target_body(makefile: str, target: str) -> str:
    target_start = makefile.index(f"{target}:")
    target_end = makefile.find("\n\n", target_start)
    if target_end == -1:
        target_end = len(makefile)
    return makefile[target_start:target_end]


def test_outbox_remediation_migration_adds_quarantine_status() -> None:
    migration = OUTBOX_REMEDIATION_MIGRATION_PATH.read_text(encoding="utf-8")

    required_fragments = [
        'down_revision: Union[str, None] = "20260525_0002"',
        "drop constraint if exists event_outbox_publish_status_check",
        "add constraint event_outbox_publish_status_check",
        "'quarantined'",
    ]

    for fragment in required_fragments:
        assert fragment in migration


def test_assurance_status_migration_allows_assurance_artifacts() -> None:
    migration = ASSURANCE_STATUS_MIGRATION_PATH.read_text(encoding="utf-8")

    required_fragments = [
        'down_revision: Union[str, None] = "20260525_0003"',
        "drop constraint if exists published_artifacts_artifact_type_check",
        "drop constraint if exists artifact_publication_work_items_artifact_type_check",
        "'assurance_status_event'",
    ]

    for fragment in required_fragments:
        assert fragment in migration


def test_management_outbox_envelope_migration_repairs_legacy_payloads() -> None:
    migration = MANAGEMENT_OUTBOX_ENVELOPE_MIGRATION_PATH.read_text(encoding="utf-8")

    required_fragments = [
        'down_revision: Union[str, None] = "20260525_0004"',
        "jsonb_build_object(",
        "'envelope'",
        "'body'",
        "Outbox payload must contain an event envelope.",
        "then 'pending'",
        "and not (payload ? 'envelope')",
    ]

    for fragment in required_fragments:
        assert fragment in migration


def test_control_plane_outbox_root_migration_repairs_rootless_payloads() -> None:
    migration = CONTROL_PLANE_OUTBOX_ROOT_MIGRATION_PATH.read_text(encoding="utf-8")

    required_fragments = [
        'down_revision: Union[str, None] = "20260525_0005"',
        "jsonb_set(",
        "'{envelope,root_program_id}'",
        "'\"control-plane\"'::jsonb",
        "root_program_id is null",
        "runtime_provider.upserted",
        "nats.subscriber.authorization.changed",
        "root:qrtrust-demo:2026",
    ]

    for fragment in required_fragments:
        assert fragment in migration


def test_reference_schema_allows_assurance_status_artifacts() -> None:
    reference_schema = REFERENCE_SCHEMA_SQL_PATH.read_text(encoding="utf-8")

    assert reference_schema.count("'assurance_status_event'") >= 2


def test_reference_schema_migration_declares_required_qr_trust_tables() -> None:
    migration = REFERENCE_SCHEMA_MIGRATION_PATH.read_text(encoding="utf-8")

    required_fragments = [
        "down_revision: Union[str, None] = \"20260525_0001\"",
        "create table if not exists qr_trust.root_programs",
        "create table if not exists qr_trust.delegated_authorities",
        "create table if not exists qr_trust.trust_keys",
        "create table if not exists qr_trust.issuers",
        "create table if not exists qr_trust.issuer_domain_proofs",
        "create table if not exists qr_trust.issuer_certificates",
        "create table if not exists qr_trust.destination_policies",
        "create table if not exists qr_trust.published_artifacts",
        "create table if not exists qr_trust.artifact_publication_work_items",
        "create table if not exists qr_trust.status_events",
        "create table if not exists qr_trust.verifier_cache_work_items",
        "create table if not exists qr_trust.verifier_cache_entries",
        "create table if not exists qr_trust.runtime_observations",
        "create table if not exists qr_trust.scanner_decisions",
        "create table if not exists qr_trust.event_outbox",
        "add column if not exists version bigint not null default 1",
        "references qr_trust.operators(operator_id)",
    ]

    for fragment in required_fragments:
        assert fragment in migration
