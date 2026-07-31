from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_python_verifier_lab_stability_gate_is_wired() -> None:
    makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
    release_audit = (REPO_ROOT / "scripts" / "public_release_audit.sh").read_text(
        encoding="utf-8"
    )

    assert "check-python-verifier-lab-stability:" in makefile
    target_start = makefile.index("check-python-verifier-lab-stability:")
    target_end = makefile.find("\n\n", target_start)
    target_body = makefile[target_start:target_end]

    assert "tests/test_verifier_api.py" in target_body
    assert "tests/test_lab_source.py" in target_body
    assert "$(MAKE) check-frontend-scanner-contract" in target_body
    assert "$(MAKE) check-frontend-scanner-open-contract" in target_body
    assert "check-python-verifier-lab-stability" in release_audit
