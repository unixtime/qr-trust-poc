"""Redirect policy: no fail-open — an unobserved final destination is unknown."""

import json
from pathlib import Path
from types import SimpleNamespace

from backend.app.api.endpoints.verifier import (
    _entry,
    _residual_vector_for_result,
    _scanner_primary_message,
)
from backend.app.services.redirect_policy_poc import (
    RedirectPolicyVerdict,
    evaluate_redirect_policy,
)

RESOLVER = "https://qr.acme.example/r/pay"
FINAL = "https://acme.example/pay"


def _write_policy(tmp_path: Path) -> Path:
    doc = {
        "redirect_policy": {
            "resolver_urls": [RESOLVER],
            "expected_final_destinations": [FINAL],
            "allowed_redirect_hosts": ["acme.example"],
            "max_redirect_hops": 2,
            "nested_shorteners_allowed": False,
        }
    }
    (tmp_path / "destination-policy.json").write_text(json.dumps(doc), encoding="utf-8")
    return tmp_path


def test_missing_final_is_unknown_and_fails_closed(tmp_path):
    verdict = evaluate_redirect_policy(RESOLVER, fixture_dir=_write_policy(tmp_path))
    assert verdict.state == "unknown"
    assert verdict.cause == "redirect-unobserved"
    assert verdict.open_allowed is False
    assert verdict.final_url is None
    assert verdict.is_blocked is True


def test_observed_final_still_binds(tmp_path):
    payload = RESOLVER + "?final=https%3A%2F%2Facme.example%2Fpay"
    verdict = evaluate_redirect_policy(payload, fixture_dir=_write_policy(tmp_path))
    assert verdict.state == "bound"
    assert verdict.open_allowed is True
    assert verdict.final_url == FINAL
    assert verdict.cause is None


def test_off_policy_final_still_blocks(tmp_path):
    payload = RESOLVER + "?final=https%3A%2F%2F203.0.113.9%2Fpay"
    verdict = evaluate_redirect_policy(payload, fixture_dir=_write_policy(tmp_path))
    assert verdict.state == "blocked"
    assert verdict.open_allowed is False


def test_non_enrolled_resolver_is_not_applicable(tmp_path):
    verdict = evaluate_redirect_policy(
        "https://other.example/x", fixture_dir=_write_policy(tmp_path)
    )
    assert verdict.state == "not_applicable"
    assert verdict.open_allowed is True


def _verdict(state: str, *, open_allowed: bool, cause: str | None = None) -> RedirectPolicyVerdict:
    return RedirectPolicyVerdict(
        state=state,
        resolver_url=RESOLVER,
        final_url=None if state == "unknown" else FINAL,
        hop_count=1,
        reason="test verdict",
        open_allowed=open_allowed,
        effective_url=RESOLVER,
        policy_label="resolver_to_final:max_2_hops",
        cause=cause,
    )


# SimpleNamespace stands in for NarrowedVerifierResponse: on these paths the
# helpers read only .allowed / .stage. If an AttributeError surfaces, extend
# the stub with the missing field rather than building the full model.

def test_primary_message_for_unknown_redirect():
    message = _scanner_primary_message(
        SimpleNamespace(allowed=True),
        redirect_verdict=_verdict("unknown", open_allowed=False, cause="redirect-unobserved"),
    )
    assert message == (
        "Resolver unresolved. The final destination of the redirect flow was not observed."
    )


def test_residual_vector_redirect_three_way():
    result = SimpleNamespace(allowed=True, stage="accepted")

    def vector(verdict):
        return _residual_vector_for_result(
            result,
            redirect_verdict=verdict,
            runtime_verdict=None,
            artifact_analysis=None,
        )

    unknown = vector(_verdict("unknown", open_allowed=False, cause="redirect-unobserved"))
    assert unknown["redirect_flow"] == _entry("fail", "redirect-unobserved")

    blocked = vector(_verdict("blocked", open_allowed=False))
    assert blocked["redirect_flow"] == _entry("fail", "redirect-policy-blocked")

    bound = vector(_verdict("bound", open_allowed=True))
    assert bound["redirect_flow"] == _entry("pass")
