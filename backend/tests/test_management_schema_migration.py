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
SCAN_ACTIVITY_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
    / "20260825_0007_scanner_decision_scan_activity.py"
)
ENVELOPE_FINGERPRINT_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
    / "20260826_0008_envelope_fingerprint.py"
)
REFERENCE_SCHEMA_DOC_PATH = (
    Path(__file__).resolve().parents[2]
    / "docs"
    / "public"
    / "network-contracts"
    / "reference-postgres-schema.sql"
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


def test_scan_activity_migration_adds_nonce_fingerprint_columns() -> None:
    body = SCAN_ACTIVITY_MIGRATION_PATH.read_text(encoding="utf-8")

    assert 'down_revision: Union[str, None] = "20260525_0006"' in body
    assert "add column if not exists nonce_fingerprint text" in body
    assert "add column if not exists client_platform text" in body
    assert "scanner_decisions_nonce_created_idx" in body
    assert "(nonce_fingerprint, created_at desc)" in body


def test_envelope_fingerprint_migration_renames_column_and_index() -> None:
    body = ENVELOPE_FINGERPRINT_MIGRATION_PATH.read_text(encoding="utf-8")
    reference_body = REFERENCE_SCHEMA_DOC_PATH.read_text(encoding="utf-8")

    assert 'revision: str = "20260826_0008"' in body
    assert 'down_revision: Union[str, None] = "20260825_0007"' in body
    assert "rename column nonce_fingerprint to envelope_fingerprint" in body
    assert "rename to scanner_decisions_envelope_created_idx" in body
    assert "rename column envelope_fingerprint to nonce_fingerprint" in body
    # The docstring records why usage_policy is intentionally left in place.
    assert "usage_policy" in body
    assert "intentionally" in body

    # The public reference DDL must describe the same rename: envelope_fingerprint
    # replaces nonce_fingerprint everywhere in the scanner_decisions table.
    assert "envelope_fingerprint text" in reference_body
    assert "scanner_decisions_envelope_created_idx" in reference_body
    assert "client_platform text" in reference_body
    scanner_decisions_block = reference_body.split(
        "create table if not exists qr_trust.scanner_decisions"
    )[1].split("create table if not exists qr_trust.event_outbox")[0]
    assert "nonce" not in scanner_decisions_block


_MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations" / "versions"


def _read_migration_0009() -> str:
    matches = sorted(_MIGRATIONS_DIR.glob("20260901_0009_*.py"))
    assert len(matches) == 1, f"expected exactly one 0009 migration, found {matches}"
    return matches[0].read_text(encoding="utf-8")


def test_migration_0009_chains_from_0008():
    text = _read_migration_0009()
    assert 'revision: str = "20260901_0009"' in text
    assert '"20260826_0008"' in text


def test_migration_0009_creates_and_seeds_governance_versions():
    text = _read_migration_0009()
    assert "create table qr_trust.governance_versions" in text
    assert "epoch uuid not null default gen_random_uuid()" in text
    assert "version bigint not null default 1" in text
    assert (
        "insert into qr_trust.governance_versions (name) values ('trust_state')"
        in text
    )


def test_migration_0009_installs_terminal_revocation_triggers():
    text = _read_migration_0009()
    assert "enforce_terminal_key_status" in text
    assert "issuer_certificates_terminal_status" in text
    assert "trust_keys_terminal_status" in text
    assert "revocation is terminal" in text


def test_migration_0009_adds_projection_columns():
    text = _read_migration_0009()
    for needle in (
        "public_key_material_pem text",
        "revoked_at timestamptz",
        "revocation_reason text",
        "not_after drop not null",
        "allow_subdomains boolean not null default false",
        "expires_at timestamptz",
        "operator_type text not null default 'person'",
        "root_program_id text",
        "delegated_authority_id text",
    ):
        assert needle in text, f"missing {needle!r}"


def test_reference_schema_lists_governance_versions():
    schema_path = (
        Path(__file__).resolve().parents[2]
        / "docs/public/network-contracts/reference-postgres-schema.sql"
    )
    text = schema_path.read_text(encoding="utf-8")
    assert "governance_versions" in text
    assert "public_key_material_pem" in text
    assert "allow_subdomains" in text


def test_reference_schema_installs_terminal_revocation_triggers():
    schema_path = (
        Path(__file__).resolve().parents[2]
        / "docs/public/network-contracts/reference-postgres-schema.sql"
    )
    text = schema_path.read_text(encoding="utf-8")

    assert "create or replace function qr_trust.enforce_terminal_key_status()" in text
    assert "create trigger issuer_certificates_terminal_status" in text
    assert "create trigger trust_keys_terminal_status" in text
    assert "revocation is terminal" in text
