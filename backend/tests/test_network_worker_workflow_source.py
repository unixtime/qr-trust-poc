from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_governance_subscriber_worker_is_operable_from_makefile_and_docs() -> None:
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
    compose_nats = (REPO_ROOT / "compose.nats.yml").read_text(encoding="utf-8")
    run_guide = (REPO_ROOT / "docs" / "public" / "RUN_GUIDE.md").read_text(
        encoding="utf-8"
    )

    assert "up-network-governance-subscriber-worker" in makefile
    assert "logs-network-governance-subscriber-worker" in makefile
    assert "QRTRUST_GOVERNANCE_SUBSCRIBER_ID" in makefile
    assert "QRTRUST_GOVERNANCE_SUBSCRIBER_ID" in compose_nats
    assert "make up-network-governance-subscriber-worker" in run_guide
    assert "make logs-network-governance-subscriber-worker" in run_guide


def test_runtime_subscriber_worker_is_operable_from_makefile_and_docs() -> None:
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
    compose_nats = (REPO_ROOT / "compose.nats.yml").read_text(encoding="utf-8")
    run_guide = (REPO_ROOT / "docs" / "public" / "RUN_GUIDE.md").read_text(
        encoding="utf-8"
    )
    package_json = (REPO_ROOT / "network" / "package.json").read_text(
        encoding="utf-8"
    )

    assert '"runtime:subscriber"' in package_json
    assert "up-network-runtime-subscriber-worker" in makefile
    assert "logs-network-runtime-subscriber-worker" in makefile
    assert "QRTRUST_RUNTIME_SUBSCRIBER_ID" in makefile
    assert "QRTRUST_RUNTIME_SUBSCRIBER_ID" in compose_nats
    assert "make up-network-runtime-subscriber-worker" in run_guide
    assert "make logs-network-runtime-subscriber-worker" in run_guide


def test_event_outbox_retry_drill_is_operable_from_makefile_and_package() -> None:
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
    package_json = (REPO_ROOT / "network" / "package.json").read_text(
        encoding="utf-8"
    )
    run_guide = (REPO_ROOT / "docs" / "public" / "RUN_GUIDE.md").read_text(
        encoding="utf-8"
    )
    drill_source = (
        REPO_ROOT
        / "network"
        / "src"
        / "programs"
        / "event-outbox-live-retry-drill.ts"
    ).read_text(encoding="utf-8")

    assert '"event-outbox:live-retry-drill"' in package_json
    assert "check-network-live-outbox-retry" in makefile
    assert "npm run event-outbox:live-retry-drill" in makefile
    assert "make check-network-live-outbox-retry" in run_guide
    assert "simulated_broker_outage_report" in drill_source
    assert "recovery_worker_report" in drill_source
    assert "outbox_status_after_failure" in drill_source
    assert "outbox_status_after_recovery" in drill_source


def test_subscriber_workers_constrain_db_subjects_to_their_streams() -> None:
    governance_source = (
        REPO_ROOT
        / "network"
        / "src"
        / "programs"
        / "governance-subscriber-worker-runtime.ts"
    ).read_text(encoding="utf-8")
    runtime_source = (
        REPO_ROOT
        / "network"
        / "src"
        / "programs"
        / "runtime-subscriber-worker-runtime.ts"
    ).read_text(encoding="utf-8")

    assert "natsSubscriberMaterializationSubjectsForStream" in governance_source
    assert '"QRTRUST_GOVERNANCE"' in governance_source
    assert "outside the governance stream" in governance_source
    assert "natsSubscriberMaterializationSubjectsForStream" in runtime_source
    assert '"QRTRUST_RUNTIME"' in runtime_source
    assert "outside the runtime stream" in runtime_source


def test_nats_worker_compose_defaults_match_local_stack_and_shared_infra_overrides() -> None:
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
    compose_nats = (REPO_ROOT / "compose.nats.yml").read_text(encoding="utf-8")
    compose_shared_infra = (REPO_ROOT / "compose.shared-infra.yml").read_text(
        encoding="utf-8"
    )

    assert "compose.yml -f compose.nats.yml -f compose.shared-infra.yml" in makefile
    assert (
        "${QRTRUST_NETWORK_DATABASE_URL:-postgresql://qr_admin:qr_dev_password@postgres:5432/qr_db}"
        in compose_nats
    )
    assert (
        "network-governance-subscriber-worker:\n"
        "    extra_hosts:\n"
        '      - "host.docker.internal:host-gateway"'
    ) in compose_shared_infra
    assert (
        "network-runtime-subscriber-worker:\n"
        "    extra_hosts:\n"
        '      - "host.docker.internal:host-gateway"'
    ) in compose_shared_infra
    # The whole DSN, not just its user prefix: every default in it is part of
    # the contract. These used to be publisher/publisher/qr_trust_poc, which
    # aimed the workers at the research-publisher role on a host Postgres this
    # project no longer runs. The stack owns its database now, so an unset
    # EXTERNAL_DB_* has to land on the same credentials compose.nats.yml
    # defaults to above; the host is the only thing this override file changes,
    # which is the entire reason it exists.
    assert (
        "QRTRUST_NETWORK_DATABASE_URL: postgres://"
        "${EXTERNAL_DB_USER:-qr_admin}:${EXTERNAL_DB_PASSWORD:-qr_dev_password}"
        "@${EXTERNAL_DB_HOST:-host.docker.internal}:${EXTERNAL_DB_PORT:-5432}"
        "/${EXTERNAL_DB_NAME:-qr_db}"
    ) in compose_shared_infra
    # publisher is another project's role, and reaching it from here is what
    # made the shared-infra bring-up fail authentication. Nothing in this file
    # should name it again, in a default or anywhere else.
    assert "publisher" not in compose_shared_infra


def test_runtime_subscriber_worker_uses_db_authorized_durable_name() -> None:
    runtime_source = (
        REPO_ROOT
        / "network"
        / "src"
        / "programs"
        / "runtime-subscriber-worker-runtime.ts"
    ).read_text(encoding="utf-8")

    assert (
        "const effectiveDurableName = subscriberAuthorization.durable_name"
        in runtime_source
    )
    assert "durable_name: effectiveDurableName" in runtime_source


def test_nats_worker_compose_uses_service_specific_credentials() -> None:
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
    compose_nats = (REPO_ROOT / "compose.nats.yml").read_text(encoding="utf-8")

    assert "${QRTRUST_NETWORK_NATS_USER:-" not in compose_nats
    assert "${QRTRUST_NETWORK_NATS_PASSWORD:-" not in compose_nats
    assert "QRTRUST_OUTBOX_NATS_USER" in makefile
    assert "QRTRUST_OUTBOX_NATS_PASSWORD" in makefile
    assert "QRTRUST_OUTBOX_NATS_USER" in compose_nats
    assert "QRTRUST_OUTBOX_NATS_PASSWORD" in compose_nats
    assert "QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_USER" in compose_nats
    assert "QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_PASSWORD" in compose_nats
    assert "QRTRUST_RUNTIME_SUBSCRIBER_NATS_USER" in compose_nats
    assert "QRTRUST_RUNTIME_SUBSCRIBER_NATS_PASSWORD" in compose_nats


def test_local_admin_make_targets_explicitly_enable_bootstrap_tokens() -> None:
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
    admin_targets = [
        "up-admin",
        "up-lan-admin",
        "up-https-admin",
        "up-https-admin-shared-infra",
        "up-https-admin-shared-infra-nats",
    ]

    for target in admin_targets:
        target_start = makefile.index(f"{target}:")
        target_end = makefile.find("\n\n", target_start)
        target_body = makefile[target_start:target_end]

        assert "VERIFIER_ADMIN_TOKENS=" in target_body
        assert "VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED='true'" in target_body


def test_shared_infra_nats_admin_stack_starts_all_network_workers() -> None:
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")

    target_start = makefile.index("up-https-admin-shared-infra-nats:")
    target_end = makefile.index("\ndown:", target_start)
    target_body = makefile[target_start:target_end]

    assert "QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_USER" in target_body
    assert "QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_PASSWORD" in target_body
    assert "QRTRUST_RUNTIME_SUBSCRIBER_NATS_USER" in target_body
    assert "QRTRUST_RUNTIME_SUBSCRIBER_NATS_PASSWORD" in target_body
    assert "QRTRUST_GOVERNANCE_SUBSCRIBER_ID" in target_body
    assert "QRTRUST_RUNTIME_SUBSCRIBER_ID" in target_body
    assert (
        "api frontend nats network-outbox-worker "
        "network-governance-subscriber-worker network-runtime-subscriber-worker"
    ) in target_body


def test_https_stack_defaults_to_lab_frontend_port() -> None:
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
    smoke_body = _make_target_body(makefile, "smoke-compose-https")

    assert "HTTPS_FRONTEND_PUBLISH_PORT ?= 8443" in makefile
    assert "FRONTEND_PUBLISH_PORT='$(HTTPS_FRONTEND_PUBLISH_PORT)'" in smoke_body
    assert (
        "FRONTEND_PUBLIC_URL='https://127.0.0.1:$(HTTPS_FRONTEND_PUBLISH_PORT)'"
        in smoke_body
    )


def _make_target_body(makefile: str, target: str) -> str:
    target_start = makefile.index(f"{target}:")
    target_end = makefile.find("\n\n", target_start)
    if target_end == -1:
        target_end = len(makefile)
    return makefile[target_start:target_end]


def test_live_reset_targets_explicitly_opt_into_non_production_reference_seed() -> None:
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
    reset_targets = [
        "check-network-live-postgres",
        "check-network-live-outbox-metrics",
        "check-network-live-outbox-worker",
        "check-network-live-authority-outbox",
        "check-network-live-outbox-retry",
        "check-network-live-verifier-cache",
        "check-network-live-scanner-decision",
    ]

    for target in reset_targets:
        target_start = makefile.index(f"{target}:")
        target_end = makefile.find("\n\n", target_start)
        target_body = makefile[target_start:target_end]

        assert "QRTRUST_NETWORK_DATABASE_URL=" in target_body
        assert "QRTRUST_NETWORK_LIVE_SMOKE_RESET=true" in target_body
        assert "QRTRUST_ALLOW_NON_PRODUCTION_REFERENCE_SEED=true" in target_body
        assert "$(MAKE) apply-backend-migrations" in target_body


def test_live_outbox_metrics_smoke_requires_non_production_seed_opt_in() -> None:
    smoke_source = (
        REPO_ROOT
        / "network"
        / "src"
        / "programs"
        / "event-outbox-live-metrics-smoke.ts"
    ).read_text(encoding="utf-8")

    assert (
        'import { requireNonProductionReferenceSeedOptIn } from "./postgres-reference-seed.js"'
        in smoke_source
    )
    assert "requireNonProductionReferenceSeedOptIn()" in smoke_source


def test_reference_seed_populates_trust_keys_needed_for_governance_publication() -> None:
    seed_source = (
        REPO_ROOT / "network" / "src" / "programs" / "postgres-reference-seed.ts"
    ).read_text(encoding="utf-8")

    assert "demoRootTrustKey" in seed_source
    assert "demoDelegatedAuthorityTrustKey" in seed_source
    assert "seedTrustKeyCommand(demoRootTrustKey)" in seed_source
    assert "seedTrustKeyCommand(demoDelegatedAuthorityTrustKey)" in seed_source
    assert 'name: "reference_seed.trust_key"' in seed_source


def test_reference_schema_reset_rewinds_backend_alembic_to_pre_qr_trust_base() -> None:
    seed_source = (
        REPO_ROOT / "network" / "src" / "programs" / "postgres-reference-seed.ts"
    ).read_text(encoding="utf-8")

    assert '"reference_schema.rewind_backend_alembic_to_base"' in seed_source
    assert "create table if not exists public.alembic_version" in seed_source
    assert "d4309a94dafa" in seed_source
