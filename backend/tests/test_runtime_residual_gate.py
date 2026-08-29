"""
Runtime adoption of the shared trust-residuals decision core (Δ).

The scanner pipeline maps its live evidence into the paper's residual
vocabulary and consults Δ on every decision. These tests pin the evidence
mapping (including the D14 rule that an expired runtime verdict is stale
runtime-safety evidence) and the D15 gate: the runtime's positive terminal
requires Δ agreement and fails closed to a caution, never implicit trust.
"""

from __future__ import annotations

from backend.app.api.endpoints import verifier as verifier_endpoint
from backend.app.schemas.poc import NarrowedVerifierResponse
from backend.app.services.runtime_safety_poc import evaluate_runtime_safety
from backend.app.services.trust_residuals_decision import attention_rank, decide


def make_result(
    *,
    allowed: bool = True,
    stage: str = "accepted",
    reason: str = "test",
    cause: str | None = None,
) -> NarrowedVerifierResponse:
    return NarrowedVerifierResponse(
        allowed=allowed,
        stage=stage,
        reason=reason,
        canonical_claims_sha256=None,
        matched_rule=None,
        cause=cause,
    )


def vector_for(
    result: NarrowedVerifierResponse,
    *,
    runtime_verdict=None,
    redirect_verdict=None,
    artifact_analysis=None,
) -> dict[str, dict[str, str | None]]:
    return verifier_endpoint._residual_vector_for_result(
        result,
        redirect_verdict=redirect_verdict,
        runtime_verdict=runtime_verdict,
        artifact_analysis=artifact_analysis,
    )


def tiers_of(vector: dict[str, dict[str, str | None]]) -> dict[str, str]:
    """The tier-only view Delta consumes; the vector also carries the cause."""
    return {family: str(entry["tier"]) for family, entry in vector.items()}


def test_clean_scan_vector_is_positive_eligible_and_gate_is_a_no_op() -> None:
    verdict = evaluate_runtime_safety("https://acme.example/pay")
    vector = vector_for(make_result(), runtime_verdict=verdict)

    assert vector == {
        "issuer_chain": {"tier": "pass", "cause": None},
        "destination_policy": {"tier": "pass", "cause": None},
        "redirect_flow": {"tier": "not-applicable", "cause": None},
        "runtime_safety": {"tier": "pass", "cause": None},
        "freshness": {"tier": "pass", "cause": None},
        "artifact_integrity": {"tier": "pass", "cause": None},
    }

    state, model = verifier_endpoint._apply_trust_residual_gate("verified_issuer", vector)
    assert state == "verified_issuer"
    assert model.primary_state == "verified-issuer"


def test_runtime_verdict_states_map_to_owned_residual_tiers() -> None:
    expected_tiers = {
        "clean": "pass",
        "risky": "warn",
        "blocked": "block",
        # D14 / author decision: verdict expiry is stale R_S evidence.
        "expired": "stale",
        "stale": "stale",
        "unavailable": "unavailable",
    }
    for marker, tier in expected_tiers.items():
        verdict = evaluate_runtime_safety(f"https://acme.example/pay?runtime={marker}")
        vector = vector_for(make_result(), runtime_verdict=verdict)
        assert vector["runtime_safety"] == {
            "tier": tier,
            # A clean verdict is evidence of safety, not a cause to display.
            "cause": None if tier == "pass" else f"runtime-{verdict.state}",
        }, marker


def test_missing_runtime_verdict_maps_to_not_checked() -> None:
    vector = vector_for(make_result(allowed=False, stage="payload_revalidation"))
    assert vector["runtime_safety"] == {"tier": "not-checked", "cause": None}


def test_failed_verifier_stages_map_to_owning_families_and_delta_blocks() -> None:
    expected = {
        "signed_schema": ("issuer_chain", "invalid-managed-claim", "signature-invalid"),
        "issuer_status": ("issuer_chain", "revoked-issuer", "issuer-revoked"),
        "key_status": ("issuer_chain", "revoked-issuer", "key-revoked"),
        "payload_revalidation": ("destination_policy", "fail", "destination-mismatch"),
        "time_window": ("freshness", "block", "object-expired"),
    }
    for stage, (family, tier, cause) in expected.items():
        # signed_schema and payload_revalidation still derive their cause; the trust
        # and freshness stages carry one from the rule function, so feed it in.
        derived = stage in {"signed_schema", "payload_revalidation"}
        vector = vector_for(
            make_result(allowed=False, stage=stage, cause=None if derived else cause)
        )
        assert vector[family] == {"tier": tier, "cause": cause}, stage

        model = decide(
            tiers_of(vector),
            profile=verifier_endpoint._RUNTIME_DECISION_PROFILE,
            qr_decodable=True,
        )
        assert model.primary_state == "blocked", stage


def test_unmodeled_runtime_state_fails_closed_at_the_positive_terminal() -> None:
    vector = vector_for(make_result())
    # Simulate a future provider verdict state that the mapping passes through
    # unmodeled: D15 must refuse the positive terminal rather than trust it.
    vector["runtime_safety"] = {"tier": "quarantined", "cause": None}

    state, model = verifier_endpoint._apply_trust_residual_gate("verified_issuer", vector)
    assert state == "unverified"
    assert model.primary_state != "verified-issuer"
    assert "unmodeled-residual-combination" in model.reason_codes


def test_gate_never_upgrades_a_withheld_state() -> None:
    verdict = evaluate_runtime_safety("https://acme.example/pay")
    vector = vector_for(make_result(), runtime_verdict=verdict)

    state, model = verifier_endpoint._apply_trust_residual_gate("blocked", vector)
    assert state == "blocked"
    assert model.primary_state == "verified-issuer"


def test_runtime_pipeline_never_undercuts_the_bounded_reference() -> None:
    # Attention of each wire decision_state the runtime emits for a verdict,
    # per the differential suite's runtime_attention mapping.
    wire_attention_rank = {
        "verified_issuer": 0,
        "unverified": 1,
        "verified_issuer_destination_risky": 2,
        "blocked": 3,
    }
    for marker in ("clean", "risky", "blocked", "expired", "stale", "unavailable"):
        verdict = evaluate_runtime_safety(f"https://acme.example/pay?runtime={marker}")
        vector = vector_for(make_result(), runtime_verdict=verdict)
        model = decide(
            tiers_of(vector),
            profile=verifier_endpoint._RUNTIME_DECISION_PROFILE,
            qr_decodable=True,
        )
        runtime_rank = wire_attention_rank[verdict.decision_state]
        assert runtime_rank >= attention_rank(model), marker
