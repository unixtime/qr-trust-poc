from __future__ import annotations

import json
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DEFAULT_NON_PRODUCTION_DEMO_FIXTURE_DIR = (
    Path(__file__).resolve().parents[3]
    / "docs"
    / "public"
    / "fixtures"
    / "governance"
)
DEFAULT_FIXTURE_DIR = DEFAULT_NON_PRODUCTION_DEMO_FIXTURE_DIR


@dataclass(frozen=True)
class GovernanceTrustProjection:
    root_program_id: str
    delegated_authority_id: str
    issuer_id: str
    issuer_display_name: str
    assurance_tier: str
    destination_policy_id: str
    cache_entry_id: str
    cache_state_published_at: str
    cache_generated_at: str
    cache_expires_at: str
    max_staleness_seconds: int
    stale_behavior: str
    source_artifacts: dict[str, str]

    @property
    def issuer_namespace_label(self) -> str:
        return (
            f"({self.root_program_id}, "
            f"{self.delegated_authority_id}, "
            f"{self.issuer_id})"
        )

    def cache_freshness_state(self, *, now: datetime | None = None) -> str:
        observed_now = now or datetime.now(timezone.utc)
        expires_at = _parse_fixture_timestamp(self.cache_expires_at)
        if observed_now >= expires_at:
            return "expired"
        generated_at = _parse_fixture_timestamp(self.cache_generated_at)
        age_seconds = int((observed_now - generated_at).total_seconds())
        if age_seconds > self.max_staleness_seconds:
            return "stale"
        return "fresh"

    def with_cache_profile(
        self,
        cache_profile: str,
        *,
        now: datetime | None = None,
    ) -> GovernanceTrustProjection:
        if cache_profile == "fresh":
            return self

        observed_now = now or datetime.now(timezone.utc)
        if cache_profile == "stale":
            return replace(
                self,
                cache_entry_id=f"{self.cache_entry_id}:stale-demo",
                cache_generated_at=_format_fixture_timestamp(
                    observed_now - timedelta(minutes=2),
                ),
                cache_expires_at=_format_fixture_timestamp(
                    observed_now + timedelta(minutes=10),
                ),
                max_staleness_seconds=60,
            )

        if cache_profile == "expired":
            return replace(
                self,
                cache_entry_id=f"{self.cache_entry_id}:expired-demo",
                cache_generated_at=_format_fixture_timestamp(
                    observed_now - timedelta(minutes=10),
                ),
                cache_expires_at=_format_fixture_timestamp(
                    observed_now - timedelta(minutes=1),
                ),
                max_staleness_seconds=60,
            )

        raise ValueError(f"Unsupported governance cache profile: {cache_profile}")


def _load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Governance fixture must be a JSON object: {path}")
    return payload


def _parse_fixture_timestamp(value: str) -> datetime:
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _format_fixture_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _source_artifacts(cache_entry: dict[str, Any]) -> dict[str, str]:
    raw_artifacts = cache_entry.get("source_artifacts", {})
    if not isinstance(raw_artifacts, dict):
        raise ValueError("Verifier cache source_artifacts must be a JSON object")
    return {
        str(key): str(value)
        for key, value in raw_artifacts.items()
    }


def load_governance_projection(
    certificate_ref: str,
    *,
    fixture_dir: Path = DEFAULT_NON_PRODUCTION_DEMO_FIXTURE_DIR,
    cache_profile: str = "fresh",
) -> GovernanceTrustProjection | None:
    """
    Return the non-production demo governance projection for a certificate ref.

    The fixtures are non-normative local PoC examples. Production-like paths use
    Postgres management state as authority; this loader intentionally projects
    only the fields the current scanner response can consume without pretending
    to verify a full signed governance chain.
    """
    cache_entry_path = fixture_dir / "verifier-cache-entry.json"
    issuer_record_path = fixture_dir / "issuer-record.json"
    if not cache_entry_path.exists() or not issuer_record_path.exists():
        return None

    cache_entry = _load_json(cache_entry_path)
    if cache_entry.get("certificate_ref") != certificate_ref:
        return None

    issuer_record = _load_json(issuer_record_path)
    namespace = cache_entry["effective_issuer_namespace"]
    issuer_namespace = issuer_record["issuer_namespace"]
    if issuer_namespace != namespace:
        raise ValueError("Issuer record namespace does not match verifier cache entry")
    freshness = cache_entry["freshness"]

    projection = GovernanceTrustProjection(
        root_program_id=namespace["root_program_id"],
        delegated_authority_id=namespace["delegated_authority_id"],
        issuer_id=namespace["issuer_id"],
        issuer_display_name=cache_entry["issuer_display_name"],
        assurance_tier=cache_entry["assurance_tier"],
        destination_policy_id=cache_entry["destination_policy_id"],
        cache_entry_id=cache_entry["cache_entry_id"],
        cache_state_published_at=freshness["state_published_at"],
        cache_generated_at=freshness["cache_generated_at"],
        cache_expires_at=freshness["cache_expires_at"],
        max_staleness_seconds=int(freshness["max_staleness_seconds"]),
        stale_behavior=freshness["stale_behavior"],
        source_artifacts=_source_artifacts(cache_entry),
    )
    return projection.with_cache_profile(cache_profile)
