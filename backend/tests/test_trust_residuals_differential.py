"""Differential corpus replay: runtime scanner vs offline trust-residuals engine.

The offline evaluator (scripts/trust_residuals_evaluation.py) decides over
pre-encoded residual evidence vectors; the runtime scanner
(POST /scanner/decisions) decides over signed QR payloads and issuer fixture
state. Until now their equivalence was asserted by construction only. This
module replays every runtime-expressible corpus case through the live scanner
pipeline and compares the two engines at the attention-level ordering
(positive < neutral < warning < block).

Every corpus case is classified exactly once:

- IN_SCOPE: replayed through the runtime scanner; the runtime decision state
  is asserted exactly and its attention level must match the offline engine's.
- DIVERGENT: runtime-expressible, but the engines are known to disagree. The
  current divergent behavior is asserted so that fixing the engine flips the
  test and forces this classification to be updated.
- OUT_OF_SCOPE: not expressible through the scanner API in this suite, with a
  recorded reason.

The motivating gap — "two decision engines with no equivalence check" — was
flagged in an internal paper-to-PoC gap review; this module closes it with an
executable replay.
"""

from __future__ import annotations

import base64
import importlib.util
import sys
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from types import ModuleType
from typing import Any, Callable
from urllib.parse import quote

import pytest
import qrcode
from fastapi.testclient import TestClient

from backend.app.api.endpoints import verifier as verifier_endpoint


ROOT = Path(__file__).resolve().parents[2]
EVALUATION_SCRIPT = ROOT / "scripts" / "trust_residuals_evaluation.py"


def load_evaluation_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "trust_residuals_evaluation_differential",
        EVALUATION_SCRIPT,
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def offline() -> dict[str, Any]:
    evaluation = load_evaluation_module()
    corpus = evaluation.load_corpus(evaluation.DEFAULT_CORPUS_PATH)
    report = evaluation.run_evaluation(
        corpus,
        generated_at="2026-05-31T00:00:00+00:00",
    )
    return {
        "cases": {case["case_id"]: case for case in corpus["cases"]},
        "decisions": {case["case_id"]: case["residual_verifier"] for case in report["cases"]},
    }


def _render_qr_base64(payload: str, *, border: int) -> str:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=border,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white").get_image()
    output = BytesIO()
    image.convert("RGB").save(output, format="PNG")
    return base64.b64encode(output.getvalue()).decode("ascii")


def _demo_scan(
    client: TestClient,
    demo_overrides: dict[str, Any],
    *,
    scan_extra: Callable[[str], dict[str, Any]] | None = None,
    scans: int = 1,
) -> dict[str, Any]:
    demo_response = client.post("/verifier/demo-materials", json=demo_overrides)
    assert demo_response.status_code == 200
    qr_payload = demo_response.json()["qr_payload"]
    body: dict[str, Any] = {"qr_payload": qr_payload}
    if scan_extra is not None:
        body.update(scan_extra(qr_payload))
    payload: dict[str, Any] = {}
    for _ in range(scans):
        result = client.post("/scanner/decisions", json=body)
        assert result.status_code == 200
        payload = result.json()
    return payload


def _plain_scan(client: TestClient, url: str) -> dict[str, Any]:
    result = client.post("/scanner/decisions", json={"qr_payload": url})
    assert result.status_code == 200
    return result.json()


def _scan_qr(client: TestClient, qr_payload: str) -> dict[str, Any]:
    result = client.post("/scanner/decisions", json={"qr_payload": qr_payload})
    assert result.status_code == 200
    return result.json()


def _minutes_from_now(minutes: int) -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=minutes)


def _scan_issuer_record_not_yet_valid(client: TestClient) -> dict[str, Any]:
    demo = client.post("/verifier/demo-materials", json={})
    assert demo.status_code == 200
    store = verifier_endpoint._scanner_trust_store
    resolved = store.resolve(demo.json()["trust"]["key_ref"])
    assert resolved is not None
    _, issuer = resolved
    store.put_issuer(replace(issuer, issued_at=_minutes_from_now(60)))
    return _scan_qr(client, demo.json()["qr_payload"])


def _scan_key_window_mismatch(client: TestClient) -> dict[str, Any]:
    # Artifact issued 30 minutes ago; key window opened 5 minutes ago.
    demo = client.post(
        "/verifier/demo-materials", json={"issued_offset_minutes": -30}
    )
    assert demo.status_code == 200
    store = verifier_endpoint._scanner_trust_store
    resolved = store.resolve(demo.json()["trust"]["key_ref"])
    assert resolved is not None
    key, _ = resolved
    store.put_key(replace(key, not_before=_minutes_from_now(-5)))
    return _scan_qr(client, demo.json()["qr_payload"])


def _resolver_url(final_url: str, *, hops: int = 1, nested: bool = False) -> str:
    suffix = "&nested=1" if nested else ""
    return (
        "https://qr.acme.example/r/pay"
        f"?final={quote(final_url, safe='')}&hops={hops}{suffix}"
    )


def _scan_unknown_issuer(client: TestClient) -> dict[str, Any]:
    demo_response = client.post(
        "/verifier/demo-materials",
        json={},
    )
    assert demo_response.status_code == 200
    qr_payload = demo_response.json()["qr_payload"]

    from backend.app.api.endpoints import verifier as verifier_endpoint

    verifier_endpoint._scanner_trust_store.clear()
    result = client.post("/scanner/decisions", json={"qr_payload": qr_payload})
    assert result.status_code == 200
    return result.json()


def runtime_attention(payload: dict[str, Any]) -> str:
    """Map a runtime scanner decision onto the offline attention lattice."""
    state = payload["decision_state"]
    if state in {"blocked", "profile_revoked"}:
        return "block"
    if state == "unverified":
        return "neutral"
    if state in {
        "signed_unknown_issuer",
        "verified_issuer_destination_risky",
        "stale_trust_state",
        "profile_stale",
    }:
        return "warning"
    assert state == "verified_issuer", f"unmapped runtime state: {state}"
    return "warning" if payload["scanner_ux"]["risk_level"] == "amber" else "positive"


@dataclass(frozen=True)
class RuntimeScenario:
    case_id: str
    expected_runtime_state: str
    run: Callable[[TestClient], dict[str, Any]]
    note: str


IN_SCOPE: tuple[RuntimeScenario, ...] = (
    RuntimeScenario(
        "C1",
        "unverified",
        lambda client: _plain_scan(client, "https://example.org/menu"),
        "Unsigned benign URL: corpus decoded_payload scanned verbatim.",
    ),
    RuntimeScenario(
        "C2",
        "signed_unknown_issuer",
        _scan_unknown_issuer,
        "Signed envelope whose certificate_ref has no scanner trust record.",
    ),
    RuntimeScenario(
        "C3",
        "verified_issuer",
        lambda client: _demo_scan(client, {}),
        "Default demo materials: accepted issuer, bound destination.",
    ),
    RuntimeScenario(
        "C4",
        "blocked",
        lambda client: _demo_scan(
            client,
            {
                "payload": "https://rogue.example/phish",
                "verified_domains": ["acme.example"],
            },
        ),
        "Destination changed after issuance: payload host outside verified domains.",
    ),
    RuntimeScenario(
        "C5",
        "verified_issuer",
        lambda client: _demo_scan(
            client,
            {
                "payload": _resolver_url("https://acme.example/pay"),
                "verified_domains": ["qr.acme.example"],
            },
        ),
        "Approved resolver flow within issuer redirect policy.",
    ),
    RuntimeScenario(
        "C6",
        "blocked",
        lambda client: _demo_scan(
            client,
            {
                "payload": _resolver_url("https://evil.example/pay"),
                "verified_domains": ["qr.acme.example"],
            },
        ),
        "Resolver final-host mismatch.",
    ),
    RuntimeScenario(
        "C7",
        "blocked",
        lambda client: _demo_scan(
            client,
            {
                "payload": "https://acme.example/pay?runtime=blocked",
            },
        ),
        "Runtime safety provider returns blocked.",
    ),
    RuntimeScenario(
        "C8",
        "verified_issuer_destination_risky",
        lambda client: _demo_scan(
            client,
            {
                "payload": "https://acme.example/pay?runtime=risky",
            },
        ),
        "Runtime safety provider returns risky.",
    ),
    RuntimeScenario(
        "C9",
        "blocked",
        lambda client: _demo_scan(
            client,
            {
                "certificate_revoked": True,
            },
        ),
        "Revoked issuer certificate.",
    ),
    RuntimeScenario(
        "C10a",
        "blocked",
        lambda client: _demo_scan(
            client,
            {
                "governance_cache_profile": "expired",
            },
        ),
        "Expired governance cache blocks in the strict path.",
    ),
    RuntimeScenario(
        "C10b",
        "stale_trust_state",
        lambda client: _demo_scan(
            client,
            {
                "governance_cache_profile": "stale",
            },
        ),
        "Stale governance cache downgrades to caution "
        "(offline: verified-issuer + stale-offline-warning).",
    ),
    RuntimeScenario(
        "C11a",
        "blocked",
        lambda client: _demo_scan(
            client,
            {
                "payload": "https://acme.example/pay?runtime=expired",
            },
        ),
        "Expired runtime verdict blocks (runtime 'expired' tier; offline: "
        "R_S stale tier under strict-online).",
    ),
    RuntimeScenario(
        "C11b",
        "verified_issuer_destination_risky",
        lambda client: _demo_scan(
            client,
            {
                "payload": "https://acme.example/pay?runtime=unavailable",
            },
        ),
        "Runtime provider unavailable. State vocabularies differ (offline: "
        "verified-issuer + limited-runtime-safety-visibility) but both are warning-level.",
    ),
    RuntimeScenario(
        "C12",
        "blocked",
        lambda client: _demo_scan(
            client,
            {
                "payload": _resolver_url("https://acme.example/pay", nested=True),
                "verified_domains": ["qr.acme.example"],
            },
        ),
        "Nested shortener in the redirect flow.",
    ),
    RuntimeScenario(
        "C14",
        "verified_issuer",
        lambda client: _demo_scan(
            client,
            {},
            scan_extra=lambda qr_payload: {
                "image_base64": _render_qr_base64(qr_payload, border=0)
            },
        ),
        "Low quiet-zone scan image: verified with amber artifact warning.",
    ),
    RuntimeScenario(
        "C15b",
        "unverified",
        lambda client: _plain_scan(
            client, "https://login-bank.example.attacker.test/pay?runtime=none"
        ),
        "HTTPS phishing lookalike without a runtime verdict: plain-URL path.",
    ),
    RuntimeScenario(
        "C15c",
        "blocked",
        lambda client: _demo_scan(
            client,
            {
                "payload": "https://acme.example/pay?runtime=blocked",
            },
        ),
        "Signed payload with runtime block (same mechanism as C7; distinct corpus vector).",
    ),
    RuntimeScenario(
        "C18",
        "blocked",
        lambda client: _demo_scan(
            client,
            {
                "payload": "https://xn--acm-fna.example/pay",
                "verified_domains": ["acme.example"],
            },
        ),
        "IDN/punycode lookalike host outside the verified domain set.",
    ),
    RuntimeScenario(
        "C19a",
        "blocked",
        lambda client: _demo_scan(
            client,
            {
                "payload": _resolver_url("https://acme.example/pay", hops=3),
                "verified_domains": ["qr.acme.example"],
            },
        ),
        "Redirect variation: observed hops exceed issuer policy.",
    ),
    RuntimeScenario(
        "C20",
        "blocked",
        lambda client: _demo_scan(
            client,
            {
                "payload": _resolver_url("https://attacker.example/steal"),
                "verified_domains": ["qr.acme.example"],
            },
        ),
        "Open redirect to an unauthorized final host (same check as C6; distinct vector).",
    ),
)


@dataclass(frozen=True)
class Cycle2Scenario:
    """A cycle-2 trust-store failure, anchored to the corpus case that already
    encodes the offline decision for its class. Not a new corpus id: the corpus
    is frozen, and the totality test needs the three tables to cover it exactly.
    """

    cause: str
    anchor_case_id: str
    run: Callable[[TestClient], dict[str, Any]]
    note: str


CYCLE2_TRUST_SCENARIOS: tuple[Cycle2Scenario, ...] = (
    Cycle2Scenario(
        "key-revoked",
        "C9",
        lambda client: _demo_scan(client, {"key_state": "revoked"}),
        "A revoked signing key blocks everything signed under it (spec Q2).",
    ),
    Cycle2Scenario(
        "key-window-mismatch",
        "C9",
        _scan_key_window_mismatch,
        "An artifact issued before the key's not_before is blocked even though "
        "the key is active now (spec Q1, checked against issued_at).",
    ),
    Cycle2Scenario(
        "issuer-record-expired",
        "C10a",
        lambda client: _demo_scan(
            client, {"issuer_record_expires_offset_minutes": -1}
        ),
        "An expired issuer record blocks a still-valid artifact.",
    ),
    Cycle2Scenario(
        "issuer-record-not-yet-valid",
        "C10a",
        _scan_issuer_record_not_yet_valid,
        "An issuer record that is not yet in force blocks like an expired one.",
    ),
)


# Runtime-expressible cases where the two engines are known to disagree today.
# Asserted below in dedicated tests so a fix flips them loudly.
DIVERGENT: dict[str, str] = {
    "C15a": (
        "Unsigned payload with a blocking runtime verdict must block in the "
        "strict profile. The runtime scanner returns 'unverified' for plain "
        "URLs before ever consulting the runtime-safety provider."
    ),
}


OUT_OF_SCOPE: dict[str, str] = {
    "C17": (
        "Blocking a second scan of the same code is not a paper-declared "
        "mechanism, so the runtime has no counterpart to compare against."
    ),
    "C0": (
        "The scanner pipeline begins from a decoded qr_payload string; an "
        "undecodable physical artifact never reaches /scanner/decisions."
    ),
    "C13a": (
        "Offline evidence comes from the qrsafe-pdf colored_overlay_frame "
        "fixture; a framed-overlay PDF scan is outside this suite's "
        "construction scope."
    ),
    "C13b": "Same PDF overlay fixture as C13a, bounded-offline variant.",
    "C16a": (
        "Invalid managed-trust claim requires forging a managed envelope; the "
        "runtime treats payloads that fail envelope decoding as plain-URL "
        "unverified rather than invalid-claim blocked."
    ),
    "C16b": "Reference-testing policy profile has no runtime counterpart.",
    "C19b": "Reference-testing policy profile has no runtime counterpart.",
    "C21a": (
        "Conflicting-QR-symbol placement geometry fixture; multi-symbol scan "
        "images are outside this suite's construction scope."
    ),
    "C21b": "Same multi-symbol fixture as C21a, bounded-offline variant.",
    "C22": "Email attachment container has no scanner API counterpart.",
    "C23a": (
        "Provider-disagreement evidence has no runtime marker; the demo "
        "provider models a single verdict source."
    ),
    "C23b": "Same provider-disagreement evidence class as C23a.",
    "C24a": (
        "The runtime artifact analyzer emits only pass/warn severities; a "
        "fail-tier artifact verdict is not expressible through the scanner "
        "API (D11 fail is unit-tested in test_trust_residuals_evaluation)."
    ),
    "C24b": (
        "Same fail-tier artifact evidence as C24a; per-scan "
        "mandatory_residuals policy additionally has no scanner API "
        "counterpart."
    ),
    "C25a": (
        "Cross-root contradiction evidence has no runtime counterpart; the "
        "scanner consults a single trust record per certificate_ref and "
        "cannot observe two accepted roots disagreeing."
    ),
    "C25b": "Same cross-root contradiction evidence class as C25a, bounded-offline variant.",
}


def test_every_corpus_case_is_classified_exactly_once(offline: dict[str, Any]) -> None:
    corpus_ids = set(offline["cases"])
    in_scope_ids = {scenario.case_id for scenario in IN_SCOPE}
    divergent_ids = set(DIVERGENT)
    out_of_scope_ids = set(OUT_OF_SCOPE)

    assert len(in_scope_ids) == len(IN_SCOPE)
    assert in_scope_ids.isdisjoint(divergent_ids)
    assert in_scope_ids.isdisjoint(out_of_scope_ids)
    assert divergent_ids.isdisjoint(out_of_scope_ids)
    assert in_scope_ids | divergent_ids | out_of_scope_ids == corpus_ids


@pytest.mark.parametrize(
    "scenario",
    IN_SCOPE,
    ids=[scenario.case_id for scenario in IN_SCOPE],
)
def test_runtime_scanner_matches_offline_engine(
    scenario: RuntimeScenario,
    client: TestClient,
    offline: dict[str, Any],
) -> None:
    payload = scenario.run(client)
    assert payload["decision_state"] == scenario.expected_runtime_state, scenario.note

    offline_decision = offline["decisions"][scenario.case_id]
    expected = offline["cases"][scenario.case_id]["expected"]
    assert offline_decision["primary_state"] == expected["primary_state"]

    assert runtime_attention(payload) == offline_decision["attention_level"], (
        f"{scenario.case_id}: runtime {payload['decision_state']!r} maps to "
        f"{runtime_attention(payload)!r} but the offline engine decided "
        f"{offline_decision['primary_state']!r} "
        f"({offline_decision['attention_level']!r}). {scenario.note}"
    )


@pytest.mark.parametrize(
    "scenario",
    CYCLE2_TRUST_SCENARIOS,
    ids=[scenario.cause for scenario in CYCLE2_TRUST_SCENARIOS],
)
def test_cycle2_trust_causes_block_with_anchored_attention(
    scenario: Cycle2Scenario,
    client: TestClient,
    offline: dict[str, Any],
) -> None:
    payload = scenario.run(client)
    assert payload["decision_state"] == "blocked", scenario.note
    assert payload["residual_vector"]["issuer_chain"] == {
        "tier": "revoked-issuer",
        "cause": scenario.cause,
    }, scenario.note

    anchor = offline["decisions"][scenario.anchor_case_id]
    assert anchor["primary_state"] == "blocked"
    assert runtime_attention(payload) == anchor["attention_level"], scenario.note


def test_cycle2_causes_are_the_closed_cycle2_vocabulary() -> None:
    assert {scenario.cause for scenario in CYCLE2_TRUST_SCENARIOS} == {
        "issuer-record-expired",
        "issuer-record-not-yet-valid",
        "key-revoked",
        "key-window-mismatch",
    }


def test_c15a_unsigned_runtime_block_diverges(
    client: TestClient, offline: dict[str, Any]
) -> None:
    offline_decision = offline["decisions"]["C15a"]
    assert offline_decision["primary_state"] == "blocked"
    assert offline_decision["attention_level"] == "block"

    payload = _plain_scan(
        client, "https://login-bank.example.attacker.test/pay?runtime=blocked"
    )
    assert payload["decision_state"] == "unverified", DIVERGENT["C15a"]
    assert runtime_attention(payload) == "neutral"
    assert runtime_attention(payload) != offline_decision["attention_level"]
