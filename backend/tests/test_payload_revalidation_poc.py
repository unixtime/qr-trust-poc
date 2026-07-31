from __future__ import annotations

from backend.app.services.payload_revalidation_poc import (
    match_payload_to_verified_domains,
    normalize_payload_destination,
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
