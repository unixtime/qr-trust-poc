"""
Deterministic redirect policy support for the scanner decision PoC.

The paper treats short URLs and resolver flows as destination-binding work:
the scanner must reason about the resolver and the final destination before
runtime safety can be meaningful. This module projects the non-normative
governance fixture into a small verifier-friendly policy check.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from backend.app.services.governance_fixture_store import DEFAULT_FIXTURE_DIR


@dataclass(frozen=True)
class RedirectPolicyVerdict:
    state: str
    resolver_url: str | None
    final_url: str | None
    hop_count: int | None
    reason: str
    open_allowed: bool
    effective_url: str
    policy_label: str | None = None

    @property
    def is_redirect_flow(self) -> bool:
        return self.resolver_url is not None

    @property
    def is_blocked(self) -> bool:
        return not self.open_allowed


def _load_redirect_policy(fixture_dir: Path = DEFAULT_FIXTURE_DIR) -> dict[str, object] | None:
    path = fixture_dir / "destination-policy.json"
    if not path.exists():
        return None

    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        return None
    policy = payload.get("redirect_policy")
    return policy if isinstance(policy, dict) else None


def _url_without_query(value: str) -> str | None:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    port = f":{parsed.port}" if parsed.port else ""
    path = parsed.path or "/"
    return f"{parsed.scheme}://{parsed.hostname.lower()}{port}{path}"


def _host(value: str) -> str | None:
    trimmed = value.strip()
    parsed = urlparse(trimmed if "://" in trimmed else f"https://{trimmed}")
    return parsed.hostname.lower() if parsed.hostname else None


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str) and item.strip()]


def _first_query_value(payload: str, key: str) -> str | None:
    parsed = urlparse(payload)
    values = parse_qs(parsed.query, keep_blank_values=True).get(key)
    if not values:
        return None
    value = values[0].strip()
    return value or None


def _query_flag(payload: str, key: str) -> bool:
    value = (_first_query_value(payload, key) or "").lower()
    return value in {"1", "true", "yes", "y", "on"}


def _query_hops(payload: str) -> tuple[int | None, str | None]:
    raw_value = _first_query_value(payload, "hops")
    if raw_value is None:
        return 1, None
    try:
        hop_count = int(raw_value)
    except ValueError:
        return None, f"Redirect hop count '{raw_value}' is not a valid number."
    if hop_count < 0:
        return None, "Redirect hop count cannot be negative."
    return hop_count, None


def _policy_label(max_hops: int) -> str:
    return f"resolver_to_final:max_{max_hops}_hop{'s' if max_hops != 1 else ''}"


def evaluate_redirect_policy(
    payload: str,
    *,
    fixture_dir: Path = DEFAULT_FIXTURE_DIR,
) -> RedirectPolicyVerdict:
    policy = _load_redirect_policy(fixture_dir)
    resolver_base_url = _url_without_query(payload)
    if policy is None or resolver_base_url is None:
        return RedirectPolicyVerdict(
            state="not_applicable",
            resolver_url=None,
            final_url=None,
            hop_count=None,
            reason="No resolver policy applies to this destination.",
            open_allowed=True,
            effective_url=payload,
        )

    resolver_urls = {_url_without_query(item) for item in _string_list(policy.get("resolver_urls"))}
    resolver_urls.discard(None)
    if resolver_base_url not in resolver_urls:
        return RedirectPolicyVerdict(
            state="not_applicable",
            resolver_url=None,
            final_url=None,
            hop_count=None,
            reason="Destination is not an enrolled resolver URL.",
            open_allowed=True,
            effective_url=payload,
        )

    expected_final_destinations = _string_list(policy.get("expected_final_destinations"))
    final_url = _first_query_value(payload, "final")
    if final_url:
        final_url = unquote(final_url)
    elif expected_final_destinations:
        final_url = expected_final_destinations[0]

    max_hops_raw = policy.get("max_redirect_hops")
    max_hops = max_hops_raw if isinstance(max_hops_raw, int) else 1
    label = _policy_label(max_hops)
    hop_count, hop_error = _query_hops(payload)
    if hop_error:
        return RedirectPolicyVerdict(
            state="blocked",
            resolver_url=resolver_base_url,
            final_url=final_url,
            hop_count=None,
            reason=hop_error,
            open_allowed=False,
            effective_url=final_url or payload,
            policy_label=label,
        )

    nested_allowed = policy.get("nested_shorteners_allowed") is True
    if _query_flag(payload, "nested") and not nested_allowed:
        return RedirectPolicyVerdict(
            state="blocked",
            resolver_url=resolver_base_url,
            final_url=final_url,
            hop_count=hop_count,
            reason="Nested shorteners are not allowed by issuer redirect policy.",
            open_allowed=False,
            effective_url=final_url or payload,
            policy_label=label,
        )

    if hop_count is not None and hop_count > max_hops:
        return RedirectPolicyVerdict(
            state="blocked",
            resolver_url=resolver_base_url,
            final_url=final_url,
            hop_count=hop_count,
            reason=(
                "Resolver exceeded issuer redirect policy: "
                f"{hop_count} hops observed, max {max_hops}."
            ),
            open_allowed=False,
            effective_url=final_url or payload,
            policy_label=label,
        )

    if final_url is None:
        return RedirectPolicyVerdict(
            state="blocked",
            resolver_url=resolver_base_url,
            final_url=None,
            hop_count=hop_count,
            reason="Resolver did not produce a final destination for scanner binding.",
            open_allowed=False,
            effective_url=payload,
            policy_label=label,
        )

    allowed_hosts = {_host(item) for item in _string_list(policy.get("allowed_redirect_hosts"))}
    allowed_hosts.discard(None)
    final_host = _host(final_url)
    if final_host not in allowed_hosts:
        return RedirectPolicyVerdict(
            state="blocked",
            resolver_url=resolver_base_url,
            final_url=final_url,
            hop_count=hop_count,
            reason=(
                f"Resolver final host '{final_host or 'unknown'}' is not in the "
                "issuer-approved redirect host set."
            ),
            open_allowed=False,
            effective_url=final_url,
            policy_label=label,
        )

    if final_url not in expected_final_destinations:
        return RedirectPolicyVerdict(
            state="blocked",
            resolver_url=resolver_base_url,
            final_url=final_url,
            hop_count=hop_count,
            reason=(
                f"Resolver points to {final_url}, which is not an "
                "issuer-approved final destination."
            ),
            open_allowed=False,
            effective_url=final_url,
            policy_label=label,
        )

    return RedirectPolicyVerdict(
        state="bound",
        resolver_url=resolver_base_url,
        final_url=final_url,
        hop_count=hop_count,
        reason=(
            "Resolver and final destination match issuer redirect policy "
            f"within {max_hops} hop{'s' if max_hops != 1 else ''}."
        ),
        open_allowed=True,
        effective_url=final_url,
        policy_label=label,
    )
