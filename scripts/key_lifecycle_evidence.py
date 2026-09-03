#!/usr/bin/env python3
"""Export and validate the public-safe E1/E2 key-lifecycle evidence record.

The experiment run records are intentionally ignored because they contain
full trust-store snapshots.  This module selects an explicit field allowlist,
hashes each source record, and emits only the observations needed to support
the bounded public claims.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = (
    ROOT / "docs/public/evaluation/key_lifecycle_evidence.v1.json"
)
SCHEMA_VERSION = "qr-trust-key-lifecycle-evidence.v1"
HEX_64 = re.compile(r"^[0-9a-f]{64}$")


class EvidenceError(ValueError):
    """The source run or public evidence record violates its contract."""


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EvidenceError(f"cannot read JSON from {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise EvidenceError(f"{path} must contain a JSON object")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise EvidenceError(f"cannot hash {path}: {exc}") from exc
    return digest.hexdigest()


def _parse_timestamp(value: object, context: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise EvidenceError(f"{context} must be a non-empty timestamp")
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise EvidenceError(f"{context} is not ISO 8601: {value}") from exc
    if parsed.tzinfo is None:
        raise EvidenceError(f"{context} must include an offset: {value}")
    return parsed


def _expect_keys(value: object, expected: set[str], context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise EvidenceError(f"{context} must be an object")
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise EvidenceError(
            f"{context} has the wrong fields; missing={missing}, extra={extra}"
        )
    return value


def _steps(run: dict[str, Any]) -> list[dict[str, Any]]:
    steps = run.get("steps")
    if not isinstance(steps, list):
        raise EvidenceError("source run steps must be an array")
    if not all(isinstance(step, dict) for step in steps):
        raise EvidenceError("every source run step must be an object")
    return steps


def _step(run: dict[str, Any], name: str) -> dict[str, Any]:
    matches = [step for step in _steps(run) if step.get("step") == name]
    if len(matches) != 1:
        raise EvidenceError(f"source run must contain exactly one {name!r} step")
    return matches[0]


def _require_string(value: object, context: str) -> str:
    if not isinstance(value, str) or not value:
        raise EvidenceError(f"{context} must be a non-empty string")
    return value


def _decision(step: dict[str, Any], context: str) -> dict[str, Any]:
    decision = step.get("decision")
    if not isinstance(decision, dict):
        raise EvidenceError(f"{context}.decision must be an object")
    return {
        "decision_state": _require_string(
            decision.get("decision_state"), f"{context}.decision_state"
        ),
        "open_allowed": decision.get("open_allowed"),
        "verifier_stage": _require_string(
            decision.get("verifier_stage"), f"{context}.verifier_stage"
        ),
    }


def _target_key(
    step: dict[str, Any], certificate_id: str, context: str
) -> dict[str, Any]:
    trust_store = step.get("trust_store")
    if not isinstance(trust_store, dict):
        raise EvidenceError(f"{context}.trust_store must be an object")
    keys = trust_store.get("keys")
    if not isinstance(keys, list):
        raise EvidenceError(f"{context}.trust_store.keys must be an array")
    matches = [
        key
        for key in keys
        if isinstance(key, dict) and key.get("key_ref") == certificate_id
    ]
    if len(matches) != 1:
        raise EvidenceError(
            f"{context} must contain exactly one key with key_ref={certificate_id!r}"
        )
    return matches[0]


def _checkpoint(
    run: dict[str, Any], step_name: str, certificate_id: str, public_name: str
) -> dict[str, Any]:
    step = _step(run, step_name)
    key = _target_key(step, certificate_id, step_name)
    return {
        "name": public_name,
        "observed_at": _require_string(step.get("at"), f"{step_name}.at"),
        "projected_key_state": _require_string(
            key.get("state"), f"{step_name}.key.state"
        ),
        **_decision(step, step_name),
        "revoked_at": key.get("revoked_at"),
    }


def export_public_evidence(e1_path: Path, e2_path: Path) -> dict[str, Any]:
    e1 = _load_json(e1_path)
    e2 = _load_json(e2_path)
    if e1.get("experiment") != "e1-revocation-persistence":
        raise EvidenceError("E1 source has the wrong experiment identifier")
    if e2.get("experiment") != "e2-rotated-key-backdating":
        raise EvidenceError("E2 source has the wrong experiment identifier")

    e1_enroll = _step(e1, "enroll-c0")
    e1_sign = _step(e1, "sign-a0")
    e1_certificate = _require_string(
        e1_enroll.get("certificate_id"), "enroll-c0.certificate_id"
    )
    e1_restart = _step(e1, "post-restart-status")

    e2_enroll = _step(e2, "enroll-c2")
    e2_sign = _step(e2, "sign-a2-backdated")
    e2_rotate = _step(e2, "rotate-c2")
    e2_certificate = _require_string(
        e2_enroll.get("certificate_id"), "enroll-c2.certificate_id"
    )
    e2_accepted = _checkpoint(
        e2,
        "scan-a2-hypothesis",
        e2_certificate,
        "post-rotation-backdated-artifact",
    )
    e2_revoked = _checkpoint(
        e2, "scan-a2-revoked", e2_certificate, "post-revocation"
    )
    e2_hypothesis_key = _target_key(
        _step(e2, "scan-a2-hypothesis"),
        e2_certificate,
        "scan-a2-hypothesis",
    )

    generated_at = max(
        _require_string(e1.get("finished_at"), "E1.finished_at"),
        _require_string(e2.get("finished_at"), "E2.finished_at"),
        key=lambda value: _parse_timestamp(value, "finished_at"),
    )
    record = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": generated_at,
        "evidence_boundary": {
            "environment": "controlled local Postgres-backed compose deployment",
            "raw_records_public": False,
            "raw_record_reason": (
                "full trust-store snapshots remain ignored; this record is an "
                "explicit public field allowlist"
            ),
            "private_key_material_recorded": False,
            "restart_claim_scope": (
                "operator-observed API restart with Postgres left running; the "
                "source record has no container identity or restart receipt"
            ),
        },
        "source_runs": {
            "e1": {
                "file": e1_path.name,
                "sha256": _sha256(e1_path),
                "started_at": _require_string(e1.get("started_at"), "E1.started_at"),
                "finished_at": _require_string(
                    e1.get("finished_at"), "E1.finished_at"
                ),
            },
            "e2": {
                "file": e2_path.name,
                "sha256": _sha256(e2_path),
                "started_at": _require_string(e2.get("started_at"), "E2.started_at"),
                "finished_at": _require_string(
                    e2.get("finished_at"), "E2.finished_at"
                ),
            },
        },
        "experiments": {
            "e1_persistent_revocation": {
                "certificate_id": e1_certificate,
                "artifact_envelope_fingerprint_sha256": _require_string(
                    e1_sign.get("envelope_fingerprint"),
                    "sign-a0.envelope_fingerprint",
                ),
                "artifact_expires_at": e1_sign.get("expires_at"),
                "checkpoints": [
                    _checkpoint(
                        e1, "scan-a0-active", e1_certificate, "active"
                    ),
                    _checkpoint(
                        e1, "scan-a0-rotated", e1_certificate, "rotated"
                    ),
                    _checkpoint(
                        e1, "scan-a0-revoked", e1_certificate, "revoked"
                    ),
                    _checkpoint(
                        e1,
                        "scan-a0-post-restart",
                        e1_certificate,
                        "post-operator-observed-restart",
                    ),
                ],
                "restart_observation": {
                    "status_recovered_at": _require_string(
                        e1_restart.get("at"), "post-restart-status.at"
                    ),
                    "machine_verifiable_restart_identity": False,
                },
            },
            "e2_rotated_key_backdating": {
                "certificate_id": e2_certificate,
                "artifact_envelope_fingerprint_sha256": _require_string(
                    e2_sign.get("envelope_fingerprint"),
                    "sign-a2-backdated.envelope_fingerprint",
                ),
                "rotation_recorded_at": _require_string(
                    e2_rotate.get("at"), "rotate-c2.at"
                ),
                "artifact_signing_recorded_at": _require_string(
                    e2_sign.get("at"), "sign-a2-backdated.at"
                ),
                "claimed_issued_at": _require_string(
                    e2_sign.get("issued_at"), "sign-a2-backdated.issued_at"
                ),
                "certificate_not_before": _require_string(
                    e2_hypothesis_key.get("not_before"),
                    "scan-a2-hypothesis.key.not_before",
                ),
                "certificate_not_after": _require_string(
                    e2_hypothesis_key.get("not_after"),
                    "scan-a2-hypothesis.key.not_after",
                ),
                "independent_issuance_time_witness": False,
                "checkpoints": [e2_accepted, e2_revoked],
            },
        },
    }
    validate_public_evidence(record)
    return record


def _validate_checkpoint(
    checkpoint: object,
    *,
    context: str,
    expected_name: str,
    expected_key_state: str,
    expected_decision: str,
    expected_open: bool,
    expected_stage: str,
) -> dict[str, Any]:
    value = _expect_keys(
        checkpoint,
        {
            "name",
            "observed_at",
            "projected_key_state",
            "decision_state",
            "open_allowed",
            "verifier_stage",
            "revoked_at",
        },
        context,
    )
    expected = {
        "name": expected_name,
        "projected_key_state": expected_key_state,
        "decision_state": expected_decision,
        "open_allowed": expected_open,
        "verifier_stage": expected_stage,
    }
    for field, expected_value in expected.items():
        if value[field] != expected_value:
            raise EvidenceError(
                f"{context}.{field} must be {expected_value!r}, got {value[field]!r}"
            )
    _parse_timestamp(value["observed_at"], f"{context}.observed_at")
    if expected_key_state == "revoked":
        _parse_timestamp(value["revoked_at"], f"{context}.revoked_at")
    elif value["revoked_at"] is not None:
        raise EvidenceError(f"{context}.revoked_at must be null")
    return value


def validate_public_evidence(record: dict[str, Any]) -> None:
    top = _expect_keys(
        record,
        {
            "schema_version",
            "generated_at",
            "evidence_boundary",
            "source_runs",
            "experiments",
        },
        "record",
    )
    if top["schema_version"] != SCHEMA_VERSION:
        raise EvidenceError(f"unsupported schema_version: {top['schema_version']!r}")
    generated_at = _parse_timestamp(top["generated_at"], "generated_at")

    boundary = _expect_keys(
        top["evidence_boundary"],
        {
            "environment",
            "raw_records_public",
            "raw_record_reason",
            "private_key_material_recorded",
            "restart_claim_scope",
        },
        "evidence_boundary",
    )
    if boundary["raw_records_public"] is not False:
        raise EvidenceError("raw_records_public must remain false")
    if boundary["private_key_material_recorded"] is not False:
        raise EvidenceError("private_key_material_recorded must remain false")
    for field in ("environment", "raw_record_reason", "restart_claim_scope"):
        _require_string(boundary[field], f"evidence_boundary.{field}")

    sources = _expect_keys(top["source_runs"], {"e1", "e2"}, "source_runs")
    source_finished: list[datetime] = []
    for name in ("e1", "e2"):
        source = _expect_keys(
            sources[name],
            {"file", "sha256", "started_at", "finished_at"},
            f"source_runs.{name}",
        )
        filename = _require_string(source["file"], f"source_runs.{name}.file")
        if Path(filename).name != filename:
            raise EvidenceError(f"source_runs.{name}.file must be a basename")
        digest = _require_string(source["sha256"], f"source_runs.{name}.sha256")
        if not HEX_64.fullmatch(digest):
            raise EvidenceError(f"source_runs.{name}.sha256 must be 64 lowercase hex")
        started = _parse_timestamp(
            source["started_at"], f"source_runs.{name}.started_at"
        )
        finished = _parse_timestamp(
            source["finished_at"], f"source_runs.{name}.finished_at"
        )
        if finished < started:
            raise EvidenceError(f"source_runs.{name} finishes before it starts")
        source_finished.append(finished)
    if generated_at != max(source_finished):
        raise EvidenceError("generated_at must equal the latest source finished_at")

    experiments = _expect_keys(
        top["experiments"],
        {"e1_persistent_revocation", "e2_rotated_key_backdating"},
        "experiments",
    )
    e1 = _expect_keys(
        experiments["e1_persistent_revocation"],
        {
            "certificate_id",
            "artifact_envelope_fingerprint_sha256",
            "artifact_expires_at",
            "checkpoints",
            "restart_observation",
        },
        "experiments.e1_persistent_revocation",
    )
    _require_string(e1["certificate_id"], "E1.certificate_id")
    if not HEX_64.fullmatch(
        _require_string(
            e1["artifact_envelope_fingerprint_sha256"],
            "E1.artifact_envelope_fingerprint_sha256",
        )
    ):
        raise EvidenceError("E1 artifact fingerprint must be 64 lowercase hex")
    if e1["artifact_expires_at"] is not None:
        raise EvidenceError("E1 artifact_expires_at must preserve the observed null")
    if not isinstance(e1["checkpoints"], list) or len(e1["checkpoints"]) != 4:
        raise EvidenceError("E1 must contain exactly four checkpoints")
    e1_expected = (
        ("active", "active", "verified_issuer", True, "accepted"),
        ("rotated", "retired", "verified_issuer", True, "accepted"),
        ("revoked", "revoked", "blocked", False, "key_status"),
        (
            "post-operator-observed-restart",
            "revoked",
            "blocked",
            False,
            "key_status",
        ),
    )
    e1_times: list[datetime] = []
    e1_checked: list[dict[str, Any]] = []
    for index, expected in enumerate(e1_expected):
        checked = _validate_checkpoint(
            e1["checkpoints"][index],
            context=f"E1.checkpoints[{index}]",
            expected_name=expected[0],
            expected_key_state=expected[1],
            expected_decision=expected[2],
            expected_open=expected[3],
            expected_stage=expected[4],
        )
        e1_checked.append(checked)
        e1_times.append(_parse_timestamp(checked["observed_at"], "E1 observed_at"))
    if e1_times != sorted(e1_times):
        raise EvidenceError("E1 checkpoints must be chronological")
    if e1_checked[2]["revoked_at"] != e1_checked[3]["revoked_at"]:
        raise EvidenceError("E1 must preserve the same revocation across restart")
    restart = _expect_keys(
        e1["restart_observation"],
        {"status_recovered_at", "machine_verifiable_restart_identity"},
        "E1.restart_observation",
    )
    restart_at = _parse_timestamp(
        restart["status_recovered_at"], "E1.restart_observation.status_recovered_at"
    )
    if restart["machine_verifiable_restart_identity"] is not False:
        raise EvidenceError("existing E1 run must not claim machine-verifiable restart identity")
    if not (e1_times[2] < restart_at <= e1_times[3]):
        raise EvidenceError("E1 restart recovery must fall between revoked scans")

    e2 = _expect_keys(
        experiments["e2_rotated_key_backdating"],
        {
            "certificate_id",
            "artifact_envelope_fingerprint_sha256",
            "rotation_recorded_at",
            "artifact_signing_recorded_at",
            "claimed_issued_at",
            "certificate_not_before",
            "certificate_not_after",
            "independent_issuance_time_witness",
            "checkpoints",
        },
        "experiments.e2_rotated_key_backdating",
    )
    _require_string(e2["certificate_id"], "E2.certificate_id")
    if not HEX_64.fullmatch(
        _require_string(
            e2["artifact_envelope_fingerprint_sha256"],
            "E2.artifact_envelope_fingerprint_sha256",
        )
    ):
        raise EvidenceError("E2 artifact fingerprint must be 64 lowercase hex")
    if e2["independent_issuance_time_witness"] is not False:
        raise EvidenceError("E2 must preserve the absence of an issuance-time witness")
    not_before = _parse_timestamp(e2["certificate_not_before"], "E2.not_before")
    not_after = _parse_timestamp(e2["certificate_not_after"], "E2.not_after")
    claimed = _parse_timestamp(e2["claimed_issued_at"], "E2.claimed_issued_at")
    rotated = _parse_timestamp(e2["rotation_recorded_at"], "E2.rotation_recorded_at")
    signed = _parse_timestamp(
        e2["artifact_signing_recorded_at"], "E2.artifact_signing_recorded_at"
    )
    if not (not_before <= claimed <= not_after):
        raise EvidenceError("E2 claimed_issued_at must fall inside the key window")
    if not claimed < rotated < signed:
        raise EvidenceError(
            "E2 must show claimed_issued_at before rotation and signing after rotation"
        )
    if not isinstance(e2["checkpoints"], list) or len(e2["checkpoints"]) != 2:
        raise EvidenceError("E2 must contain exactly two checkpoints")
    e2_expected = (
        (
            "post-rotation-backdated-artifact",
            "retired",
            "verified_issuer",
            True,
            "accepted",
        ),
        ("post-revocation", "revoked", "blocked", False, "key_status"),
    )
    e2_times: list[datetime] = []
    for index, expected in enumerate(e2_expected):
        checked = _validate_checkpoint(
            e2["checkpoints"][index],
            context=f"E2.checkpoints[{index}]",
            expected_name=expected[0],
            expected_key_state=expected[1],
            expected_decision=expected[2],
            expected_open=expected[3],
            expected_stage=expected[4],
        )
        e2_times.append(_parse_timestamp(checked["observed_at"], "E2 observed_at"))
    if not signed <= e2_times[0] < e2_times[1]:
        raise EvidenceError("E2 checkpoint order contradicts the signing observation")


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate the output")
    parser.add_argument("--e1-run", type=Path, help="ignored raw E1 run record")
    parser.add_argument("--e2-run", type=Path, help="ignored raw E2 run record")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)

    try:
        if args.check:
            committed = _load_json(args.output)
            validate_public_evidence(committed)
            if (args.e1_run is None) != (args.e2_run is None):
                raise EvidenceError(
                    "source comparison requires both --e1-run and --e2-run"
                )
            if args.e1_run is not None and args.e2_run is not None:
                regenerated = export_public_evidence(args.e1_run, args.e2_run)
                if regenerated != committed:
                    raise EvidenceError(
                        "public evidence differs from the supplied source runs"
                    )
            print(f"Key-lifecycle evidence passed: {args.output}")
            return 0

        if args.e1_run is None or args.e2_run is None:
            parser.error("generation requires --e1-run and --e2-run")
        record = export_public_evidence(args.e1_run, args.e2_run)
        _write_json(args.output, record)
        print(f"Generated public key-lifecycle evidence: {args.output}")
        return 0
    except EvidenceError as exc:
        print(f"key-lifecycle evidence error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
