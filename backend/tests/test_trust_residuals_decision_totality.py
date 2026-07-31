"""
Totality and profile-domain properties of the shared decision core (Δ).

These tests pin the guarantees the paper claims for D14, D15, and P:

* Substituting an unmodeled evidence tier into ANY residual family — not just
  runtime safety — must fall through to the never-positive totality default.
  This includes the D5 early return: a risky runtime verdict may only reach
  the verified-issuer-destination-risky state when every other family sits in
  a positive-eligible tier, because that state still asserts issuer
  verification.
* Requiredness under P is not limited to runtime safety. When P declares a
  family mandatory and its evidence cannot be established — a tier that is
  neither positive-eligible nor an adverse verdict, or an insufficiency tier
  even where it is positive-eligible (runtime "unavailable") — strict online
  profiles must block and every other profile must cap the outcome at an
  explicitly labeled caution — never the generic totality default, and never
  a positive state. Without the mandatory declaration the same tier keeps its
  unrequired behavior (the D15 default, or the annotated positive for runtime
  "unavailable").
* The decision context P is a closed enum. An unknown profile string must be
  rejected as a configuration error, never silently evaluated as the most
  permissive arm of each profile-conditional rule.
"""

from __future__ import annotations

import itertools

import pytest

from backend.app.services.trust_residuals_decision import (
    INSUFFICIENCY_TIERS,
    KNOWN_PROFILES,
    POSITIVE_ELIGIBLE_RESIDUALS,
    RESIDUAL_FAMILIES,
    UnknownProfileError,
    UnknownResidualFamilyError,
    attention_level,
    decide,
)

# Every tier compute_residuals() can emit, per family.
MODELED_TIERS: dict[str, tuple[str, ...]] = {
    "issuer_chain": (
        "pass",
        "invalid-managed-claim",
        "revoked-issuer",
        "unaccepted-issuer",
        "cross-root-contradiction",
        "no-issuer",
    ),
    "destination_policy": ("pass", "fail", "not-applicable"),
    "redirect_flow": ("pass", "fail", "warn", "not-applicable"),
    "runtime_safety": ("pass", "warn", "block", "stale", "unavailable", "not-checked"),
    "freshness": ("pass", "warn", "block", "not-applicable"),
    "artifact_integrity": ("pass", "warn", "fail", "block"),
}

HAPPY_VECTOR: dict[str, str] = {
    "issuer_chain": "pass",
    "destination_policy": "pass",
    "redirect_flow": "not-applicable",
    "runtime_safety": "pass",
    "freshness": "pass",
    "artifact_integrity": "pass",
}

POSITIVE_STATES = {"verified-issuer", "verified-issuer-destination-risky"}


@pytest.mark.parametrize("profile", sorted(KNOWN_PROFILES))
@pytest.mark.parametrize("family", RESIDUAL_FAMILIES)
def test_unmodeled_tier_in_any_family_hits_the_totality_default(
    profile: str, family: str
) -> None:
    vector = dict(HAPPY_VECTOR)
    vector[family] = "unmodeled-tier"

    decision = decide(vector, profile=profile, qr_decodable=True)

    assert decision.primary_state == "unverified", (profile, family)
    assert decision.annotations == ("incomplete-verification-warning",)
    assert decision.reason_codes == ("unmodeled-residual-combination",)
    assert attention_level(decision) != "positive"


@pytest.mark.parametrize("profile", sorted(KNOWN_PROFILES))
@pytest.mark.parametrize(
    "family", [f for f in RESIDUAL_FAMILIES if f != "runtime_safety"]
)
def test_runtime_warn_with_unmodeled_tier_elsewhere_is_not_risky(
    profile: str, family: str
) -> None:
    # The reviewer counterexample: D5 must not certify issuer verification
    # (the ...-destination-risky state) while another family is unmodeled.
    vector = dict(HAPPY_VECTOR, runtime_safety="warn")
    vector[family] = "unmodeled-tier"

    decision = decide(vector, profile=profile, qr_decodable=True)

    assert decision.primary_state == "unverified", (profile, family)
    assert decision.reason_codes == ("unmodeled-residual-combination",)


@pytest.mark.parametrize("profile", sorted(KNOWN_PROFILES))
def test_runtime_warn_with_all_families_eligible_still_downgrades_to_risky(
    profile: str,
) -> None:
    vector = dict(HAPPY_VECTOR, runtime_safety="warn")

    decision = decide(vector, profile=profile, qr_decodable=True)

    assert decision.primary_state == "verified-issuer-destination-risky"
    assert "runtime-safety-warning" in decision.reason_codes


NON_RUNTIME_FAMILIES = tuple(f for f in RESIDUAL_FAMILIES if f != "runtime_safety")


@pytest.mark.parametrize("family", NON_RUNTIME_FAMILIES)
def test_required_family_without_decision_grade_evidence_blocks_under_strict(
    family: str,
) -> None:
    # The reviewer reproduction from the fifth round: a strict online profile
    # that marks destination, redirect, or artifact evidence required must not
    # answer a neutral unverified when that evidence is unavailable.
    vector = dict(HAPPY_VECTOR)
    vector[family] = "unavailable"

    decision = decide(
        vector,
        profile="strict-online",
        mandatory_residuals=(family,),
        qr_decodable=True,
    )

    assert decision.primary_state == "blocked", family
    expected_reason = f"{family.replace('_', '-')}-required-evidence-missing"
    assert decision.reason_codes == (expected_reason,)


@pytest.mark.parametrize("profile", sorted(KNOWN_PROFILES - {"strict-online"}))
@pytest.mark.parametrize("family", NON_RUNTIME_FAMILIES)
def test_required_family_without_decision_grade_evidence_caps_at_labeled_caution(
    profile: str, family: str
) -> None:
    vector = dict(HAPPY_VECTOR)
    vector[family] = "unavailable"

    decision = decide(
        vector,
        profile=profile,
        mandatory_residuals=(family,),
        qr_decodable=True,
    )

    assert decision.primary_state == "unverified", (profile, family)
    assert decision.annotations == ("incomplete-verification-warning",)
    expected_reason = f"{family.replace('_', '-')}-required-evidence-missing"
    assert decision.reason_codes == (expected_reason,)
    assert attention_level(decision) != "positive"


@pytest.mark.parametrize("profile", sorted(KNOWN_PROFILES))
@pytest.mark.parametrize("family", NON_RUNTIME_FAMILIES)
def test_unrequired_family_insufficiency_keeps_the_totality_default(
    profile: str, family: str
) -> None:
    # The D14 gate is requiredness under P: without the mandatory declaration
    # the same tier stays a generic D15 caution, not a required-evidence block.
    vector = dict(HAPPY_VECTOR)
    vector[family] = "unavailable"

    decision = decide(vector, profile=profile, qr_decodable=True)

    assert decision.primary_state == "unverified", (profile, family)
    assert decision.reason_codes == ("unmodeled-residual-combination",)


def test_runtime_insufficiency_overlaps_positive_eligibility_only_on_unavailable() -> None:
    # The exact overlap that hid the round-nine defect: "unavailable" is the
    # one tier that is simultaneously positive-eligible (annotated best-effort
    # trust for unrequired deployments) and an insufficiency tier (missing
    # evidence the moment P requires the family).
    overlap = (
        INSUFFICIENCY_TIERS["runtime_safety"]
        & POSITIVE_ELIGIBLE_RESIDUALS["runtime_safety"]
    )
    assert overlap == {"unavailable"}


@pytest.mark.parametrize("profile", sorted(KNOWN_PROFILES - {"strict-online"}))
def test_required_runtime_unavailable_never_reaches_a_positive_state(
    profile: str,
) -> None:
    # The reviewer counterexample from the ninth round: runtime "unavailable"
    # is positive-eligible so that unrequired best-effort deployments keep an
    # annotated positive, but once P marks runtime safety mandatory the same
    # tier is missing required evidence and D14 caps the outcome at a labeled
    # caution.
    decision = decide(
        dict(HAPPY_VECTOR, runtime_safety="unavailable"),
        profile=profile,
        mandatory_residuals=("runtime_safety",),
        qr_decodable=True,
    )

    assert decision.primary_state == "unverified", profile
    assert decision.annotations == ("incomplete-verification-warning",)
    assert decision.reason_codes == ("runtime-safety-required-evidence-missing",)
    assert attention_level(decision) != "positive"


def test_required_runtime_unavailable_blocks_under_strict() -> None:
    # Strict online already treats runtime safety as required evidence; its
    # dedicated D14 arm owns the block and the reason code, with or without
    # the explicit mandatory declaration.
    decision = decide(
        dict(HAPPY_VECTOR, runtime_safety="unavailable"),
        profile="strict-online",
        mandatory_residuals=("runtime_safety",),
        qr_decodable=True,
    )
    assert decision.primary_state == "blocked"
    assert decision.reason_codes == ("runtime-safety-unavailable",)


@pytest.mark.parametrize("profile", sorted(KNOWN_PROFILES - {"strict-online"}))
def test_unrequired_runtime_unavailable_keeps_the_annotated_positive(
    profile: str,
) -> None:
    # Without the mandatory declaration the non-strict profiles keep the
    # annotated best-effort positive (corpus cases C11b and C23b).
    decision = decide(
        dict(HAPPY_VECTOR, runtime_safety="unavailable"),
        profile=profile,
        qr_decodable=True,
    )
    assert decision.primary_state == "verified-issuer", profile
    assert "limited-runtime-safety-visibility" in decision.annotations


@pytest.mark.parametrize("profile", sorted(KNOWN_PROFILES - {"strict-online"}))
@pytest.mark.parametrize("tier", ["stale", "not-checked"])
def test_required_runtime_named_insufficiency_tiers_keep_their_dedicated_arms(
    profile: str, tier: str
) -> None:
    # "stale" and "not-checked" are insufficiency tiers too, but their
    # dedicated D14 arms return before the general mandatory rule, so the
    # mandatory declaration must not relabel their reason codes.
    decision = decide(
        dict(HAPPY_VECTOR, runtime_safety=tier),
        profile=profile,
        mandatory_residuals=("runtime_safety",),
        qr_decodable=True,
    )
    assert decision.primary_state == "unverified", (profile, tier)
    assert decision.annotations == ("incomplete-verification-warning",)
    assert decision.reason_codes == (f"runtime-safety-{tier}",)


def test_required_runtime_warn_is_a_verdict_not_missing_evidence() -> None:
    # A risky runtime verdict is real evidence: D5 must still downgrade to the
    # risky state even when P marks runtime safety mandatory.
    decision = decide(
        dict(HAPPY_VECTOR, runtime_safety="warn"),
        profile="strict-online",
        mandatory_residuals=("runtime_safety",),
        qr_decodable=True,
    )
    assert decision.primary_state == "verified-issuer-destination-risky"


@pytest.mark.parametrize("profile", sorted(KNOWN_PROFILES))
@pytest.mark.parametrize("family", NON_RUNTIME_FAMILIES)
def test_required_runtime_warn_with_unmodeled_tier_elsewhere_stays_generic(
    profile: str, family: str
) -> None:
    # The warn carve-out must fall through to D15, not mislabel the risky
    # verdict as missing runtime evidence.
    vector = dict(HAPPY_VECTOR, runtime_safety="warn")
    vector[family] = "unmodeled-tier"

    decision = decide(
        vector,
        profile=profile,
        mandatory_residuals=("runtime_safety",),
        qr_decodable=True,
    )

    assert decision.primary_state == "unverified", (profile, family)
    assert decision.reason_codes == ("unmodeled-residual-combination",)


def test_required_runtime_unmodeled_tier_is_missing_evidence_under_strict() -> None:
    # An out-of-vocabulary tier for the REQUIRED runtime family is missing
    # evidence (the named insufficiency tiers have their own arms above it).
    decision = decide(
        dict(HAPPY_VECTOR, runtime_safety="unmodeled-tier"),
        profile="strict-online",
        mandatory_residuals=("runtime_safety",),
        qr_decodable=True,
    )
    assert decision.primary_state == "blocked"
    assert decision.reason_codes == ("runtime-safety-required-evidence-missing",)


@pytest.mark.parametrize(
    "mandatory", [(), ("artifact_integrity",), RESIDUAL_FAMILIES]
)
def test_positive_states_require_positive_eligibility_across_all_modeled_vectors(
    mandatory: tuple[str, ...],
) -> None:
    # Exhaustive sweep over the modeled tier space: a positive-family state is
    # only ever reachable when the vector satisfies the paper's eligibility
    # predicate, for every profile and both arms of the D11 mandatory flag.
    for combo in itertools.product(*(MODELED_TIERS[f] for f in RESIDUAL_FAMILIES)):
        vector = dict(zip(RESIDUAL_FAMILIES, combo))
        for profile in KNOWN_PROFILES:
            decision = decide(
                vector,
                profile=profile,
                mandatory_residuals=mandatory,
                qr_decodable=True,
            )
            if decision.primary_state == "verified-issuer":
                assert all(
                    vector[f] in POSITIVE_ELIGIBLE_RESIDUALS[f]
                    for f in RESIDUAL_FAMILIES
                ), (profile, vector)
            if decision.primary_state == "verified-issuer-destination-risky":
                assert vector["runtime_safety"] == "warn", (profile, vector)
                assert all(
                    vector[f] in POSITIVE_ELIGIBLE_RESIDUALS[f]
                    for f in RESIDUAL_FAMILIES
                    if f != "runtime_safety"
                ), (profile, vector)
            if attention_level(decision) == "positive":
                assert decision.primary_state == "verified-issuer", (profile, vector)
            if any(
                f in mandatory
                and vector[f] in INSUFFICIENCY_TIERS.get(f, frozenset())
                for f in RESIDUAL_FAMILIES
            ):
                # D14: a mandatory family sitting in an insufficiency tier can
                # never reach a positive-family state, on any profile.
                assert decision.primary_state not in POSITIVE_STATES, (
                    profile,
                    vector,
                )


def test_undecodable_artifact_precedes_every_other_rule() -> None:
    vector = dict(HAPPY_VECTOR)
    vector["issuer_chain"] = "unmodeled-tier"
    decision = decide(vector, profile="strict-online", qr_decodable=False)
    assert decision.primary_state == "unreadable"


@pytest.mark.parametrize(
    "profile",
    ["", "strict_online", "STRICT-ONLINE", "bounded", "future-profile"],
)
def test_unknown_profiles_are_rejected(profile: str) -> None:
    with pytest.raises(UnknownProfileError):
        decide(dict(HAPPY_VECTOR), profile=profile, qr_decodable=True)


@pytest.mark.parametrize("profile", sorted(KNOWN_PROFILES))
def test_known_profiles_are_accepted(profile: str) -> None:
    decision = decide(dict(HAPPY_VECTOR), profile=profile, qr_decodable=True)
    assert decision.primary_state == "verified-issuer"


@pytest.mark.parametrize(
    "mandatory",
    [
        ("artifact-integrity",),  # hyphen for underscore
        ("artefact_integrity",),  # spelling
        ("runtime",),  # truncated family name
        ("artifact_integrity", "freshness "),  # trailing whitespace
    ],
)
def test_misspelled_mandatory_family_names_are_rejected(
    mandatory: tuple[str, ...],
) -> None:
    # A silently ignored mandatory name would demote a policy-mandated D11
    # block to a warning; the reviewer counterexample from the third round.
    with pytest.raises(UnknownResidualFamilyError):
        decide(
            dict(HAPPY_VECTOR),
            profile="strict-online",
            mandatory_residuals=mandatory,
            qr_decodable=True,
        )


def test_all_known_family_names_are_accepted_as_mandatory() -> None:
    decision = decide(
        dict(HAPPY_VECTOR),
        profile="strict-online",
        mandatory_residuals=RESIDUAL_FAMILIES,
        qr_decodable=True,
    )
    assert decision.primary_state == "verified-issuer"
