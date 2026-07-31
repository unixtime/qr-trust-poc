from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
LAB_CONTROLLER = REPO_ROOT / "frontend" / "src" / "routes" / "lab" / "useLabController.ts"
STATIC_LAB = REPO_ROOT / "backend" / "app" / "static" / "verifier_lab.html"


def test_lab_key_issuance_uses_management_verifier_client_endpoint() -> None:
    source = LAB_CONTROLLER.read_text(encoding="utf-8")

    assert '"/admin/verifier-clients/api-keys/issue"' in source
    assert '"/verifier/admin/api-keys/issue"' not in source
    assert "ManagementApiKeyIssueResponse" in source


def test_static_lab_key_management_uses_management_verifier_client_endpoints() -> None:
    source = STATIC_LAB.read_text(encoding="utf-8")

    assert '"/admin/verifier-clients/api-keys"' in source
    assert '"/admin/verifier-clients/api-keys/issue"' in source
    assert "/admin/verifier-clients/api-keys/${keyId}/revoke" in source
    assert "/verifier/admin/api-keys" not in source
