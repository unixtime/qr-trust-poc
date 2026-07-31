from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import pytest

from backend.app.services.management_auth import ManagementPrincipal
from backend.app.services.management_plane import (
    GovernanceMutation,
    GovernancePreconditionFailedError,
    IdempotencyConflictError,
    ManagementPlaneService,
    build_delegated_authority_upsert_mutation,
    build_destination_policy_status_update_mutation,
    build_destination_policy_upsert_mutation,
    build_domain_proof_upsert_mutation,
    build_issuer_enrollment_mutation,
    build_issuer_status_update_mutation,
    build_nats_subscriber_authorization_mutation,
    build_root_program_upsert_mutation,
    build_runtime_safety_provider_upsert_mutation,
    build_trust_key_status_update_mutation,
    build_trust_key_upsert_mutation,
)


class FakeManagementConnection:
    def __init__(
        self,
        execute_statuses: list[str] | None = None,
        fetchrow_result: dict[str, Any] | None = None,
    ) -> None:
        self.execute_calls: list[tuple[Any, ...]] = []
        self.fetchrow_calls: list[tuple[Any, ...]] = []
        self._execute_statuses = execute_statuses or []
        self._fetchrow_result = fetchrow_result
        self.completed_idempotency_hash: str | None = None
        self.transaction_committed = False
        self.transaction_rolled_back = False

    def transaction(self) -> "FakeManagementTransaction":
        return FakeManagementTransaction(self)

    async def execute(self, *args: Any) -> str:
        self.execute_calls.append(args)
        if "qr_trust.idempotency_keys" in str(args[0]) and len(args) > 2:
            self.completed_idempotency_hash = str(args[2])
        if self._execute_statuses:
            return self._execute_statuses.pop(0)
        return "INSERT 0 1"

    async def fetchrow(self, *args: Any) -> dict[str, Any] | None:
        self.fetchrow_calls.append(args)
        if self._fetchrow_result is not None:
            return self._fetchrow_result
        return {
            "request_hash": self.completed_idempotency_hash,
            "status": "completed",
            "response_json": {
                "state_rows": 1,
                "audit_rows": 1,
                "outbox_rows": 1,
            },
        }


class FakeManagementTransaction:
    def __init__(self, connection: FakeManagementConnection) -> None:
        self.connection = connection

    async def __aenter__(self) -> "FakeManagementTransaction":
        return self

    async def __aexit__(self, exc_type: Any, *_args: Any) -> None:
        if exc_type is None:
            self.connection.transaction_committed = True
        else:
            self.connection.transaction_rolled_back = True


@pytest.mark.asyncio
async def test_record_governance_mutation_writes_state_audit_and_outbox() -> None:
    connection = FakeManagementConnection()
    service = ManagementPlaneService(connection)
    principal = ManagementPrincipal(
        key_id="mgmt_test",
        operator_id="00000000-0000-0000-0000-000000000001",
        scopes=frozenset({"issuer:write"}),
    )

    result = await service.record_governance_mutation(
        principal=principal,
        mutation=GovernanceMutation(
            action="issuer.enroll",
            target_type="issuer",
            target_id="issuer:acme-demo",
            root_program_id="root:qrtrust-demo:2026",
            delegated_authority_id="authority:qrtrust-demo:merchant-web",
            issuer_id="issuer:acme-demo",
            state_sql=(
                "insert into qr_trust.issuers (root_program_id, "
                "delegated_authority_id, issuer_id, display_name, "
                "issuer_class, assurance_tier, enrollment_status) "
                "values ($1, $2, $3, $4, 'business', "
                "'domain_controlled', 'pending')"
            ),
            state_values=(
                "root:qrtrust-demo:2026",
                "authority:qrtrust-demo:merchant-web",
                "issuer:acme-demo",
                "ACME Demo",
            ),
            after_json={"issuer_id": "issuer:acme-demo", "status": "pending"},
            event_type="issuer.enrollment.requested",
        ),
        request_id="req_test",
        idempotency_key=None,
    )

    assert result.state_rows == 1
    assert result.audit_rows == 1
    assert result.outbox_rows == 1
    assert connection.transaction_committed is True
    assert len(connection.execute_calls) == 3
    assert "qr_trust.issuers" in connection.execute_calls[0][0]
    assert "qr_trust.governance_audit_log" in connection.execute_calls[1][0]
    assert "qr_trust.event_outbox" in connection.execute_calls[2][0]
    outbox_payload = json.loads(connection.execute_calls[2][11])
    assert outbox_payload["envelope"]["event_id"] == connection.execute_calls[2][1]
    assert outbox_payload["envelope"]["type"] == "issuer.enrollment.requested"
    assert outbox_payload["envelope"]["root_program_id"] == "root:qrtrust-demo:2026"
    assert (
        outbox_payload["envelope"]["delegated_authority_id"]
        == "authority:qrtrust-demo:merchant-web"
    )
    assert outbox_payload["envelope"]["issuer_id"] == "issuer:acme-demo"
    assert outbox_payload["envelope"]["artifact_id"] == "issuer:acme-demo"
    assert outbox_payload["envelope"]["artifact_hash"] == connection.execute_calls[2][6]
    assert outbox_payload["envelope"]["version"] == 1
    assert outbox_payload["body"]["action"] == "issuer.enroll"
    assert outbox_payload["body"]["after"] == {
        "issuer_id": "issuer:acme-demo",
        "status": "pending",
    }


@pytest.mark.asyncio
async def test_record_governance_mutation_counts_cte_select_state_writes() -> None:
    connection = FakeManagementConnection(
        execute_statuses=["SELECT 1", "INSERT 0 1", "INSERT 0 1"]
    )
    service = ManagementPlaneService(connection)
    principal = ManagementPrincipal(
        key_id="mgmt_test",
        operator_id=None,
        scopes=frozenset({"admin:*"}),
    )

    result = await service.record_governance_mutation(
        principal=principal,
        mutation=GovernanceMutation(
            action="nats_subscriber.authorize",
            target_type="nats_subscriber",
            target_id="subscriber:reference-governance",
            root_program_id=None,
            delegated_authority_id=None,
            issuer_id=None,
            state_sql="with upserted as (...) select subscriber_id from upserted",
            state_values=(),
            after_json={"subscriber_id": "subscriber:reference-governance"},
            event_type="nats.subscriber.authorization.changed",
        ),
        request_id="req_test",
        idempotency_key=None,
    )

    assert result.state_rows == 1
    assert result.audit_rows == 1
    assert result.outbox_rows == 1


@pytest.mark.asyncio
async def test_record_rootless_management_mutation_uses_control_plane_subject_root() -> None:
    connection = FakeManagementConnection(
        execute_statuses=["SELECT 1", "INSERT 0 1", "INSERT 0 1"]
    )
    service = ManagementPlaneService(connection)
    principal = ManagementPrincipal(
        key_id="mgmt_test",
        operator_id=None,
        scopes=frozenset({"admin:*"}),
    )

    await service.record_governance_mutation(
        principal=principal,
        mutation=GovernanceMutation(
            action="nats_subscriber.authorize",
            target_type="nats_subscriber",
            target_id="subscriber:reference-governance",
            root_program_id=None,
            delegated_authority_id=None,
            issuer_id=None,
            state_sql="with upserted as (...) select subscriber_id from upserted",
            state_values=(),
            after_json={"subscriber_id": "subscriber:reference-governance"},
            event_type="nats.subscriber.authorization.changed",
        ),
        request_id="req_test",
        idempotency_key=None,
    )

    outbox_call = connection.execute_calls[2]
    outbox_payload = json.loads(outbox_call[11])

    assert outbox_call[7] is None
    assert outbox_payload["envelope"]["root_program_id"] == "control-plane"


@pytest.mark.asyncio
async def test_trust_key_upsert_mutation_writes_state_audit_and_outbox() -> None:
    connection = FakeManagementConnection()
    service = ManagementPlaneService(connection)
    principal = ManagementPrincipal(
        key_id="mgmt_trust_key_admin",
        operator_id=None,
        scopes=frozenset({"trust_keys:write"}),
    )

    result = await service.record_governance_mutation(
        principal=principal,
        mutation=build_trust_key_upsert_mutation(
            key_id="key:authority:qrtrust-demo:merchant-web:ed25519:v1",
            root_program_id="root:qrtrust-demo:2026",
            delegated_authority_id="authority:qrtrust-demo:merchant-web",
            signer_id="authority:qrtrust-demo:merchant-web",
            algorithm_id="ed25519",
            public_key_material_ref="managed://qrtrust/authority/public/v1",
            public_key_material_pem=None,
            scope="delegated_authority",
            key_status="active",
            not_before=None,
            not_after=None,
        ),
        request_id="req_trust_key_upsert",
        idempotency_key=None,
    )

    assert result.state_rows == 1
    assert result.audit_rows == 1
    assert result.outbox_rows == 1
    assert "qr_trust.trust_keys" in connection.execute_calls[0][0]
    assert connection.execute_calls[0][1:10] == (
        "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
        "root:qrtrust-demo:2026",
        "authority:qrtrust-demo:merchant-web",
        "authority:qrtrust-demo:merchant-web",
        "ed25519",
        "managed://qrtrust/authority/public/v1",
        None,
        "delegated_authority",
        "active",
    )
    assert connection.execute_calls[1][3] == "trust_key.upsert"
    assert connection.execute_calls[1][4] == "trust_key"
    assert connection.execute_calls[2][2] == "trust_key.upserted"


@pytest.mark.asyncio
async def test_trust_key_status_update_requires_existing_key() -> None:
    connection = FakeManagementConnection(fetchrow_result={"changed_rows": 1})
    service = ManagementPlaneService(connection)
    principal = ManagementPrincipal(
        key_id="mgmt_trust_key_admin",
        operator_id=None,
        scopes=frozenset({"trust_keys:write"}),
    )

    result = await service.record_governance_mutation(
        principal=principal,
        mutation=build_trust_key_status_update_mutation(
            root_program_id="root:qrtrust-demo:2026",
            key_id="key:authority:qrtrust-demo:merchant-web:ed25519:v1",
            key_status="revoked",
        ),
        request_id="req_trust_key_status",
        idempotency_key=None,
    )

    assert result.state_rows == 1
    assert "qr_trust.trust_keys" in connection.fetchrow_calls[0][0]
    assert connection.fetchrow_calls[0][1:] == (
        "root:qrtrust-demo:2026",
        "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
        "revoked",
    )
    assert connection.execute_calls[0][3] == "trust_key.status.update"


@pytest.mark.asyncio
async def test_record_governance_mutation_completes_new_idempotency_key() -> None:
    connection = FakeManagementConnection()
    service = ManagementPlaneService(connection)
    principal = ManagementPrincipal(
        key_id="mgmt_test",
        operator_id=None,
        scopes=frozenset({"admin:*"}),
    )

    result = await service.record_governance_mutation(
        principal=principal,
        mutation=GovernanceMutation(
            action="issuer.enroll",
            target_type="issuer",
            target_id="issuer:acme-demo",
            root_program_id="root:qrtrust-demo:2026",
            delegated_authority_id="authority:qrtrust-demo:merchant-web",
            issuer_id="issuer:acme-demo",
            state_sql="insert into qr_trust.issuers (...) values (...)",
            state_values=(),
            after_json={"issuer_id": "issuer:acme-demo"},
            event_type="issuer.enrollment.requested",
        ),
        request_id="req_first",
        idempotency_key="idem_issuer_acme",
    )

    assert result.state_rows == 1
    assert result.audit_rows == 1
    assert result.outbox_rows == 1
    assert len(connection.execute_calls) == 5
    assert "qr_trust.idempotency_keys" in connection.execute_calls[0][0]
    assert "qr_trust.issuers" in connection.execute_calls[1][0]
    assert "qr_trust.governance_audit_log" in connection.execute_calls[2][0]
    assert "qr_trust.event_outbox" in connection.execute_calls[3][0]
    assert "qr_trust.idempotency_keys" in connection.execute_calls[4][0]


@pytest.mark.asyncio
async def test_record_governance_mutation_replays_completed_idempotency_key() -> None:
    connection = FakeManagementConnection(execute_statuses=["INSERT 0 0"])
    service = ManagementPlaneService(connection)
    principal = ManagementPrincipal(
        key_id="mgmt_test",
        operator_id=None,
        scopes=frozenset({"admin:*"}),
    )

    result = await service.record_governance_mutation(
        principal=principal,
        mutation=GovernanceMutation(
            action="issuer.enroll",
            target_type="issuer",
            target_id="issuer:acme-demo",
            root_program_id="root:qrtrust-demo:2026",
            delegated_authority_id="authority:qrtrust-demo:merchant-web",
            issuer_id="issuer:acme-demo",
            state_sql="insert into qr_trust.issuers (...) values (...)",
            state_values=(),
            after_json={"issuer_id": "issuer:acme-demo"},
            event_type="issuer.enrollment.requested",
        ),
        request_id="req_retry",
        idempotency_key="idem_issuer_acme",
    )

    assert result.state_rows == 1
    assert result.audit_rows == 1
    assert result.outbox_rows == 1
    assert connection.transaction_committed is True
    assert len(connection.execute_calls) == 1
    assert "qr_trust.idempotency_keys" in connection.execute_calls[0][0]
    assert len(connection.fetchrow_calls) == 1


@pytest.mark.asyncio
async def test_record_governance_mutation_rejects_conflicting_idempotency_key() -> None:
    class ConflictingIdempotencyConnection(FakeManagementConnection):
        async def fetchrow(self, *args: Any) -> dict[str, Any] | None:
            self.fetchrow_calls.append(args)
            return {
                "request_hash": "sha256:different",
                "status": "completed",
                "response_json": {
                    "state_rows": 1,
                    "audit_rows": 1,
                    "outbox_rows": 1,
                },
            }

    connection = ConflictingIdempotencyConnection(execute_statuses=["INSERT 0 0"])
    service = ManagementPlaneService(connection)
    principal = ManagementPrincipal(
        key_id="mgmt_test",
        operator_id=None,
        scopes=frozenset({"admin:*"}),
    )

    with pytest.raises(IdempotencyConflictError):
        await service.record_governance_mutation(
            principal=principal,
            mutation=GovernanceMutation(
                action="issuer.enroll",
                target_type="issuer",
                target_id="issuer:acme-demo",
                root_program_id="root:qrtrust-demo:2026",
                delegated_authority_id="authority:qrtrust-demo:merchant-web",
                issuer_id="issuer:acme-demo",
                state_sql="insert into qr_trust.issuers (...) values (...)",
                state_values=(),
                after_json={"issuer_id": "issuer:acme-demo"},
                event_type="issuer.enrollment.requested",
            ),
            request_id="req_conflict",
            idempotency_key="idem_issuer_acme",
        )

    assert connection.transaction_rolled_back is True
    assert len(connection.execute_calls) == 1
    assert len(connection.fetchrow_calls) == 1


@pytest.mark.asyncio
async def test_expired_idempotency_key_reuse_gets_new_outbox_event() -> None:
    principal = ManagementPrincipal(
        key_id="mgmt_test",
        operator_id=None,
        scopes=frozenset({"admin:*"}),
    )
    first_connection = FakeManagementConnection()
    second_connection = FakeManagementConnection()

    await ManagementPlaneService(first_connection).record_governance_mutation(
        principal=principal,
        mutation=GovernanceMutation(
            action="destination_policy.status.update",
            target_type="destination_policy",
            target_id="policy:acme-demo:web-payments:v1",
            root_program_id="root:qrtrust-demo:2026",
            delegated_authority_id="authority:qrtrust-demo:merchant-web",
            issuer_id="issuer:acme-demo",
            state_sql="update qr_trust.destination_policies set status = $1",
            state_values=("suspended",),
            after_json={
                "destination_policy_id": "policy:acme-demo:web-payments:v1",
                "status": "suspended",
            },
            event_type="destination_policy.status.changed",
            destination_policy_id="policy:acme-demo:web-payments:v1",
        ),
        request_id="req_first",
        idempotency_key="idem_expired_policy_status",
    )
    await ManagementPlaneService(second_connection).record_governance_mutation(
        principal=principal,
        mutation=GovernanceMutation(
            action="destination_policy.status.update",
            target_type="destination_policy",
            target_id="policy:acme-demo:web-payments:v1",
            root_program_id="root:qrtrust-demo:2026",
            delegated_authority_id="authority:qrtrust-demo:merchant-web",
            issuer_id="issuer:acme-demo",
            state_sql="update qr_trust.destination_policies set status = $1",
            state_values=("revoked",),
            after_json={
                "destination_policy_id": "policy:acme-demo:web-payments:v1",
                "status": "revoked",
            },
            event_type="destination_policy.status.changed",
            destination_policy_id="policy:acme-demo:web-payments:v1",
        ),
        request_id="req_second",
        idempotency_key="idem_expired_policy_status",
    )

    first_outbox_event_id = first_connection.execute_calls[3][1]
    second_outbox_event_id = second_connection.execute_calls[3][1]
    assert first_outbox_event_id != second_outbox_event_id


@pytest.mark.asyncio
async def test_expired_idempotency_key_same_payload_gets_new_outbox_event() -> None:
    principal = ManagementPrincipal(
        key_id="mgmt_test",
        operator_id=None,
        scopes=frozenset({"admin:*"}),
    )
    first_connection = FakeManagementConnection()
    second_connection = FakeManagementConnection()
    mutation = GovernanceMutation(
        action="destination_policy.status.update",
        target_type="destination_policy",
        target_id="policy:acme-demo:web-payments:v1",
        root_program_id="root:qrtrust-demo:2026",
        delegated_authority_id="authority:qrtrust-demo:merchant-web",
        issuer_id="issuer:acme-demo",
        state_sql="update qr_trust.destination_policies set status = $1",
        state_values=("suspended",),
        after_json={
            "destination_policy_id": "policy:acme-demo:web-payments:v1",
            "status": "suspended",
        },
        event_type="destination_policy.status.changed",
        destination_policy_id="policy:acme-demo:web-payments:v1",
    )

    await ManagementPlaneService(first_connection).record_governance_mutation(
        principal=principal,
        mutation=mutation,
        request_id="req_first",
        idempotency_key="idem_expired_policy_status",
    )
    await ManagementPlaneService(second_connection).record_governance_mutation(
        principal=principal,
        mutation=mutation,
        request_id="req_second",
        idempotency_key="idem_expired_policy_status",
    )

    first_outbox_event_id = first_connection.execute_calls[3][1]
    second_outbox_event_id = second_connection.execute_calls[3][1]
    assert first_outbox_event_id != second_outbox_event_id


@pytest.mark.asyncio
async def test_record_governance_mutation_rejects_failed_required_state_write() -> None:
    connection = FakeManagementConnection(fetchrow_result={"changed_rows": 0})
    service = ManagementPlaneService(connection)
    principal = ManagementPrincipal(
        key_id="mgmt_test",
        operator_id=None,
        scopes=frozenset({"admin:*"}),
    )

    with pytest.raises(GovernancePreconditionFailedError):
        await service.record_governance_mutation(
            principal=principal,
            mutation=GovernanceMutation(
                action="destination_policy.upsert",
                target_type="destination_policy",
                target_id="policy:acme-demo:web-payments:v1",
                root_program_id="root:qrtrust-demo:2026",
                delegated_authority_id="authority:qrtrust-demo:merchant-web",
                issuer_id="issuer:acme-demo",
                state_sql="with upserted as (...) select 0 as changed_rows",
                state_values=(),
                after_json={
                    "destination_policy_id": "policy:acme-demo:web-payments:v1"
                },
                event_type="destination_policy.upserted",
                destination_policy_id="policy:acme-demo:web-payments:v1",
                require_state_rows=True,
            ),
            request_id="req_test",
            idempotency_key=None,
        )

    assert connection.transaction_rolled_back is True
    assert len(connection.fetchrow_calls) == 1
    assert len(connection.execute_calls) == 0


def test_build_issuer_enrollment_mutation_uses_pending_status() -> None:
    mutation = build_issuer_enrollment_mutation(
        root_program_id="root:qrtrust-demo:2026",
        delegated_authority_id="authority:qrtrust-demo:merchant-web",
        issuer_id="issuer:acme-demo",
        display_name="ACME Demo",
        issuer_class="business",
        assurance_tier="domain_controlled",
    )

    assert mutation.action == "issuer.enroll"
    assert mutation.target_type == "issuer"
    assert mutation.target_id == "issuer:acme-demo"
    assert mutation.event_type == "issuer.enrollment.requested"
    assert "enrollment_status" in mutation.state_sql
    assert mutation.after_json["enrollment_status"] == "pending"


def test_build_domain_proof_upsert_mutation_uses_issuer_namespace() -> None:
    mutation = build_domain_proof_upsert_mutation(
        root_program_id="root:qrtrust-demo:2026",
        delegated_authority_id="authority:qrtrust-demo:merchant-web",
        issuer_id="issuer:acme-demo",
        domain="acme.example",
        proof_method="manual_review",
        verification_status="verified",
        expires_at=datetime(2026, 12, 31, 23, 59, 59, tzinfo=timezone.utc),
        evidence_ref="operator://manual-review/acme.example",
    )

    assert mutation.action == "domain_proof.upsert"
    assert mutation.target_type == "domain_proof"
    assert mutation.target_id == "acme.example"
    assert mutation.root_program_id == "root:qrtrust-demo:2026"
    assert mutation.delegated_authority_id == "authority:qrtrust-demo:merchant-web"
    assert mutation.issuer_id == "issuer:acme-demo"
    assert mutation.event_type == "domain_proof.upserted"
    assert "qr_trust.issuer_domain_proofs" in mutation.state_sql
    assert "verification_status in ('pending','verified')" in mutation.state_sql
    assert mutation.after_json["domain"] == "acme.example"
    assert mutation.after_json["verification_status"] == "verified"
    assert mutation.after_json["expires_at"] == "2026-12-31T23:59:59+00:00"


def test_build_issuer_status_update_mutation_sets_active_status() -> None:
    mutation = build_issuer_status_update_mutation(
        root_program_id="root:qrtrust-demo:2026",
        delegated_authority_id="authority:qrtrust-demo:merchant-web",
        issuer_id="issuer:acme-demo",
        enrollment_status="active",
    )

    assert mutation.action == "issuer.status.update"
    assert mutation.target_type == "issuer"
    assert mutation.target_id == "issuer:acme-demo"
    assert mutation.event_type == "issuer.status.changed"
    assert "qr_trust.issuers" in mutation.state_sql
    assert "enrollment_status = $4" in mutation.state_sql
    assert mutation.require_state_rows is True
    assert mutation.after_json["enrollment_status"] == "active"


def test_build_runtime_safety_provider_upsert_mutation_targets_provider_registry() -> None:
    mutation = build_runtime_safety_provider_upsert_mutation(
        provider_id="deterministic-runtime-safety",
        display_name="Deterministic runtime safety",
        base_url=None,
        verdict_ttl_seconds=300,
        stale_behavior="downgrade_to_caution",
        unavailable_behavior="block",
        status="active",
    )

    assert mutation.action == "runtime_provider.upsert"
    assert mutation.target_type == "runtime_safety_provider"
    assert mutation.target_id == "deterministic-runtime-safety"
    assert mutation.event_type == "runtime_provider.upserted"
    assert "qr_trust.runtime_safety_providers" in mutation.state_sql
    assert mutation.state_values == (
        "deterministic-runtime-safety",
        "Deterministic runtime safety",
        None,
        300,
        "downgrade_to_caution",
        "block",
        "active",
    )
    assert mutation.after_json["provider_id"] == "deterministic-runtime-safety"
    assert mutation.after_json["unavailable_behavior"] == "block"


def test_build_destination_policy_upsert_mutation_requires_active_issuer_and_proof() -> None:
    mutation = build_destination_policy_upsert_mutation(
        root_program_id="root:qrtrust-demo:2026",
        delegated_authority_id="authority:qrtrust-demo:merchant-web",
        issuer_id="issuer:acme-demo",
        destination_policy_id="policy:acme-demo:web-payments:v1",
        usage_policy="reusable_public",
        approved_destinations=[
            {
                "destination_id": "dest:acme-demo:pay",
                "expected_final_url": "https://acme.example/pay",
                "allowed_hosts": ["acme.example"],
                "allow_subdomains": False,
                "path_prefixes": ["/pay"],
                "query_policy": "allow_known_payment_query",
            }
        ],
        redirect_policy={
            "resolver_urls": [],
            "expected_final_destinations": ["https://acme.example/pay"],
            "allowed_redirect_hosts": [],
            "max_redirect_hops": 0,
            "nested_shorteners_allowed": False,
            "scanner_must_display_resolver_and_final_destination": True,
        },
        runtime_safety_policy={
            "provider": "deterministic-runtime-safety",
            "verdict_ttl_seconds": 300,
            "stale_behavior": "downgrade_to_caution",
            "unavailable_behavior": "downgrade_to_caution",
        },
        host_scopes=[{"host": "acme.example", "allow_subdomains": False}],
    )

    assert mutation.action == "destination_policy.upsert"
    assert mutation.target_type == "destination_policy"
    assert mutation.target_id == "policy:acme-demo:web-payments:v1"
    assert mutation.event_type == "destination_policy.upserted"
    assert mutation.destination_policy_id == "policy:acme-demo:web-payments:v1"
    assert mutation.require_state_rows is True
    assert "qr_trust.destination_policies" in mutation.state_sql
    assert "enrollment_status = 'active'" in mutation.state_sql
    assert "issuer_domain_proofs" in mutation.state_sql
    assert mutation.after_json["publication_gate"]["required_hosts"] == [
        {"host": "acme.example", "allow_subdomains": False}
    ]


def test_build_destination_policy_status_update_mutation_revokes_existing_policy() -> None:
    mutation = build_destination_policy_status_update_mutation(
        root_program_id="root:qrtrust-demo:2026",
        delegated_authority_id="authority:qrtrust-demo:merchant-web",
        issuer_id="issuer:acme-demo",
        destination_policy_id="policy:acme-demo:web-payments:v1",
        status="revoked",
    )

    assert mutation.action == "destination_policy.status.update"
    assert mutation.target_type == "destination_policy"
    assert mutation.target_id == "policy:acme-demo:web-payments:v1"
    assert mutation.event_type == "destination_policy.status.changed"
    assert mutation.destination_policy_id == "policy:acme-demo:web-payments:v1"
    assert mutation.require_state_rows is True
    assert "qr_trust.destination_policies" in mutation.state_sql
    assert "status = $5" in mutation.state_sql
    assert mutation.state_values[4] == "revoked"
    assert mutation.after_json["status"] == "revoked"


def test_build_root_program_upsert_mutation_uses_active_status() -> None:
    mutation = build_root_program_upsert_mutation(
        root_program_id="root:qrtrust-demo:2026",
        name="QR Trust Demo Root",
        program_scope="demo merchant QR trust",
        accepted_algorithm_ids=["ES256"],
        policy_constraints={"max_redirect_hops": 1},
    )

    assert mutation.action == "root_program.upsert"
    assert mutation.target_type == "root_program"
    assert mutation.target_id == "root:qrtrust-demo:2026"
    assert mutation.root_program_id == "root:qrtrust-demo:2026"
    assert mutation.event_type == "root_program.upserted"
    assert "qr_trust.root_programs" in mutation.state_sql
    assert "version = qr_trust.root_programs.version + 1" in mutation.state_sql
    assert mutation.after_json["status"] == "active"


def test_build_delegated_authority_upsert_mutation_uses_active_status() -> None:
    mutation = build_delegated_authority_upsert_mutation(
        root_program_id="root:qrtrust-demo:2026",
        delegated_authority_id="authority:qrtrust-demo:merchant-web",
        name="Merchant Web Authority",
        authority_type="merchant_operator",
        scope={"domains": ["acme.example"]},
        assurance_requirements={"domain_proof": "required"},
    )

    assert mutation.action == "delegated_authority.upsert"
    assert mutation.target_type == "delegated_authority"
    assert mutation.target_id == "authority:qrtrust-demo:merchant-web"
    assert mutation.root_program_id == "root:qrtrust-demo:2026"
    assert mutation.delegated_authority_id == "authority:qrtrust-demo:merchant-web"
    assert mutation.event_type == "delegated_authority.upserted"
    assert "qr_trust.delegated_authorities" in mutation.state_sql
    assert "version = qr_trust.delegated_authorities.version + 1" in mutation.state_sql
    assert mutation.after_json["status"] == "active"


def test_build_nats_subscriber_authorization_mutation_uses_active_subjects() -> None:
    mutation = build_nats_subscriber_authorization_mutation(
        subscriber_id="subscriber:reference-governance",
        display_name="Reference governance subscriber",
        durable_name="qrtrust_governance_subscriber_worker",
        description="Consumes governance artifact notifications.",
        subjects=[
            "qrtrust.*.issuer.>",
            "qrtrust.*.destination.>",
        ],
    )

    assert mutation.action == "nats_subscriber.authorize"
    assert mutation.target_type == "nats_subscriber"
    assert mutation.target_id == "subscriber:reference-governance"
    assert mutation.event_type == "nats.subscriber.authorization.changed"
    assert "qr_trust.nats_subscribers" in mutation.state_sql
    assert "qr_trust.nats_subscriber_subjects" in mutation.state_sql
    assert mutation.after_json["status"] == "active"
    assert mutation.after_json["subjects"] == [
        "qrtrust.*.issuer.>",
        "qrtrust.*.destination.>",
    ]
