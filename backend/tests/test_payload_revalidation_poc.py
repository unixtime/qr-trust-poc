from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path

from backend.app.services.payload_revalidation_poc import (
    load_destination_policy_resolution,
    match_payload_to_verified_domains,
    normalize_payload_destination,
    normalized_verified_domains,
)


def test_normalize_payload_destination_strips_www_and_defaults_scheme() -> None:
    destination = normalize_payload_destination("www.Acme.Example/menu")

    assert destination.host == "acme.example"
    assert destination.scheme == "https"
    assert destination.path == "/menu"


def test_match_payload_exact_host() -> None:
    decision = match_payload_to_verified_domains(
        "https://acme.example/pay",
        ["acme.example"],
    )

    assert decision.allowed is True
    assert decision.matched_rule == "acme.example"


def test_match_payload_blocks_subdomain_without_policy() -> None:
    decision = match_payload_to_verified_domains(
        "https://login.acme.example/sign-in",
        ["acme.example"],
        allow_subdomains=False,
    )

    assert decision.allowed is False
    assert decision.matched_rule is None


def test_match_payload_allows_subdomain_with_policy() -> None:
    decision = match_payload_to_verified_domains(
        "https://login.acme.example/sign-in",
        ["acme.example"],
        allow_subdomains=True,
    )

    assert decision.allowed is True
    assert decision.matched_rule == "acme.example"


def test_match_payload_rejects_when_verified_domains_missing() -> None:
    decision = match_payload_to_verified_domains(
        "https://acme.example/pay",
        [],
    )

    assert decision.allowed is False
    assert "No currently verified domains" in decision.reason


def test_match_payload_rejects_malformed_port() -> None:
    decision = match_payload_to_verified_domains(
        "https://acme.example:99999/pay",
        ["acme.example"],
    )

    assert decision.allowed is False
    assert decision.matched_rule is None
    assert "Invalid destination URL" in decision.reason


FIXTURE_POLICY_PATH = (
    Path(__file__).resolve().parents[2]
    / "docs/public/fixtures/governance/destination-policy.json"
)


def _policy_doc() -> dict:
    return json.loads(FIXTURE_POLICY_PATH.read_text(encoding="utf-8"))


def _rules_key(doc: dict) -> str:
    for key, value in doc.items():
        if isinstance(value, list) and any(
            isinstance(item, dict) and "path_prefixes" in item for item in value
        ):
            return key
    raise AssertionError("destination-policy.json has no rule list with path_prefixes")


def _set_single_rule(doc: dict, **rule_overrides) -> None:
    base_rule = {
        "name": "canonical-test",
        "allowed_hosts": ["acme.example"],
        "path_prefixes": ["/pay"],
    }
    doc[_rules_key(doc)] = [{**base_rule, **rule_overrides}]


def _decision_for(tmp_path, payload, **rule_overrides):
    doc = _policy_doc()
    _set_single_rule(doc, **rule_overrides)
    (tmp_path / "destination-policy.json").write_text(
        json.dumps(doc), encoding="utf-8"
    )
    return match_payload_to_verified_domains(
        payload, ["acme.example"], fixture_dir=tmp_path
    )


def test_policy_blocks_sibling_path_segment(tmp_path):
    decision = _decision_for(tmp_path, "https://acme.example/payments")
    assert decision.allowed is False
    assert decision.cause == "destination-mismatch"


def test_policy_allows_nested_path(tmp_path):
    decision = _decision_for(tmp_path, "https://acme.example/pay/now")
    assert decision.allowed is True
    assert decision.matched_domain == "acme.example"


def test_policy_rejects_http_scheme_by_default(tmp_path):
    decision = _decision_for(tmp_path, "http://acme.example/pay")
    assert decision.allowed is False
    assert decision.cause == "destination-mismatch"
    assert "scheme" in decision.reason


def test_policy_rejects_unlisted_port(tmp_path):
    decision = _decision_for(tmp_path, "https://acme.example:8443/pay")
    assert decision.allowed is False
    assert decision.cause == "destination-mismatch"
    assert "port" in decision.reason


def test_policy_rejects_dot_segment_traversal(tmp_path):
    decision = _decision_for(tmp_path, "https://acme.example/pay/%2e%2e/admin")
    assert decision.allowed is False
    assert decision.cause == "destination-mismatch"


def test_policy_accepts_cosmetic_variants(tmp_path):
    decision = _decision_for(tmp_path, "HTTPS://ACME.EXAMPLE.:443/pay")
    assert decision.allowed is True


def test_trailing_slash_equivalence(tmp_path):
    decision = _decision_for(tmp_path, "https://acme.example/pay/")
    assert decision.allowed is True


def test_root_prefix_matches_everything(tmp_path):
    decision = _decision_for(
        tmp_path, "https://acme.example/anything/at/all", path_prefixes=["/"]
    )
    assert decision.allowed is True


def test_userinfo_payload_is_destination_invalid(tmp_path):
    decision = _decision_for(tmp_path, "https://alice@acme.example/pay")
    assert decision.allowed is False
    assert decision.cause == "destination-invalid"


def test_invalid_policy_json_rejects_scan(tmp_path):
    (tmp_path / "destination-policy.json").write_text(
        "{not json", encoding="utf-8"
    )
    decision = match_payload_to_verified_domains(
        "https://acme.example/pay", ["acme.example"], fixture_dir=tmp_path
    )
    assert decision.allowed is False
    assert decision.cause == "policy-invalid"


def test_missing_policy_falls_back_to_host_match(tmp_path):
    decision = match_payload_to_verified_domains(
        "https://acme.example/anything", ["acme.example"], fixture_dir=tmp_path
    )
    assert decision.allowed is True
    assert decision.cause is None


def test_policy_resolution_reads_fixture():
    resolution = load_destination_policy_resolution()
    assert resolution is not None
    assert resolution.source == "fixture"
    assert resolution.name == "destination-policy.json"
    assert re.fullmatch(r"[0-9a-f]{64}", resolution.digest)


def test_policy_resolution_missing_file_is_none(tmp_path):
    assert load_destination_policy_resolution(tmp_path / "empty") is None


def test_expired_domain_proof_blocks(tmp_path):
    decision = match_payload_to_verified_domains(
        "https://acme.example/pay",
        {"acme.example": datetime(2026, 1, 1, tzinfo=UTC)},
        fixture_dir=tmp_path,
        now=datetime(2026, 3, 1, tzinfo=UTC),
    )
    assert decision.allowed is False
    assert decision.cause == "destination-mismatch"
    assert "expired" in decision.reason


def test_unexpired_domain_proof_allows(tmp_path):
    decision = match_payload_to_verified_domains(
        "https://acme.example/pay",
        {"acme.example": datetime(2026, 6, 1, tzinfo=UTC)},
        fixture_dir=tmp_path,
        now=datetime(2026, 3, 1, tzinfo=UTC),
    )
    assert decision.allowed is True
    assert decision.matched_domain == "acme.example"


def test_open_ended_domain_proof_allows(tmp_path):
    decision = match_payload_to_verified_domains(
        "https://acme.example/pay",
        {"acme.example": None},
        fixture_dir=tmp_path,
        now=datetime(2026, 3, 1, tzinfo=UTC),
    )
    assert decision.allowed is True


def test_legacy_domain_list_still_accepted(tmp_path):
    decision = match_payload_to_verified_domains(
        "https://acme.example/pay", ["acme.example"], fixture_dir=tmp_path
    )
    assert decision.allowed is True
    assert decision.matched_domain == "acme.example"


def test_expired_subdomain_parent_blocks(tmp_path):
    decision = match_payload_to_verified_domains(
        "https://shop.acme.example/pay",
        {"acme.example": datetime(2026, 1, 1, tzinfo=UTC)},
        allow_subdomains=True,
        fixture_dir=tmp_path,
        now=datetime(2026, 3, 1, tzinfo=UTC),
    )
    assert decision.allowed is False
    assert decision.cause == "destination-mismatch"


def test_policy_allowed_resolver_url_stamps_matched_domain(tmp_path):
    doc = _policy_doc()
    (tmp_path / "destination-policy.json").write_text(
        json.dumps(doc), encoding="utf-8"
    )
    decision = match_payload_to_verified_domains(
        "https://qr.acme.example/r/pay",
        {"qr.acme.example": datetime(2026, 6, 1, tzinfo=UTC)},
        fixture_dir=tmp_path,
        now=datetime(2026, 3, 1, tzinfo=UTC),
    )
    assert decision.allowed is True
    assert decision.matched_domain == "qr.acme.example"


def test_expiry_exactly_at_now_blocks(tmp_path):
    decision = match_payload_to_verified_domains(
        "https://acme.example/pay",
        {"acme.example": datetime(2026, 3, 1, tzinfo=UTC)},
        fixture_dir=tmp_path,
        now=datetime(2026, 3, 1, tzinfo=UTC),
    )
    assert decision.allowed is False
    assert decision.cause == "destination-mismatch"
    assert "expired" in decision.reason


def test_match_payload_normalizes_legacy_verified_domain_key() -> None:
    # Regression: a raw "www."-prefixed key used to be indexed with its
    # normalized form and raised KeyError instead of matching.
    decision = match_payload_to_verified_domains(
        "https://www.example.com/pay",
        ["www.example.com"],
    )

    assert decision.allowed is True
    assert decision.matched_domain == "example.com"


def test_match_payload_normalizes_mixed_case_mapping_key() -> None:
    decision = match_payload_to_verified_domains(
        "https://example.com/pay",
        {"Example.COM": None},
    )

    assert decision.allowed is True
    assert decision.matched_domain == "example.com"


def test_match_payload_expired_non_canonical_key_denies() -> None:
    # Proves the expiry lookup actually finds the boundary for a
    # non-canonical key instead of the pre-fix behavior of silently missing
    # it (KeyError, or a None expiry under the alternate lookup shape).
    decision = match_payload_to_verified_domains(
        "https://example.com/pay",
        {"WWW.Example.com": datetime(2020, 1, 1, tzinfo=UTC)},
        now=datetime(2026, 1, 1, tzinfo=UTC),
    )

    assert decision.allowed is False
    assert decision.cause == "destination-mismatch"
    assert "has expired" in decision.reason


def test_normalized_verified_domains_maps_original_expiries() -> None:
    expiry = datetime(2026, 6, 1, tzinfo=UTC)
    normalized = normalized_verified_domains(
        {"WWW.Example.com": expiry, "  ": None, "acme.EXAMPLE": None}
    )

    assert normalized == {"example.com": expiry, "acme.example": None}
