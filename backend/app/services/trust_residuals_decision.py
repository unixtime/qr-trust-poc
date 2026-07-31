"""
Shared trust-residuals decision core (the paper's Δ = decide(R⃗, P)).

This module is the single source of truth for the residual vocabulary, the
positive-eligibility sets, the attention lattice, and the decision function
shared by the offline corpus evaluation (scripts/trust_residuals_evaluation.py)
and the runtime scanner decision path. It is deliberately stdlib-only so both
callers can import it without pulling backend service dependencies.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Literal, Mapping


PRIMARY_STATES = {
    "unreadable",
    "unverified",
    "signed-unaccepted-issuer",
    "verified-issuer",
    "verified-issuer-destination-risky",
    "blocked",
}

ANNOTATIONS = {
    "artifact-warning",
    "stale-offline-warning",
    "limited-runtime-safety-visibility",
    "redirect-variation-warning",
    "invalid-trust-claim-warning",
    "policy-profile-warning",
    "incomplete-verification-warning",
}

# The decision context P is drawn from a closed profile enum. Every profile
# comparison in decide() is an equality test against one of these values, so
# an unrecognized string would otherwise silently select the most permissive
# arm of every profile-conditional rule; decide() rejects it instead.
KNOWN_PROFILES: frozenset[str] = frozenset(
    {
        "strict-online",
        "bounded-online",
        "bounded-offline",
        "production-trusted",
        "reference-testing",
    }
)

# The policy profile is decision context (the P in decide(R⃗, P)), not a member
# of the residual vector: it selects how strict each rule is, it is not itself
# verification evidence. It therefore has no entry here, no residual tier, and
# no ablation — "ablating" it would swap policies, not remove evidence.
RESIDUAL_FAMILIES: tuple[str, ...] = (
    "issuer_chain",
    "destination_policy",
    "redirect_flow",
    "runtime_safety",
    "freshness",
    "artifact_integrity",
)

# D15 totality rule: the positive terminal is only reachable when every residual
# sits in an explicitly positive-eligible tier. Any tier outside these sets —
# including tiers added to compute_residuals() later — falls through to a
# never-positive caution default instead of implicit trust.
POSITIVE_ELIGIBLE_RESIDUALS: dict[str, frozenset[str]] = {
    "issuer_chain": frozenset({"pass"}),
    "destination_policy": frozenset({"pass", "not-applicable"}),
    "redirect_flow": frozenset({"pass", "warn", "not-applicable"}),
    "runtime_safety": frozenset({"pass", "unavailable"}),
    "freshness": frozenset({"pass", "warn", "not-applicable"}),
    "artifact_integrity": frozenset({"pass", "warn"}),
}

# Tiers that report the absence of decision-grade evidence rather than a
# verdict about it. A profile may tolerate insufficiency for an unrequired
# family (runtime "unavailable" stays positive-eligible and is annotated), but
# a family P declares mandatory can never satisfy its evidence requirement
# with one of these tiers, even where the tier is positive-eligible. The
# "stale" and "not-checked" tiers are listed for completeness; their dedicated
# D14 arms in decide() return before the general mandatory rule is reached.
INSUFFICIENCY_TIERS: dict[str, frozenset[str]] = {
    "runtime_safety": frozenset({"unavailable", "not-checked", "stale"}),
}

AttentionLevel = Literal["positive", "neutral", "warning", "block"]


@dataclass(frozen=True)
class Decision:
    primary_state: str
    annotations: tuple[str, ...] = ()
    reason_codes: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        return {
            "primary_state": self.primary_state,
            "annotations": list(self.annotations),
            "reason_codes": list(self.reason_codes),
            "attention_level": attention_level(self),
        }


class ResidualEvidenceError(ValueError):
    """Raised when evidence cannot be mapped into the residual vocabulary."""


class UnknownProfileError(ValueError):
    """Raised when decide() receives a profile outside KNOWN_PROFILES."""


class UnknownResidualFamilyError(ValueError):
    """Raised when decide() receives a mandatory name outside RESIDUAL_FAMILIES."""


def compute_residuals(case: dict[str, Any]) -> dict[str, str]:
    evidence = case["evidence"]
    managed_claim = evidence["managed_trust_claim"]
    issuer = evidence["issuer"]

    if managed_claim == "invalid":
        issuer_chain = "invalid-managed-claim"
    elif issuer == "accepted":
        issuer_chain = "pass"
    elif issuer == "revoked":
        issuer_chain = "revoked-issuer"
    elif issuer == "unaccepted":
        issuer_chain = "unaccepted-issuer"
    elif issuer == "contradictory":
        issuer_chain = "cross-root-contradiction"
    elif issuer == "none":
        issuer_chain = "no-issuer"
    else:
        raise ResidualEvidenceError(
            f"{case['case_id']} has unsupported issuer evidence: {issuer}"
        )

    return {
        "issuer_chain": issuer_chain,
        "destination_policy": map_status(
            evidence["destination_policy"],
            {
                "bound": "pass",
                "mismatch": "fail",
                "not_applicable": "not-applicable",
            },
            case,
        ),
        "redirect_flow": map_status(
            evidence["redirect_flow"],
            {
                "pass": "pass",
                "fail": "fail",
                "warn": "warn",
                "not_applicable": "not-applicable",
            },
            case,
        ),
        "runtime_safety": map_status(
            evidence["runtime_safety"],
            {
                "clear": "pass",
                "risky": "warn",
                "blocked": "block",
                "provider_disagreement_block": "block",
                "stale": "stale",
                "unavailable": "unavailable",
                "provider_disagreement_unavailable": "unavailable",
                "not_checked": "not-checked",
            },
            case,
        ),
        "freshness": map_status(
            evidence["freshness"],
            {
                "fresh": "pass",
                "stale_warn": "warn",
                "expired_block": "block",
                "replay_block": "block",
                "not_applicable": "not-applicable",
            },
            case,
        ),
        "artifact_integrity": map_status(
            evidence["artifact_integrity"],
            {
                "pass": "pass",
                "warn": "warn",
                "fail": "fail",
                "block": "block",
            },
            case,
        ),
    }


def map_status(
    value: str,
    mapping: dict[str, str],
    case: dict[str, Any],
) -> str:
    try:
        return mapping[value]
    except KeyError as exc:
        raise ResidualEvidenceError(
            f"{case['case_id']} has unsupported evidence value: {value}"
        ) from exc


def decide(
    residuals: Mapping[str, str],
    *,
    profile: str,
    mandatory_residuals: Iterable[str] = (),
    qr_decodable: bool,
) -> Decision:
    if profile not in KNOWN_PROFILES:
        raise UnknownProfileError(
            f"unknown policy profile {profile!r}; expected one of "
            f"{sorted(KNOWN_PROFILES)}"
        )

    # A misspelled mandatory name would otherwise never match its equality
    # test in D11, silently demoting a policy-mandated block to a warning.
    mandatory = set(mandatory_residuals)
    unknown_families = mandatory - set(RESIDUAL_FAMILIES)
    if unknown_families:
        raise UnknownResidualFamilyError(
            f"unknown mandatory residual families {sorted(unknown_families)}; "
            f"expected members of {sorted(RESIDUAL_FAMILIES)}"
        )
    annotations: list[str] = []
    reasons: list[str] = []

    # Evaluation order follows the paper's rule classes: capture (D0), the
    # mandatory block class (D3, D6-D8, D10, strict-D9, mandatory-D11), the
    # downgrade/annotation class (D11, D13, then the neutral capture D1/D2,
    # then D14 and D5 with annotations), the totality default (D15), and the
    # positive terminal (D4). Adverse tiers (fail/block) preempt neutral
    # capture; insufficiency tiers (stale, unavailable, not-checked) gate only
    # paths that could otherwise turn positive, because requiredness under D14
    # protects positive trust and a neutral-capped path grants none.
    if not qr_decodable:
        return Decision("unreadable", reason_codes=("qr-undecodable",))

    if residuals["issuer_chain"] == "invalid-managed-claim":
        if profile == "reference-testing":
            return Decision(
                "unverified",
                ("invalid-trust-claim-warning", "policy-profile-warning"),
                ("invalid-managed-trust-claim", "reference-testing-profile"),
            )
        return Decision("blocked", reason_codes=("invalid-managed-trust-claim",))

    if residuals["issuer_chain"] == "revoked-issuer":
        return Decision("blocked", reason_codes=("issuer-revoked",))

    # D6/D7/D8 and the freshness block tier of D9: adverse evidence in any
    # non-issuer family blocks before the neutral issuer rules can capture the
    # case, so an unsigned or unaccepted-issuer payload with a blocking
    # runtime verdict is still blocked.
    for family, reason in (
        ("destination_policy", "destination-policy-failed"),
        ("redirect_flow", "redirect-flow-failed"),
        ("runtime_safety", "runtime-safety-block"),
        ("freshness", "freshness-block"),
    ):
        if residuals[family] in {"fail", "block"}:
            return Decision("blocked", reason_codes=(reason,))

    # D9, strict arm: strict online profiles refuse stale freshness evidence
    # outright; other profiles carry it as the stale-offline annotation below.
    if profile == "strict-online" and residuals["freshness"] == "warn":
        return Decision("blocked", reason_codes=("freshness-stale",))

    if residuals["artifact_integrity"] == "block":
        return Decision("blocked", reason_codes=("artifact-integrity-block",))

    # D11: an artifact-integrity failure is policy-gated. If P marks the
    # artifact residual mandatory, the failure blocks; otherwise it removes
    # positive trust and is preserved as evidence, never a positive state.
    if residuals["artifact_integrity"] == "fail":
        if "artifact_integrity" in mandatory:
            return Decision("blocked", reason_codes=("artifact-integrity-failed",))
        return Decision(
            "unverified",
            ("artifact-warning",),
            ("artifact-integrity-failed",),
        )

    # D13: contradictory verdicts across accepted roots for the same issuer.
    # The paper delegates resolution to P: strict online profiles refuse to
    # arbitrate and block; bounded profiles surface an explicitly labeled
    # caution. Neither profile may resolve the contradiction into trust.
    if residuals["issuer_chain"] == "cross-root-contradiction":
        if profile == "strict-online":
            return Decision("blocked", reason_codes=("cross-root-contradiction",))
        return Decision(
            "unverified",
            ("incomplete-verification-warning",),
            ("cross-root-contradiction",),
        )

    # D1/D2 neutral capture: after every adverse rule, before the
    # missing-evidence rules. A missing or stale runtime verdict adds nothing
    # to a path already capped at neutral, so it neither blocks these states
    # nor annotates them.
    if residuals["issuer_chain"] == "no-issuer":
        return Decision("unverified", reason_codes=("no-issuer-path",))

    if residuals["issuer_chain"] == "unaccepted-issuer":
        return Decision(
            "signed-unaccepted-issuer",
            reason_codes=("signed-by-unaccepted-issuer",),
        )

    # D14: an expired runtime verdict is stale runtime-safety evidence owned by
    # R_S. Strict online profiles block; other profiles fall to an explicitly
    # labeled caution and never a positive state.
    if residuals["runtime_safety"] == "stale":
        if profile == "strict-online":
            return Decision("blocked", reason_codes=("runtime-safety-stale",))
        return Decision(
            "unverified",
            ("incomplete-verification-warning",),
            ("runtime-safety-stale",),
        )

    # D14: the strict online profile marks the runtime-safety residual as
    # required evidence, so a verdict that was never obtained ("not-checked")
    # or could not be obtained ("unavailable") blocks outright.
    if profile == "strict-online" and residuals["runtime_safety"] in {
        "unavailable",
        "not-checked",
    }:
        return Decision(
            "blocked",
            reason_codes=(
                "runtime-safety-unavailable"
                if residuals["runtime_safety"] == "unavailable"
                else "runtime-safety-not-checked",
            ),
        )

    # D14, non-strict arm for a skipped check: bounded profiles treat an
    # unavailable provider as best-effort evidence (annotated below), but a
    # verdict that was never requested is a verifier omission rather than a
    # provider failure, so it caps the outcome at a labeled caution — never a
    # positive state.
    if residuals["runtime_safety"] == "not-checked":
        return Decision(
            "unverified",
            ("incomplete-verification-warning",),
            ("runtime-safety-not-checked",),
        )

    if residuals["freshness"] == "warn":
        annotations.append("stale-offline-warning")
        reasons.append("freshness-warning")
    if residuals["runtime_safety"] == "unavailable":
        annotations.append("limited-runtime-safety-visibility")
        reasons.append("runtime-safety-unavailable")
    if residuals["artifact_integrity"] == "warn":
        annotations.append("artifact-warning")
        reasons.append("artifact-integrity-warning")
    if residuals["redirect_flow"] == "warn":
        annotations.append("redirect-variation-warning")
        reasons.append("redirect-variation-warning")
    if profile == "reference-testing":
        annotations.append("policy-profile-warning")
        reasons.append("reference-testing-profile")

    # D5: a risky runtime verdict downgrades the positive terminal to the
    # explicitly risky state. Evaluated after annotation accumulation so
    # co-occurring cautions (stale-offline, artifact, redirect variation)
    # are carried on the risky state instead of being dropped. The risky
    # state still asserts issuer verification, so it demands the same
    # positive-eligibility of every non-runtime family as the positive
    # terminal; an unmodeled tier anywhere falls through to the D15
    # default instead of reaching this early return.
    if residuals["runtime_safety"] == "warn" and all(
        residuals[family] in POSITIVE_ELIGIBLE_RESIDUALS[family]
        for family in RESIDUAL_FAMILIES
        if family != "runtime_safety"
    ):
        reasons.append("runtime-safety-warning")
        return Decision(
            "verified-issuer-destination-risky",
            tuple(annotations),
            tuple(reasons),
        )

    # D14, general arm: requiredness under P is not limited to runtime safety.
    # A family P declares mandatory must present decision-grade evidence: any
    # tier that survived the adverse rules yet is either an insufficiency tier
    # or outside the positive-eligible set means the required evidence could
    # not be established. Positive-eligibility does not excuse a required
    # family — runtime "unavailable" is tolerated and annotated only when the
    # family is unrequired. Strict online profiles block; every other profile
    # caps the outcome at an explicitly labeled caution, never a positive
    # state and never the generic D15 default reserved for unrequired
    # families.
    for family in RESIDUAL_FAMILIES:
        if family not in mandatory:
            continue
        if (
            residuals[family] not in INSUFFICIENCY_TIERS.get(family, frozenset())
            and residuals[family] in POSITIVE_ELIGIBLE_RESIDUALS[family]
        ):
            continue
        if family == "runtime_safety" and residuals[family] == "warn":
            # A risky runtime verdict is real evidence, not missing evidence;
            # D5 above and the D15 default below own that tier.
            continue
        reason = f"{family.replace('_', '-')}-required-evidence-missing"
        if profile == "strict-online":
            return Decision("blocked", reason_codes=(reason,))
        return Decision(
            "unverified",
            ("incomplete-verification-warning",),
            (reason,),
        )

    if any(
        residuals[family] not in POSITIVE_ELIGIBLE_RESIDUALS[family]
        for family in RESIDUAL_FAMILIES
    ):
        return Decision(
            "unverified",
            ("incomplete-verification-warning",),
            ("unmodeled-residual-combination",),
        )

    return Decision("verified-issuer", tuple(annotations), tuple(reasons))


def attention_level(decision: Decision) -> AttentionLevel:
    if decision.primary_state == "blocked":
        return "block"
    if (
        decision.primary_state in {"signed-unaccepted-issuer", "verified-issuer-destination-risky"}
        or decision.annotations
    ):
        return "warning"
    if decision.primary_state in {"unreadable", "unverified"}:
        return "neutral"
    return "positive"


def attention_rank(decision: Decision) -> int:
    return {
        "positive": 0,
        "neutral": 1,
        "warning": 2,
        "block": 3,
    }[attention_level(decision)]


def is_attention_undercut(expected: Decision, actual: Decision) -> bool:
    """True when ``actual`` demands strictly less user attention than ``expected``.

    This is an ordering comparison over attention levels, not a claim of
    positive trust: a neutral ``unverified`` rendering of a case that demands
    a warning undercuts the required attention without asserting anything.
    """
    return attention_rank(actual) < attention_rank(expected)


def is_unsafe_positive(expected: Decision, actual: Decision) -> bool:
    """True when ``actual`` asserts positive trust where ``expected`` does not."""
    return (
        attention_level(actual) == "positive"
        and attention_level(expected) != "positive"
    )
