"""
Independent encoding of the paper's formal decision table (D0-D15).

This module is transcribed directly from the manuscript's Formal Decision
Table (rules D0-D15) and the ordered rule classes of the precedence function
S = Delta(R, P). It deliberately imports nothing from
backend.app.services.trust_residuals_decision: the evaluation harness compares
decide() against this second, independently authored encoding, so "37/37"
means conformance to the paper's table rather than agreement of the
implementation with corpus labels derived from it. Keep it that way — an
import from the decision module would collapse the two encodings back into
one and silently restore the circularity this module exists to remove.

The comparison surface is a disjoint union: D0 yields a capture outcome;
decoded cases yield (primary state, set of annotations). Reason codes are
implementation rationale for the rule that fired, not part of the formal
outcome, and the same blocked state can legitimately be attributed to
different rules by the two encodings without a semantic disagreement.
"""

from __future__ import annotations

from typing import Iterable, Mapping, NamedTuple


# The paper's policy profiles, in the order they are introduced.
FORMAL_PROFILES: tuple[str, ...] = (
    "strict-online",
    "bounded-online",
    "bounded-offline",
    "production-trusted",
    "reference-testing",
)

FORMAL_PRIMARY_STATES: frozenset[str] = frozenset(
    {
        "unverified",
        "signed-unaccepted-issuer",
        "verified-issuer",
        "verified-issuer-destination-risky",
        "blocked",
    }
)
FORMAL_CAPTURE_OUTCOMES: frozenset[str] = frozenset({"unreadable"})

# Residual families in the paper's vector order [R_I, R_D, R_R, R_S, R_F, R_A],
# with the modeled tier vocabulary of each family's residual definition.
FORMAL_TIERS: dict[str, tuple[str, ...]] = {
    "issuer_chain": (
        "pass",
        "no-issuer",
        "unaccepted-issuer",
        "revoked-issuer",
        "invalid-managed-claim",
        "cross-root-contradiction",
    ),
    "destination_policy": ("pass", "fail", "not-applicable"),
    "redirect_flow": ("pass", "warn", "fail", "not-applicable"),
    "runtime_safety": ("pass", "warn", "block", "stale", "unavailable", "not-checked"),
    "freshness": ("pass", "warn", "block", "not-applicable"),
    "artifact_integrity": ("pass", "warn", "fail", "block"),
}

FORMAL_FAMILIES: tuple[str, ...] = tuple(FORMAL_TIERS)

# D4's positive-eligibility predicate, per family: the tiers a family may
# occupy while the vector still reaches a state that asserts issuer
# verification (D4's terminal, and D5's outside the runtime family).
FORMAL_POSITIVE_ELIGIBLE: dict[str, frozenset[str]] = {
    "issuer_chain": frozenset({"pass"}),
    "destination_policy": frozenset({"pass", "not-applicable"}),
    "redirect_flow": frozenset({"pass", "warn", "not-applicable"}),
    "runtime_safety": frozenset({"pass", "unavailable"}),
    "freshness": frozenset({"pass", "warn", "not-applicable"}),
    "artifact_integrity": frozenset({"pass", "warn"}),
}

# D14's insufficiency tiers: absence of decision-grade evidence rather than a
# verdict about it. Runtime safety is the one family whose evidence model
# refines insufficiency into named tiers.
FORMAL_INSUFFICIENCY: dict[str, frozenset[str]] = {
    "runtime_safety": frozenset({"stale", "unavailable", "not-checked"}),
}


class FormalOutcome(NamedTuple):
    primary_state: str
    annotations: frozenset[str]
    rule: str


class FormalCaptureOutcome(NamedTuple):
    capture_outcome: str
    rule: str


def formal_capture_outcome(*, qr_decodable: bool) -> FormalCaptureOutcome | None:
    """Evaluate D0 before any trust-decision state or residual is consulted."""
    if qr_decodable:
        return None
    return FormalCaptureOutcome("unreadable", "D0")


def _blocked(rule: str) -> FormalOutcome:
    return FormalOutcome("blocked", frozenset(), rule)


def _caution(rule: str) -> FormalOutcome:
    return FormalOutcome(
        "unverified", frozenset({"incomplete-verification-warning"}), rule
    )


def formal_table_decision(
    residuals: Mapping[str, str],
    *,
    profile: str,
    mandatory_residuals: Iterable[str] = (),
) -> FormalOutcome:
    """Evaluate the trust-decision rules after capture and decode succeeded."""
    if profile not in FORMAL_PROFILES:
        raise ValueError(f"unknown policy profile {profile!r}")
    if set(residuals) != set(FORMAL_FAMILIES):
        raise ValueError(f"residual vector families {sorted(residuals)} do not match the model")
    for family, tier in residuals.items():
        if tier not in FORMAL_TIERS[family]:
            raise ValueError(f"unmodeled tier {tier!r} for family {family!r}")
    mandatory = frozenset(mandatory_residuals)
    if not mandatory <= set(FORMAL_FAMILIES):
        raise ValueError(f"unknown mandatory families {sorted(mandatory - set(FORMAL_FAMILIES))}")

    r_i = residuals["issuer_chain"]
    r_d = residuals["destination_policy"]
    r_r = residuals["redirect_flow"]
    r_s = residuals["runtime_safety"]
    r_f = residuals["freshness"]
    r_a = residuals["artifact_integrity"]

    # Class 2 — mandatory block rules. Class 1 is the separate D0 capture
    # outcome above. Every rule in this class emits the bare
    # blocked state, so their relative order is not observable in the outcome.
    if r_i == "invalid-managed-claim":
        # D3, with the reference-testing carve-out: under the explicitly
        # labeled testing posture the invalid claim degrades to unverified
        # with explicit invalid-trust-claim and profile warnings.
        if profile == "reference-testing":
            return FormalOutcome(
                "unverified",
                frozenset({"invalid-trust-claim-warning", "policy-profile-warning"}),
                "D3",
            )
        return _blocked("D3")
    if r_i == "revoked-issuer":
        return _blocked("D3")
    if r_d == "fail":
        return _blocked("D6")
    if r_r == "fail":
        return _blocked("D7")
    if r_s == "block":
        return _blocked("D8")
    if r_f == "block":
        # D9's mandatory tier: required trust state expired beyond policy.
        return _blocked("D9")
    if profile == "strict-online" and r_f == "warn":
        # D9, strict arm: strict online profiles refuse stale freshness.
        return _blocked("D9")
    if r_a == "block":
        return _blocked("D10")
    if r_a == "fail" and "artifact_integrity" in mandatory:
        # D11, mandatory arm.
        return _blocked("D11")

    # Class 3 — downgrade and annotation rules. D9's bounded arm and D12 are
    # annotation marks rendered on the positive-family terminals below;
    # D11 and D13 are terminal here.
    if r_a == "fail":
        return FormalOutcome("unverified", frozenset({"artifact-warning"}), "D11")
    if r_i == "cross-root-contradiction":
        if profile == "strict-online":
            return _blocked("D13")
        return _caution("D13")

    # Class 4 — neutral rules. Adverse evidence was consumed above, and the
    # insufficiency class below gates only paths that could otherwise reach a
    # positive state, so neutral capture returns unannotated states.
    if r_i == "no-issuer":
        return FormalOutcome("unverified", frozenset(), "D1")
    if r_i == "unaccepted-issuer":
        return FormalOutcome("signed-unaccepted-issuer", frozenset(), "D2")

    # Class 5 — insufficiency rules (D14). The named runtime tiers first:
    # stale and never-obtained verdicts cap the outcome on every profile,
    # and the strict online profile treats runtime safety as required.
    if r_s == "stale":
        return _blocked("D14") if profile == "strict-online" else _caution("D14")
    if r_s == "not-checked":
        return _blocked("D14") if profile == "strict-online" else _caution("D14")
    if profile == "strict-online" and r_s == "unavailable":
        return _blocked("D14")
    # General requiredness arm: a family P declares mandatory must present
    # decision-grade evidence — an insufficiency tier, or any tier that is
    # neither positive-eligible nor an adverse verdict, fails the
    # requirement. Never positive.
    for family in FORMAL_FAMILIES:
        if family not in mandatory:
            continue
        tier = residuals[family]
        if family == "runtime_safety" and tier == "warn":
            # A risky runtime verdict is evidence, owned by D5 and D15.
            continue
        if tier in FORMAL_INSUFFICIENCY.get(family, frozenset()) or (
            tier not in FORMAL_POSITIVE_ELIGIBLE[family]
        ):
            return _blocked("D14") if profile == "strict-online" else _caution("D14")

    # Annotation marks carried by the terminals that assert issuer
    # verification: D9's bounded arm, tolerated unrequired runtime
    # insufficiency, D12, D4's redirect-warn admission, and the
    # reference-testing posture label.
    marks = set()
    if r_f == "warn":
        marks.add("stale-offline-warning")
    if r_s == "unavailable":
        marks.add("limited-runtime-safety-visibility")
    if r_a == "warn":
        marks.add("artifact-warning")
    if r_r == "warn":
        marks.add("redirect-variation-warning")
    if profile == "reference-testing":
        marks.add("policy-profile-warning")

    # Class 6 — risky downgrade rule (D5): runtime warns while every
    # non-runtime family sits in a positive-eligible tier.
    if r_s == "warn" and all(
        residuals[family] in FORMAL_POSITIVE_ELIGIBLE[family]
        for family in FORMAL_FAMILIES
        if family != "runtime_safety"
    ):
        return FormalOutcome(
            "verified-issuer-destination-risky", frozenset(marks), "D5"
        )

    # Class 7 — totality rule (D15): any family outside its positive-eligible
    # tiers defaults to caution, never trust.
    if any(
        residuals[family] not in FORMAL_POSITIVE_ELIGIBLE[family]
        for family in FORMAL_FAMILIES
    ):
        return _caution("D15")

    # Class 8 — positive rule (D4).
    return FormalOutcome("verified-issuer", frozenset(marks), "D4")
