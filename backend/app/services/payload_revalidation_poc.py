"""
PoC support for verification-time payload revalidation.

This module normalizes the payload destination and compares it against the
issuer's currently verified domains using deterministic rules.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qsl, urlparse

from backend.app.services.governance_fixture_store import DEFAULT_FIXTURE_DIR


@dataclass
class NormalizedDestination:
    raw_payload: str
    host: str
    scheme: str | None
    port: int | None
    path: str
    query_keys: list[str]


@dataclass
class MatchDecision:
    allowed: bool
    matched_rule: str | None
    reason: str


def _normalize_host(host: str) -> str:
    normalized = host.strip().lower().rstrip(".")
    if normalized.startswith("www."):
        normalized = normalized[4:]
    return normalized


def normalize_payload_destination(payload: str) -> NormalizedDestination:
    payload = payload.strip()
    if not payload:
        raise ValueError("Payload is empty")

    if payload.startswith(("http://", "https://")):
        parsed = urlparse(payload)
    else:
        parsed = urlparse(f"https://{payload}")

    if not parsed.hostname:
        raise ValueError(f"Could not extract a host from payload: {payload}")

    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError(f"Invalid destination URL: {exc}") from exc

    return NormalizedDestination(
        raw_payload=payload,
        host=_normalize_host(parsed.hostname),
        scheme=parsed.scheme or None,
        port=port,
        path=parsed.path or "/",
        query_keys=list(dict.fromkeys(key for key, _ in parse_qsl(parsed.query))),
    )


def _is_same_or_subdomain(candidate: str, verified: str) -> bool:
    return candidate == verified or candidate.endswith(f".{verified}")


def _load_destination_policy(fixture_dir: Path = DEFAULT_FIXTURE_DIR) -> dict[str, object] | None:
    path = fixture_dir / "destination-policy.json"
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return None
    return payload


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item.strip()]


def _url_without_query(value: str) -> str | None:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    port = f":{parsed.port}" if parsed.port else ""
    path = parsed.path or "/"
    return f"{parsed.scheme}://{parsed.hostname.lower()}{port}{path}"


def _rule_allows_destination_host(
    rule: dict[str, object],
    host: str,
) -> bool:
    expected_final_url = rule.get("expected_final_url")
    if isinstance(expected_final_url, str) and expected_final_url.strip():
        expected_host = urlparse(expected_final_url.strip()).hostname
        return expected_host is not None and host == _normalize_host(expected_host)

    allow_subdomains = rule.get("allow_subdomains") is True
    for allowed_host in _string_list(rule.get("allowed_hosts")):
        normalized = _normalize_host(allowed_host)
        if host == normalized or (
            allow_subdomains and _is_same_or_subdomain(host, normalized)
        ):
            return True
    return False


def _policy_path_reason(
    destination: NormalizedDestination,
    rule: dict[str, object],
) -> str | None:
    path_prefixes = _string_list(rule.get("path_prefixes"))
    if path_prefixes and not any(
        destination.path.startswith(prefix) for prefix in path_prefixes
    ):
        return (
            f"Destination path '{destination.path}' is outside issuer-approved "
            f"path prefixes: {path_prefixes}"
        )

    query_policy = rule.get("query_policy")
    if query_policy == "none" and destination.query_keys:
        return "Destination query string is not approved for this issuer policy"

    allowed_query_keys = _string_list(rule.get("allowed_query_keys"))
    if allowed_query_keys and any(
        key.split("=", 1)[0] not in allowed_query_keys for key in destination.query_keys
    ):
        return (
            "Destination query string contains keys outside issuer-approved "
            f"query keys: {allowed_query_keys}"
        )

    return None


def _match_destination_policy(
    destination: NormalizedDestination,
) -> MatchDecision | None:
    policy = _load_destination_policy()
    if policy is None:
        return None

    redirect_policy = policy.get("redirect_policy")
    if isinstance(redirect_policy, dict):
        resolver_urls = {
            _url_without_query(item)
            for item in _string_list(redirect_policy.get("resolver_urls"))
        }
        resolver_urls.discard(None)
        if _url_without_query(destination.raw_payload) in resolver_urls:
            return MatchDecision(
                allowed=True,
                matched_rule=destination.host,
                reason="Approved resolver URL",
            )

    raw_rules = policy.get("approved_destinations")
    if not isinstance(raw_rules, list):
        return None

    matched_rules = [
        rule
        for rule in raw_rules
        if isinstance(rule, dict) and _rule_allows_destination_host(rule, destination.host)
    ]
    if not matched_rules:
        return None

    first_reason: str | None = None
    for rule in matched_rules:
        reason = _policy_path_reason(destination, rule)
        if reason is None:
            return MatchDecision(
                allowed=True,
                matched_rule=destination.host,
                reason="Destination matches issuer-approved destination policy",
            )
        first_reason = first_reason or reason

    return MatchDecision(
        allowed=False,
        matched_rule=None,
        reason=first_reason or "Destination is outside issuer-approved destination policy",
    )


def match_payload_to_verified_domains(
    payload: str,
    verified_domains: list[str],
    *,
    allow_subdomains: bool = False,
) -> MatchDecision:
    try:
        destination = normalize_payload_destination(payload)
    except ValueError as exc:
        return MatchDecision(
            allowed=False,
            matched_rule=None,
            reason=str(exc),
        )

    normalized_rules = [_normalize_host(rule) for rule in verified_domains if rule.strip()]

    if not normalized_rules:
        return MatchDecision(
            allowed=False,
            matched_rule=None,
            reason="No currently verified domains are available for this issuer",
        )

    for rule in normalized_rules:
        if destination.host == rule:
            policy_decision = _match_destination_policy(destination)
            if policy_decision is not None:
                return policy_decision
            return MatchDecision(
                allowed=True,
                matched_rule=rule,
                reason="Exact host match",
            )
        if allow_subdomains and _is_same_or_subdomain(destination.host, rule):
            policy_decision = _match_destination_policy(destination)
            if policy_decision is not None:
                return policy_decision
            return MatchDecision(
                allowed=True,
                matched_rule=rule,
                reason="Subdomain match under verified parent domain",
            )

    return MatchDecision(
        allowed=False,
        matched_rule=None,
        reason=(
            f"Destination host '{destination.host}' does not match current "
            f"verified domains: {normalized_rules}"
        ),
    )
