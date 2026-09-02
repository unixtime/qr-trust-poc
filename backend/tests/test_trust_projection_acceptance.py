"""End-to-end acceptance for the trust projection governance loop (spec 2.5).

Only the database transport is faked: a shared mutable row dict stands in for
Postgres while the real TrustProjectionManager, the real ScannerTrustStore,
the real verdict cache, and the real HTTP surfaces do the work. Boundary
arithmetic and spelling-normalization bullets are pinned at unit level in
test_verdict_cache_governance.py; this file covers the bullets that need the
whole loop.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from backend.app.api.endpoints import verifier as verifier_module
from backend.app.services.payload_revalidation_poc import PolicyResolution
from backend.app.services.scanner_trust_store import ScannerTrustStore
from backend.app.services.trust_projection import TrustProjectionManager
from backend.tests.test_trust_projection import (
    FakeConnection,
    _cert_row,
    _issuer_row,
)


def _shared_database() -> dict[str, object]:
    return {
        "governance": {"epoch": "epoch-a", "version": 1},
        "certs": [_cert_row()],
        "issuers": [_issuer_row()],
        "proofs": [
            {"issuer_id": "acme", "domain": "acme.example", "expires_at": None}
        ],
    }


def _connect_for(db: dict[str, object]):
    async def _connect() -> FakeConnection:
        return FakeConnection(
            governance_row=dict(db["governance"]),
            certificate_rows=[dict(row) for row in db["certs"]],
            issuer_rows=[dict(row) for row in db["issuers"]],
            proof_rows=[dict(row) for row in db["proofs"]],
        )

    return _connect


def _install_projection(monkeypatch, db: dict[str, object]) -> TrustProjectionManager:
    """Point the live verifier singletons at a fresh store fed by the fake DB."""
    store = ScannerTrustStore()
    manager = TrustProjectionManager(max_staleness_seconds=30)
    connect = _connect_for(db)

    async def _ensure() -> str:
        return await manager.ensure_fresh(
            store=verifier_module._scanner_trust_store,
            connect=connect,
            now=datetime.now(tz=UTC),
        )

    monkeypatch.setattr(verifier_module, "_scanner_trust_store", store)
    monkeypatch.setattr(verifier_module, "_trust_projection_manager", manager)
    monkeypatch.setattr(verifier_module, "_ensure_trust_projection", _ensure)
    return manager


def _demo_qr_and_verify_request(
    client: TestClient, db: dict[str, object]
) -> tuple[str, dict]:
    """Mint demo materials, then align the fake DB rows with the demo key.

    Hydration replaces the whole store, so the fake certificate row must carry
    the demo certificate's ref, algorithm, and public key for the demo QR to
    keep verifying after a reload.
    """
    demo = client.post(
        "/verifier/demo-materials",
        json={"verified_domains": ["acme.example"]},
    )
    assert demo.status_code == 200
    payload = demo.json()
    cert = payload["verify_request"]["certificate"]
    db["certs"] = [
        _cert_row(
            certificate_id=cert["certificate_ref"],
            algorithm_id=cert["algorithm_id"],
            public_key_material_pem=cert["public_key_pem"],
        )
    ]
    db["issuers"] = [_issuer_row(display_name=cert["issuer_name"])]
    return payload["qr_payload"], payload["verify_request"]


def _capture_cache_writes(monkeypatch) -> list[str]:
    """Record every verdict-cache key written, passing the write through."""
    captured: list[str] = []
    original = verifier_module._verdict_cache.set

    async def _recording_set(*args: object, **kwargs: object):
        captured.append(str(args[0]))
        return await original(*args, **kwargs)

    monkeypatch.setattr(verifier_module._verdict_cache, "set", _recording_set)
    return captured


def _scan(client: TestClient, qr_payload: str) -> dict:
    response = client.post("/scanner/decisions", json={"qr_payload": qr_payload})
    assert response.status_code == 200
    return response.json()


def test_revoked_key_invalidates_cached_verdict(client, monkeypatch):
    db = _shared_database()
    _install_projection(monkeypatch, db)
    qr_payload, verify_request = _demo_qr_and_verify_request(client, db)
    written_keys = _capture_cache_writes(monkeypatch)

    first = _scan(client, qr_payload)
    assert first["decision_state"] == "verified_issuer"
    assert first["verdict_source"] == "computed"

    second = _scan(client, qr_payload)
    assert second["verdict_source"] == "cached"

    db["certs"][0].update(
        key_status="revoked",
        revoked_at=datetime.now(tz=UTC),
        revocation_reason="key compromise",
    )
    db["governance"] = {"epoch": "epoch-a", "version": 2}

    third = _scan(client, qr_payload)
    assert third["verdict_source"] == "computed"
    assert third["decision_state"] == "blocked"
    assert third["verifier_stage"] == "key_status"
    assert len(written_keys) == 2
    assert written_keys[0] != written_keys[1]

    record = verifier_module._scanner_record_for(
        verify_request["certificate"]["certificate_ref"]
    )
    assert record is not None
    narrowed_request = dict(verify_request)
    narrowed_request["certificate"] = record.certificate.model_dump()
    narrowed_request["issuer_state"] = record.issuer_state.model_dump(mode="json")
    verify = client.post("/verifier/verify", json=narrowed_request)
    assert verify.status_code == 200
    assert verify.json()["allowed"] is False
    assert verify.json()["cause"] == "key-revoked"


def test_policy_digest_change_alone_forces_cache_miss(client, monkeypatch):
    db = _shared_database()
    _install_projection(monkeypatch, db)
    qr_payload, _ = _demo_qr_and_verify_request(client, db)
    written_keys = _capture_cache_writes(monkeypatch)

    resolution = {
        "value": PolicyResolution(
            source="fixture", name="destination-policy.json", digest="a" * 64
        )
    }
    monkeypatch.setattr(
        verifier_module,
        "load_destination_policy_resolution",
        lambda: resolution["value"],
    )

    assert _scan(client, qr_payload)["verdict_source"] == "computed"
    assert _scan(client, qr_payload)["verdict_source"] == "cached"

    resolution["value"] = PolicyResolution(
        source="fixture", name="destination-policy.json", digest="b" * 64
    )

    third = _scan(client, qr_payload)
    assert third["verdict_source"] == "computed"
    assert third["decision_state"] == "verified_issuer"
    assert len(written_keys) == 2
    assert written_keys[0] != written_keys[1]


def test_epoch_collision_at_same_version_misses_verdict_cache(client, monkeypatch):
    db = _shared_database()
    _install_projection(monkeypatch, db)
    qr_payload, _ = _demo_qr_and_verify_request(client, db)
    written_keys = _capture_cache_writes(monkeypatch)

    assert _scan(client, qr_payload)["verdict_source"] == "computed"
    assert _scan(client, qr_payload)["verdict_source"] == "cached"

    db["governance"] = {"epoch": "epoch-b", "version": 1}

    third = _scan(client, qr_payload)
    assert third["verdict_source"] == "computed"
    assert third["decision_state"] == "verified_issuer"
    assert len(written_keys) == 2
    assert written_keys[0] != written_keys[1]


async def test_projection_propagates_across_stores_sharing_one_database():
    db = _shared_database()
    connect = _connect_for(db)
    now = datetime.now(tz=UTC)
    store_a, store_b = ScannerTrustStore(), ScannerTrustStore()
    manager_a = TrustProjectionManager(max_staleness_seconds=30)
    manager_b = TrustProjectionManager(max_staleness_seconds=30)

    assert await manager_a.ensure_fresh(store=store_a, connect=connect, now=now) == "fresh"
    assert await manager_b.ensure_fresh(store=store_b, connect=connect, now=now) == "fresh"
    assert {entry.state for entry in store_a.keys()} == {"active"}
    assert {entry.state for entry in store_b.keys()} == {"active"}

    db["certs"][0].update(
        key_status="revoked",
        revoked_at=now,
        revocation_reason="key compromise",
    )
    db["governance"] = {"epoch": "epoch-a", "version": 2}

    later = now + timedelta(seconds=5)
    assert await manager_a.ensure_fresh(store=store_a, connect=connect, now=later) == "fresh"
    assert await manager_b.ensure_fresh(store=store_b, connect=connect, now=later) == "fresh"
    assert {entry.state for entry in store_a.keys()} == {"revoked"}
    assert {entry.state for entry in store_b.keys()} == {"revoked"}


def test_outage_returns_unknown_and_writes_nothing(client, monkeypatch):
    monkeypatch.setattr(verifier_module, "_scanner_trust_store", ScannerTrustStore())

    demo = client.post(
        "/verifier/demo-materials",
        json={"verified_domains": ["acme.example"]},
    )
    assert demo.status_code == 200
    payload = demo.json()

    async def _unavailable() -> str:
        return "unavailable"

    monkeypatch.setattr(verifier_module, "_ensure_trust_projection", _unavailable)
    written_keys = _capture_cache_writes(monkeypatch)

    decision = _scan(client, payload["qr_payload"])
    assert decision["decision_state"] == "unknown"
    assert decision["open_allowed"] is False
    assert decision["issuer"]["status"] == "unknown"
    assert decision["verifier_stage"] == "key_status"

    verify = client.post("/verifier/verify", json=payload["verify_request"])
    assert verify.status_code == 200
    assert verify.json()["allowed"] is False
    assert verify.json()["cause"] == "trust-state-unavailable"

    assert written_keys == []
