from __future__ import annotations

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_release_audit_rejects_obsolete_publication_state() -> None:
    release_audit = (REPO_ROOT / "scripts" / "public_release_audit.sh").read_text(
        encoding="utf-8"
    )

    assert "stale_publication_state_matches" in release_audit
    assert "docs/public/RELEASE_CANDIDATE_STATUS.md" in release_audit
    assert "docs/public/PUBLIC_RELEASE_CHECKLIST.md" in release_audit
    assert "private pre-publication review" in release_audit
    assert "no public GitHub repository" in release_audit
    assert "stale publication-state scan failed" in release_audit
    assert "public-release lifecycle wording matches" in release_audit


def test_release_audit_rejects_obsolete_public_claims() -> None:
    release_audit = (REPO_ROOT / "scripts" / "public_release_audit.sh").read_text(
        encoding="utf-8"
    )

    assert "stale_public_claims_matches" in release_audit
    assert "replay control" in release_audit
    assert "replay protection" in release_audit
    assert "Redis replay" in release_audit
    assert "The current iOS harness is not yet an end-user scanner" in release_audit
    assert "not yet connected through production Postgres migrations" in release_audit
    assert "release-candidate status" in release_audit
    assert "preparation guide for a paper-companion repository surface" in release_audit
    assert "docs/public/OPEN_SOURCE_DIRECTION.md" in release_audit
    assert "public-claim consistency scan failed" in release_audit
    assert "public orientation claims match" in release_audit


def test_release_audit_cross_checks_citation_snapshot_metadata() -> None:
    release_audit = (REPO_ROOT / "scripts" / "public_release_audit.sh").read_text(
        encoding="utf-8"
    )

    assert 'heading "Published Metadata Coherence"' in release_audit
    assert "citation_version_count" in release_audit
    assert "citation_release_date_count" in release_audit
    assert "CITATION.cff version is not identified" in release_audit
    assert "CITATION.cff release date does not match" in release_audit
    assert "citation version matches" in release_audit
    assert "citation release date matches" in release_audit
