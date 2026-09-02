"""
PoC support for verification-time payload revalidation.

This module normalizes the payload destination and compares it against the
issuer's currently verified domains using deterministic rules.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlparse

from backend.app.services.destination_canonicalization import (
    CanonicalDestination,
    CanonicalizationError,
    canonicalize_destination,
    canonicalize_rule_prefix,
    path_matches_prefix,
)
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
    cause: str | None = None
    matched_domain: str | None = None


def _normalize_host(host: str) -> str:
    normalized = host.strip().lower().rstrip(".")
    if normalized.startswith("www."):
        normalized = normalized[4:]
    return normalized


def normalized_verified_domains(
    verified_domains: Mapping[str, datetime | None],
) -> dict[str, datetime | None]:
    """Build a single {normalized_host: expiry} mapping from raw verified-domain keys.

    Keys are normalized with `_normalize_host` (lowercased, trailing dot and
    leading "www." stripped) so lookups against the normalized key never miss.
    Blank keys are filtered out, matching the historical `if rule.strip()` guard.
    """
    return {
        _normalize_host(rule): verified_domains[rule]
        for rule in verified_domains
        if rule.strip()
    }


def normalize_payload_destination(payload: str) -> NormalizedDestination:
    payload = payload.strip()
    if not payload:
        raise ValueError("Payload is empty")

    if payload.lower().startswith(("http://", "https://")):
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


@dataclass(frozen=True)
class _PolicyLoad:
    policy: dict | None
    invalid: bool
    detail: str | None = None


def _load_destination_policy(fixture_dir: Path = DEFAULT_FIXTURE_DIR) -> _PolicyLoad:
    policy_path = fixture_dir / "destination-policy.json"
    try:
        raw = policy_path.read_text(encoding="utf-8")
    except OSError:
        return _PolicyLoad(policy=None, invalid=False)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        return _PolicyLoad(
            policy=None,
            invalid=True,
            detail=f"Destination policy document is not valid JSON: {exc}",
        )
    if not isinstance(payload, dict):
        return _PolicyLoad(
            policy=None,
            invalid=True,
            detail="Destination policy document must be a JSON object",
        )
    return _PolicyLoad(policy=payload, invalid=False)


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


def _policy_rule_reason(destination: CanonicalDestination, rule: dict) -> str | None:
    allowed_schemes = _string_list(rule.get("allowed_schemes")) or ["https"]
    if destination.scheme not in allowed_schemes:
        return (
            f"Destination scheme '{destination.scheme}' is not in issuer-approved "
            f"schemes: {allowed_schemes}"
        )
    allowed_ports = [
        port for port in rule.get("allowed_ports") or [] if isinstance(port, int)
    ]
    if destination.port is not None and destination.port not in allowed_ports:
        return (
            f"Destination port {destination.port} is not in issuer-approved "
            f"ports: {allowed_ports}"
        )
    path_prefixes = _string_list(rule.get("path_prefixes"))
    if path_prefixes and not any(
        path_matches_prefix(destination.path, canonicalize_rule_prefix(prefix))
        for prefix in path_prefixes
    ):
        return (
            f"Destination path '{destination.path}' is outside issuer-approved "
            f"path prefixes: {path_prefixes}"
        )
    query_keys = list(
        dict.fromkeys(
            key for key, _ in parse_qsl(destination.query, keep_blank_values=True)
        )
    )
    query_policy = rule.get("query_policy")
    if query_policy == "none" and query_keys:
        return "Destination query string is not approved for this issuer policy"
    allowed_query_keys = _string_list(rule.get("allowed_query_keys"))
    if allowed_query_keys and any(
        key.split("=", 1)[0] not in allowed_query_keys for key in query_keys
    ):
        return (
            "Destination query string contains keys outside issuer-approved "
            f"query keys: {allowed_query_keys}"
        )
    return None


def _match_destination_policy(
    destination: NormalizedDestination, *, fixture_dir: Path = DEFAULT_FIXTURE_DIR
) -> MatchDecision | None:
    load = _load_destination_policy(fixture_dir)
    if load.invalid:
        return MatchDecision(
            allowed=False,
            matched_rule=None,
            reason=load.detail or "Destination policy document is invalid",
            cause="policy-invalid",
        )
    if load.policy is None:
        return None
    try:
        canonical = canonicalize_destination(destination.raw_payload)
    except CanonicalizationError as exc:
        return MatchDecision(
            allowed=False,
            matched_rule=None,
            reason=exc.reason,
            cause="destination-invalid",
        )
    redirect_policy = load.policy.get("redirect_policy")
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

    match_host = _normalize_host(canonical.host)
    first_reason: str | None = None
    found_matching_rule = False
    for rule in load.policy.get("approved_destinations") or []:
        if not isinstance(rule, dict):
            continue
        if not _rule_allows_destination_host(rule, match_host):
            continue
        found_matching_rule = True
        reason = _policy_rule_reason(canonical, rule)
        if reason is None:
            return MatchDecision(
                allowed=True,
                matched_rule=match_host,
                reason="Destination matches issuer-approved destination policy",
                matched_domain=match_host,
            )
        if first_reason is None:
            first_reason = reason
    if not found_matching_rule:
        return None
    return MatchDecision(
        allowed=False,
        matched_rule=None,
        reason=first_reason or "Destination is outside issuer-approved destination policy",
        cause="destination-mismatch",
    )


def match_payload_to_verified_domains(
    payload: str,
    verified_domains: Mapping[str, datetime | None] | list[str],
    *,
    allow_subdomains: bool = False,
    now: datetime | None = None,
    fixture_dir: Path = DEFAULT_FIXTURE_DIR,
) -> MatchDecision:
    if not isinstance(verified_domains, Mapping):
        verified_domains = {domain: None for domain in verified_domains}
    if now is None:
        now = datetime.now(UTC)

    try:
        destination = normalize_payload_destination(payload)
    except ValueError as exc:
        return MatchDecision(
            allowed=False,
            matched_rule=None,
            reason=str(exc),
        )

    normalized_domains = normalized_verified_domains(verified_domains)
    normalized_rules = list(normalized_domains)

    if not normalized_rules:
        return MatchDecision(
            allowed=False,
            matched_rule=None,
            reason="No currently verified domains are available for this issuer",
        )

    for rule in normalized_rules:
        if destination.host == rule:
            matched = rule
            expiry = normalized_domains[matched]
            if expiry is not None and expiry <= now:
                return MatchDecision(
                    allowed=False,
                    matched_rule=None,
                    reason=f"Domain proof for '{matched}' has expired",
                    cause="destination-mismatch",
                )
            policy_decision = _match_destination_policy(destination, fixture_dir=fixture_dir)
            if policy_decision is not None:
                if policy_decision.allowed and policy_decision.matched_domain is None:
                    return replace(policy_decision, matched_domain=matched)
                return policy_decision
            return MatchDecision(
                allowed=True,
                matched_rule=rule,
                reason="Exact host match",
                matched_domain=matched,
            )
        if allow_subdomains and _is_same_or_subdomain(destination.host, rule):
            matched = rule
            expiry = normalized_domains[matched]
            if expiry is not None and expiry <= now:
                return MatchDecision(
                    allowed=False,
                    matched_rule=None,
                    reason=f"Domain proof for '{matched}' has expired",
                    cause="destination-mismatch",
                )
            policy_decision = _match_destination_policy(destination, fixture_dir=fixture_dir)
            if policy_decision is not None:
                if policy_decision.allowed and policy_decision.matched_domain is None:
                    return replace(policy_decision, matched_domain=matched)
                return policy_decision
            return MatchDecision(
                allowed=True,
                matched_rule=rule,
                reason="Subdomain match under verified parent domain",
                matched_domain=matched,
            )

    return MatchDecision(
        allowed=False,
        matched_rule=None,
        reason=(
            f"Destination host '{destination.host}' does not match current "
            f"verified domains: {normalized_rules}"
        ),
    )


@dataclass(frozen=True)
class PolicyResolution:
    source: str
    name: str
    digest: str


def load_destination_policy_resolution(
    fixture_dir: Path = DEFAULT_FIXTURE_DIR,
) -> PolicyResolution | None:
    policy_path = fixture_dir / "destination-policy.json"
    try:
        raw = policy_path.read_bytes()
    except OSError:
        return None
    return PolicyResolution(
        source="fixture",
        name="destination-policy.json",
        digest=hashlib.sha256(raw).hexdigest(),
    )
