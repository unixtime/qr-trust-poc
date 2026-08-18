"""Resolve every link in the built documentation tree against that tree.

MkDocs checks links whose targets live under ``docs_dir``. The source-view
routes that ``mkdocs_source_pages`` generates do not exist until the build has
written them, so MkDocs files links to them under ``unrecognized_links`` and
cannot say whether they resolve. Those are exactly the links that broke: every
policy link leaving ``docs/README.md`` pointed one directory too high, the
built pages shipped it, and the build stayed green.

Checking the built tree closes that gap, because by then the generated routes
are real files. Walking ``site/`` rather than following links from the home
page also reaches the pages nothing links to -- roughly a third of the tree,
whose links a crawler never sees at all.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from posixpath import dirname, join, normpath

REPO_ROOT = Path(__file__).resolve().parents[2]
MKDOCS_CONFIG = REPO_ROOT / "mkdocs.yml"

ANCHOR = re.compile(r'<a[^>]*href="([^"]+)"')
ELEMENT_ID = re.compile(r'\s(?:id|name)="([^"]+)"')
# Anything with a scheme, a protocol-relative host, or a bare fragment is not
# this tree's to resolve.
EXTERNAL = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//|#)", re.IGNORECASE)


def site_mount() -> str:
    """The URL path the built tree is served at, per ``site_url``.

    404.html is the one page MkDocs renders with absolute links, because it
    has to work at any URL. Resolving those against the wrong mount point
    would report every link on it as dead. Read from the config rather than
    hardcoded so moving the site off /docs/ cannot silently blind this check.
    """

    match = re.search(r"^site_url:\s*(\S+)", MKDOCS_CONFIG.read_text(encoding="utf-8"), re.M)
    if not match:
        raise SystemExit(f"no site_url in {MKDOCS_CONFIG}")
    path = re.sub(r"^https?://[^/]+", "", match.group(1))
    return path.rstrip("/")


class SiteTree:
    def __init__(self, site_dir: Path, mount: str) -> None:
        self.root = site_dir.resolve()
        self.mount = mount
        self._anchors: dict[Path, set[str]] = {}

    def pages(self) -> list[Path]:
        return sorted(self.root.rglob("*.html"))

    def url_of(self, page: Path) -> str:
        """The URL a built file is served at: site/a/index.html -> /docs/a/."""

        rel = page.relative_to(self.root).as_posix()
        if rel.endswith("index.html"):
            rel = rel[: -len("index.html")]
        return f"{self.mount}/{rel}"

    def _within_mount(self, url_path: str) -> str | None:
        """The tree-relative part of a URL, or None if it points off the tree."""

        if not f"{url_path}/".startswith(f"{self.mount}/"):
            return None
        return url_path[len(self.mount) :].lstrip("/")

    def file_serving(self, url_path: str) -> Path | None:
        """The file answering a URL, or None when nothing in the tree does."""

        rel = self._within_mount(url_path)
        if rel is None:
            return None
        if url_path.endswith("/") or not rel:
            return self.root / rel / "index.html"
        # A slash-less URL naming a directory is served by a redirect at best,
        # and browsers resolve its relative links one level too high -- the
        # same failure this whole check exists for. Do not quietly accept the
        # index page behind it; directory_index reports it as its own class.
        candidate = self.root / rel
        return candidate if candidate.is_file() else None

    def directory_index(self, url_path: str) -> Path | None:
        """The page a slash-less URL would have reached had it had its slash."""

        rel = self._within_mount(url_path)
        if rel is None or url_path.endswith("/"):
            return None
        candidate = self.root / rel / "index.html"
        return candidate if candidate.is_file() else None

    def anchors(self, page: Path) -> set[str]:
        if page not in self._anchors:
            self._anchors[page] = set(ELEMENT_ID.findall(page.read_text("utf-8", "replace")))
        return self._anchors[page]


def check(site_dir: Path) -> int:
    tree = SiteTree(site_dir, site_mount())
    pages = tree.pages()
    if not pages:
        raise SystemExit(f"no built pages under {site_dir} -- run `make docs-build` first")

    dead: list[tuple[str, str, str]] = []
    dead_anchor: list[tuple[str, str, str]] = []
    slashless: list[tuple[str, str, str]] = []

    for page in pages:
        source = tree.url_of(page)
        for href in ANCHOR.findall(page.read_text("utf-8", "replace")):
            if EXTERNAL.match(href):
                continue
            path, _, fragment = href.partition("#")
            path = path.split("?")[0]
            if not path:
                continue
            resolved = normpath(join(dirname(source), path))
            # normpath eats the trailing slash that decides how a browser
            # resolves the next link along, so put it back.
            if path.endswith("/") and not resolved.endswith("/"):
                resolved += "/"

            target = tree.file_serving(resolved)
            if target is not None and target.is_file():
                if fragment and fragment not in tree.anchors(target):
                    dead_anchor.append((source, href, resolved))
            elif tree.directory_index(resolved) is not None:
                slashless.append((source, href, resolved))
            else:
                dead.append((source, href, resolved))

    failures = 0
    for label, rows in (
        ("dead targets", dead),
        ("dead anchors", dead_anchor),
        ("directory links missing a trailing slash", slashless),
    ):
        if not rows:
            continue
        failures += len(rows)
        print(f"\n{len(rows)} {label}:", file=sys.stderr)
        for source, href, resolved in rows:
            print(f"  {resolved}\n      href={href!r} on {source}", file=sys.stderr)

    if failures:
        print(f"\n{failures} broken links across {len(pages)} built pages", file=sys.stderr)
        return 1

    print(f"All links resolve across {len(pages)} built pages.")
    return 0


if __name__ == "__main__":
    raise SystemExit(check(Path(sys.argv[1] if len(sys.argv) > 1 else "site")))
