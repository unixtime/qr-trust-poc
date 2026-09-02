from datetime import UTC, datetime, timedelta

import pytest

from backend.app.services.scanner_trust_store import (
    IssuerRecord,
    KeyEntry,
    ScannerTrustStore,
    evaluate_blocking_states,
    evaluate_trust_window,
)
from backend.app.services.signed_schema_poc import SignedQRCodeClaims

NOW = datetime(2026, 3, 1, 12, 0, 0, tzinfo=UTC)


def _issuer(**overrides) -> IssuerRecord:
    base = {
        "issuer_id": "acme-demo",
        "issuer_name": "Acme Demo Issuer",
        "root_id": "root:qrtrust-demo",
        "status": "active",
        "issued_at": NOW - timedelta(days=30),
        "expires_at": NOW + timedelta(days=30),
        "verified_domains": {"acme.example": None},
        "allow_subdomains": False,
    }
    return IssuerRecord(**{**base, **overrides})


def _key(**overrides) -> KeyEntry:
    base = {
        "key_ref": "cert:acme-demo:2026-01",
        "issuer_id": "acme-demo",
        "algorithm_id": "rsa-pss-sha256-v1",
        "public_key_pem": "-----BEGIN PUBLIC KEY-----\nstub\n-----END PUBLIC KEY-----\n",
        "state": "active",
        "not_before": NOW - timedelta(days=10),
        "not_after": NOW + timedelta(days=10),
    }
    return KeyEntry(**{**base, **overrides})


def _claims(*, issued_at: datetime = NOW, expires_at: datetime | None = None) -> SignedQRCodeClaims:
    return SignedQRCodeClaims(
        version="2",
        certificate_ref="cert:acme-demo:2026-01",
        issued_at=issued_at.isoformat().replace("+00:00", "Z"),
        expires_at=None if expires_at is None else expires_at.isoformat().replace("+00:00", "Z"),
        payload="https://acme.example/pay",
    )


@pytest.mark.parametrize(
    ("issuer_kwargs", "key_kwargs", "claim_kwargs", "expected_stage", "expected_cause"),
    [
        ({}, {}, {}, None, None),
        ({"status": "revoked"}, {}, {}, "issuer_status", "issuer-revoked"),
        ({"status": "suspended"}, {}, {}, "issuer_status", "issuer-inactive"),
        (
            {"expires_at": NOW - timedelta(days=1)},
            {},
            {},
            "issuer_status",
            "issuer-record-expired",
        ),
        (
            {"issued_at": NOW + timedelta(days=1), "expires_at": NOW + timedelta(days=40)},
            {},
            {},
            "issuer_status",
            "issuer-record-not-yet-valid",
        ),
        (
            {},
            {"state": "revoked", "revoked_at": NOW, "revocation_reason": "key compromise"},
            {},
            "key_status",
            "key-revoked",
        ),
        (
            {},
            {"not_after": NOW - timedelta(days=1)},
            {},
            "key_status",
            "key-window-mismatch",
        ),
        (
            {},
            {},
            {"issued_at": NOW + timedelta(minutes=10)},
            "time_window",
            "not-yet-valid",
        ),
        (
            {},
            {},
            {"issued_at": NOW - timedelta(hours=2), "expires_at": NOW - timedelta(hours=1)},
            "time_window",
            "object-expired",
        ),
        ({"status": "expired"}, {}, {}, "issuer_status", "issuer-record-expired"),
        ({}, {"state": "suspended"}, {}, "key_status", "key-suspended"),
    ],
)
def test_first_failing_rule_only(issuer_kwargs, key_kwargs, claim_kwargs, expected_stage, expected_cause):
    result = evaluate_trust_window(
        now=NOW,
        claims=_claims(**claim_kwargs),
        key=_key(**key_kwargs),
        issuer=_issuer(**issuer_kwargs),
        skew_seconds=300,
    )

    if expected_stage is None:
        assert result.allowed is True
        assert result.cause is None
        return

    assert result.allowed is False
    assert result.stage == expected_stage
    assert result.cause == expected_cause


def test_open_ended_artifact_never_expires():
    result = evaluate_trust_window(
        now=NOW + timedelta(days=5),
        claims=_claims(issued_at=NOW - timedelta(days=1), expires_at=None),
        key=_key(not_after=NOW + timedelta(days=30)),
        issuer=_issuer(expires_at=NOW + timedelta(days=90)),
        skew_seconds=300,
    )

    assert result.allowed is True


def test_retired_key_verifies_artifact_issued_inside_its_window():
    retired = _key(state="retired", not_after=NOW - timedelta(days=1))
    result = evaluate_trust_window(
        now=NOW,
        claims=_claims(issued_at=NOW - timedelta(days=2)),
        key=retired,
        issuer=_issuer(),
        skew_seconds=300,
    )

    assert result.allowed is True


def test_retired_key_blocks_artifact_issued_after_not_after():
    retired = _key(state="retired", not_after=NOW - timedelta(days=1))
    result = evaluate_trust_window(
        now=NOW,
        claims=_claims(issued_at=NOW - timedelta(hours=1)),
        key=retired,
        issuer=_issuer(),
        skew_seconds=300,
    )

    assert result.allowed is False
    assert result.cause == "key-window-mismatch"


def test_revoked_key_blocks_artifact_issued_before_revocation():
    revoked = _key(state="revoked", revoked_at=NOW - timedelta(hours=1))
    result = evaluate_trust_window(
        now=NOW,
        claims=_claims(issued_at=NOW - timedelta(days=3)),
        key=revoked,
        issuer=_issuer(),
        skew_seconds=300,
    )

    assert result.allowed is False
    assert result.cause == "key-revoked"


def test_suspended_issuer_outranks_revoked_key():
    result = evaluate_trust_window(
        now=NOW,
        claims=_claims(),
        key=_key(state="revoked", revoked_at=NOW),
        issuer=_issuer(status="suspended"),
        skew_seconds=300,
    )

    assert result.cause == "issuer-inactive"


def test_issuer_record_expiry_blocks_a_still_valid_artifact():
    result = evaluate_trust_window(
        now=NOW,
        claims=_claims(expires_at=NOW + timedelta(days=1)),
        key=_key(),
        issuer=_issuer(expires_at=NOW - timedelta(minutes=1)),
        skew_seconds=300,
    )

    assert result.cause == "issuer-record-expired"


@pytest.mark.parametrize(
    ("drift_minutes", "expected_allowed"),
    [(4, True), (6, False)],
)
def test_skew_tolerance_on_future_issued_at(drift_minutes, expected_allowed):
    result = evaluate_trust_window(
        now=NOW,
        claims=_claims(issued_at=NOW + timedelta(minutes=drift_minutes)),
        key=_key(not_before=NOW - timedelta(days=10), not_after=NOW + timedelta(days=10)),
        issuer=_issuer(),
        skew_seconds=300,
    )

    assert result.allowed is expected_allowed


def test_store_holds_two_keys_for_one_issuer():
    store = ScannerTrustStore()
    store.put_issuer(_issuer())
    store.put_key(_key())
    store.put_key(_key(key_ref="cert:acme-demo:2026-01-r1"))

    assert store.resolve("cert:acme-demo:2026-01") is not None
    assert store.resolve("cert:acme-demo:2026-01-r1") is not None


def test_retire_keys_for_flips_previous_keys():
    store = ScannerTrustStore()
    store.put_issuer(_issuer())
    store.put_key(_key())
    store.put_key(_key(key_ref="cert:acme-demo:2026-01-r1"))

    store.retire_keys_for("acme-demo", now=NOW, except_key_ref="cert:acme-demo:2026-01-r1")

    previous, _ = store.resolve("cert:acme-demo:2026-01")
    current, _ = store.resolve("cert:acme-demo:2026-01-r1")
    assert previous.state == "retired"
    assert previous.not_after == NOW
    assert current.state == "active"


def test_resolve_unknown_key_ref_returns_none():
    assert ScannerTrustStore().resolve("cert:nobody:0000") is None


def test_remove_key_makes_it_unresolvable():
    store = ScannerTrustStore()
    store.put_issuer(_issuer())
    store.put_key(_key())
    store.remove_key("cert:acme-demo:2026-01")

    assert store.resolve("cert:acme-demo:2026-01") is None


def test_retire_keys_for_leaves_a_revoked_key_revoked():
    """Revocation is terminal: a retirement sweep must not soften it."""
    store = ScannerTrustStore()
    store.put_issuer(_issuer())
    store.put_key(_key(state="revoked", revocation_reason="key compromise"))
    store.put_key(_key(key_ref="cert:acme-demo:2026-01-r1"))

    store.retire_keys_for("acme-demo", now=NOW, except_key_ref="cert:acme-demo:2026-01-r1")

    revoked, _ = store.resolve("cert:acme-demo:2026-01")
    assert revoked.state == "revoked"
    assert revoked.revocation_reason == "key compromise"


def test_put_key_refuses_to_un_revoke_a_revoked_ref():
    store = ScannerTrustStore()
    store.put_issuer(_issuer())
    store.put_key(_key(state="revoked"))

    with pytest.raises(ValueError, match="revocation is terminal"):
        store.put_key(_key(state="active"))

    with pytest.raises(ValueError, match="revocation is terminal"):
        store.put_key(_key(state="retired"))

    still_revoked, _ = store.resolve("cert:acme-demo:2026-01")
    assert still_revoked.state == "revoked"


def test_put_key_allows_an_idempotent_re_put_of_a_revoked_key():
    store = ScannerTrustStore()
    store.put_issuer(_issuer())
    store.put_key(_key(state="revoked"))

    store.put_key(_key(state="revoked", revocation_reason="key compromise"))

    entry, _ = store.resolve("cert:acme-demo:2026-01")
    assert entry.state == "revoked"
    assert entry.revocation_reason == "key compromise"


def test_open_ended_key_window_accepts():
    result = evaluate_trust_window(
        now=NOW,
        claims=_claims(),
        key=_key(not_after=None),
        issuer=_issuer(),
        skew_seconds=60,
    )
    assert result.allowed is True


def test_open_ended_issuer_window_accepts():
    result = evaluate_trust_window(
        now=NOW,
        claims=_claims(),
        key=_key(),
        issuer=_issuer(expires_at=None),
        skew_seconds=60,
    )
    assert result.allowed is True


def test_put_key_requires_material_for_verifying_states():
    store = ScannerTrustStore()
    store.put_issuer(_issuer())
    with pytest.raises(ValueError):
        store.put_key(_key(public_key_pem=None))
    with pytest.raises(ValueError):
        store.put_key(_key(state="retired", public_key_pem=None))
    store.put_key(_key(state="revoked", public_key_pem=None))


def test_replace_projection_swaps_projected_and_keeps_ephemeral():
    store = ScannerTrustStore()
    store.put_issuer(_issuer())
    store.put_key(_key())
    projected_issuer = _issuer(issuer_id="beta-demo", source="projection")
    projected_key = _key(
        key_ref="cert:beta-demo:2026-01", issuer_id="beta-demo", source="projection"
    )
    store.replace_projection(
        issuers=(projected_issuer,), keys=(projected_key,), defects=("d1",)
    )
    assert store.projection_defects == ("d1",)
    assert "beta-demo" in store._issuers
    assert "acme-demo" in store._issuers
    store.replace_projection(issuers=(), keys=())
    assert "beta-demo" not in store._issuers
    assert "acme-demo" in store._issuers
    assert "cert:beta-demo:2026-01" not in store._keys
    assert "cert:acme-demo:2026-01" in store._keys
    assert store.projection_defects == ()


def test_evaluate_blocking_states_returns_none_when_clear():
    assert evaluate_blocking_states(key=_key(), issuer=_issuer()) is None


def test_blocking_states_precede_time_windows():
    result = evaluate_trust_window(
        now=NOW,
        claims=_claims(),
        key=_key(
            state="revoked",
            public_key_pem=None,
            not_after=NOW - timedelta(days=20),
        ),
        issuer=_issuer(),
        skew_seconds=60,
    )
    assert result.cause == "key-revoked"
    assert result.stage == "key_status"
