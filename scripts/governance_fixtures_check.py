#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "docs" / "public" / "fixtures" / "governance"

REQUIRED_ARTIFACTS = {
    "root_manifest": "root-manifest.json",
    "delegated_operator_manifest": "delegated-operator-manifest.json",
    "issuer_record": "issuer-record.json",
    "destination_policy": "destination-policy.json",
    "revocation_status_event": "revocation-status-event.json",
    "trust_key_status_event": "trust-key-status-event.json",
    "verifier_cache_entry": "verifier-cache-entry.json",
}


class FixtureError(ValueError):
    pass


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FixtureError(f"missing fixture: {path.relative_to(ROOT)}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise FixtureError(f"invalid JSON in {path.relative_to(ROOT)}: {exc}") from exc
    if not isinstance(payload, dict):
        raise FixtureError(f"fixture must be a JSON object: {path.relative_to(ROOT)}")
    return payload


def require_equal(label: str, actual: Any, expected: Any) -> None:
    if actual != expected:
        raise FixtureError(f"{label} mismatch: expected {expected!r}, got {actual!r}")


def require_truthy(label: str, value: Any) -> None:
    if not value:
        raise FixtureError(f"{label} is required")


def artifact_paths(index: dict[str, Any]) -> dict[str, str]:
    artifacts = index.get("artifacts")
    if not isinstance(artifacts, list):
        raise FixtureError("index artifacts must be a list")

    result: dict[str, str] = {}
    for artifact in artifacts:
        if not isinstance(artifact, dict):
            raise FixtureError("each index artifact must be an object")
        kind = artifact.get("kind")
        path = artifact.get("path")
        if not isinstance(kind, str) or not isinstance(path, str):
            raise FixtureError("each index artifact needs string kind and path")
        result[kind] = path
    return result


def main() -> int:
    index = load_json(FIXTURE_DIR / "index.json")
    paths = artifact_paths(index)

    for kind, expected_path in REQUIRED_ARTIFACTS.items():
        require_equal(f"index path for {kind}", paths.get(kind), expected_path)

    root = load_json(FIXTURE_DIR / REQUIRED_ARTIFACTS["root_manifest"])
    operator = load_json(FIXTURE_DIR / REQUIRED_ARTIFACTS["delegated_operator_manifest"])
    issuer = load_json(FIXTURE_DIR / REQUIRED_ARTIFACTS["issuer_record"])
    destination_policy = load_json(FIXTURE_DIR / REQUIRED_ARTIFACTS["destination_policy"])
    status_event = load_json(FIXTURE_DIR / REQUIRED_ARTIFACTS["revocation_status_event"])
    cache_entry = load_json(FIXTURE_DIR / REQUIRED_ARTIFACTS["verifier_cache_entry"])

    root_program_id = index["root_program_id"]
    delegated_authority_id = index["delegated_authority_id"]
    issuer_id = index["issuer_id"]
    destination_policy_id = index["destination_policy_id"]
    status_event_id = index["revocation_event_id"]
    trust_key_status_event_id = index["trust_key_status_event_id"]
    cache_entry_id = index["verifier_cache_entry_id"]

    require_equal("root program id", root["root_program_id"], root_program_id)
    require_equal("operator root program id", operator["root_program_id"], root_program_id)
    require_equal("operator delegated authority id", operator["delegated_authority_id"], delegated_authority_id)

    issuer_namespace = issuer["issuer_namespace"]
    require_equal("issuer root program id", issuer_namespace["root_program_id"], root_program_id)
    require_equal("issuer delegated authority id", issuer_namespace["delegated_authority_id"], delegated_authority_id)
    require_equal("issuer id", issuer_namespace["issuer_id"], issuer_id)

    require_equal("destination root program id", destination_policy["root_program_id"], root_program_id)
    require_equal("destination delegated authority id", destination_policy["delegated_authority_id"], delegated_authority_id)
    require_equal("destination issuer id", destination_policy["issuer_id"], issuer_id)
    require_equal("destination policy id", destination_policy["destination_policy_id"], destination_policy_id)

    require_equal("status event id", status_event["status_event_id"], status_event_id)
    require_equal("status target issuer id", status_event["target"]["issuer_id"], issuer_id)

    trust_key_status_event = load_json(
        FIXTURE_DIR / REQUIRED_ARTIFACTS["trust_key_status_event"]
    )
    require_equal(
        "trust-key status event id",
        trust_key_status_event["status_event_id"],
        trust_key_status_event_id,
    )
    require_equal(
        "trust-key status target type",
        trust_key_status_event["target"]["target_type"],
        "trust_key",
    )
    require_truthy(
        "trust-key status target key id",
        trust_key_status_event["target"].get("key_id"),
    )

    require_equal("cache entry id", cache_entry["cache_entry_id"], cache_entry_id)
    cache_namespace = cache_entry["effective_issuer_namespace"]
    require_equal("cache root program id", cache_namespace["root_program_id"], root_program_id)
    require_equal("cache delegated authority id", cache_namespace["delegated_authority_id"], delegated_authority_id)
    require_equal("cache issuer id", cache_namespace["issuer_id"], issuer_id)
    require_equal("cache destination policy id", cache_entry["destination_policy_id"], destination_policy_id)

    require_truthy("root delegated authorities", root.get("delegated_authorities"))
    require_truthy("operator enrolled issuers", operator.get("enrolled_issuers"))
    require_truthy("issuer certificate refs", issuer.get("certificate_refs"))
    require_truthy("destination approved destinations", destination_policy.get("approved_destinations"))
    require_truthy("cache freshness", cache_entry.get("freshness"))
    require_truthy("cache expires at", cache_entry["freshness"].get("cache_expires_at"))
    require_truthy("cache generated at", cache_entry["freshness"].get("cache_generated_at"))
    require_truthy("cache state published at", cache_entry["freshness"].get("state_published_at"))
    require_truthy("cache stale behavior", cache_entry["freshness"].get("stale_behavior"))
    require_truthy("cache source artifacts", cache_entry.get("source_artifacts"))

    print("PASS: governance fixture bundle is internally consistent")
    print(f"PASS: validated {len(REQUIRED_ARTIFACTS) + 1} governance fixture files")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except FixtureError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
