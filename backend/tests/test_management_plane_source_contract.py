from __future__ import annotations

import ast
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MANAGEMENT_ENDPOINT = REPO_ROOT / "backend" / "app" / "api" / "endpoints" / "management.py"
CLI_PATH = REPO_ROOT / "backend" / "scripts" / "qrtrustctl.py"
COMPOSE_PATH = REPO_ROOT / "compose.yml"
COMPOSE_NATS_PATH = REPO_ROOT / "compose.nats.yml"
MAKEFILE_PATH = REPO_ROOT / "Makefile"


def test_governance_mutation_endpoints_use_management_plane_service() -> None:
    source = MANAGEMENT_ENDPOINT.read_text(encoding="utf-8")

    for function_name in (
        "upsert_trust_key",
        "update_trust_key_status",
        "upsert_root_program",
        "upsert_delegated_authority",
        "enroll_issuer",
        "update_issuer_status",
        "upsert_domain_proof",
        "upsert_destination_policy",
        "update_destination_policy_status",
        "upsert_runtime_provider",
        "authorize_nats_subscriber",
    ):
        function_source = _async_function_source(source, function_name)
        assert "ManagementPlaneService(connection)" in function_source
        assert ".record_governance_mutation(" in function_source
        assert 'http_request.headers.get("Idempotency-Key")' in function_source


def test_management_api_exposes_scoped_admin_surfaces() -> None:
    from backend.app.api.endpoints.management import router

    paths = {route.path for route in router.routes}

    for path in (
        "/health",
        "/management-keys/issue",
        "/management-keys",
        "/management-keys/{key_id}/revoke",
        "/operators",
        "/operator-role-assignments",
        "/verifier-clients/api-keys/issue",
        "/verifier-clients/api-keys",
        "/verifier-clients/api-keys/{key_id}/revoke",
        "/trust-keys",
        "/trust-keys/status",
        "/root-programs",
        "/delegated-authorities",
        "/issuers",
        "/issuers/status",
        "/domain-proofs",
        "/destination-policies",
        "/destination-policies/status",
        "/runtime-providers",
        "/nats/subscribers",
        "/outbox",
        "/outbox/events/remediate",
        "/audit",
    ):
        assert path in paths


def test_qrtrustctl_is_management_api_client_not_direct_database_writer() -> None:
    source = CLI_PATH.read_text(encoding="utf-8").lower()

    for forbidden_fragment in (
        "asyncpg",
        "psycopg",
        "sqlalchemy",
        "postgresql://",
        "qrtrust_network_database_url",
    ):
        assert forbidden_fragment not in source

    assert '"/admin/' in source


def test_optional_management_cli_container_uses_api_runtime() -> None:
    compose = COMPOSE_PATH.read_text(encoding="utf-8")
    makefile = MAKEFILE_PATH.read_text(encoding="utf-8")

    assert "management-cli:" in compose
    assert "management-tools" in compose
    assert "QRTRUSTCTL_BASE_URL: ${QRTRUSTCTL_BASE_URL:-http://api:8000}" in compose
    assert 'entrypoint: ["python", "/app/backend/scripts/qrtrustctl.py"]' in compose
    assert "qrtrustctl-container-help:" in makefile
    assert "docker compose --profile management-tools run --rm management-cli --help" in makefile


def test_container_plan_keeps_postgres_and_nats_as_existing_stateful_services() -> None:
    compose = COMPOSE_PATH.read_text(encoding="utf-8").lower()
    compose_nats = COMPOSE_NATS_PATH.read_text(encoding="utf-8").lower()
    combined = f"{compose}\n{compose_nats}"

    assert "postgres:" in compose
    assert "image: postgres:" in compose
    assert "nats:" in compose_nats
    assert "image: nats:" in compose_nats

    for forbidden_service in ("kafka", "mysql", "mariadb", "mongodb"):
        assert forbidden_service not in combined

    for worker_name in (
        "network-outbox-worker",
        "network-governance-subscriber-worker",
        "network-runtime-subscriber-worker",
    ):
        assert worker_name in compose_nats


def test_optional_second_verifier_node_profile_is_operable() -> None:
    compose = COMPOSE_PATH.read_text(encoding="utf-8")
    shared_infra = (REPO_ROOT / "compose.shared-infra.yml").read_text(
        encoding="utf-8"
    )
    makefile = MAKEFILE_PATH.read_text(encoding="utf-8")
    run_guide = (REPO_ROOT / "docs" / "public" / "RUN_GUIDE.md").read_text(
        encoding="utf-8"
    )

    assert "api-verifier-b:" in compose
    assert "verifier-federation" in compose
    assert (
        "QRTRUST_SCANNER_VERIFIER_ID: "
        "${SECONDARY_VERIFIER_ID:-verifier:reference-http-runtime-b}"
    ) in compose
    assert "REDIS_DB: ${SECONDARY_VERIFIER_REDIS_DB:-1}" in compose
    assert (
        '"${SECONDARY_API_PUBLISH_HOST:-127.0.0.1}:'
        '${SECONDARY_API_PUBLISH_PORT:-8001}:8000"'
    ) in compose
    assert "api-verifier-b:" in shared_infra
    assert "REDIS_DB: ${SECONDARY_VERIFIER_REDIS_DB:-6}" in shared_infra
    assert "up-secondary-verifier-node" in makefile
    assert "-f compose.nats.yml -f compose.shared-infra.yml" in makefile
    assert "logs-secondary-verifier-node" in makefile
    assert "make up-secondary-verifier-node" in run_guide
    assert "verifier:reference-http-runtime-b" in run_guide


def _async_function_source(source: str, function_name: str) -> str:
    module = ast.parse(source)
    for node in module.body:
        if isinstance(node, ast.AsyncFunctionDef) and node.name == function_name:
            function_source = ast.get_source_segment(source, node)
            if function_source is None:
                raise AssertionError(f"missing source for {function_name}")
            return function_source
    raise AssertionError(f"missing async function {function_name}")
