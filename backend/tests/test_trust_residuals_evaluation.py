from __future__ import annotations

import ast
import importlib.util
import sys
from pathlib import Path
from types import ModuleType


ROOT = Path(__file__).resolve().parents[2]
EVALUATION_SCRIPT = ROOT / "scripts" / "trust_residuals_evaluation.py"


def load_evaluation_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "trust_residuals_evaluation",
        EVALUATION_SCRIPT,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_public_corpus_is_semantically_exact() -> None:
    evaluation = load_evaluation_module()
    corpus = evaluation.load_corpus(evaluation.DEFAULT_CORPUS_PATH)
    report = evaluation.run_evaluation(
        corpus,
        generated_at="2026-05-31T00:00:00+00:00",
    )

    assert report["summary"]["total_cases"] == 37
    assert report["summary"]["semantic_correct_count"] == 37
    assert report["summary"]["semantic_mismatch_count"] == 0
    assert report["summary"]["residual_match_count"] == 37
    assert report["summary"]["residual_mismatch_count"] == 0
    assert report["summary"]["residual_verifier_unsafe_positive_count"] == 0
    assert report["summary"]["residual_verifier_attention_undercut_count"] == 0


def test_weaker_baselines_have_measured_deficits() -> None:
    evaluation = load_evaluation_module()
    corpus = evaluation.load_corpus(evaluation.DEFAULT_CORPUS_PATH)
    report = evaluation.run_evaluation(
        corpus,
        generated_at="2026-05-31T00:00:00+00:00",
    )

    for baseline in ("decode-only", "https-only", "signature-only", "reputation-only"):
        summary = report["baseline_summary"][baseline]
        assert summary["attention_cases"] == 35
        assert summary["attention_undercut_count"] > 0

    # decode-only never claims positive trust by construction; its deficit is
    # entirely attention undercuts, which the split metric must keep separate.
    assert report["baseline_summary"]["decode-only"]["unsafe_positive_count"] == 0

    assert "C4" in report["baseline_summary"]["https-only"]["unsafe_positive_cases"]
    assert "C9" in report["baseline_summary"]["signature-only"]["unsafe_positive_cases"]
    assert "C18" in report["baseline_summary"]["reputation-only"]["unsafe_positive_cases"]


def test_no_baseline_asserts_a_state_for_an_undecodable_artifact() -> None:
    # Decodability is a precondition of every scanner, not a signal one
    # baseline may skip: reputation-only must not report `verified-issuer`
    # (a manufactured unsafe positive) on the unreadable capture case.
    evaluation = load_evaluation_module()
    corpus = evaluation.load_corpus(evaluation.DEFAULT_CORPUS_PATH)
    report = evaluation.run_evaluation(
        corpus,
        generated_at="2026-05-31T00:00:00+00:00",
    )

    c0 = next(case for case in report["cases"] if case["case_id"] == "C0")
    assert c0["expected"]["primary_state"] == "unreadable"
    for baseline, baseline_report in c0["baselines"].items():
        assert baseline_report["primary_state"] == "unreadable", baseline
        assert not baseline_report["unsafe_positive"], baseline
        assert not baseline_report["attention_undercut"], baseline


def test_residual_ablation_changes_outputs_for_each_family() -> None:
    evaluation = load_evaluation_module()
    corpus = evaluation.load_corpus(evaluation.DEFAULT_CORPUS_PATH)
    report = evaluation.run_evaluation(
        corpus,
        generated_at="2026-05-31T00:00:00+00:00",
    )

    for family in evaluation.RESIDUAL_FAMILIES:
        assert report["ablation_summary"][family]["changed_output_count"] > 0

    assert "C4" in report["ablation_summary"]["destination_policy"]["reduced_attention_cases"]
    assert "C12" in report["ablation_summary"]["redirect_flow"]["reduced_attention_cases"]
    assert "C13a" in report["ablation_summary"]["artifact_integrity"]["reduced_attention_cases"]


def test_artifact_fixtures_feed_evaluation_evidence() -> None:
    evaluation = load_evaluation_module()
    corpus = evaluation.load_corpus(evaluation.DEFAULT_CORPUS_PATH)
    report = evaluation.run_evaluation(
        corpus,
        generated_at="2026-05-31T00:00:00+00:00",
    )
    cases = {case["case_id"]: case for case in report["cases"]}

    assert cases["C1"]["artifact_analysis"]["analyzer"] == "qrsafe-image"
    assert cases["C1"]["artifact_analysis"]["artifact_integrity"] == "pass"
    assert cases["C13a"]["artifact_analysis"]["analyzer"] == "qrsafe-pdf"
    assert cases["C13a"]["artifact_analysis"]["artifact_integrity"] == "warn"
    assert cases["C13a"]["artifact_analysis"]["extracted_artifact_count"] == 1
    assert "colored_overlay_frame" in (
        cases["C13a"]["artifact_analysis"]["tamper_indicators"]
    )
    assert cases["C14"]["artifact_analysis"]["artifact_integrity"] == "warn"
    assert "low_quiet_zone" in cases["C14"]["artifact_analysis"]["tamper_indicators"]
    assert cases["C21b"]["artifact_analysis"]["artifact_integrity"] == "warn"
    assert "multiple_qr_symbols" in cases["C21b"]["artifact_analysis"]["tamper_indicators"]
    assert cases["C22"]["artifact_analysis"]["analyzer"] == "qrsafe-email"
    assert cases["C22"]["artifact_analysis"]["artifact_integrity"] == "warn"


def test_decide_totality_default_is_never_positive(monkeypatch) -> None:
    evaluation = load_evaluation_module()

    unmodeled = {
        "issuer_chain": "pass",
        "destination_policy": "pass",
        "redirect_flow": "pass",
        "runtime_safety": "unmodeled-tier",
        "freshness": "pass",
        "artifact_integrity": "pass",
    }
    monkeypatch.setattr(
        evaluation,
        "compute_residuals",
        lambda _case: dict(unmodeled),
    )

    case = {
        "policy_bundle": {"profile": "strict-online"},
        "evidence": {"qr_decodable": True},
    }
    decision = evaluation.decide(case)

    assert decision.primary_state == "unverified"
    assert evaluation.attention_level(decision) != "positive"
    assert "incomplete-verification-warning" in decision.annotations
    assert "unmodeled-residual-combination" in decision.reason_codes


def test_decide_d14_required_runtime_verdict_is_profile_conditional(monkeypatch) -> None:
    evaluation = load_evaluation_module()

    base = {
        "issuer_chain": "pass",
        "destination_policy": "pass",
        "redirect_flow": "pass",
        "freshness": "pass",
        "artifact_integrity": "pass",
    }

    def run(profile: str, runtime_tier: str):
        monkeypatch.setattr(
            evaluation,
            "compute_residuals",
            lambda _case: {**base, "runtime_safety": runtime_tier},
        )
        case = {
            "policy_bundle": {"profile": profile},
            "evidence": {"qr_decodable": True},
        }
        return evaluation.decide(case)

    strict_unavailable = run("strict-online", "unavailable")
    assert strict_unavailable.primary_state == "blocked"
    assert "runtime-safety-unavailable" in strict_unavailable.reason_codes

    strict_unchecked = run("strict-online", "not-checked")
    assert strict_unchecked.primary_state == "blocked"
    assert "runtime-safety-not-checked" in strict_unchecked.reason_codes

    bounded_unavailable = run("bounded-offline", "unavailable")
    assert bounded_unavailable.primary_state == "verified-issuer"
    assert "limited-runtime-safety-visibility" in bounded_unavailable.annotations
    assert evaluation.attention_level(bounded_unavailable) == "warning"


def test_decide_d13_cross_root_contradiction_is_profile_conditional(monkeypatch) -> None:
    evaluation = load_evaluation_module()

    contradiction = {
        "issuer_chain": "cross-root-contradiction",
        "destination_policy": "pass",
        "redirect_flow": "pass",
        "runtime_safety": "pass",
        "freshness": "pass",
        "artifact_integrity": "pass",
    }
    monkeypatch.setattr(
        evaluation,
        "compute_residuals",
        lambda _case: dict(contradiction),
    )

    def run(profile: str):
        case = {
            "policy_bundle": {"profile": profile},
            "evidence": {"qr_decodable": True},
        }
        return evaluation.decide(case)

    strict = run("strict-online")
    assert strict.primary_state == "blocked"
    assert "cross-root-contradiction" in strict.reason_codes

    bounded = run("bounded-offline")
    assert bounded.primary_state == "unverified"
    assert "incomplete-verification-warning" in bounded.annotations
    assert "cross-root-contradiction" in bounded.reason_codes
    assert evaluation.attention_level(bounded) == "warning"


def test_decide_d11_artifact_fail_is_policy_gated() -> None:
    evaluation = load_evaluation_module()

    def build_case(policy_bundle: dict) -> dict:
        return {
            "case_id": "unit-d11-artifact-fail",
            "policy_bundle": policy_bundle,
            "evidence": {
                "qr_decodable": True,
                "managed_trust_claim": "valid",
                "signature": "valid",
                "issuer": "accepted",
                "destination_policy": "bound",
                "redirect_flow": "pass",
                "runtime_safety": "clear",
                "freshness": "fresh",
                "artifact_integrity": "fail",
            },
        }

    optional = build_case({"profile": "strict-online"})
    assert evaluation.compute_residuals(optional)["artifact_integrity"] == "fail"

    optional_decision = evaluation.decide(optional)
    assert optional_decision.primary_state == "unverified"
    assert "artifact-warning" in optional_decision.annotations
    assert "artifact-integrity-failed" in optional_decision.reason_codes
    assert evaluation.attention_level(optional_decision) == "warning"

    mandatory = build_case(
        {
            "profile": "strict-online",
            "mandatory_residuals": ["artifact_integrity"],
        }
    )
    mandatory_decision = evaluation.decide(mandatory)
    assert mandatory_decision.primary_state == "blocked"
    assert "artifact-integrity-failed" in mandatory_decision.reason_codes
    assert evaluation.attention_level(mandatory_decision) == "block"


def test_formal_table_encoding_imports_nothing_from_the_implementation() -> None:
    # The conformance claim rests on the formal-table module being a second,
    # independently authored encoding of the paper's table. An import from the
    # decision core (or from the evaluator, which imports it) would collapse
    # the two encodings into one and silently restore the corpus-label
    # circularity the module exists to remove.
    source = (ROOT / "scripts" / "trust_residuals_formal_table.py").read_text(
        encoding="utf-8"
    )
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            modules = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            modules = [node.module or ""]
        else:
            continue
        for module in modules:
            assert not module.startswith("backend"), module
            assert not module.startswith("scripts"), module
            assert "trust_residuals_decision" not in module, module


def test_formal_table_conformance_is_exhaustive_and_exact() -> None:
    evaluation = load_evaluation_module()
    corpus = evaluation.load_corpus(evaluation.DEFAULT_CORPUS_PATH)
    report = evaluation.run_evaluation(
        corpus,
        generated_at="2026-05-31T00:00:00+00:00",
    )

    conformance = report["summary"]["formal_table_conformance"]
    assert conformance["corpus_case_count"] == 37
    assert conformance["corpus_match_count"] == 37
    assert conformance["corpus_mismatch_count"] == 0
    # 6 x 3 x 4 x 6 x 4 x 4 modeled tiers across the six residual families.
    assert conformance["sweep_vector_count"] == 6912
    assert conformance["sweep_profile_count"] == 5
    # The full powerset of the six residual families.
    assert conformance["sweep_mandatory_configuration_count"] == 64
    # Every decodable combination, plus one undecodable vector per profile
    # and mandatory configuration for the D0 capture rule.
    assert conformance["sweep_comparison_count"] == 6912 * 5 * 64 + 5 * 64
    assert conformance["sweep_mismatch_count"] == 0
    assert conformance["sweep_mismatches"] == []

    for case in report["cases"]:
        formal = case["formal_table"]
        assert formal["match"], case["case_id"]
        assert formal["primary_state"] == case["residual_verifier"]["primary_state"]
        assert sorted(formal["annotations"]) == sorted(
            case["residual_verifier"]["annotations"]
        )
        assert formal["rule"].startswith("D"), case["case_id"]
