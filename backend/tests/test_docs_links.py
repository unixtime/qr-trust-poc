"""Guard the two halves of the repo-link rewrite in the docs build.

The links that broke were correct in the Markdown -- ``../SECURITY.md`` is how
you reach the policy from ``docs/README.md`` when browsing the repository --
and wrong in the built site, because that README publishes at the site root
rather than one level down. Only the hook can tell the two apart, so these
tests pin the depth it computes, and prove the build-time checker actually
catches the failure rather than reporting a vacuous zero.
"""

from __future__ import annotations

import posixpath
from pathlib import Path

# conftest.py puts the repository root on sys.path, which is what makes
# backend.scripts importable here without an __init__.py.
from backend.scripts.check_docs_links import check
from backend.scripts.mkdocs_source_pages import _published_href

REPO_ROOT = Path(__file__).resolve().parents[2]
DOCS_README = REPO_ROOT / "docs" / "README.md"


def _browser_resolves(page_url: str, href: str) -> str:
    """Where a browser on ``page_url`` lands after following ``href``."""

    return posixpath.normpath(posixpath.join(posixpath.dirname(page_url), href)) + "/"


def test_published_href_lands_on_the_generated_route() -> None:
    # Whatever depth the page sits at, the href has to arrive at the route the
    # same build generates -- this is the property the whole rewrite exists for.
    for page_url in ("", "public/CITING/", "public/evidence/", "public/evidence/manifest/"):
        href = _published_href(Path("SECURITY.md"), page_url)

        assert _browser_resolves(page_url, href) == "SECURITY.md/"


def test_readme_and_sibling_need_different_depths() -> None:
    # Both files sit in docs/public/evidence/, so both spell the repo root
    # ../../../ on disk. The README collapses into its own directory when
    # published and the other page does not, so the built hrefs must differ --
    # no single Markdown spelling can be right for the repo and the site both.
    readme = _published_href(Path("SECURITY.md"), "public/evidence/")
    sibling = _published_href(Path("SECURITY.md"), "public/evidence/manifest/")

    assert readme == "../../SECURITY.md/"
    assert sibling == "../../../SECURITY.md/"


def test_docs_home_reaches_repo_root_without_climbing() -> None:
    # docs/README.md publishes at the site root, so the ../ its Markdown needs
    # for repository browsing is exactly one level too many on the site. This
    # is the link that shipped broken.
    assert _published_href(Path("SECURITY.md"), "") == "SECURITY.md/"


def test_docs_home_policy_links_point_at_real_files() -> None:
    source = DOCS_README.read_text(encoding="utf-8")

    for policy in ("SECURITY.md", "CONTRIBUTING.md", "SUPPORT.md", "ROADMAP.md"):
        assert f"(../{policy})" in source, f"docs/README.md no longer links {policy}"
        assert (REPO_ROOT / policy).is_file(), f"{policy} is linked but missing"


def _built_site(root: Path, home_href: str) -> Path:
    """A miniature built tree: a home page linking one generated source route."""

    site = root / "site"
    (site / "SECURITY.md").mkdir(parents=True)
    (site / "index.html").write_text(f'<a href="{home_href}">Security policy</a>', encoding="utf-8")
    (site / "SECURITY.md" / "index.html").write_text(
        '<h1 id="security-policy">Security policy</h1>', encoding="utf-8"
    )
    return site


def test_checker_passes_a_tree_whose_links_resolve(tmp_path: Path) -> None:
    assert check(_built_site(tmp_path, "SECURITY.md/")) == 0
    assert check(_built_site(tmp_path / "anchored", "SECURITY.md/#security-policy")) == 0
    assert check(_built_site(tmp_path / "external", "https://example.com/gone")) == 0


def test_checker_catches_the_link_that_shipped_broken(tmp_path: Path) -> None:
    # The pre-fix spelling: one ../ too many, landing above the site root.
    assert check(_built_site(tmp_path, "../SECURITY.md/")) == 1


def test_checker_catches_dead_anchors_and_missing_trailing_slashes(tmp_path: Path) -> None:
    assert check(_built_site(tmp_path, "SECURITY.md/#no-such-heading")) == 1
    # Without the slash a browser treats the last segment as a file, and every
    # relative link on the page it redirects to resolves one level too high.
    assert check(_built_site(tmp_path / "slashless", "SECURITY.md")) == 1
