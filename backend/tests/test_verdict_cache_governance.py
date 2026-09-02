"""Task 17: the verdict cache is keyed by the governance identity a verdict
was computed under and clamped to every time boundary it consulted."""

import copy
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

from fastapi.testclient import TestClient

from backend.app.api.endpoints import verifier as verifier_module
from backend.app.api.endpoints.verifier import (
    _verdict_cache_key,
    _verdict_cache_ttl_seconds,
)
from backend.app.schemas.poc import NarrowedVerifierRequest
from backend.app.services.payload_revalidation_poc import PolicyResolution
from backend.app.services.trust_state import TrustStateToken

RESOLUTION = PolicyResolution(
    source="fixture", name="destination-policy.json", digest="a" * 64
)


def _demo_request_dict(client: TestClient) -> dict:
    materials = client.post("/verifier/demo-materials", json={})
    assert materials.status_code == 200
    return materials.json()["verify_request"]


def _key(request: NarrowedVerifierRequest, token, resolution) -> str:
    return _verdict_cache_key(
        request, "fp-test", token=token, resolution=resolution
    )


def test_key_changes_with_trust_state_token(client):
    request = NarrowedVerifierRequest.model_validate(_demo_request_dict(client))
    baseline = _key(request, TrustStateToken(epoch="epoch-1", version=1), RESOLUTION)
    assert (
        _key(request, TrustStateToken(epoch="epoch-1", version=1), RESOLUTION)
        == baseline
    )
    assert (
        _key(request, TrustStateToken(epoch="epoch-1", version=2), RESOLUTION)
        != baseline
    )
    # Round-7 P0: a healed governance row restarts at version 1 under a new
    # epoch. Both parts hash, so (epoch-2, 1) never collides with (epoch-1, 1).
    assert (
        _key(request, TrustStateToken(epoch="epoch-2", version=1), RESOLUTION)
        != baseline
    )
    assert _key(request, None, RESOLUTION) != baseline


def test_key_changes_with_policy_resolution(client):
    request = NarrowedVerifierRequest.model_validate(_demo_request_dict(client))
    token = TrustStateToken(epoch="epoch-1", version=1)
    baseline = _key(request, token, RESOLUTION)
    edited = PolicyResolution(
        source="fixture", name="destination-policy.json", digest="b" * 64
    )
    assert _key(request, token, edited) != baseline
    assert _key(request, token, None) != baseline


def test_key_identical_for_legacy_and_mapping_domain_spellings(client):
    raw = _demo_request_dict(client)
    token = TrustStateToken(epoch="epoch-1", version=1)
    legacy = copy.deepcopy(raw)
    legacy["issuer_state"]["verified_domains"] = ["acme.example"]
    mapping = copy.deepcopy(raw)
    mapping["issuer_state"]["verified_domains"] = {"acme.example": None}
    key_legacy = _key(NarrowedVerifierRequest.model_validate(legacy), token, RESOLUTION)
    key_mapping = _key(
        NarrowedVerifierRequest.model_validate(mapping), token, RESOLUTION
    )
    # The key hashes the validated model dump, so schema normalization runs
    # before hashing and both spellings land on one cache entry (round-8 P2).
    assert key_legacy == key_mapping


def test_ttl_clamps_to_soonest_future_boundary(monkeypatch):
    monkeypatch.setattr(
        verifier_module.config, "VERIFIER_VERDICT_CACHE_TTL_SECONDS", 600
    )
    soon = datetime.now(timezone.utc) + timedelta(seconds=60)
    ttl = _verdict_cache_ttl_seconds(None, consulted_boundaries=[soon])
    assert 0 < ttl <= 60


def test_ttl_ignores_none_boundaries(monkeypatch):
    monkeypatch.setattr(
        verifier_module.config, "VERIFIER_VERDICT_CACHE_TTL_SECONDS", 600
    )
    # A NULL proof expiry means "no boundary", never "expired".
    assert _verdict_cache_ttl_seconds(None, consulted_boundaries=[None, None]) == 600


def test_ttl_excludes_past_boundary(monkeypatch):
    monkeypatch.setattr(
        verifier_module.config, "VERIFIER_VERDICT_CACHE_TTL_SECONDS", 600
    )
    # The serve-time rule already folded a past boundary into the deny; the
    # deny stays correct until a row change bumps the token, so the verdict
    # still caches at the full configured TTL.
    past = datetime.now(timezone.utc) - timedelta(days=1)
    assert _verdict_cache_ttl_seconds(None, consulted_boundaries=[past]) == 600


def test_ttl_still_zero_when_claims_already_expired(monkeypatch):
    monkeypatch.setattr(
        verifier_module.config, "VERIFIER_VERDICT_CACHE_TTL_SECONDS", 600
    )
    expired = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    future = datetime.now(timezone.utc) + timedelta(seconds=30)
    assert _verdict_cache_ttl_seconds(expired, consulted_boundaries=[future]) == 0


def test_ttl_naive_boundary_treated_as_utc(monkeypatch):
    monkeypatch.setattr(
        verifier_module.config, "VERIFIER_VERDICT_CACHE_TTL_SECONDS", 600
    )
    naive = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=45)
    ttl = _verdict_cache_ttl_seconds(None, consulted_boundaries=[naive])
    assert 0 < ttl <= 45


def _capture_writes(monkeypatch) -> list[tuple[str, int]]:
    captured: list[tuple[str, int]] = []

    async def capture_set(key: str, value: dict, ttl: int) -> None:
        captured.append((key, ttl))

    monkeypatch.setattr(verifier_module._verdict_cache, "set", capture_set)
    return captured


def test_write_clamps_to_matched_domain_proof_expiry(client, monkeypatch):
    monkeypatch.setattr(
        verifier_module.config, "VERIFIER_VERDICT_CACHE_TTL_SECONDS", 3600
    )
    captured = _capture_writes(monkeypatch)
    raw = _demo_request_dict(client)
    host = urlparse(raw["envelope"]["claims"]["payload"]).hostname
    proof_expiry = datetime.now(timezone.utc) + timedelta(seconds=120)
    raw["issuer_state"]["verified_domains"] = {host: proof_expiry.isoformat()}
    response = client.post("/verifier/verify", json=raw)
    assert response.status_code == 200
    assert response.json()["allowed"] is True
    assert len(captured) == 1
    assert 0 < captured[0][1] <= 120


def test_write_clamps_to_matched_domain_proof_expiry_non_canonical_key(
    client, monkeypatch
):
    # Regression: the matched-domain boundary lookup used to index the raw
    # verified_domains mapping with the normalized match key, so a
    # non-canonical raw key (here, uppercase) silently dropped the expiry
    # from the TTL clamp instead of shortening it.
    monkeypatch.setattr(
        verifier_module.config, "VERIFIER_VERDICT_CACHE_TTL_SECONDS", 3600
    )
    captured = _capture_writes(monkeypatch)
    raw = _demo_request_dict(client)
    host = urlparse(raw["envelope"]["claims"]["payload"]).hostname
    proof_expiry = datetime.now(timezone.utc) + timedelta(seconds=120)
    raw["issuer_state"]["verified_domains"] = {host.upper(): proof_expiry.isoformat()}
    response = client.post("/verifier/verify", json=raw)
    assert response.status_code == 200
    assert response.json()["allowed"] is True
    assert len(captured) == 1
    assert 0 < captured[0][1] <= 120


def test_unrelated_domain_proofs_never_clamp(client, monkeypatch):
    monkeypatch.setattr(
        verifier_module.config, "VERIFIER_VERDICT_CACHE_TTL_SECONDS", 3600
    )
    captured = _capture_writes(monkeypatch)
    raw = _demo_request_dict(client)
    host = urlparse(raw["envelope"]["claims"]["payload"]).hostname
    now = datetime.now(timezone.utc)
    raw["issuer_state"]["verified_domains"] = {
        host: None,
        "stale.example": (now - timedelta(days=30)).isoformat(),
        "closing.example": (now + timedelta(seconds=10)).isoformat(),
    }
    response = client.post("/verifier/verify", json=raw)
    assert response.status_code == 200
    assert response.json()["allowed"] is True
    # Round-7 P1: only the MATCHED domain's proof participates. The expired
    # proof on stale.example must not zero the TTL, and closing.example's
    # 10-second horizon must not shorten it.
    assert len(captured) == 1
    assert captured[0][1] > 10


def test_write_clamps_to_issuer_record_expiry(client, monkeypatch):
    monkeypatch.setattr(
        verifier_module.config, "VERIFIER_VERDICT_CACHE_TTL_SECONDS", 3600
    )
    captured = _capture_writes(monkeypatch)
    raw = _demo_request_dict(client)
    raw["issuer_state"]["issuer_record_expires_at"] = (
        datetime.now(timezone.utc) + timedelta(seconds=90)
    ).isoformat()
    response = client.post("/verifier/verify", json=raw)
    assert response.status_code == 200
    assert response.json()["allowed"] is True
    assert len(captured) == 1
    assert 0 < captured[0][1] <= 90
