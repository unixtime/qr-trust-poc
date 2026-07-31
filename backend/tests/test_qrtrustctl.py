from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest


CLI_PATH = Path(__file__).resolve().parents[1] / "scripts" / "qrtrustctl.py"


def test_qrtrustctl_reads_container_safe_defaults_from_environment(monkeypatch) -> None:
    from backend.scripts import qrtrustctl

    monkeypatch.setenv("QRTRUSTCTL_BASE_URL", "http://api:8000")
    monkeypatch.setenv("QRTRUSTCTL_ADMIN_TOKEN", "managed-admin-token")
    monkeypatch.setenv("QRTRUSTCTL_INSECURE_TLS", "true")

    args = qrtrustctl.build_parser().parse_args(["audit-list"])

    assert args.base_url == "http://api:8000"
    assert args.admin_token == "managed-admin-token"
    assert args.insecure_tls is True


def test_qrtrustctl_defaults_to_local_compose_api(monkeypatch) -> None:
    from backend.scripts import qrtrustctl

    monkeypatch.delenv("QRTRUSTCTL_BASE_URL", raising=False)
    monkeypatch.delenv("API_PUBLISH_HOST", raising=False)
    monkeypatch.delenv("API_PUBLISH_PORT", raising=False)

    args = qrtrustctl.build_parser().parse_args(["audit-list"])

    assert args.base_url == "http://127.0.0.1:8000"


def test_qrtrustctl_derives_local_https_base_url_from_api_publish_env(
    monkeypatch,
) -> None:
    from backend.scripts import qrtrustctl

    monkeypatch.delenv("QRTRUSTCTL_BASE_URL", raising=False)
    monkeypatch.setenv("API_PUBLISH_HOST", "0.0.0.0")
    monkeypatch.setenv("API_PUBLISH_PORT", "8443")

    args = qrtrustctl.build_parser().parse_args(["audit-list"])

    assert args.base_url == "https://127.0.0.1:8443"


def test_qrtrustctl_outbox_status_defaults_to_full_operator_window() -> None:
    from backend.scripts import qrtrustctl

    args = qrtrustctl.build_parser().parse_args(["outbox-status"])

    assert args.limit == 100


def test_qrtrustctl_reuses_management_contract_constants() -> None:
    source = CLI_PATH.read_text(encoding="utf-8")

    assert "from backend.app.schemas.management_contracts import" in source
    assert "DELEGATED_AUTHORITY_TYPE_CHOICES = [" not in source
    assert "MANAGEMENT_KEY_SCOPE_CHOICES = [" not in source


def test_qrtrustctl_reuses_lifecycle_contract_constants() -> None:
    source = CLI_PATH.read_text(encoding="utf-8")

    for name in (
        "ISSUER_CLASS_CHOICES",
        "ISSUER_ASSURANCE_TIER_CHOICES",
        "ISSUER_ENROLLMENT_STATUS_CHOICES",
        "DOMAIN_PROOF_METHOD_CHOICES",
        "DOMAIN_VERIFICATION_STATUS_CHOICES",
        "DESTINATION_USAGE_POLICY_CHOICES",
        "DESTINATION_POLICY_STATUS_CHOICES",
        "OPERATOR_STATUS_CHOICES",
        "OPERATOR_ROLE_CHOICES",
        "OPERATOR_ROLE_STATUS_CHOICES",
        "TRUST_KEY_SCOPE_CHOICES",
        "TRUST_KEY_STATUS_CHOICES",
        "RUNTIME_PROVIDER_BEHAVIOR_CHOICES",
        "RUNTIME_PROVIDER_STATUS_CHOICES",
        "OUTBOX_EVENT_REMEDIATION_ACTION_CHOICES",
    ):
        assert f"{name} = [" not in source


def test_qrtrustctl_help_lists_issuer_enroll() -> None:
    result = subprocess.run(
        [sys.executable, str(CLI_PATH), "--help"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0
    assert "root-program-upsert" in result.stdout
    assert "delegated-authority-upsert" in result.stdout
    assert "issuer-enroll" in result.stdout
    assert "issuer-status-update" in result.stdout
    assert "domain-proof-upsert" in result.stdout
    assert "destination-policy-upsert" in result.stdout
    assert "destination-policy-status-update" in result.stdout
    assert "runtime-provider-upsert" in result.stdout
    assert "runtime-provider-list" in result.stdout
    assert "nats-subscriber-authorize" in result.stdout
    assert "nats-subscriber-list" in result.stdout
    assert "outbox-status" in result.stdout
    assert "outbox-event-remediate" in result.stdout
    assert "audit-list" in result.stdout
    assert "management-key-issue" in result.stdout
    assert "management-key-list" in result.stdout
    assert "management-key-revoke" in result.stdout
    assert "demo-bootstrap" in result.stdout
    assert "management-live-drill" in result.stdout


def test_qrtrustctl_issuer_enroll_rejects_unknown_governance_class() -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.build_parser().parse_args(
            [
                "issuer-enroll",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--delegated-authority-id",
                "authority:qrtrust-demo:merchant-web",
                "--issuer-id",
                "issuer:acme-demo",
                "--display-name",
                "ACME Demo Issuer",
                "--issuer-class",
                "merchant",
            ]
        )

    assert exc.value.code == 2


def test_qrtrustctl_issuer_status_update_rejects_unknown_lifecycle_status() -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.build_parser().parse_args(
            [
                "issuer-status-update",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--delegated-authority-id",
                "authority:qrtrust-demo:merchant-web",
                "--issuer-id",
                "issuer:acme-demo",
                "--enrollment-status",
                "enabled",
            ]
        )

    assert exc.value.code == 2


def test_qrtrustctl_domain_proof_upsert_rejects_unknown_verification_status() -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.build_parser().parse_args(
            [
                "domain-proof-upsert",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--delegated-authority-id",
                "authority:qrtrust-demo:merchant-web",
                "--issuer-id",
                "issuer:acme-demo",
                "--domain",
                "acme.example",
                "--verification-status",
                "approved",
            ]
        )

    assert exc.value.code == 2


def test_qrtrustctl_domain_proof_upsert_rejects_stale_verified_window_before_http(
    monkeypatch,
) -> None:
    from backend.scripts import qrtrustctl

    class FakeClient:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            raise AssertionError("domain proof validation should run before HTTP")

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.main(
            [
                "--admin-token",
                "local-lab-admin",
                "domain-proof-upsert",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--delegated-authority-id",
                "authority:qrtrust-demo:merchant-web",
                "--issuer-id",
                "issuer:acme-demo",
                "--domain",
                "acme.example",
                "--proof-method",
                "manual_review",
                "--verification-status",
                "verified",
                "--expires-at",
                "2020-01-01T00:00:00Z",
            ]
        )

    assert "verified domain proof expires_at must be in the future" in str(exc.value)


def test_qrtrustctl_destination_policy_upsert_rejects_unknown_usage_policy() -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.build_parser().parse_args(
            [
                "destination-policy-upsert",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--delegated-authority-id",
                "authority:qrtrust-demo:merchant-web",
                "--issuer-id",
                "issuer:acme-demo",
                "--destination-policy-id",
                "policy:acme-demo:web-payments:v1",
                "--usage-policy",
                "forever",
                "--approved-destinations-json",
                "[]",
            ]
        )

    assert exc.value.code == 2


def test_qrtrustctl_destination_policy_upsert_rejects_empty_destinations_before_http(
    monkeypatch,
) -> None:
    from backend.scripts import qrtrustctl

    class FakeClient:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            raise AssertionError("destination policy validation should run before HTTP")

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.main(
            [
                "--admin-token",
                "local-lab-admin",
                "destination-policy-upsert",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--delegated-authority-id",
                "authority:qrtrust-demo:merchant-web",
                "--issuer-id",
                "issuer:acme-demo",
                "--destination-policy-id",
                "policy:acme-demo:web-payments:v1",
                "--approved-destinations-json",
                "[]",
            ]
        )

    assert "approved_destinations" in str(exc.value)


def test_qrtrustctl_nats_subscriber_authorize_rejects_broad_subject() -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.build_parser().parse_args(
            [
                "nats-subscriber-authorize",
                "--subscriber-id",
                "subscriber:too-broad",
                "--display-name",
                "Too Broad",
                "--durable-name",
                "too_broad",
                "--subject",
                "qrtrust.>",
            ]
        )

    assert exc.value.code == 2


@pytest.mark.parametrize(
    "subject",
    [
        "qrtrust.bad root.issuer.record.v1",
        "qrtrust.root:qrtrust-demo:2026.issuer.record.v1",
        "qrtrust.root-a.issuer.v1",
        "qrtrust.control-plane.issuer.record.published.v1",
        "qrtrust.control-plane.runtime.>",
    ],
)
def test_qrtrustctl_nats_subscriber_authorize_rejects_malformed_subject_tokens(
    subject: str,
) -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.build_parser().parse_args(
            [
                "nats-subscriber-authorize",
                "--subscriber-id",
                "subscriber:malformed",
                "--display-name",
                "Malformed",
                "--durable-name",
                "malformed_subscriber",
                "--subject",
                subject,
            ]
        )

    assert exc.value.code == 2


def test_qrtrustctl_delegated_authority_rejects_unknown_authority_type() -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.build_parser().parse_args(
            [
                "delegated-authority-upsert",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--delegated-authority-id",
                "authority:qrtrust-demo:merchant-web",
                "--name",
                "QR Trust Demo Merchant Web",
                "--authority-type",
                "partner",
            ]
        )

    assert exc.value.code == 2


def test_qrtrustctl_management_key_issue_rejects_verifier_client_scope() -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.build_parser().parse_args(
            [
                "management-key-issue",
                "--label",
                "bad mixed key",
                "--scope",
                "verifier:client",
            ]
        )

    assert exc.value.code == 2


def test_qrtrustctl_management_key_issue_rejects_unknown_scope() -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.build_parser().parse_args(
            [
                "management-key-issue",
                "--label",
                "typo key",
                "--scope",
                "issuer:wriet",
            ]
        )

    assert exc.value.code == 2


def test_qrtrustctl_management_key_issue_rejects_expired_window_before_http(
    monkeypatch,
) -> None:
    from backend.scripts import qrtrustctl

    class FakeClient:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            raise AssertionError("management key validation should run before HTTP")

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.main(
            [
                "--admin-token",
                "local-lab-admin",
                "management-key-issue",
                "--label",
                "expired admin key",
                "--scope",
                "audit:read",
                "--expires-at",
                "2020-01-01T00:00:00Z",
            ]
        )

    assert "expires_at must be in the future" in str(exc.value)


def test_qrtrustctl_verifier_client_key_issue_rejects_expired_window_before_http(
    monkeypatch,
) -> None:
    from backend.scripts import qrtrustctl

    class FakeClient:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            raise AssertionError(
                "verifier client key validation should run before HTTP"
            )

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.main(
            [
                "--admin-token",
                "managed-verifier-admin",
                "verifier-client-key-issue",
                "--label",
                "expired lab client",
                "--expires-at",
                "2020-01-01T00:00:00Z",
            ]
        )

    assert "expires_at must be in the future" in str(exc.value)


def test_qrtrustctl_operator_upsert_rejects_unknown_status() -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.build_parser().parse_args(
            [
                "operator-upsert",
                "--email",
                "professor@example.edu",
                "--display-name",
                "Professor Example",
                "--status",
                "enabled",
            ]
        )

    assert exc.value.code == 2


def test_qrtrustctl_operator_role_upsert_rejects_unknown_role() -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.build_parser().parse_args(
            [
                "operator-role-upsert",
                "--operator-id",
                "66666666-6666-4666-8666-666666666666",
                "--role",
                "super_admin",
            ]
        )

    assert exc.value.code == 2


def test_qrtrustctl_operator_role_upsert_rejects_unknown_status() -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.build_parser().parse_args(
            [
                "operator-role-upsert",
                "--operator-id",
                "66666666-6666-4666-8666-666666666666",
                "--role",
                "issuer_admin",
                "--status",
                "retired",
            ]
        )

    assert exc.value.code == 2


def test_qrtrustctl_operator_role_upsert_rejects_missing_scope_before_http(
    monkeypatch,
) -> None:
    from backend.scripts import qrtrustctl

    class FakeClient:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            raise AssertionError("operator role validation should run before HTTP")

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.main(
            [
                "--admin-token",
                "local-lab-admin",
                "operator-role-upsert",
                "--operator-id",
                "66666666-6666-4666-8666-666666666666",
                "--role",
                "issuer_admin",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--issuer-id",
                "issuer:acme-demo",
            ]
        )

    assert "issuer_admin assignments require delegated_authority_id" in str(
        exc.value
    )


def test_qrtrustctl_trust_key_upsert_rejects_unknown_scope() -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.build_parser().parse_args(
            [
                "trust-key-upsert",
                "--key-id",
                "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--signer-id",
                "authority:qrtrust-demo:merchant-web",
                "--algorithm-id",
                "Ed25519",
                "--public-key-material-ref",
                "pem://fixture/authority/qrtrust-demo-merchant-web",
                "--scope",
                "issuer",
            ]
        )

    assert exc.value.code == 2


def test_qrtrustctl_trust_key_upsert_rejects_expired_not_after_before_http(
    monkeypatch,
) -> None:
    from backend.scripts import qrtrustctl

    class FakeClient:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            raise AssertionError("trust key validation should run before HTTP")

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.main(
            [
                "--admin-token",
                "local-lab-admin",
                "trust-key-upsert",
                "--key-id",
                "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--delegated-authority-id",
                "authority:qrtrust-demo:merchant-web",
                "--signer-id",
                "authority:qrtrust-demo:merchant-web",
                "--algorithm-id",
                "ed25519",
                "--public-key-material-ref",
                "managed://qrtrust/authority/public/v1",
                "--scope",
                "delegated_authority",
                "--not-after",
                "2020-01-01T00:00:00Z",
            ]
        )

    assert "not_after must be in the future" in str(exc.value)


def test_qrtrustctl_trust_key_upsert_rejects_reversed_window_before_http(
    monkeypatch,
) -> None:
    from backend.scripts import qrtrustctl

    class FakeClient:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            raise AssertionError("trust key validation should run before HTTP")

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.main(
            [
                "--admin-token",
                "local-lab-admin",
                "trust-key-upsert",
                "--key-id",
                "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--delegated-authority-id",
                "authority:qrtrust-demo:merchant-web",
                "--signer-id",
                "authority:qrtrust-demo:merchant-web",
                "--algorithm-id",
                "ed25519",
                "--public-key-material-ref",
                "managed://qrtrust/authority/public/v1",
                "--scope",
                "delegated_authority",
                "--not-before",
                "2026-12-31T23:59:59Z",
                "--not-after",
                "2026-12-01T00:00:00Z",
            ]
        )

    assert "not_after must be later than not_before" in str(exc.value)


def test_qrtrustctl_trust_key_status_rejects_unknown_status() -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.build_parser().parse_args(
            [
                "trust-key-status-update",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--key-id",
                "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
                "--key-status",
                "disabled",
            ]
        )

    assert exc.value.code == 2


@pytest.mark.parametrize(
    ("argv", "expected_error"),
    [
        (
            [
                "operator-upsert",
                "--email",
                "",
                "--display-name",
                "Professor Example",
            ],
            "email",
        ),
        (
            [
                "trust-key-status-update",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--key-id",
                "",
                "--key-status",
                "revoked",
            ],
            "key_id",
        ),
        (
            [
                "issuer-enroll",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--delegated-authority-id",
                "authority:qrtrust-demo:merchant-web",
                "--issuer-id",
                "issuer:acme-demo",
                "--display-name",
                "",
            ],
            "display_name",
        ),
        (
            [
                "issuer-status-update",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--delegated-authority-id",
                "authority:qrtrust-demo:merchant-web",
                "--issuer-id",
                "",
                "--enrollment-status",
                "active",
            ],
            "issuer_id",
        ),
        (
            [
                "destination-policy-status-update",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--delegated-authority-id",
                "authority:qrtrust-demo:merchant-web",
                "--issuer-id",
                "issuer:acme-demo",
                "--destination-policy-id",
                "",
                "--status",
                "active",
            ],
            "destination_policy_id",
        ),
        (
            [
                "root-program-upsert",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--name",
                "",
                "--program-scope",
                "demo merchant QR trust",
                "--accepted-algorithm-id",
                "ed25519",
            ],
            "name",
        ),
        (
            [
                "delegated-authority-upsert",
                "--root-program-id",
                "root:qrtrust-demo:2026",
                "--delegated-authority-id",
                "",
                "--name",
                "QR Trust Demo Merchant Web",
            ],
            "delegated_authority_id",
        ),
        (
            [
                "runtime-provider-upsert",
                "--provider-id",
                "deterministic-runtime-safety",
                "--display-name",
                "Deterministic runtime safety",
                "--verdict-ttl-seconds",
                "0",
            ],
            "verdict_ttl_seconds",
        ),
        (
            [
                "nats-subscriber-authorize",
                "--subscriber-id",
                "subscriber:reference-governance",
                "--display-name",
                "",
                "--durable-name",
                "qrtrust_governance_subscriber_worker",
                "--subject",
                "qrtrust.*.issuer.>",
            ],
            "display_name",
        ),
        (
            [
                "outbox-event-remediate",
                "--event-id",
                "",
                "--action",
                "retry",
            ],
            "event_id",
        ),
    ],
)
def test_qrtrustctl_remaining_mutations_validate_before_http(
    monkeypatch,
    argv: list[str],
    expected_error: str,
) -> None:
    from backend.scripts import qrtrustctl

    class FakeClient:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            raise AssertionError("management request validation should run before HTTP")

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.main(["--admin-token", "local-lab-admin", *argv])

    assert expected_error in str(exc.value)


def test_qrtrustctl_root_program_upsert_sends_idempotency_key(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, str]:
            return {
                "root_program_id": "root:qrtrust-demo:2026",
                "status": "active",
                "event_type": "root_program.upserted",
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "--idempotency-key",
            "idem-root-demo",
            "root-program-upsert",
            "--root-program-id",
            "root:qrtrust-demo:2026",
            "--name",
            "QR Trust Demo Root",
            "--program-scope",
            "demo merchant QR trust",
            "--accepted-algorithm-id",
            "ES256",
            "--policy-constraints-json",
            '{"max_redirect_hops":1}',
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/root-programs"
    assert requests[1]["headers"] == {
        "X-Admin-Token": "local-lab-admin",
        "Idempotency-Key": "idem-root-demo",
    }
    assert requests[1]["json"]["policy_constraints"] == {"max_redirect_hops": 1}
    assert "root_program.upserted" in capsys.readouterr().out


def test_qrtrustctl_domain_proof_upsert_sends_verified_status(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, str]:
            return {
                "root_program_id": "root:qrtrust-demo:2026",
                "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
                "issuer_id": "issuer:acme-demo",
                "domain": "acme.example",
                "verification_status": "verified",
                "event_type": "domain_proof.upserted",
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "--idempotency-key",
            "idem-domain-proof-demo",
            "domain-proof-upsert",
            "--root-program-id",
            "root:qrtrust-demo:2026",
            "--delegated-authority-id",
            "authority:qrtrust-demo:merchant-web",
            "--issuer-id",
            "issuer:acme-demo",
            "--domain",
            "acme.example",
            "--proof-method",
            "manual_review",
            "--verification-status",
            "verified",
            "--expires-at",
            "2026-12-31T23:59:59Z",
            "--evidence-ref",
            "operator://manual-review/acme.example",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/domain-proofs"
    assert requests[1]["headers"] == {
        "X-Admin-Token": "local-lab-admin",
        "Idempotency-Key": "idem-domain-proof-demo",
    }
    assert requests[1]["json"] == {
        "root_program_id": "root:qrtrust-demo:2026",
        "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
        "issuer_id": "issuer:acme-demo",
        "domain": "acme.example",
        "proof_method": "manual_review",
        "verification_status": "verified",
        "expires_at": "2026-12-31T23:59:59Z",
        "evidence_ref": "operator://manual-review/acme.example",
    }
    assert "domain_proof.upserted" in capsys.readouterr().out


def test_qrtrustctl_issuer_status_update_sends_active_status(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, str]:
            return {
                "issuer_id": "issuer:acme-demo",
                "enrollment_status": "active",
                "event_type": "issuer.status.changed",
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "--idempotency-key",
            "idem-issuer-active-demo",
            "issuer-status-update",
            "--root-program-id",
            "root:qrtrust-demo:2026",
            "--delegated-authority-id",
            "authority:qrtrust-demo:merchant-web",
            "--issuer-id",
            "issuer:acme-demo",
            "--enrollment-status",
            "active",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/issuers/status"
    assert requests[1]["json"]["enrollment_status"] == "active"
    assert "issuer.status.changed" in capsys.readouterr().out


def test_qrtrustctl_management_key_issue_sends_scopes(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "record": {
                    "key_id": "mkey_demo_issuer",
                    "label": "demo issuer operator",
                    "operator_id": None,
                    "scopes": ["audit:read", "outbox:read"],
                    "status": "active",
                    "created_at": "2026-05-25T10:02:00Z",
                    "expires_at": None,
                    "revoked_at": None,
                },
                "plaintext_key": "mkey_plaintext_once",
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "management-key-issue",
            "--label",
            "demo issuer operator",
            "--scope",
            "audit:read",
            "--scope",
            "outbox:read",
            "--expires-at",
            "2026-12-31T23:59:59Z",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/management-keys/issue"
    assert requests[1]["headers"] == {"X-Admin-Token": "local-lab-admin"}
    assert requests[1]["json"] == {
        "label": "demo issuer operator",
        "scopes": ["audit:read", "outbox:read"],
        "operator_id": None,
        "expires_at": "2026-12-31T23:59:59Z",
    }
    assert "mkey_plaintext_once" in capsys.readouterr().out


def test_qrtrustctl_management_key_list_sends_limit(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {"records": []}

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def get(
            self,
            path: str,
            *,
            headers: dict[str, str],
            params: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "params": params})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "management-key-list",
            "--limit",
            "5",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/management-keys"
    assert requests[1]["headers"] == {"X-Admin-Token": "local-lab-admin"}
    assert requests[1]["params"] == {"limit": 5}
    assert '"records": []' in capsys.readouterr().out


def test_qrtrustctl_management_key_revoke_posts_key_id(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "record": {
                    "key_id": "mkey_demo_issuer",
                    "label": "demo issuer operator",
                    "operator_id": None,
                    "scopes": ["audit:read"],
                    "status": "revoked",
                    "created_at": "2026-05-25T10:02:00Z",
                    "expires_at": None,
                    "revoked_at": "2026-05-25T10:04:00Z",
                }
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "management-key-revoke",
            "--key-id",
            "mkey_demo_issuer",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/management-keys/mkey_demo_issuer/revoke"
    assert requests[1]["headers"] == {"X-Admin-Token": "local-lab-admin"}
    assert "revoked" in capsys.readouterr().out


def test_qrtrustctl_operator_upsert_posts_management_endpoint(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "operator_id": "66666666-6666-4666-8666-666666666666",
                "email": "professor@example.edu",
                "display_name": "Professor Example",
                "status": "active",
                "created_at": "2026-05-25T10:08:00Z",
                "updated_at": "2026-05-25T10:08:00Z",
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "operator-upsert",
            "--email",
            "professor@example.edu",
            "--display-name",
            "Professor Example",
            "--status",
            "active",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/operators"
    assert requests[1]["json"] == {
        "email": "professor@example.edu",
        "display_name": "Professor Example",
        "status": "active",
    }
    assert "professor@example.edu" in capsys.readouterr().out


def test_qrtrustctl_operator_list_gets_management_endpoint(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {"records": []}

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def get(
            self,
            path: str,
            *,
            headers: dict[str, str],
            params: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "params": params})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "operator-list",
            "--limit",
            "10",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/operators"
    assert requests[1]["params"] == {"limit": 10}
    assert '"records": []' in capsys.readouterr().out


def test_qrtrustctl_operator_role_upsert_posts_management_endpoint(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "assignment_id": "77777777-7777-4777-8777-777777777777",
                "operator_id": "66666666-6666-4666-8666-666666666666",
                "role": "issuer_admin",
                "root_program_id": "root:qrtrust-demo:2026",
                "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
                "issuer_id": "issuer:acme-demo",
                "status": "active",
                "created_at": "2026-05-25T10:09:00Z",
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "operator-role-upsert",
            "--operator-id",
            "66666666-6666-4666-8666-666666666666",
            "--role",
            "issuer_admin",
            "--root-program-id",
            "root:qrtrust-demo:2026",
            "--delegated-authority-id",
            "authority:qrtrust-demo:merchant-web",
            "--issuer-id",
            "issuer:acme-demo",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/operator-role-assignments"
    assert requests[1]["json"] == {
        "operator_id": "66666666-6666-4666-8666-666666666666",
        "role": "issuer_admin",
        "root_program_id": "root:qrtrust-demo:2026",
        "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
        "issuer_id": "issuer:acme-demo",
        "status": "active",
    }
    assert "issuer_admin" in capsys.readouterr().out


def test_qrtrustctl_operator_role_list_filters_operator_id(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {"records": []}

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def get(
            self,
            path: str,
            *,
            headers: dict[str, str],
            params: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "params": params})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "operator-role-list",
            "--operator-id",
            "66666666-6666-4666-8666-666666666666",
            "--limit",
            "10",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/operator-role-assignments"
    assert requests[1]["params"] == {
        "operator_id": "66666666-6666-4666-8666-666666666666",
        "limit": 10,
    }
    assert '"records": []' in capsys.readouterr().out


def test_qrtrustctl_trust_key_upsert_posts_management_endpoint(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "key_id": "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
                "key_status": "active",
                "event_type": "trust_key.upserted",
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "trust-key-upsert",
            "--key-id",
            "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
            "--root-program-id",
            "root:qrtrust-demo:2026",
            "--delegated-authority-id",
            "authority:qrtrust-demo:merchant-web",
            "--signer-id",
            "authority:qrtrust-demo:merchant-web",
            "--algorithm-id",
            "ed25519",
            "--public-key-material-ref",
            "managed://qrtrust/authority/public/v1",
            "--scope",
            "delegated_authority",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/trust-keys"
    assert requests[1]["json"] == {
        "key_id": "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
        "root_program_id": "root:qrtrust-demo:2026",
        "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
        "signer_id": "authority:qrtrust-demo:merchant-web",
        "algorithm_id": "ed25519",
        "public_key_material_ref": "managed://qrtrust/authority/public/v1",
        "public_key_material_pem": None,
        "scope": "delegated_authority",
        "key_status": "active",
        "not_before": None,
        "not_after": None,
    }
    assert "trust_key.upserted" in capsys.readouterr().out


def test_qrtrustctl_trust_key_status_posts_management_endpoint(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "key_id": "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
                "key_status": "revoked",
                "event_type": "trust_key.status.changed",
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "trust-key-status-update",
            "--root-program-id",
            "root:qrtrust-demo:2026",
            "--key-id",
            "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
            "--key-status",
            "revoked",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/trust-keys/status"
    assert requests[1]["json"] == {
        "root_program_id": "root:qrtrust-demo:2026",
        "key_id": "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
        "key_status": "revoked",
    }
    assert "revoked" in capsys.readouterr().out


def test_qrtrustctl_trust_key_list_gets_management_endpoint(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {"records": []}

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def get(
            self,
            path: str,
            *,
            headers: dict[str, str],
            params: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "params": params})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "trust-key-list",
            "--root-program-id",
            "root:qrtrust-demo:2026",
            "--delegated-authority-id",
            "authority:qrtrust-demo:merchant-web",
            "--limit",
            "10",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/trust-keys"
    assert requests[1]["params"] == {
        "root_program_id": "root:qrtrust-demo:2026",
        "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
        "limit": 10,
    }
    assert '"records": []' in capsys.readouterr().out


def test_qrtrustctl_destination_policy_upsert_sends_json_policy(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "destination_policy_id": "policy:acme-demo:web-payments:v1",
                "status": "active",
                "event_type": "destination_policy.upserted",
                "required_hosts": ["acme.example"],
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "--idempotency-key",
            "idem-policy-demo",
            "destination-policy-upsert",
            "--root-program-id",
            "root:qrtrust-demo:2026",
            "--delegated-authority-id",
            "authority:qrtrust-demo:merchant-web",
            "--issuer-id",
            "issuer:acme-demo",
            "--destination-policy-id",
            "policy:acme-demo:web-payments:v1",
            "--approved-destinations-json",
            '[{"destination_id":"dest:acme-demo:pay","expected_final_url":"https://acme.example/pay","allowed_hosts":["acme.example"],"allow_subdomains":false,"path_prefixes":["/pay"],"query_policy":"allow_known_payment_query"}]',
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/destination-policies"
    assert requests[1]["headers"] == {
        "X-Admin-Token": "local-lab-admin",
        "Idempotency-Key": "idem-policy-demo",
    }
    assert requests[1]["json"]["destination_policy_id"] == (
        "policy:acme-demo:web-payments:v1"
    )
    assert requests[1]["json"]["approved_destinations"][0]["allowed_hosts"] == [
        "acme.example"
    ]
    assert requests[1]["json"]["redirect_policy"]["max_redirect_hops"] == 0
    assert "destination_policy.upserted" in capsys.readouterr().out


def test_qrtrustctl_destination_policy_upsert_merges_partial_policy_overrides(
    monkeypatch,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "destination_policy_id": "policy:acme-demo:web-payments:v1",
                "status": "active",
                "event_type": "destination_policy.upserted",
                "required_hosts": ["acme.example"],
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "destination-policy-upsert",
            "--root-program-id",
            "root:qrtrust-demo:2026",
            "--delegated-authority-id",
            "authority:qrtrust-demo:merchant-web",
            "--issuer-id",
            "issuer:acme-demo",
            "--destination-policy-id",
            "policy:acme-demo:web-payments:v1",
            "--approved-destinations-json",
            '[{"destination_id":"dest:acme-demo:pay","expected_final_url":"https://acme.example/pay","allowed_hosts":["acme.example"],"allow_subdomains":false,"path_prefixes":["/pay"],"query_policy":"allow_known_payment_query"}]',
            "--redirect-policy-json",
            '{"max_redirect_hops":1}',
            "--runtime-safety-policy-json",
            '{"publication_ttl_seconds":86400}',
        ]
    )

    assert result == 0
    payload = requests[1]["json"]
    assert payload["redirect_policy"] == {
        "resolver_urls": [],
        "expected_final_destinations": [],
        "allowed_redirect_hosts": [],
        "max_redirect_hops": 1,
        "nested_shorteners_allowed": False,
        "scanner_must_display_resolver_and_final_destination": True,
    }
    assert payload["runtime_safety_policy"] == {
        "provider": "deterministic-runtime-safety",
        "verdict_ttl_seconds": 300,
        "stale_behavior": "downgrade_to_caution",
        "unavailable_behavior": "downgrade_to_caution",
        "publication_ttl_seconds": 86400,
    }


def test_qrtrustctl_destination_policy_status_update_sends_revoked_status(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, str]:
            return {
                "destination_policy_id": "policy:acme-demo:web-payments:v1",
                "status": "revoked",
                "event_type": "destination_policy.status.changed",
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "--idempotency-key",
            "idem-policy-revoke-demo",
            "destination-policy-status-update",
            "--root-program-id",
            "root:qrtrust-demo:2026",
            "--delegated-authority-id",
            "authority:qrtrust-demo:merchant-web",
            "--issuer-id",
            "issuer:acme-demo",
            "--destination-policy-id",
            "policy:acme-demo:web-payments:v1",
            "--status",
            "revoked",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/destination-policies/status"
    assert requests[1]["headers"] == {
        "X-Admin-Token": "local-lab-admin",
        "Idempotency-Key": "idem-policy-revoke-demo",
    }
    assert requests[1]["json"] == {
        "root_program_id": "root:qrtrust-demo:2026",
        "delegated_authority_id": "authority:qrtrust-demo:merchant-web",
        "issuer_id": "issuer:acme-demo",
        "destination_policy_id": "policy:acme-demo:web-payments:v1",
        "status": "revoked",
    }
    assert "destination_policy.status.changed" in capsys.readouterr().out


def test_qrtrustctl_outbox_event_remediate_sends_quarantine_action(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {
                "event_id": "evt_mgmt_stale_policy",
                "publish_status": "quarantined",
                "attempts": 0,
                "last_error": "stale source policy event",
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "outbox-event-remediate",
            "--event-id",
            "evt_mgmt_stale_policy",
            "--action",
            "quarantine",
            "--reason",
            "stale source policy event",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/outbox/events/remediate"
    assert requests[1]["headers"] == {"X-Admin-Token": "local-lab-admin"}
    assert requests[1]["json"] == {
        "event_id": "evt_mgmt_stale_policy",
        "action": "quarantine",
        "reason": "stale source policy event",
    }
    assert "quarantined" in capsys.readouterr().out


def test_qrtrustctl_runtime_provider_upsert_posts_registry_payload(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, str]:
            return {
                "provider_id": "deterministic-runtime-safety",
                "status": "active",
                "event_type": "runtime_provider.upserted",
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "--idempotency-key",
            "idem-runtime-provider-demo",
            "runtime-provider-upsert",
            "--provider-id",
            "deterministic-runtime-safety",
            "--display-name",
            "Deterministic runtime safety",
            "--verdict-ttl-seconds",
            "300",
            "--stale-behavior",
            "downgrade_to_caution",
            "--unavailable-behavior",
            "block",
            "--status",
            "active",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/runtime-providers"
    assert requests[1]["headers"] == {
        "X-Admin-Token": "local-lab-admin",
        "Idempotency-Key": "idem-runtime-provider-demo",
    }
    assert requests[1]["json"] == {
        "provider_id": "deterministic-runtime-safety",
        "display_name": "Deterministic runtime safety",
        "base_url": None,
        "verdict_ttl_seconds": 300,
        "stale_behavior": "downgrade_to_caution",
        "unavailable_behavior": "block",
        "status": "active",
    }
    assert "runtime_provider.upserted" in capsys.readouterr().out


def test_qrtrustctl_runtime_provider_list_gets_registry(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, list[dict[str, object]]]:
            return {
                "providers": [
                    {
                        "provider_id": "deterministic-runtime-safety",
                        "display_name": "Deterministic runtime safety",
                        "base_url": None,
                        "verdict_ttl_seconds": 300,
                        "stale_behavior": "downgrade_to_caution",
                        "unavailable_behavior": "block",
                        "status": "active",
                    }
                ]
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def get(
            self,
            path: str,
            *,
            headers: dict[str, str],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "runtime-provider-list",
        ]
    )

    assert result == 0
    assert requests[1]["path"] == "/admin/runtime-providers"
    assert requests[1]["headers"] == {"X-Admin-Token": "local-lab-admin"}
    assert "deterministic-runtime-safety" in capsys.readouterr().out


def test_qrtrustctl_verifier_client_key_issue_posts_management_endpoint(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "record": {
                    "key_id": "vkey_demo_client_hash",
                    "label": "lab-client",
                    "operator_id": None,
                    "scopes": ["verifier:client"],
                    "status": "active",
                    "created_at": "2026-05-25T10:06:00Z",
                    "expires_at": None,
                    "revoked_at": None,
                },
                "plaintext_key": "vkey_plaintext",
            }

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "managed-verifier-admin",
            "verifier-client-key-issue",
            "--label",
            "lab-client",
        ]
    )

    assert result == 0
    assert requests[1] == {
        "path": "/admin/verifier-clients/api-keys/issue",
        "headers": {"X-Admin-Token": "managed-verifier-admin"},
        "json": {"label": "lab-client", "expires_at": None},
    }
    assert "vkey_plaintext" in capsys.readouterr().out


def test_qrtrustctl_verifier_client_key_list_gets_management_endpoint(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {"records": [{"key_id": "vkey_demo_client_hash"}]}

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def get(
            self,
            path: str,
            *,
            headers: dict[str, str],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "managed-verifier-reader",
            "verifier-client-key-list",
        ]
    )

    assert result == 0
    assert requests[1] == {
        "path": "/admin/verifier-clients/api-keys",
        "headers": {"X-Admin-Token": "managed-verifier-reader"},
    }
    assert "vkey_demo_client_hash" in capsys.readouterr().out


def test_qrtrustctl_verifier_client_key_revoke_posts_management_endpoint(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {"record": {"key_id": "vkey_demo_client_hash", "status": "revoked"}}

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers})
            return FakeResponse()

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "managed-verifier-admin",
            "verifier-client-key-revoke",
            "--key-id",
            "vkey_demo_client_hash",
        ]
    )

    assert result == 0
    assert requests[1] == {
        "path": "/admin/verifier-clients/api-keys/vkey_demo_client_hash/revoke",
        "headers": {"X-Admin-Token": "managed-verifier-admin"},
    }
    assert "revoked" in capsys.readouterr().out


def test_qrtrustctl_demo_bootstrap_posts_managed_reference_flow(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def __init__(self, path: str) -> None:
            self.path = path

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            event_by_path = {
                "/admin/root-programs": "root_program.upserted",
                "/admin/delegated-authorities": "delegated_authority.upserted",
                "/admin/runtime-providers": "runtime_provider.upserted",
                "/admin/issuers": "issuer.enrollment.requested",
                "/admin/domain-proofs": "domain_proof.upserted",
                "/admin/issuers/status": "issuer.status.changed",
                "/admin/destination-policies": "destination_policy.upserted",
                "/admin/nats/subscribers": (
                    "nats.subscriber.authorization.changed"
                ),
            }
            return {"event_type": event_by_path[self.path]}

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            return FakeResponse(path)

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "demo-bootstrap",
            "--idempotency-prefix",
            "managed-demo",
        ]
    )

    assert result == 0
    posted = requests[1:]
    assert [request["path"] for request in posted] == [
        "/admin/root-programs",
        "/admin/delegated-authorities",
        "/admin/runtime-providers",
        "/admin/issuers",
        "/admin/domain-proofs",
        "/admin/issuers/status",
        "/admin/destination-policies",
        "/admin/nats/subscribers",
        "/admin/nats/subscribers",
    ]
    assert posted[0]["headers"] == {
        "X-Admin-Token": "local-lab-admin",
        "Idempotency-Key": "managed-demo:root-program",
    }
    assert posted[4]["headers"]["Idempotency-Key"] == "managed-demo:domain-proof"
    assert posted[6]["headers"]["Idempotency-Key"] == "managed-demo:destination-policy"
    assert posted[0]["json"]["root_program_id"] == "root:qrtrust-demo:2026"
    assert posted[1]["json"]["delegated_authority_id"] == (
        "authority:qrtrust-demo:merchant-web"
    )
    assert posted[2]["json"] == {
        "provider_id": "deterministic-runtime-safety",
        "display_name": "Deterministic runtime safety",
        "base_url": None,
        "verdict_ttl_seconds": 300,
        "stale_behavior": "downgrade_to_caution",
        "unavailable_behavior": "downgrade_to_caution",
        "status": "active",
    }
    assert posted[3]["json"]["issuer_id"] == "issuer:acme-demo"
    assert posted[4]["json"]["verification_status"] == "verified"
    assert posted[5]["json"]["enrollment_status"] == "active"
    assert posted[6]["json"]["approved_destinations"][0] == {
        "destination_id": "dest:acme-demo:pay",
        "expected_final_url": "https://acme.example/pay",
        "allowed_hosts": ["acme.example"],
        "allow_subdomains": False,
        "path_prefixes": ["/pay"],
        "query_policy": "allow_known_payment_query",
    }
    assert posted[7]["json"]["subjects"] == [
        "qrtrust.*.root.manifest.published.v1",
        "qrtrust.*.authority.manifest.published.v1",
        "qrtrust.*.issuer.record.published.v1",
        "qrtrust.*.issuer.status.changed.v1",
        "qrtrust.*.destination.policy.published.v1",
        "qrtrust.*.destination.policy.revoked.v1",
        "qrtrust.*.certificate.status.changed.v1",
    ]
    assert posted[8]["json"] == {
        "subscriber_id": "subscriber:runtime-observations",
        "display_name": "Runtime observation subscriber",
        "durable_name": "qrtrust_runtime_subscriber_worker",
        "description": (
            "Consumes managed QR Trust runtime observation events for the demo."
        ),
        "subjects": ["qrtrust.*.runtime.verdict.observed.v1"],
    }
    output = capsys.readouterr().out
    assert "demo_bootstrap" in output
    assert "destination_policy.upserted" in output


def test_qrtrustctl_management_live_drill_exercises_production_workflow(
    monkeypatch,
    capsys,
) -> None:
    from backend.scripts import qrtrustctl

    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def __init__(self, path: str, status_code: int = 200) -> None:
            self.path = path
            self.status_code = status_code

        def raise_for_status(self) -> None:
            if self.status_code >= 400:
                raise RuntimeError(f"unexpected HTTP {self.status_code}")

        def json(self) -> dict[str, Any]:
            if self.path == "/admin/verifier-clients/api-keys/issue":
                return {
                    "plaintext_key": "vkey_drill_client",
                    "record": {"key_id": "vkey_drill_client_hash"},
                }
            if self.path == "/admin/outbox/events/remediate":
                return {
                    "event_id": "evt_failed_after_broker_outage",
                    "publish_status": "pending",
                }
            event_by_path = {
                "/admin/root-programs": "root_program.upserted",
                "/admin/delegated-authorities": "delegated_authority.upserted",
                "/admin/runtime-providers": "runtime_provider.upserted",
                "/admin/issuers": "issuer.enrollment.requested",
                "/admin/domain-proofs": "domain_proof.upserted",
                "/admin/issuers/status": "issuer.status.changed",
                "/admin/destination-policies": "destination_policy.upserted",
                "/admin/nats/subscribers": (
                    "nats.subscriber.authorization.changed"
                ),
            }
            if self.status_code >= 400:
                return {"detail": "expected drill rejection"}
            return {"event_type": event_by_path[self.path]}

    class FakeClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            requests.append({"init": kwargs})

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            path: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers, "json": json})
            if path == "/admin/destination-policies" and json["issuer_id"].endswith(
                ":missing-precondition"
            ):
                return FakeResponse(path, status_code=409)
            if path == "/admin/nats/subscribers" and json["subjects"] == [
                "qrtrust.>"
            ]:
                return FakeResponse(path, status_code=422)
            return FakeResponse(path)

        def get(
            self,
            path: str,
            *,
            headers: dict[str, str],
        ) -> FakeResponse:
            requests.append({"path": path, "headers": headers})
            if path == "/admin/health" and headers == {
                "X-Admin-Token": "vkey_drill_client"
            }:
                return FakeResponse(path, status_code=401)
            return FakeResponse(path)

    monkeypatch.setattr(qrtrustctl.httpx, "Client", FakeClient)

    result = qrtrustctl.main(
        [
            "--admin-token",
            "local-lab-admin",
            "--insecure-tls",
            "--idempotency-key",
            "managed-live",
            "management-live-drill",
            "--outbox-retry-event-id",
            "evt_failed_after_broker_outage",
            "--require-outbox-retry",
        ]
    )

    assert result == 0
    assert requests[0]["init"]["verify"] is False
    posted = requests[1:]
    assert [request["path"] for request in posted] == [
        "/admin/destination-policies",
        "/admin/root-programs",
        "/admin/root-programs",
        "/admin/delegated-authorities",
        "/admin/runtime-providers",
        "/admin/issuers",
        "/admin/domain-proofs",
        "/admin/issuers/status",
        "/admin/destination-policies",
        "/admin/nats/subscribers",
        "/admin/nats/subscribers",
        "/admin/nats/subscribers",
        "/admin/verifier-clients/api-keys/issue",
        "/admin/health",
        "/admin/outbox/events/remediate",
    ]
    assert posted[0]["json"]["issuer_id"] == (
        "issuer:acme-demo:missing-precondition"
    )
    assert posted[0]["headers"] == {"X-Admin-Token": "local-lab-admin"}
    assert posted[1]["headers"] == {
        "X-Admin-Token": "local-lab-admin",
        "Idempotency-Key": "managed-live:root-program",
    }
    assert posted[2]["headers"] == posted[1]["headers"]
    assert posted[8]["json"]["destination_policy_id"] == (
        "policy:acme-demo:web-payments:v1"
    )
    assert posted[10]["json"]["subjects"] == [
        "qrtrust.*.runtime.verdict.observed.v1"
    ]
    assert posted[11]["json"]["subjects"] == ["qrtrust.>"]
    assert posted[12]["json"] == {"label": "management-live-drill verifier client"}
    assert posted[13]["headers"] == {"X-Admin-Token": "vkey_drill_client"}
    assert posted[14]["json"] == {
        "event_id": "evt_failed_after_broker_outage",
        "action": "retry",
        "reason": "management live drill broker outage recovery",
    }
    output = capsys.readouterr().out
    output_payload = json.loads(output)
    nats_check = next(
        check
        for check in output_payload["checks"]
        if check["check"] == "nats_subscriber_allow_deny"
    )
    assert nats_check["allowed_subscribers"] == [
        {
            "subscriber_id": "subscriber:reference-governance",
            "subjects": [
                "qrtrust.*.root.manifest.published.v1",
                "qrtrust.*.authority.manifest.published.v1",
                "qrtrust.*.issuer.record.published.v1",
                "qrtrust.*.issuer.status.changed.v1",
                "qrtrust.*.destination.policy.published.v1",
                "qrtrust.*.destination.policy.revoked.v1",
                "qrtrust.*.certificate.status.changed.v1",
            ],
        },
        {
            "subscriber_id": "subscriber:runtime-observations",
            "subjects": ["qrtrust.*.runtime.verdict.observed.v1"],
        },
    ]
    boundary_check = next(
        check
        for check in output_payload["checks"]
        if check["check"] == "verifier_client_admin_boundary"
    )
    assert boundary_check["verifier_client_key_id"] == "vkey_drill_client_hash"
    assert boundary_check["admin_health_http_status"] == 401
    outbox_check = next(
        check
        for check in output_payload["checks"]
        if check["check"] == "outbox_retry_after_broker_outage"
    )
    assert outbox_check["status"] == "passed"
    assert outbox_check["event_id"] == "evt_failed_after_broker_outage"
    assert "management_live_drill" in output
    assert "transaction_precondition" in output
    assert "idempotent_replay" in output
    assert "issuer_enrollment_to_publication" in output
    assert "nats_subscriber_allow_deny" in output
    assert "verifier_client_admin_boundary" in output
    assert "outbox_retry_after_broker_outage" in output


def test_qrtrustctl_management_live_drill_requires_retry_event_when_strict() -> None:
    from backend.scripts import qrtrustctl

    with pytest.raises(SystemExit) as exc:
        qrtrustctl.main(
            [
                "--admin-token",
                "local-lab-admin",
                "management-live-drill",
                "--require-outbox-retry",
            ]
        )

    assert str(exc.value) == (
        "management live drill requires --outbox-retry-event-id when "
        "--require-outbox-retry is set"
    )
