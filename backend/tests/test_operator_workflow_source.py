from __future__ import annotations

import re
from pathlib import Path

from backend.app.schemas.management_contracts import (
    DELEGATED_AUTHORITY_ID_PATTERN,
    DESTINATION_POLICY_ID_PATTERN,
    ISSUER_ID_PATTERN,
    ROOT_PROGRAM_ID_PATTERN,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
OPERATOR_ROUTE = REPO_ROOT / "frontend" / "src" / "routes" / "operator"


def _form_constant(form_source: str, name: str) -> str:
    match = re.search(rf'^const {name} = "([^"]+)"$', form_source, re.MULTILINE)
    assert match is not None, f"{name} is not a top-level string constant"
    return match.group(1)


def test_operator_surface_exposes_runtime_provider_management_workflow() -> None:
    section_source = (
        OPERATOR_ROUTE / "components" / "ManagementWorkflowSection.tsx"
    ).read_text()
    form_source = (
        OPERATOR_ROUTE / "components" / "ManagementWorkflowForms.tsx"
    ).read_text()
    controller_source = (OPERATOR_ROUTE / "useOperatorController.ts").read_text()

    assert 'id: "runtime-providers"' in section_source
    assert "POST /admin/runtime-providers" in section_source
    assert "RuntimeProviderForm" in form_source
    assert 'props.workflowId === "runtime-providers"' in form_source
    assert 'workflowId === "runtime-providers"' in controller_source
    assert '"/admin/runtime-providers"' in controller_source
    assert "ManagementRuntimeProviderListResponse" in controller_source
    assert "runtimeProviders" in section_source


def test_operator_surface_exposes_trust_key_management_workflow() -> None:
    section_source = (
        OPERATOR_ROUTE / "components" / "ManagementWorkflowSection.tsx"
    ).read_text()
    form_source = (
        OPERATOR_ROUTE / "components" / "ManagementWorkflowForms.tsx"
    ).read_text()
    controller_source = (OPERATOR_ROUTE / "useOperatorController.ts").read_text()
    client_source = (
        REPO_ROOT / "frontend" / "src" / "lib" / "verifier-client.ts"
    ).read_text()

    assert 'id: "trust-keys"' in section_source
    assert "POST /admin/trust-keys" in section_source
    assert "trust_key.upserted" in section_source
    assert "TrustKeyForm" in form_source
    assert 'props.workflowId === "trust-keys"' in form_source
    assert 'workflowId === "trust-keys"' in controller_source
    assert '"/admin/trust-keys"' in controller_source
    assert '"/admin/trust-keys/status"' in controller_source
    assert "TrustKeyMutationResponse" in controller_source
    assert "TrustKeyMutationResponse" in client_source


def test_operator_trust_key_form_sends_timezone_aware_validity_windows() -> None:
    form_source = (
        OPERATOR_ROUTE / "components" / "ManagementWorkflowForms.tsx"
    ).read_text()

    assert "function datetimeLocalToIsoUtc" in form_source
    assert "not_before: datetimeLocalToIsoUtc(notBefore)" in form_source
    assert "not_after: datetimeLocalToIsoUtc(notAfter)" in form_source
    assert "toISOString()" in form_source


def test_operator_form_default_ids_satisfy_the_governance_id_contract() -> None:
    """The form's prefilled ids must clear the same patterns the API enforces.

    Regression test. These defaults once shipped unprefixed ("qr-trust-local",
    "acme-local-authority"), which the management API accepted and only the
    outbox publisher rejected — so submitting a stock form produced a
    retry-exhausted outbox row instead of a validation error. The patterns are
    imported rather than restated so this cannot drift from the API's rule.
    """
    form_source = (
        OPERATOR_ROUTE / "components" / "ManagementWorkflowForms.tsx"
    ).read_text()

    for constant, pattern in (
        ("defaultRootProgramId", ROOT_PROGRAM_ID_PATTERN),
        ("defaultDelegatedAuthorityId", DELEGATED_AUTHORITY_ID_PATTERN),
        ("defaultIssuerId", ISSUER_ID_PATTERN),
        ("defaultDestinationPolicyId", DESTINATION_POLICY_ID_PATTERN),
    ):
        value = _form_constant(form_source, constant)
        assert re.match(pattern, value), f"{constant}={value!r} violates {pattern}"

    # Every form reads its ids from those four constants; a literal id inline in
    # a useState call is how the destination-policy forms drifted, since only
    # one of the two duplicates would ever get corrected.
    assert '"acme-demo-policy"' not in form_source
    assert '"acme-local-authority"' not in form_source


def test_operator_form_defaults_match_the_seeded_demo_ids() -> None:
    """Passing the id patterns is necessary but not sufficient.

    Root program ids are additionally checked against the
    QRTRUST_ACCEPTED_ROOT_PROGRAM_IDS trust anchor allowlist downstream, so a
    well-formed id naming a program nobody seeded still fails — one hop later
    than before, at the governance subscriber. Pinning the form to
    `qrtrustctl demo-bootstrap` keeps the two producers of these ids in step and
    means the forms open against rows that already exist.
    """
    from backend.scripts import qrtrustctl

    form_source = (
        OPERATOR_ROUTE / "components" / "ManagementWorkflowForms.tsx"
    ).read_text()
    seeded = qrtrustctl.build_parser().parse_args(["demo-bootstrap"])

    assert _form_constant(form_source, "defaultRootProgramId") == (
        seeded.root_program_id
    )
    authority_id = _form_constant(form_source, "defaultDelegatedAuthorityId")
    assert authority_id == seeded.delegated_authority_id
    assert _form_constant(form_source, "defaultIssuerId") == seeded.issuer_id
    assert _form_constant(form_source, "defaultDomain") == seeded.domain

    # The trust key id embeds the authority it signs for, so it has to move
    # whenever the authority default does.
    key_id = re.search(r'keyId: "([^"]+)"', form_source)
    assert key_id is not None
    assert key_id.group(1).startswith(f"key:{authority_id}:")
