from __future__ import annotations

import importlib.util
import json
import sys
from copy import deepcopy
from pathlib import Path
from types import ModuleType

import pytest


ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_SCRIPT = ROOT / "scripts" / "key_lifecycle_evidence.py"


def load_evidence_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "key_lifecycle_evidence",
        EVIDENCE_SCRIPT,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _key(key_ref: str, state: str, *, revoked_at: str | None = None) -> dict:
    return {
        "key_ref": key_ref,
        "state": state,
        "not_before": "2026-08-01T00:00:00Z",
        "not_after": "2026-10-01T00:00:00Z",
        "revoked_at": revoked_at,
        "public_key_pem": "not allowed into the public artifact",
    }


def _scan_step(
    name: str,
    at: str,
    certificate_id: str,
    state: str,
    decision_state: str,
    open_allowed: bool,
    verifier_stage: str,
    *,
    revoked_at: str | None = None,
) -> dict:
    return {
        "step": name,
        "at": at,
        "decision": {
            "decision_state": decision_state,
            "open_allowed": open_allowed,
            "verifier_stage": verifier_stage,
            "signals": [{"sensitive": "not exported"}],
        },
        "trust_store": {
            "keys": [
                _key(
                    f"{certificate_id}-decoy",
                    "revoked",
                    revoked_at="2026-09-01T00:00:00Z",
                ),
                _key(certificate_id, state, revoked_at=revoked_at),
            ],
            "issuers": [{"internal": "not exported"}],
        },
    }


def _write_sources(tmp_path: Path) -> tuple[Path, Path]:
    e1_certificate = "cert:test:e1-c0"
    e1 = {
        "experiment": "e1-revocation-persistence",
        "started_at": "2026-09-02T09:00:00Z",
        "finished_at": "2026-09-02T09:00:08Z",
        "steps": [
            {
                "step": "enroll-c0",
                "at": "2026-09-02T09:00:01Z",
                "certificate_id": e1_certificate,
                "response": {"public_key": "not exported"},
            },
            {
                "step": "sign-a0",
                "at": "2026-09-02T09:00:02Z",
                "envelope_fingerprint": "a" * 64,
                "expires_at": None,
            },
            _scan_step(
                "scan-a0-active",
                "2026-09-02T09:00:03Z",
                e1_certificate,
                "active",
                "verified_issuer",
                True,
                "accepted",
            ),
            _scan_step(
                "scan-a0-rotated",
                "2026-09-02T09:00:04Z",
                e1_certificate,
                "retired",
                "verified_issuer",
                True,
                "accepted",
            ),
            _scan_step(
                "scan-a0-revoked",
                "2026-09-02T09:00:05Z",
                e1_certificate,
                "revoked",
                "blocked",
                False,
                "key_status",
                revoked_at="2026-09-02T09:00:04.500000Z",
            ),
            {
                "step": "post-restart-status",
                "at": "2026-09-02T09:00:06Z",
                "status": {"internal": "not exported"},
            },
            _scan_step(
                "scan-a0-post-restart",
                "2026-09-02T09:00:07Z",
                e1_certificate,
                "revoked",
                "blocked",
                False,
                "key_status",
                revoked_at="2026-09-02T09:00:04.500000Z",
            ),
        ],
    }

    e2_certificate = "cert:test:e2-c2"
    e2 = {
        "experiment": "e2-rotated-key-backdating",
        "started_at": "2026-09-02T10:00:00Z",
        "finished_at": "2026-09-02T10:00:06Z",
        "steps": [
            {
                "step": "enroll-c2",
                "at": "2026-09-02T10:00:01Z",
                "certificate_id": e2_certificate,
            },
            {"step": "rotate-c2", "at": "2026-09-02T10:00:02Z"},
            {
                "step": "sign-a2-backdated",
                "at": "2026-09-02T10:00:03Z",
                "envelope_fingerprint": "b" * 64,
                "issued_at": "2026-08-26T10:00:00Z",
            },
            _scan_step(
                "scan-a2-hypothesis",
                "2026-09-02T10:00:04Z",
                e2_certificate,
                "retired",
                "verified_issuer",
                True,
                "accepted",
            ),
            _scan_step(
                "scan-a2-revoked",
                "2026-09-02T10:00:05Z",
                e2_certificate,
                "revoked",
                "blocked",
                False,
                "key_status",
                revoked_at="2026-09-02T10:00:04.500000Z",
            ),
        ],
    }

    e1_path = tmp_path / "e1.json"
    e2_path = tmp_path / "e2.json"
    e1_path.write_text(json.dumps(e1), encoding="utf-8")
    e2_path.write_text(json.dumps(e2), encoding="utf-8")
    return e1_path, e2_path


def test_export_uses_exact_key_identity_and_redacts_raw_snapshots(tmp_path: Path) -> None:
    evidence = load_evidence_module()
    e1_path, e2_path = _write_sources(tmp_path)

    record = evidence.export_public_evidence(e1_path, e2_path)

    e1 = record["experiments"]["e1_persistent_revocation"]
    assert [item["projected_key_state"] for item in e1["checkpoints"]] == [
        "active",
        "retired",
        "revoked",
        "revoked",
    ]
    serialized = json.dumps(record)
    for forbidden in (
        "public_key_pem",
        "trust_store",
        "signals",
        "not allowed into the public artifact",
        "not exported",
    ):
        assert forbidden not in serialized


def test_committed_public_evidence_is_semantically_exact() -> None:
    evidence = load_evidence_module()
    record = json.loads(evidence.DEFAULT_OUTPUT.read_text(encoding="utf-8"))

    evidence.validate_public_evidence(record)

    e2 = record["experiments"]["e2_rotated_key_backdating"]
    assert e2["independent_issuance_time_witness"] is False
    assert e2["checkpoints"][0]["decision_state"] == "verified_issuer"
    assert e2["checkpoints"][1]["decision_state"] == "blocked"


def test_validator_rejects_a_stronger_restart_claim_than_the_run_proves() -> None:
    evidence = load_evidence_module()
    record = json.loads(evidence.DEFAULT_OUTPUT.read_text(encoding="utf-8"))
    overclaim = deepcopy(record)
    overclaim["experiments"]["e1_persistent_revocation"]["restart_observation"][
        "machine_verifiable_restart_identity"
    ] = True

    with pytest.raises(evidence.EvidenceError, match="must not claim"):
        evidence.validate_public_evidence(overclaim)


def test_validator_rejects_a_backdating_record_that_was_signed_before_rotation() -> None:
    evidence = load_evidence_module()
    record = json.loads(evidence.DEFAULT_OUTPUT.read_text(encoding="utf-8"))
    contradicted = deepcopy(record)
    contradicted["experiments"]["e2_rotated_key_backdating"][
        "artifact_signing_recorded_at"
    ] = "2026-09-02T09:12:50.800000Z"

    with pytest.raises(evidence.EvidenceError, match="signing after rotation"):
        evidence.validate_public_evidence(contradicted)
