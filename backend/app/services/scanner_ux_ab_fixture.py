from __future__ import annotations

from dataclasses import dataclass
from statistics import median

from backend.app.schemas.poc import (
    ScannerUXExperimentArmResult,
    ScannerUXExperimentArmSummary,
    ScannerUXExperimentEvent,
    ScannerUXExperimentFixtureResponse,
)

BLIND_OPEN_WINDOW_MS = 300
HOLD_GATE_MS = 800
PARTICIPANTS_PER_ARM = 60


@dataclass(frozen=True)
class _FixtureCase:
    scan_id: str
    case_kind: str
    decision_state: str
    risk_score: int
    risk_level: str
    reason_codes: tuple[str, ...]
    destination_display: str
    destination_url: str

    @property
    def flagged(self) -> bool:
        return self.risk_score >= 30


_CASES = (
    _FixtureCase(
        scan_id="benign-merchant-home",
        case_kind="benign",
        decision_state="verified_issuer",
        risk_score=0,
        risk_level="green",
        reason_codes=(),
        destination_display="acme.example",
        destination_url="https://acme.example/pay",
    ),
    _FixtureCase(
        scan_id="benign-receipt-status",
        case_kind="benign",
        decision_state="verified_issuer",
        risk_score=10,
        risk_level="green",
        reason_codes=("net_new_domain",),
        destination_display="receipts.acme.example",
        destination_url="https://receipts.acme.example/lookup",
    ),
    _FixtureCase(
        scan_id="benign-public-poster",
        case_kind="benign",
        decision_state="verified_issuer",
        risk_score=0,
        risk_level="green",
        reason_codes=(),
        destination_display="city.example",
        destination_url="https://city.example/parking",
    ),
    _FixtureCase(
        scan_id="benign-ticket-checkin",
        case_kind="benign",
        decision_state="verified_issuer",
        risk_score=15,
        risk_level="green",
        reason_codes=("net_new_domain",),
        destination_display="tickets.example",
        destination_url="https://tickets.example/event/check-in",
    ),
    _FixtureCase(
        scan_id="mismatch-caption-bank",
        case_kind="mismatch",
        decision_state="unverified",
        risk_score=45,
        risk_level="amber",
        reason_codes=("display_text_mismatch", "net_new_domain"),
        destination_display="pay.example",
        destination_url="https://pay-verify.example/login",
    ),
    _FixtureCase(
        scan_id="mismatch-brand-lookalike",
        case_kind="mismatch",
        decision_state="unverified",
        risk_score=55,
        risk_level="amber",
        reason_codes=("brand_similarity", "display_text_mismatch"),
        destination_display="support.example",
        destination_url="https://supp0rt.example/reset",
    ),
    _FixtureCase(
        scan_id="mismatch-shortlink-hop",
        case_kind="mismatch",
        decision_state="unverified",
        risk_score=40,
        risk_level="amber",
        reason_codes=("redirect_chain", "net_new_domain"),
        destination_display="qr.example",
        destination_url="https://qr.example/r/8Zp9",
    ),
    _FixtureCase(
        scan_id="high-risk-known-bad",
        case_kind="high_risk",
        decision_state="blocked",
        risk_score=75,
        risk_level="red",
        reason_codes=("known_bad_domain", "https_invalid"),
        destination_display="secure-login.example",
        destination_url="http://secure-login.example/session",
    ),
    _FixtureCase(
        scan_id="high-risk-new-domain-creds",
        case_kind="high_risk",
        decision_state="blocked",
        risk_score=85,
        risk_level="red",
        reason_codes=("embedded_credentials", "newly_registered_domain"),
        destination_display="wallet.example",
        destination_url="https://user:pass@wallet-login.example.zip/restore",
    ),
)


def build_scanner_ux_ab_fixture(seed: str) -> ScannerUXExperimentFixtureResponse:
    control_events = _build_arm_events(seed=seed, arm="control")
    treatment_events = _build_arm_events(seed=seed, arm="treatment")
    control_summary = _summarize_arm("control", control_events)
    treatment_summary = _summarize_arm("treatment", treatment_events)

    return ScannerUXExperimentFixtureResponse(
        seed=seed,
        participants_per_arm=PARTICIPANTS_PER_ARM,
        scans_per_participant=len(_CASES),
        sampled_scans_per_arm=len(_CASES),
        blind_open_window_ms=BLIND_OPEN_WINDOW_MS,
        hold_gate_ms=HOLD_GATE_MS,
        success_criteria=[
            "Flagged treatment scans require hold_complete before open.",
            "Flagged treatment scans have zero opens under the blind-open window.",
            "Benign treatment decisions add no more than 200 ms median delay.",
            "Every flagged scan includes risk_score and reason_codes.",
        ],
        control=ScannerUXExperimentArmResult(
            summary=control_summary,
            sample_events=control_events,
        ),
        treatment=ScannerUXExperimentArmResult(
            summary=treatment_summary,
            sample_events=treatment_events,
        ),
    )


def _build_arm_events(seed: str, arm: str) -> list[ScannerUXExperimentEvent]:
    events: list[ScannerUXExperimentEvent] = []
    benign_open_delays = {
        "control": (180, 210, 230, 240),
        "treatment": (260, 300, 330, 360),
    }
    benign_index = 0

    for case in _CASES:
        request_id = f"{seed}:{arm}:{case.scan_id}"
        hold_required = arm == "treatment" and case.flagged
        hold_ms = HOLD_GATE_MS if hold_required else 0
        events.append(_event(case, arm, request_id, "preview", 0, hold_required, hold_ms))

        if hold_required:
            events.append(_event(case, arm, request_id, "hold_start", 0, True, HOLD_GATE_MS))
            events.append(_event(case, arm, request_id, "hold_complete", HOLD_GATE_MS, True, HOLD_GATE_MS))
            events.append(_event(case, arm, request_id, "open", HOLD_GATE_MS + 120, True, HOLD_GATE_MS))
            continue

        if case.flagged:
            open_delay = 180 if arm == "control" else HOLD_GATE_MS + 120
        else:
            open_delay = benign_open_delays[arm][benign_index]
            benign_index += 1
        events.append(_event(case, arm, request_id, "open", open_delay, False, 0))

    return events


def _event(
    case: _FixtureCase,
    arm: str,
    request_id: str,
    event_type: str,
    elapsed_ms: int,
    hold_required: bool,
    hold_ms: int,
) -> ScannerUXExperimentEvent:
    return ScannerUXExperimentEvent(
        scan_id=request_id,
        arm=arm,
        case_kind=case.case_kind,
        event_type=event_type,
        elapsed_ms=elapsed_ms,
        decision_state=case.decision_state,
        risk_score=case.risk_score,
        risk_level=case.risk_level,
        reason_codes=list(case.reason_codes),
        hold_required=hold_required,
        hold_ms=hold_ms,
        destination_display=case.destination_display,
        destination_url=case.destination_url,
    )


def _summarize_arm(arm: str, events: list[ScannerUXExperimentEvent]) -> ScannerUXExperimentArmSummary:
    open_events = [event for event in events if event.event_type == "open"]
    flagged_open_events = [event for event in open_events if event.risk_score >= 30]
    benign_open_events = [event for event in open_events if event.risk_score < 30]
    held_open_count = len(
        [
            event
            for event in events
            if event.event_type == "hold_complete" and event.risk_score >= 30
        ]
    )
    blind_open_count = len(
        [
            event
            for event in flagged_open_events
            if event.elapsed_ms <= BLIND_OPEN_WINDOW_MS
        ]
    )
    false_friction_count = len(
        [
            event
            for event in benign_open_events
            if event.hold_required
        ]
    )
    flagged_scan_count = len({event.scan_id for event in events if event.risk_score >= 30})
    benign_scan_count = len({event.scan_id for event in events if event.risk_score < 30})

    return ScannerUXExperimentArmSummary(
        arm=arm,
        total_scans=len({event.scan_id for event in events}),
        flagged_scans=flagged_scan_count,
        held_open_count=held_open_count,
        flagged_blind_open_count=blind_open_count,
        flagged_blind_open_rate=blind_open_count / flagged_scan_count,
        median_benign_decision_ms=int(median(event.elapsed_ms for event in benign_open_events)),
        false_friction_rate=false_friction_count / benign_scan_count,
    )
