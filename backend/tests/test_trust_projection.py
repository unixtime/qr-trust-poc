from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from backend.app.services.scanner_trust_store import ScannerTrustStore
from backend.app.services.trust_projection import (
    TrustProjectionManager,
    TrustStateUnavailableError,
    load_trust_snapshot,
    project_certificate_row,
    project_issuer_row,
)
from backend.app.services.trust_state import TrustStateToken

_NOW = datetime(2026, 9, 1, 12, 0, 0, tzinfo=UTC)


def _make_pem() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return (
        key.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("ascii")
    )


_PEM = _make_pem()


def _cert_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "certificate_id": "cert-acme-1",
        "root_program_id": "rp-1",
        "delegated_authority_id": "da-1",
        "issuer_id": "acme",
        "algorithm_id": "RS256",
        "public_key_material_pem": _PEM,
        "key_status": "active",
        "not_before": _NOW - timedelta(days=1),
        "not_after": _NOW + timedelta(days=30),
        "revoked_at": None,
        "revocation_reason": None,
    }
    row.update(overrides)
    return row


def _issuer_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "root_program_id": "rp-1",
        "delegated_authority_id": "da-1",
        "issuer_id": "acme",
        "display_name": "Acme Payments",
        "enrollment_status": "active",
        "allow_subdomains": False,
        "expires_at": None,
        "created_at": _NOW - timedelta(days=10),
    }
    row.update(overrides)
    return row


class _FakeTransaction:
    async def __aenter__(self) -> "_FakeTransaction":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class FakeConnection:
    def __init__(
        self,
        *,
        governance_row: dict[str, object] | None,
        certificate_rows: list[dict[str, object]] | None = None,
        issuer_rows: list[dict[str, object]] | None = None,
        proof_rows: list[dict[str, object]] | None = None,
    ) -> None:
        self.governance_row = governance_row
        self.certificate_rows = certificate_rows or []
        self.issuer_rows = issuer_rows or []
        self.proof_rows = proof_rows or []
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []
        self.closed = False

    def transaction(self, *args: object, **kwargs: object) -> _FakeTransaction:
        return _FakeTransaction()

    async def fetchrow(self, query: str, *params: object) -> dict[str, object] | None:
        if "qr_trust.governance_versions" in query:
            return self.governance_row
        raise AssertionError(f"unexpected fetchrow: {query}")

    async def fetch(self, query: str, *params: object) -> list[dict[str, object]]:
        self.fetch_calls.append((query, params))
        # Most specific table name first: dispatch is by substring.
        if "qr_trust.issuer_domain_proofs" in query:
            return list(self.proof_rows)
        if "qr_trust.issuer_certificates" in query:
            return list(self.certificate_rows)
        if "qr_trust.issuers" in query:
            return list(self.issuer_rows)
        raise AssertionError(f"unexpected fetch: {query}")

    async def close(self) -> None:
        self.closed = True


class _ConnectFactory:
    def __init__(self, build) -> None:
        self._build = build
        self.connections: list[FakeConnection] = []

    async def __call__(self) -> FakeConnection:
        connection = self._build()
        self.connections.append(connection)
        return connection


async def _failing_connect() -> FakeConnection:
    raise ConnectionError("database unreachable")


def test_active_certificate_row_projects_to_key_entry() -> None:
    entry, defect = project_certificate_row(_cert_row())
    assert defect is None
    assert entry is not None
    assert entry.key_ref == "cert-acme-1"
    assert entry.issuer_id == "acme"
    assert entry.state == "active"
    assert entry.public_key_pem == _PEM
    assert entry.source == "projection"


def test_rotated_status_projects_to_retired() -> None:
    entry, defect = project_certificate_row(_cert_row(key_status="rotated"))
    assert defect is None
    assert entry is not None
    assert entry.state == "retired"


def test_unrecognized_status_is_excluded_as_defect() -> None:
    entry, defect = project_certificate_row(_cert_row(key_status="haunted"))
    assert entry is None
    assert defect is not None
    assert defect.defect_class == "excluded-verifying-row"
    assert defect.row_ref == "cert-acme-1"


def test_material_less_verifying_row_is_excluded() -> None:
    entry, defect = project_certificate_row(
        _cert_row(public_key_material_pem=None)
    )
    assert entry is None
    assert defect is not None
    assert defect.defect_class == "excluded-verifying-row"


def test_material_less_revoked_row_is_projected_with_defect() -> None:
    entry, defect = project_certificate_row(
        _cert_row(
            key_status="revoked",
            public_key_material_pem=None,
            revoked_at=_NOW,
            revocation_reason="compromised",
        )
    )
    assert entry is not None
    assert entry.state == "revoked"
    assert entry.public_key_pem is None
    assert entry.revocation_reason == "compromised"
    assert defect is not None
    assert defect.defect_class == "projected-blocking-row"


def test_pending_issuer_is_not_projected() -> None:
    record = project_issuer_row(_issuer_row(enrollment_status="pending"), {})
    assert record is None


def test_issuer_row_projects_with_verified_domains() -> None:
    record = project_issuer_row(
        _issuer_row(), {"Acme.Example.": None, "pay.acme.example": _NOW}
    )
    assert record is not None
    assert record.issuer_id == "acme"
    assert record.issuer_name == "Acme Payments"
    assert record.root_id == "rp-1"
    assert record.status == "active"
    assert record.source == "projection"
    assert dict(record.verified_domains) == {
        "acme.example": None,
        "pay.acme.example": _NOW,
    }


async def test_load_trust_snapshot_assembles_projection() -> None:
    connection = FakeConnection(
        governance_row={"epoch": "epoch-a", "version": 7},
        certificate_rows=[
            _cert_row(),
            _cert_row(
                certificate_id="cert-acme-2",
                key_status="revoked",
                public_key_material_pem=None,
                revoked_at=_NOW,
            ),
        ],
        issuer_rows=[
            _issuer_row(),
            _issuer_row(
                issuer_id="newco",
                display_name="NewCo",
                enrollment_status="pending",
            ),
        ],
        proof_rows=[
            {"issuer_id": "acme", "domain": "acme.example", "expires_at": None}
        ],
    )
    snapshot = await load_trust_snapshot(connection)
    assert snapshot.token == TrustStateToken(epoch="epoch-a", version=7)
    assert [entry.key_ref for entry in snapshot.keys] == [
        "cert-acme-1",
        "cert-acme-2",
    ]
    assert all(entry.source == "projection" for entry in snapshot.keys)
    assert [record.issuer_id for record in snapshot.issuers] == ["acme"]
    assert dict(snapshot.issuers[0].verified_domains) == {"acme.example": None}
    assert [defect.defect_class for defect in snapshot.defects] == [
        "projected-blocking-row"
    ]


async def test_load_trust_snapshot_rejects_canonical_domain_collision() -> None:
    connection = FakeConnection(
        governance_row={"epoch": "epoch-a", "version": 7},
        issuer_rows=[_issuer_row()],
        proof_rows=[
            {"issuer_id": "acme", "domain": "Acme.Example.", "expires_at": None},
            {"issuer_id": "acme", "domain": "acme.example", "expires_at": None},
        ],
    )

    with pytest.raises(
        TrustStateUnavailableError,
        match="ambiguous verified-domain state",
    ):
        await load_trust_snapshot(connection)


async def test_load_trust_snapshot_requires_governance_row() -> None:
    connection = FakeConnection(governance_row=None)
    with pytest.raises(TrustStateUnavailableError):
        await load_trust_snapshot(connection)


async def test_manager_without_database_is_inert() -> None:
    manager = TrustProjectionManager(max_staleness_seconds=30)
    state = await manager.ensure_fresh(
        store=ScannerTrustStore(), connect=None, now=_NOW
    )
    assert state == "inert"
    assert manager.token is None


def _healthy_connection() -> FakeConnection:
    return FakeConnection(
        governance_row={"epoch": "epoch-a", "version": 1},
        certificate_rows=[_cert_row()],
        issuer_rows=[_issuer_row()],
        proof_rows=[
            {"issuer_id": "acme", "domain": "acme.example", "expires_at": None}
        ],
    )


async def test_manager_hydrates_then_reuses_unchanged_token() -> None:
    store = ScannerTrustStore()
    manager = TrustProjectionManager(max_staleness_seconds=30)
    factory = _ConnectFactory(_healthy_connection)

    first = await manager.ensure_fresh(store=store, connect=factory, now=_NOW)
    assert first == "fresh"
    assert manager.token == TrustStateToken(epoch="epoch-a", version=1)
    assert any(entry.key_ref == "cert-acme-1" for entry in store.keys())
    assert store.projection_defects == ()

    second = await manager.ensure_fresh(
        store=store, connect=factory, now=_NOW + timedelta(seconds=5)
    )
    assert second == "reused"
    assert len(factory.connections) == 2
    assert factory.connections[1].fetch_calls == []
    assert all(connection.closed for connection in factory.connections)


async def test_manager_serves_stale_within_budget_then_fails_closed() -> None:
    store = ScannerTrustStore()
    manager = TrustProjectionManager(max_staleness_seconds=30)
    factory = _ConnectFactory(_healthy_connection)
    assert (
        await manager.ensure_fresh(store=store, connect=factory, now=_NOW)
        == "fresh"
    )

    stale = await manager.ensure_fresh(
        store=store, connect=_failing_connect, now=_NOW + timedelta(seconds=10)
    )
    assert stale == "stale-served"

    # The degrade path never refreshed last_success, so the budget keeps
    # draining from the original hydration at _NOW. The +35s probe isolates a
    # mutant that incorrectly refreshes the degrade clock at the +10s call:
    # such a mutant would still be inside a false 30-second budget here.
    exhausted_near_boundary = await manager.ensure_fresh(
        store=store, connect=_failing_connect, now=_NOW + timedelta(seconds=35)
    )
    assert exhausted_near_boundary == "unavailable"

    exhausted = await manager.ensure_fresh(
        store=store, connect=_failing_connect, now=_NOW + timedelta(seconds=41)
    )
    assert exhausted == "unavailable"


async def test_manager_cold_start_failure_fails_closed() -> None:
    manager = TrustProjectionManager(max_staleness_seconds=30)
    state = await manager.ensure_fresh(
        store=ScannerTrustStore(), connect=_failing_connect, now=_NOW
    )
    assert state == "unavailable"
    assert manager.token is None


async def test_manager_records_projection_defects_on_store() -> None:
    store = ScannerTrustStore()
    manager = TrustProjectionManager(max_staleness_seconds=30)
    factory = _ConnectFactory(
        lambda: FakeConnection(
            governance_row={"epoch": "epoch-a", "version": 2},
            certificate_rows=[
                _cert_row(
                    certificate_id="cert-acme-2",
                    key_status="revoked",
                    public_key_material_pem=None,
                    revoked_at=_NOW,
                )
            ],
            issuer_rows=[_issuer_row()],
        )
    )
    assert (
        await manager.ensure_fresh(store=store, connect=factory, now=_NOW)
        == "fresh"
    )
    assert [defect.defect_class for defect in store.projection_defects] == [
        "projected-blocking-row"
    ]


def test_verifier_stays_ephemeral_without_database(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.app.api.endpoints import verifier as verifier_module

    monkeypatch.setattr(
        verifier_module.config, "QRTRUST_NETWORK_DATABASE_URL", None
    )
    monkeypatch.setattr(verifier_module.config, "DATABASE_URL", None)
    materials = client.post("/verifier/demo-materials", json={})
    assert materials.status_code == 200
    response = client.post(
        "/verifier/verify", json=materials.json()["verify_request"]
    )
    assert response.status_code == 200
    assert response.json()["allowed"] is True


def test_verifier_fails_closed_when_trust_state_unavailable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from backend.app.api.endpoints import verifier as verifier_module

    async def _unavailable(**_kwargs: object) -> str:
        return "unavailable"

    # Instance attribute shadows the bound method, so _ensure_trust_projection
    # sees the stub without affecting other tests.
    monkeypatch.setattr(
        verifier_module._trust_projection_manager, "ensure_fresh", _unavailable
    )
    materials = client.post("/verifier/demo-materials", json={})
    assert materials.status_code == 200
    response = client.post(
        "/verifier/verify", json=materials.json()["verify_request"]
    )
    assert response.status_code == 200
    body = response.json()
    assert body["allowed"] is False
    assert body["stage"] == "key_status"
    assert body["cause"] == "trust-state-unavailable"
