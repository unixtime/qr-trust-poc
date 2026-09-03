#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import platform
import statistics
import sys
import time
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DEFAULT_CORPUS_PATH = ROOT / "docs/public/evaluation/trust_residuals_corpus.v1.json"
DEFAULT_JSON_OUTPUT_PATH = ROOT / "docs/public/evaluation/trust_residuals_results.v1.json"
DEFAULT_MARKDOWN_OUTPUT_PATH = ROOT / "docs/public/evaluation/trust_residuals_results.v1.md"

try:
    from backend.app.services.qr_artifact_poc import (  # noqa: E402
        QRArtifactError,
        analyze_qr_artifact_container_bytes,
    )
except ModuleNotFoundError as exc:  # pragma: no cover - depends on caller venv
    QRArtifactError = ValueError  # type: ignore[assignment]
    analyze_qr_artifact_container_bytes = None  # type: ignore[assignment]
    QR_ARTIFACT_IMPORT_ERROR: ModuleNotFoundError | None = exc
else:
    QR_ARTIFACT_IMPORT_ERROR = None

from backend.app.services.trust_residuals_decision import (  # noqa: E402
    ANNOTATIONS,
    CAPTURE_OUTCOMES,
    KNOWN_PROFILES,
    PRIMARY_STATES,
    RESIDUAL_FAMILIES,
    CaptureOutcome,
    Decision,
    EvaluationOutcome,
    ResidualEvidenceError,
    attention_level,  # re-exported for the test suite's module-namespace access
    attention_rank,
    compute_residuals,
    decide as decide_residual_vector,
    evaluate_capture,
    is_attention_undercut,
    is_unsafe_positive,
)
from scripts.trust_residuals_formal_table import (  # noqa: E402
    FORMAL_CAPTURE_OUTCOMES,
    FORMAL_PROFILES,
    FORMAL_PRIMARY_STATES,
    FORMAL_TIERS,
    FormalCaptureOutcome,
    FormalOutcome,
    formal_capture_outcome,
    formal_table_decision,
)

BASELINES = (
    "decode-only",
    "https-only",
    "signature-only",
    "reputation-only",
)

# Construction rule for each baseline, exported with the results so the
# comparison matrix can be audited against the exact single-signal policy that
# produced it. Decodability is a scanner precondition rather than a signal:
# every baseline reports `unreadable` for an undecodable artifact, and the
# single signal below applies only once a decoded payload exists to judge.
BASELINE_CONSTRUCTION = {
    "decode-only": (
        "`unreadable` if the QR is undecodable, else `unverified`; "
        "never claims positive trust."
    ),
    "https-only": (
        "`verified-issuer` iff the decoded URL scheme is `https`, "
        "else `unverified`."
    ),
    "signature-only": (
        "`verified-issuer` for any valid signature; `blocked` for an invalid "
        "managed trust claim; else `unverified`."
    ),
    "reputation-only": (
        "mirrors the runtime-safety verdict alone: `blocked` on a blocking "
        "verdict, `verified-issuer-destination-risky` on a risky verdict, "
        "`unverified` when the provider is unavailable, and `verified-issuer` "
        "otherwise — including when no runtime check ran, which is why it can "
        "claim positive trust on cases the other baselines cannot."
    ),
}

class CorpusError(ResidualEvidenceError):
    pass


def load_corpus(path: Path = DEFAULT_CORPUS_PATH) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        corpus = json.load(handle)
    validate_corpus(corpus)
    return corpus


def validate_corpus(corpus: dict[str, Any]) -> None:
    cases = corpus.get("cases")
    if not isinstance(cases, list) or not cases:
        raise CorpusError("Corpus must contain a non-empty cases array.")

    seen: set[str] = set()
    for index, case in enumerate(cases, start=1):
        case_id = require_string(case, "case_id", f"case[{index}]")
        if case_id in seen:
            raise CorpusError(f"Duplicate case_id: {case_id}")
        seen.add(case_id)

        require_string(case, "decoded_payload", case_id)
        qr_artifact = require_dict(case, "qr_artifact", case_id)
        fixture_path = qr_artifact.get("fixture_path")
        if fixture_path is not None:
            if not isinstance(fixture_path, str) or not fixture_path.strip():
                raise CorpusError(f"{case_id}.qr_artifact.fixture_path must be a string.")
            if Path(fixture_path).is_absolute() or ".." in Path(fixture_path).parts:
                raise CorpusError(
                    f"{case_id}.qr_artifact.fixture_path must stay under evaluation/"
                )
        expected_indicators = qr_artifact.get("expected_analyzer_indicators", [])
        if not isinstance(expected_indicators, list):
            raise CorpusError(
                f"{case_id}.qr_artifact.expected_analyzer_indicators must be a list."
            )
        policy_bundle = require_dict(case, "policy_bundle", case_id)
        require_string(policy_bundle, "profile", f"{case_id}.policy_bundle")
        mandatory = policy_bundle.get("mandatory_residuals", [])
        if not isinstance(mandatory, list):
            raise CorpusError(
                f"{case_id}.policy_bundle.mandatory_residuals must be a list."
            )
        unknown_mandatory = sorted(set(mandatory) - set(RESIDUAL_FAMILIES))
        if unknown_mandatory:
            raise CorpusError(
                f"{case_id}.policy_bundle.mandatory_residuals unknown: "
                f"{', '.join(unknown_mandatory)}"
            )
        evidence = require_dict(case, "evidence", case_id)
        expected = require_dict(case, "expected", case_id)
        has_primary_state = "primary_state" in expected
        has_capture_outcome = "capture_outcome" in expected
        if has_primary_state == has_capture_outcome:
            raise CorpusError(
                f"{case_id}.expected must carry exactly one of primary_state "
                "or capture_outcome"
            )
        if evidence.get("qr_decodable") is False:
            if not has_capture_outcome:
                raise CorpusError(
                    f"{case_id} undecodable capture must use expected.capture_outcome"
                )
            capture_outcome = require_string(
                expected, "capture_outcome", f"{case_id}.expected"
            )
            if capture_outcome not in CAPTURE_OUTCOMES:
                raise CorpusError(
                    f"{case_id} expected unknown capture_outcome: {capture_outcome}"
                )
            if "annotations" in expected:
                raise CorpusError(
                    f"{case_id} capture outcome must not carry model annotations"
                )
        else:
            if not has_primary_state:
                raise CorpusError(
                    f"{case_id} decoded artifact must use expected.primary_state"
                )
            primary_state = require_string(
                expected, "primary_state", f"{case_id}.expected"
            )
            if primary_state not in PRIMARY_STATES:
                raise CorpusError(
                    f"{case_id} expected unknown primary_state: {primary_state}"
                )

            annotations = expected.get("annotations", [])
            if not isinstance(annotations, list):
                raise CorpusError(f"{case_id} expected.annotations must be a list.")
            unknown_annotations = sorted(set(annotations) - ANNOTATIONS)
            if unknown_annotations:
                raise CorpusError(
                    f"{case_id} expected unknown annotations: "
                    f"{', '.join(unknown_annotations)}"
                )

        expected_residuals = require_dict(expected, "residuals", f"{case_id}.expected")
        missing_residuals = sorted(set(RESIDUAL_FAMILIES) - set(expected_residuals))
        if missing_residuals:
            raise CorpusError(
                f"{case_id} expected.residuals missing: {', '.join(missing_residuals)}"
            )
        unknown_residuals = sorted(set(expected_residuals) - set(RESIDUAL_FAMILIES))
        if unknown_residuals:
            raise CorpusError(
                f"{case_id} expected unknown residuals: {', '.join(unknown_residuals)}"
            )

        for key in (
            "qr_decodable",
            "managed_trust_claim",
            "signature",
            "issuer",
            "destination_policy",
            "redirect_flow",
            "runtime_safety",
            "freshness",
            "artifact_integrity",
        ):
            if key not in evidence:
                raise CorpusError(f"{case_id}.evidence missing {key}.")


def require_dict(parent: dict[str, Any], key: str, context: str) -> dict[str, Any]:
    value = parent.get(key)
    if not isinstance(value, dict):
        raise CorpusError(f"{context}.{key} must be an object.")
    return value


def require_string(parent: dict[str, Any], key: str, context: str) -> str:
    value = parent.get(key)
    if not isinstance(value, str) or not value:
        raise CorpusError(f"{context}.{key} must be a non-empty string.")
    return value


def decide(case: dict[str, Any]) -> EvaluationOutcome:
    # Capture failure terminates before the trust-decision core. Keeping that
    # result in a separate type prevents `unreadable` from entering the closed
    # model_decision.primary_state vocabulary.
    capture = evaluate_capture(qr_decodable=case["evidence"]["qr_decodable"])
    if capture is not None:
        return capture

    # Corpus-shaped adapter over the shared decision core Δ = decide(R⃗, P).
    # compute_residuals must resolve through this module's globals so tests can
    # substitute the evidence→tier mapping without touching the shared core.
    return decide_residual_vector(
        compute_residuals(case),
        profile=case["policy_bundle"]["profile"],
        mandatory_residuals=case["policy_bundle"].get("mandatory_residuals", ()),
    )


def baseline_decision(case: dict[str, Any], baseline: str) -> EvaluationOutcome:
    evidence = case["evidence"]
    capture = evaluate_capture(qr_decodable=evidence["qr_decodable"])
    if capture is not None:
        # Decoding is a precondition of every scanner, not a trust signal;
        # no baseline may assert a state about a payload it cannot read.
        return capture

    parsed = urlparse(case["decoded_payload"])

    if baseline == "decode-only":
        return Decision("unverified", reason_codes=("payload-decoded",))

    if baseline == "https-only":
        if parsed.scheme == "https":
            return Decision("verified-issuer", reason_codes=("https-url-present",))
        return Decision("unverified", reason_codes=("non-https-url",))

    if baseline == "signature-only":
        if evidence["signature"] == "valid":
            return Decision("verified-issuer", reason_codes=("signature-valid",))
        if evidence["managed_trust_claim"] == "invalid":
            return Decision("blocked", reason_codes=("signature-invalid",))
        return Decision("unverified", reason_codes=("signature-absent",))

    if baseline == "reputation-only":
        runtime = compute_residuals(case)["runtime_safety"]
        if runtime == "block":
            return Decision("blocked", reason_codes=("runtime-safety-block",))
        if runtime == "warn":
            return Decision(
                "verified-issuer-destination-risky",
                reason_codes=("runtime-safety-warning",),
            )
        if runtime == "unavailable":
            return Decision("unverified", reason_codes=("reputation-unavailable",))
        return Decision("verified-issuer", reason_codes=("reputation-clear",))

    raise CorpusError(f"Unknown baseline: {baseline}")


def outcome_from_mapping(value: dict[str, Any]) -> EvaluationOutcome:
    """Decode one report/corpus outcome without conflating its two namespaces."""
    if "capture_outcome" in value:
        return CaptureOutcome(
            value["capture_outcome"],
            tuple(value.get("reason_codes", ())),
        )
    return Decision(
        value["primary_state"],
        tuple(value.get("annotations", ())),
        tuple(value.get("reason_codes", ())),
    )


def expected_outcome(case: dict[str, Any]) -> EvaluationOutcome:
    return outcome_from_mapping(case["expected"])


def outcome_identity(outcome: EvaluationOutcome) -> tuple[str, str]:
    if isinstance(outcome, CaptureOutcome):
        return ("capture_outcome", outcome.capture_outcome)
    return ("primary_state", outcome.primary_state)


def outcome_annotations(outcome: EvaluationOutcome) -> tuple[str, ...]:
    return outcome.annotations if isinstance(outcome, Decision) else ()


def outcomes_match(expected: EvaluationOutcome, actual: EvaluationOutcome) -> bool:
    return (
        outcome_identity(expected) == outcome_identity(actual)
        and sorted(outcome_annotations(expected))
        == sorted(outcome_annotations(actual))
    )


def outcome_attention_rank(outcome: EvaluationOutcome) -> int:
    # Re-capture is a non-positive, user-visible intervention. Rank it at the
    # neutral level for cross-baseline statistics without putting it in the
    # trust decision's attention-level type.
    return 1 if isinstance(outcome, CaptureOutcome) else attention_rank(outcome)


def outcome_is_unsafe_positive(
    expected: EvaluationOutcome,
    actual: EvaluationOutcome,
) -> bool:
    if not isinstance(actual, Decision):
        return False
    if isinstance(expected, CaptureOutcome):
        return attention_level(actual) == "positive"
    return is_unsafe_positive(expected, actual)


def outcome_is_attention_undercut(
    expected: EvaluationOutcome,
    actual: EvaluationOutcome,
) -> bool:
    if isinstance(expected, Decision) and isinstance(actual, Decision):
        return is_attention_undercut(expected, actual)
    return outcome_attention_rank(actual) < outcome_attention_rank(expected)


def ablated_case(case: dict[str, Any], residual_family: str) -> dict[str, Any]:
    clone = deepcopy(case)
    evidence = clone["evidence"]

    if residual_family == "issuer_chain":
        evidence["managed_trust_claim"] = "valid"
        evidence["signature"] = "valid"
        evidence["issuer"] = "accepted"
        if evidence["destination_policy"] == "not_applicable":
            evidence["destination_policy"] = "bound"
        if evidence["redirect_flow"] == "not_applicable":
            evidence["redirect_flow"] = "pass"
        if evidence["freshness"] == "not_applicable":
            evidence["freshness"] = "fresh"
        if evidence["runtime_safety"] == "not_checked":
            evidence["runtime_safety"] = "clear"
    elif residual_family == "destination_policy":
        evidence["destination_policy"] = "bound"
    elif residual_family == "redirect_flow":
        evidence["redirect_flow"] = "pass"
    elif residual_family == "runtime_safety":
        evidence["runtime_safety"] = "clear"
    elif residual_family == "freshness":
        evidence["freshness"] = "fresh"
    elif residual_family == "artifact_integrity":
        evidence["artifact_integrity"] = "pass"
    else:
        raise CorpusError(f"Unknown residual family: {residual_family}")

    return clone


def payload_sha256(payload: str) -> str:
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def artifact_fixture_path(case: dict[str, Any]) -> Path | None:
    fixture_path = case["qr_artifact"].get("fixture_path")
    if not fixture_path:
        return None
    path = (DEFAULT_CORPUS_PATH.parent / fixture_path).resolve()
    fixture_root = (DEFAULT_CORPUS_PATH.parent / "fixtures").resolve()
    if not path.is_relative_to(fixture_root):
        raise CorpusError(f"{case['case_id']} fixture path escapes fixtures directory.")
    if not path.exists():
        raise CorpusError(f"{case['case_id']} fixture not found: {path}")
    return path


def artifact_fixture_content_type(path: Path) -> str:
    match path.suffix.lower():
        case ".pdf":
            return "application/pdf"
        case ".eml":
            return "message/rfc822"
        case ".png":
            return "image/png"
        case ".jpg" | ".jpeg":
            return "image/jpeg"
        case _:
            return "application/octet-stream"


def artifact_analysis_report(case: dict[str, Any]) -> dict[str, Any] | None:
    path = artifact_fixture_path(case)
    if path is None:
        return None

    if analyze_qr_artifact_container_bytes is None:
        raise CorpusError(
            "Artifact fixture analysis requires backend image dependencies. "
            "Run with backend/.venv/bin/python or install the backend dependencies."
        ) from QR_ARTIFACT_IMPORT_ERROR

    try:
        analysis = analyze_qr_artifact_container_bytes(
            path.read_bytes(),
            content_type=artifact_fixture_content_type(path),
            filename=path.name,
        )
    except QRArtifactError as exc:
        raise CorpusError(f"{case['case_id']} fixture analysis failed: {exc}") from exc

    if case["decoded_payload"] not in analysis.decoded_payloads:
        raise CorpusError(
            f"{case['case_id']} fixture payloads do not include decoded_payload."
        )

    expected_integrity = case["qr_artifact"].get("expected_analyzer_integrity")
    if expected_integrity and expected_integrity != analysis.artifact_integrity:
        raise CorpusError(
            f"{case['case_id']} expected analyzer integrity {expected_integrity}, "
            f"got {analysis.artifact_integrity}."
        )

    expected_indicators = set(case["qr_artifact"].get("expected_analyzer_indicators", []))
    missing_indicators = sorted(expected_indicators - set(analysis.tamper_indicators))
    if missing_indicators:
        raise CorpusError(
            f"{case['case_id']} fixture analysis missing indicators: "
            f"{', '.join(missing_indicators)}"
        )

    return {
        "fixture_path": str(path.relative_to(DEFAULT_CORPUS_PATH.parent)),
        "analyzer": f"qrsafe-{analysis.container_type}",
        "container_type": analysis.container_type,
        "extracted_artifact_count": analysis.extracted_artifact_count,
        "rejected_part_count": analysis.rejected_part_count,
        "payload_sha256": [
            payload_sha256(payload) for payload in analysis.decoded_payloads
        ],
        "artifact_integrity": analysis.artifact_integrity,
        "risk_score": analysis.risk_score,
        "tamper_indicators": list(analysis.tamper_indicators),
    }


def materialize_case_evidence(
    case: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    artifact_report = artifact_analysis_report(case)
    materialized = deepcopy(case)
    if artifact_report and case["qr_artifact"].get("use_analyzer_for_evidence"):
        materialized["evidence"]["artifact_integrity"] = artifact_report[
            "artifact_integrity"
        ]
    return materialized, artifact_report


def ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0


def formal_agreement(
    actual: EvaluationOutcome,
    formal: FormalOutcome | FormalCaptureOutcome,
) -> bool:
    """Agreement on the disjoint capture-outcome or trust-decision result.

    The formal outcome carries annotations as a set; the length check keeps
    set-equality from masking a duplicated annotation in the implementation's
    tuple.
    """
    if isinstance(actual, CaptureOutcome) or isinstance(formal, FormalCaptureOutcome):
        return (
            isinstance(actual, CaptureOutcome)
            and isinstance(formal, FormalCaptureOutcome)
            and actual.capture_outcome == formal.capture_outcome
        )
    return (
        actual.primary_state == formal.primary_state
        and len(actual.annotations) == len(set(actual.annotations))
        and set(actual.annotations) == formal.annotations
    )


def formal_table_case_report(
    decision: EvaluationOutcome,
    residuals: dict[str, str],
    profile: str,
    mandatory_residuals: tuple[str, ...],
    qr_decodable: bool,
) -> dict[str, Any]:
    capture = formal_capture_outcome(qr_decodable=qr_decodable)
    if capture is not None:
        return {
            "rule": capture.rule,
            "capture_outcome": capture.capture_outcome,
            "match": formal_agreement(decision, capture),
        }
    formal = formal_table_decision(
        residuals,
        profile=profile,
        mandatory_residuals=mandatory_residuals,
    )
    return {
        "rule": formal.rule,
        "primary_state": formal.primary_state,
        "annotations": sorted(formal.annotations),
        "match": formal_agreement(decision, formal),
    }


def formal_sweep_conformance() -> dict[str, Any]:
    """Exhaustively compare decide() with the independent formal-table encoding.

    Coverage is every modeled residual vector, under every policy profile and
    every subset of mandatory families — the full powerset of the six
    residual families, 64 configurations — plus the undecodable capture rule
    under every profile and configuration. Nothing about the mandatory
    dimension is sampled or argued away; the sweep witnesses every
    configuration directly.
    """
    if tuple(FORMAL_TIERS) != RESIDUAL_FAMILIES:
        raise ValueError(
            "formal-table family vocabulary diverged from the decision core"
        )
    if set(FORMAL_PROFILES) != KNOWN_PROFILES:
        raise ValueError(
            "formal-table profile vocabulary diverged from the decision core"
        )
    if FORMAL_PRIMARY_STATES != PRIMARY_STATES:
        raise ValueError(
            "formal-table primary-state vocabulary diverged from the decision core"
        )
    if FORMAL_CAPTURE_OUTCOMES != CAPTURE_OUTCOMES:
        raise ValueError(
            "formal-table capture-outcome vocabulary diverged from the decision core"
        )

    mandatory_schedule: tuple[tuple[str, ...], ...] = tuple(
        subset
        for size in range(len(RESIDUAL_FAMILIES) + 1)
        for subset in itertools.combinations(RESIDUAL_FAMILIES, size)
    )
    comparison_count = 0
    mismatches: list[dict[str, Any]] = []

    def compare(
        residuals: dict[str, str],
        profile: str,
        mandatory: tuple[str, ...],
    ) -> None:
        nonlocal comparison_count
        comparison_count += 1
        formal = formal_table_decision(
            residuals,
            profile=profile,
            mandatory_residuals=mandatory,
        )
        actual = decide_residual_vector(
            residuals,
            profile=profile,
            mandatory_residuals=mandatory,
        )
        if not formal_agreement(actual, formal):
            mismatches.append(
                {
                    "residuals": residuals,
                    "profile": profile,
                    "mandatory_residuals": list(mandatory),
                    "result_kind": "primary_state",
                    "implementation": actual.as_dict(),
                    "formal_table": {
                        "rule": formal.rule,
                        "primary_state": formal.primary_state,
                        "annotations": sorted(formal.annotations),
                    },
                }
            )

    def compare_capture(profile: str, mandatory: tuple[str, ...]) -> None:
        nonlocal comparison_count
        comparison_count += 1
        formal = formal_capture_outcome(qr_decodable=False)
        if formal is None:
            raise AssertionError("formal D0 oracle did not emit a capture outcome")
        actual = evaluate_capture(qr_decodable=False)
        if actual is None:
            raise AssertionError("implementation D0 did not emit a capture outcome")
        if not formal_agreement(actual, formal):
            mismatches.append(
                {
                    "profile": profile,
                    "mandatory_residuals": list(mandatory),
                    "result_kind": "capture_outcome",
                    "implementation": actual.as_dict(),
                    "formal_table": {
                        "rule": formal.rule,
                        "capture_outcome": formal.capture_outcome,
                    },
                }
            )

    vector_count = 0
    for combination in itertools.product(
        *(FORMAL_TIERS[family] for family in RESIDUAL_FAMILIES)
    ):
        vector_count += 1
        residuals = dict(zip(RESIDUAL_FAMILIES, combination))
        for profile in FORMAL_PROFILES:
            for mandatory in mandatory_schedule:
                compare(residuals, profile, mandatory)

    # D0 is independent of R and P. Repeat the disjoint capture-outcome check
    # per profile and mandatory schedule so the published comparison count and
    # coverage claim still witness the full configuration space.
    for profile in FORMAL_PROFILES:
        for mandatory in mandatory_schedule:
            compare_capture(profile, mandatory)

    return {
        "encoding_module": "scripts/trust_residuals_formal_table.py",
        "sweep_vector_count": vector_count,
        "sweep_profile_count": len(FORMAL_PROFILES),
        "sweep_mandatory_configuration_count": len(mandatory_schedule),
        "sweep_comparison_count": comparison_count,
        "sweep_mismatch_count": len(mismatches),
        "sweep_mismatches": mismatches[:25],
    }


def run_evaluation(
    corpus: dict[str, Any],
    *,
    generated_at: str | None = None,
) -> dict[str, Any]:
    generated_at = generated_at or datetime.now(UTC).isoformat()
    case_reports: list[dict[str, Any]] = []
    decision_inputs: list[tuple[dict[str, str], str, tuple[str, ...]]] = []

    for source_case in corpus["cases"]:
        case, artifact_report = materialize_case_evidence(source_case)
        residuals = compute_residuals(case)
        decision = decide(case)
        if case["evidence"]["qr_decodable"]:
            decision_inputs.append(
                (
                    residuals,
                    case["policy_bundle"]["profile"],
                    tuple(case["policy_bundle"].get("mandatory_residuals", ())),
                )
            )

        expected = expected_outcome(case)
        expected_residuals = case["expected"]["residuals"]
        residual_match = residuals == expected_residuals
        decision_match = outcomes_match(expected, decision)
        formal_report = formal_table_case_report(
            decision,
            residuals,
            case["policy_bundle"]["profile"],
            tuple(case["policy_bundle"].get("mandatory_residuals", ())),
            case["evidence"]["qr_decodable"],
        )

        baseline_reports = {
            baseline: baseline_decision(case, baseline).as_dict()
            for baseline in BASELINES
        }
        for baseline_report in baseline_reports.values():
            actual = outcome_from_mapping(baseline_report)
            baseline_report["unsafe_positive"] = outcome_is_unsafe_positive(
                expected, actual
            )
            baseline_report["attention_undercut"] = outcome_is_attention_undercut(
                expected, actual
            )
            baseline_report["state_mismatch"] = (
                outcome_identity(actual) != outcome_identity(expected)
            )

        ablation_reports = {}
        for family in RESIDUAL_FAMILIES:
            ablated = decide(ablated_case(case, family))
            ablation_reports[family] = {
                **ablated.as_dict(),
                "reduced_attention": outcome_attention_rank(ablated)
                < outcome_attention_rank(decision),
                "changed_output": not outcomes_match(decision, ablated),
            }

        case_reports.append(
            {
                "case_id": case["case_id"],
                "title": case["title"],
                "description": case["description"],
                "decoded_payload_sha256": payload_sha256(case["decoded_payload"]),
                "artifact_analysis": artifact_report,
                "verifier_profile": case["policy_bundle"]["profile"],
                "residuals": residuals,
                "expected": expected.as_dict(),
                "residual_verifier": decision.as_dict(),
                "semantic_match": decision_match,
                "residual_match": residual_match,
                "formal_table": formal_report,
                "baselines": baseline_reports,
                "ablations": ablation_reports,
            }
        )

    attention_cases = [
        case
        for case in case_reports
        if outcome_attention_rank(outcome_from_mapping(case["expected"])) > 0
    ]
    baseline_summary = {}
    for baseline in BASELINES:
        # Unsafe positives and attention undercuts are only possible on cases
        # whose expected outcome demands attention, so those rates use the
        # attention-case denominator; state mismatches use all cases.
        unsafe_positive_cases = [
            case["case_id"]
            for case in attention_cases
            if case["baselines"][baseline]["unsafe_positive"]
        ]
        attention_undercut_cases = [
            case["case_id"]
            for case in attention_cases
            if case["baselines"][baseline]["attention_undercut"]
        ]
        state_mismatch_cases = [
            case["case_id"]
            for case in case_reports
            if case["baselines"][baseline]["state_mismatch"]
        ]
        baseline_summary[baseline] = {
            "attention_cases": len(attention_cases),
            "unsafe_positive_count": len(unsafe_positive_cases),
            "unsafe_positive_rate": ratio(
                len(unsafe_positive_cases), len(attention_cases)
            ),
            "attention_undercut_count": len(attention_undercut_cases),
            "attention_undercut_rate": ratio(
                len(attention_undercut_cases), len(attention_cases)
            ),
            "state_mismatch_count": len(state_mismatch_cases),
            "state_mismatch_rate": ratio(
                len(state_mismatch_cases), len(case_reports)
            ),
            "unsafe_positive_cases": unsafe_positive_cases,
            "attention_undercut_cases": attention_undercut_cases,
            "state_mismatch_cases": state_mismatch_cases,
        }

    ablation_summary = {}
    for family in RESIDUAL_FAMILIES:
        changed = [
            case["case_id"]
            for case in case_reports
            if case["ablations"][family]["changed_output"]
        ]
        reduced = [
            case["case_id"]
            for case in case_reports
            if case["ablations"][family]["reduced_attention"]
        ]
        ablation_summary[family] = {
            "changed_output_count": len(changed),
            "reduced_attention_count": len(reduced),
            "changed_output_cases": changed,
            "reduced_attention_cases": reduced,
        }

    semantic_correct_count = sum(1 for case in case_reports if case["semantic_match"])
    residual_match_count = sum(1 for case in case_reports if case["residual_match"])
    residual_verifier_unsafe_positive_count = 0
    residual_verifier_attention_undercut_count = 0
    for case in case_reports:
        case_expected = outcome_from_mapping(case["expected"])
        case_actual = outcome_from_mapping(case["residual_verifier"])
        if outcome_is_unsafe_positive(case_expected, case_actual):
            residual_verifier_unsafe_positive_count += 1
        if outcome_is_attention_undercut(case_expected, case_actual):
            residual_verifier_attention_undercut_count += 1

    formal_corpus_match_count = sum(
        1 for case in case_reports if case["formal_table"]["match"]
    )
    formal_table_conformance = {
        "corpus_case_count": len(case_reports),
        "corpus_match_count": formal_corpus_match_count,
        "corpus_mismatch_count": len(case_reports) - formal_corpus_match_count,
        **formal_sweep_conformance(),
    }

    latency_report = measure_decision_latency(decision_inputs)

    return {
        "schema_version": "trust-residuals-evaluation-results.v1",
        "generated_at": generated_at,
        "corpus": {
            "schema_version": corpus["schema_version"],
            "case_count": len(corpus["cases"]),
            "source_path": str(DEFAULT_CORPUS_PATH.relative_to(ROOT)),
        },
        "summary": {
            "total_cases": len(case_reports),
            "semantic_correct_count": semantic_correct_count,
            "semantic_mismatch_count": len(case_reports) - semantic_correct_count,
            "residual_match_count": residual_match_count,
            "residual_mismatch_count": len(case_reports) - residual_match_count,
            "residual_verifier_unsafe_positive_count": (
                residual_verifier_unsafe_positive_count
            ),
            "residual_verifier_attention_undercut_count": (
                residual_verifier_attention_undercut_count
            ),
            "formal_table_conformance": formal_table_conformance,
            "offline_runner_latency_ns": latency_report["latency_ns"],
            "latency_methodology": latency_report["methodology"],
        },
        "baseline_construction": BASELINE_CONSTRUCTION,
        "baseline_summary": baseline_summary,
        "ablation_summary": ablation_summary,
        "cases": case_reports,
    }


def measure_decision_latency(
    decision_inputs: list[tuple[dict[str, str], str, tuple[str, ...]]],
    *,
    warmup_iterations: int = 20,
    timed_iterations: int = 200,
) -> dict[str, Any]:
    """Measure Δ evaluation latency in isolation.

    Residual vectors are precomputed by the caller, so the timed span covers
    only decide(R⃗, P). Each case is warmed up before sampling and summarized
    by its per-case median, which suppresses interpreter warm-up and scheduler
    noise that a single-shot measurement would fold into the numbers.
    """
    per_case_median_ns: list[int] = []
    for residuals, profile, mandatory_residuals in decision_inputs:
        for _ in range(warmup_iterations):
            decide_residual_vector(
                residuals,
                profile=profile,
                mandatory_residuals=mandatory_residuals,
            )
        samples: list[int] = []
        for _ in range(timed_iterations):
            start_ns = time.perf_counter_ns()
            decide_residual_vector(
                residuals,
                profile=profile,
                mandatory_residuals=mandatory_residuals,
            )
            samples.append(time.perf_counter_ns() - start_ns)
        per_case_median_ns.append(int(statistics.median(samples)))

    return {
        "latency_ns": latency_summary(per_case_median_ns),
        "methodology": {
            "timed_span": (
                "decoded-case decide(R, P) only; residual vectors precomputed; "
                "capture outcomes excluded"
            ),
            "warmup_iterations_per_case": warmup_iterations,
            "timed_iterations_per_case": timed_iterations,
            "per_case_statistic": "median of timed iterations",
            "summary_population": "per-case medians across all corpus cases",
            "timer": "time.perf_counter_ns around each individual call",
            "runtime": f"CPython {platform.python_version()}",
            "os": f"{platform.system()} {platform.release()}",
            "machine": platform.machine(),
        },
    }


def latency_summary(values: list[int]) -> dict[str, int]:
    if not values:
        return {"median": 0, "p95": 0, "max": 0}
    ordered = sorted(values)
    p95_index = min(len(ordered) - 1, int(round((len(ordered) - 1) * 0.95)))
    return {
        "median": int(statistics.median(ordered)),
        "p95": int(ordered[p95_index]),
        "max": max(ordered),
    }


def write_markdown(report: dict[str, Any], path: Path) -> None:
    lines = [
        "# Trust Residuals Conformance Evaluation",
        "",
        f"Generated: `{report['generated_at']}`",
        "",
        "This report is a synthetic conformance suite: every case is an",
        "author-constructed fixture with a specified expected outcome, so the",
        "match counts below measure conformance of the implementation to the",
        "paper's decision semantics — not effectiveness against field traffic.",
        "",
        "Conformance is checked against two oracles. The corpus stores expected",
        "labels per case, and `scripts/trust_residuals_formal_table.py` holds an",
        "independently authored encoding of the paper's formal decision table",
        "(D0–D15) that imports nothing from the implementation; the latter is",
        "compared with the implementation on every corpus case and on an",
        "exhaustive sweep of all modeled residual vectors, policy profiles, and",
        "mandatory-family configurations.",
        "",
        "## Summary",
        "",
        f"- Corpus cases: `{report['summary']['total_cases']}`",
        f"- Semantic matches: `{report['summary']['semantic_correct_count']}/{report['summary']['total_cases']}`",
        f"- Residual-vector matches: `{report['summary']['residual_match_count']}/{report['summary']['total_cases']}`",
        f"- Residual verifier unsafe positives: `{report['summary']['residual_verifier_unsafe_positive_count']}`",
        f"- Residual verifier attention undercuts: `{report['summary']['residual_verifier_attention_undercut_count']}`",
        (
            "- Formal-table conformance (corpus): "
            f"`{report['summary']['formal_table_conformance']['corpus_match_count']}"
            f"/{report['summary']['formal_table_conformance']['corpus_case_count']}`"
        ),
        (
            "- Formal-table conformance (exhaustive sweep): "
            "`{comparisons}` comparisons over `{vectors}` residual vectors × "
            "`{profiles}` profiles × `{configs}` mandatory-family "
            "configurations, plus the undecodable-capture rule per profile × "
            "configuration; `{mismatches}` mismatches"
        ).format(
            comparisons=report["summary"]["formal_table_conformance"][
                "sweep_comparison_count"
            ],
            vectors=report["summary"]["formal_table_conformance"][
                "sweep_vector_count"
            ],
            profiles=report["summary"]["formal_table_conformance"][
                "sweep_profile_count"
            ],
            configs=report["summary"]["formal_table_conformance"][
                "sweep_mandatory_configuration_count"
            ],
            mismatches=report["summary"]["formal_table_conformance"][
                "sweep_mismatch_count"
            ],
        ),
        f"- Δ decision latency median/p95/max ns: `{report['summary']['offline_runner_latency_ns']['median']}` / `{report['summary']['offline_runner_latency_ns']['p95']}` / `{report['summary']['offline_runner_latency_ns']['max']}`",
        (
            "- Latency methodology: timed span is {timed_span}; "
            "{warmup} warmup + {timed} timed iterations per case, each call "
            "timed individually with {timer}; summary statistics taken over "
            "per-case medians ({runtime}; {os}; {machine})."
        ).format(
            timed_span=report["summary"]["latency_methodology"]["timed_span"],
            warmup=report["summary"]["latency_methodology"][
                "warmup_iterations_per_case"
            ],
            timed=report["summary"]["latency_methodology"][
                "timed_iterations_per_case"
            ],
            timer=report["summary"]["latency_methodology"]["timer"],
            runtime=report["summary"]["latency_methodology"]["runtime"],
            os=report["summary"]["latency_methodology"]["os"],
            machine=report["summary"]["latency_methodology"]["machine"],
        ),
        "",
        "## Baseline Construction",
        "",
        "Each baseline decodes the artifact (decodability is a scanner",
        "precondition, not a signal), then consults exactly one evidence channel",
        "and is deliberately blind to every other channel, so the comparison",
        "matrix below measures what a single-signal scanner gives up rather than",
        "implementation quality:",
        "",
    ]
    for baseline in BASELINES:
        lines.append(f"- **{baseline}**: {report['baseline_construction'][baseline]}")
    lines.extend([
        "",
        "## Baseline Comparison Matrix",
        "",
        "Three metrics separate what a weaker baseline actually gets wrong. An",
        "**unsafe positive** asserts positive trust where the reference outcome",
        "does not. An **attention undercut** renders strictly less user attention",
        "than the reference outcome demands (including a neutral rendering of a",
        "case that requires a warning) without necessarily asserting anything.",
        "A **state mismatch** is any difference in primary state. Unsafe-positive",
        f"and attention-undercut rates are over the "
        f"{report['baseline_summary'][BASELINES[0]]['attention_cases']} attention "
        "cases (expected outcome anything other than an unannotated positive",
        "state); state-mismatch rates are over",
        f"all {report['summary']['total_cases']} cases.",
        "",
        "| Baseline | Unsafe positives | Attention undercuts | State mismatches |",
        "|---|---:|---:|---:|",
    ])
    for baseline, summary in report["baseline_summary"].items():
        lines.append(
            "| {baseline} | {up}/{att} ({up_rate:.2%}) | {au}/{att} ({au_rate:.2%}) | {sm}/{total} ({sm_rate:.2%}) |".format(
                baseline=baseline,
                up=summary["unsafe_positive_count"],
                au=summary["attention_undercut_count"],
                att=summary["attention_cases"],
                sm=summary["state_mismatch_count"],
                total=report["summary"]["total_cases"],
                up_rate=summary["unsafe_positive_rate"],
                au_rate=summary["attention_undercut_rate"],
                sm_rate=summary["state_mismatch_rate"],
            )
        )
    lines.extend(["", "Per-baseline case lists:", ""])
    for baseline, summary in report["baseline_summary"].items():
        lines.append(
            "- **{baseline}** — unsafe positives: {up}; attention undercuts: {au}".format(
                baseline=baseline,
                up=", ".join(summary["unsafe_positive_cases"]) or "none",
                au=", ".join(summary["attention_undercut_cases"]) or "none",
            )
        )

    lines.extend(
        [
            "",
            "## Residual Ablation Coverage",
            "",
            "| Residual family | Changed output | Reduced attention | Reduced-attention cases |",
            "|---|---:|---:|---|",
        ]
    )
    for family, summary in report["ablation_summary"].items():
        lines.append(
            "| {family} | {changed} | {reduced} | {cases} |".format(
                family=family,
                changed=summary["changed_output_count"],
                reduced=summary["reduced_attention_count"],
                cases=", ".join(summary["reduced_attention_cases"]) or "-",
            )
        )

    artifact_cases = [case for case in report["cases"] if case["artifact_analysis"]]
    lines.extend(
        [
            "",
            "## Artifact Fixture Analysis",
            "",
            "| Case | Fixture | Analyzer | Integrity | Indicators |",
            "|---|---|---|---|---|",
        ]
    )
    for case in artifact_cases:
        analysis = case["artifact_analysis"]
        indicators = ", ".join(analysis.get("tamper_indicators", [])) or "-"
        lines.append(
            "| {case_id} | `{fixture}` | `{analyzer}` | `{integrity}` | {indicators} |".format(
                case_id=case["case_id"],
                fixture=analysis["fixture_path"],
                analyzer=analysis["analyzer"],
                integrity=analysis.get("artifact_integrity", "not_applicable"),
                indicators=indicators,
            )
        )

    lines.extend(
        [
            "",
            "## Case Results",
            "",
            "| Case | Profile | Expected | Residual verifier | Semantic match |",
            "|---|---|---|---|---|",
        ]
    )
    for case in report["cases"]:
        expected = format_decision(case["expected"])
        actual = format_decision(case["residual_verifier"])
        lines.append(
            f"| {case['case_id']} | {case['verifier_profile']} | {expected} | {actual} | {case['semantic_match']} |"
        )

    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def format_decision(decision: dict[str, Any]) -> str:
    if "capture_outcome" in decision:
        return f"capture `{decision['capture_outcome']}`"
    annotations = decision.get("annotations", [])
    if annotations:
        return f"`{decision['primary_state']}` + " + ", ".join(
            f"`{annotation}`" for annotation in annotations
        )
    return f"`{decision['primary_state']}`"


def write_json(report: dict[str, Any], path: Path) -> None:
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def deterministic_view(report: dict[str, Any]) -> dict[str, Any]:
    """Strip the fields that legitimately vary between runs.

    generated_at is a timestamp, the latency figures are wall-clock
    measurements, and the methodology's runtime/os/machine fields describe
    whatever host ran the export. The rest of the methodology — timed span,
    iteration counts, statistics, timer — is deterministic benchmark
    configuration and stays in the comparison, so a method change cannot
    leave a stale export behind a passing check. Everything else in the
    report is a pure function of the corpus and the decision core, so two
    runs must agree on it exactly.
    """
    view = deepcopy(report)
    view.pop("generated_at", None)
    view["summary"].pop("offline_runner_latency_ns", None)
    methodology = view["summary"].get("latency_methodology")
    if methodology is not None:
        for host_field in ("runtime", "os", "machine"):
            methodology.pop(host_field, None)
    return view


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the deterministic trust-residuals public corpus evaluation.",
    )
    parser.add_argument(
        "--corpus",
        type=Path,
        default=DEFAULT_CORPUS_PATH,
        help="Path to the public corpus JSON manifest.",
    )
    parser.add_argument(
        "--json-output",
        type=Path,
        default=DEFAULT_JSON_OUTPUT_PATH,
        help="Path for machine-readable evaluation results.",
    )
    parser.add_argument(
        "--markdown-output",
        type=Path,
        default=DEFAULT_MARKDOWN_OUTPUT_PATH,
        help="Path for the human-readable evaluation report.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help=(
            "Read-only mode: write nothing; fail if any expected residual "
            "vector or scanner decision mismatches, if the implementation "
            "disagrees with the independent formal-table encoding on any "
            "corpus case or sweep vector, or if the committed JSON export "
            "differs from a fresh run on any deterministic field."
        ),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    corpus = load_corpus(args.corpus)
    report = run_evaluation(corpus)

    conformance = report["summary"]["formal_table_conformance"]
    mismatches = (
        report["summary"]["semantic_mismatch_count"]
        + report["summary"]["residual_mismatch_count"]
        + conformance["corpus_mismatch_count"]
        + conformance["sweep_mismatch_count"]
    )
    print(
        "trust-residuals evaluation: "
        f"{report['summary']['semantic_correct_count']}/{report['summary']['total_cases']} semantic matches; "
        f"{report['summary']['residual_match_count']}/{report['summary']['total_cases']} residual matches"
    )
    print(
        "formal-table conformance: "
        f"{conformance['corpus_match_count']}/{conformance['corpus_case_count']} corpus cases; "
        f"{conformance['sweep_comparison_count']} sweep comparisons, "
        f"{conformance['sweep_mismatch_count']} mismatches"
    )

    if args.check:
        stale = True
        if args.json_output.exists():
            committed = json.loads(args.json_output.read_text(encoding="utf-8"))
            stale = deterministic_view(committed) != deterministic_view(report)
        if stale:
            print(f"check: committed export {args.json_output} is stale or missing; rerun without --check to regenerate")
        else:
            print(f"check: committed export {args.json_output} matches; no files written")
        return 1 if mismatches or stale else 0

    write_json(report, args.json_output)
    write_markdown(report, args.markdown_output)
    print(f"json: {args.json_output}")
    print(f"markdown: {args.markdown_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
