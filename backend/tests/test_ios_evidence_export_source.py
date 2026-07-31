from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
CONTENT_VIEW = REPO_ROOT / "ios" / "VerifierLabApp" / "VerifierLabApp" / "ContentView.swift"
EVIDENCE_EXPORT = (
    REPO_ROOT / "ios" / "VerifierLabApp" / "VerifierLabApp" / "EvidenceExport.swift"
)


def test_ios_evidence_export_shares_one_folder() -> None:
    source = CONTENT_VIEW.read_text(encoding="utf-8")

    assert "EvidenceShareSheet(activityItems: [package.directoryURL])" in source
    assert "EvidenceShareSheet(activityItems: package.fileURLs)" not in source


def test_ios_evidence_export_readme_points_to_combined_importer() -> None:
    source = EVIDENCE_EXPORT.read_text(encoding="utf-8")

    assert (
        "make import-scanner-release-evidence-export "
        "SCANNER_RELEASE_EVIDENCE_SOURCE_DIR=<synced-folder>"
    ) in source
    assert (
        "make import-iphone-evidence IPHONE_EVIDENCE_SOURCE_DIR=<synced-folder>"
    ) not in source
