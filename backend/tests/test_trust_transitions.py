import pytest

from backend.app.services.trust_transitions import (
    CERTIFICATE_TRANSITIONS,
    ISSUER_PROJECTION,
    KEY_PROJECTION,
    TRUST_KEY_TRANSITIONS,
    check_transition,
)

_CERT_EXPECTED = [
    ("active", "active", "noop"),
    ("active", "rotated", "allowed"),
    ("active", "suspended", "allowed"),
    ("active", "revoked", "allowed"),
    ("active", "expired", "allowed"),
    ("rotated", "active", "disallowed"),
    ("rotated", "rotated", "noop"),
    ("rotated", "suspended", "allowed"),
    ("rotated", "revoked", "allowed"),
    ("rotated", "expired", "allowed"),
    ("suspended", "active", "allowed"),
    ("suspended", "rotated", "allowed"),
    ("suspended", "suspended", "noop"),
    ("suspended", "revoked", "allowed"),
    ("suspended", "expired", "allowed"),
    ("revoked", "active", "terminal"),
    ("revoked", "rotated", "terminal"),
    ("revoked", "suspended", "terminal"),
    ("revoked", "revoked", "noop"),
    ("revoked", "expired", "terminal"),
    ("expired", "active", "disallowed"),
    ("expired", "rotated", "disallowed"),
    ("expired", "suspended", "disallowed"),
    ("expired", "revoked", "allowed"),
    ("expired", "expired", "noop"),
]

_KEY_EXPECTED = [
    ("active", "active", "noop"),
    ("active", "suspended", "allowed"),
    ("active", "revoked", "allowed"),
    ("active", "expired", "allowed"),
    ("suspended", "active", "allowed"),
    ("suspended", "suspended", "noop"),
    ("suspended", "revoked", "allowed"),
    ("suspended", "expired", "allowed"),
    ("revoked", "active", "terminal"),
    ("revoked", "suspended", "terminal"),
    ("revoked", "revoked", "noop"),
    ("revoked", "expired", "terminal"),
    ("expired", "active", "disallowed"),
    ("expired", "suspended", "disallowed"),
    ("expired", "revoked", "allowed"),
    ("expired", "expired", "noop"),
]


@pytest.mark.parametrize("current,requested,kind", _CERT_EXPECTED)
def test_certificate_transition_matrix(current, requested, kind):
    assert check_transition(CERTIFICATE_TRANSITIONS, current, requested).kind == kind


@pytest.mark.parametrize("current,requested,kind", _KEY_EXPECTED)
def test_trust_key_transition_matrix(current, requested, kind):
    assert check_transition(TRUST_KEY_TRANSITIONS, current, requested).kind == kind


def test_unknown_current_status_is_disallowed():
    check = check_transition(CERTIFICATE_TRANSITIONS, "sideways", "active")
    assert check.kind == "disallowed"
    assert "unknown" in check.detail


def test_terminal_detail_is_generic():
    check = check_transition(TRUST_KEY_TRANSITIONS, "revoked", "active")
    assert check.kind == "terminal"
    assert check.detail == "status 'revoked' is terminal"


def test_key_projection_covers_certificate_and_key_states():
    assert set(KEY_PROJECTION) == set(CERTIFICATE_TRANSITIONS)
    assert set(TRUST_KEY_TRANSITIONS) <= set(KEY_PROJECTION)
    assert set(KEY_PROJECTION.values()) <= {"active", "retired", "suspended", "revoked"}


def test_issuer_projection_is_identity_without_pending():
    assert ISSUER_PROJECTION == {
        status: status for status in ("active", "suspended", "revoked", "expired")
    }
    assert "pending" not in ISSUER_PROJECTION
