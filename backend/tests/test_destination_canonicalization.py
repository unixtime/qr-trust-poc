"""Tests for RFC 3986 destination canonicalization."""

import pytest

from backend.app.services.destination_canonicalization import (
    CanonicalizationError,
    canonicalize_destination,
    canonicalize_rule_prefix,
    path_matches_prefix,
)


def test_lowercases_scheme_and_host_but_not_path():
    dest = canonicalize_destination("HTTPS://ACME.Example/Pay")
    assert dest.scheme == "https"
    assert dest.host == "acme.example"
    assert dest.path == "/Pay"


def test_default_port_dropped():
    assert canonicalize_destination("https://acme.example:443/pay").port is None


def test_non_default_port_kept():
    assert canonicalize_destination("https://acme.example:8443/pay").port == 8443


def test_single_trailing_host_dot_stripped():
    assert canonicalize_destination("https://acme.example./pay").host == "acme.example"


def test_double_trailing_host_dot_raises():
    with pytest.raises(CanonicalizationError):
        canonicalize_destination("https://acme.example../pay")


def test_dot_segments_resolved():
    dest = canonicalize_destination("https://acme.example/a/%2e%2e/admin")
    assert dest.path == "/admin"


def test_unreserved_percent_encoding_decoded():
    assert canonicalize_destination("https://acme.example/p%61y").path == "/pay"


def test_reserved_percent_encoding_kept_uppercase():
    assert canonicalize_destination("https://acme.example/a%2fb").path == "/a%2Fb"


def test_truncated_percent_escape_raises():
    with pytest.raises(CanonicalizationError):
        canonicalize_destination("https://acme.example/pay%2")


def test_userinfo_raises():
    with pytest.raises(CanonicalizationError):
        canonicalize_destination("https://alice@acme.example/pay")


def test_backslash_raises():
    with pytest.raises(CanonicalizationError):
        canonicalize_destination("https://acme.example\\pay")


def test_raw_null_byte_raises():
    with pytest.raises(CanonicalizationError):
        canonicalize_destination("https://acme.example/pay\x00")


def test_encoded_null_byte_raises():
    with pytest.raises(CanonicalizationError):
        canonicalize_destination("https://acme.example/pay%00")


def test_javascript_scheme_raises():
    with pytest.raises(CanonicalizationError):
        canonicalize_destination("javascript:alert(1)")


def test_idna_host_encoded():
    dest = canonicalize_destination("https://bücher.example/pay")
    assert dest.host == "xn--bcher-kva.example"


@pytest.mark.parametrize("raw", ["", "   "])
def test_empty_destination_raises(raw):
    with pytest.raises(CanonicalizationError):
        canonicalize_destination(raw)


def test_error_carries_cause_slug():
    with pytest.raises(CanonicalizationError) as excinfo:
        canonicalize_destination("")
    assert excinfo.value.cause == "destination-invalid"
    assert excinfo.value.reason


def test_scheme_less_payload_defaults_to_https():
    dest = canonicalize_destination("acme.example/pay")
    assert dest.scheme == "https"
    assert dest.host == "acme.example"
    assert dest.path == "/pay"


def test_trailing_path_slash_collapsed():
    assert canonicalize_destination("https://acme.example/pay/").path == "/pay"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("/pay/", "/pay"), ("pay", "/pay"), ("/", "/"), ("", "/")],
)
def test_rule_prefix_canonicalization(raw, expected):
    assert canonicalize_rule_prefix(raw) == expected


@pytest.mark.parametrize(
    ("path", "prefix", "expected"),
    [
        ("/pay", "/pay", True),
        ("/pay/now", "/pay", True),
        ("/payments", "/pay", False),
        ("/anything/at/all", "/", True),
    ],
)
def test_path_matches_prefix_segment_boundaries(path, prefix, expected):
    assert path_matches_prefix(path, prefix) is expected
