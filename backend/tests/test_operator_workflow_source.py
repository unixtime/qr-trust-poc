from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
OPERATOR_ROUTE = REPO_ROOT / "frontend" / "src" / "routes" / "operator"


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
