"""Generate safe, local source views for repository links in MkDocs pages.

MkDocs intentionally publishes only ``docs_dir``. Public documentation in this
repository also links to implementation files outside that directory. This
hook records the Markdown pages MkDocs actually renders, resolves their local
repository links, enforces the public-release source boundary, and creates
read-only source pages at the paths those links already address.
"""

from __future__ import annotations

import html
import logging
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import TextLexer, get_lexer_for_filename
from pygments.util import ClassNotFound

LOG = logging.getLogger("mkdocs.hooks.source-pages")

_RENDERED_MARKDOWN: set[Path] = set()
_MARKDOWN_LINK = re.compile(
    r"(?<!!)\[[^\]]+\]\(\s*(?P<target><[^>]+>|[^\s)]+)(?:\s+['\"][^'\"]*['\"])?\s*\)"
)
_ALLOWED_PREFIXES = (
    Path("backend"),
    Path("frontend"),
    Path("network"),
    Path("ios/VerifierLabApp"),
    Path("scripts"),
)
_ALLOWED_ROOT_FILES = {
    Path("CITATION.cff"),
    Path("CONTRIBUTING.md"),
    Path("LICENSE"),
    Path("Makefile"),
    Path("NOTICE"),
    Path("README.md"),
    Path("ROADMAP.md"),
    Path("SECURITY.md"),
    Path("SUPPORT.md"),
}
_MAX_SOURCE_BYTES = 2_000_000


def on_pre_build(*, config, **kwargs) -> None:  # noqa: ARG001
    """Clear module state when a long-running MkDocs process rebuilds."""

    _RENDERED_MARKDOWN.clear()


def on_page_markdown(markdown, *, page, config, files):  # noqa: ARG001
    """Record only pages that MkDocs selected for this build."""

    source = getattr(page.file, "abs_src_path", None)
    if source:
        _RENDERED_MARKDOWN.add(Path(source).resolve())
    return markdown


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _is_public_source(relative_path: Path) -> bool:
    if relative_path in _ALLOWED_ROOT_FILES:
        return True
    return any(
        relative_path == prefix or _is_within(relative_path, prefix)
        for prefix in _ALLOWED_PREFIXES
    )


def _linked_public_sources(repo_root: Path, docs_root: Path) -> set[Path]:
    targets: set[Path] = set()

    for markdown_path in sorted(_RENDERED_MARKDOWN):
        source = markdown_path.read_text(encoding="utf-8")
        for match in _MARKDOWN_LINK.finditer(source):
            raw_target = match.group("target").strip("<>")
            parsed = urlsplit(raw_target)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue

            target = (markdown_path.parent / unquote(parsed.path)).resolve()
            if _is_within(target, docs_root):
                continue
            if not _is_within(target, repo_root):
                raise RuntimeError(
                    f"documentation link escapes the repository: {markdown_path}: {raw_target}"
                )

            relative_target = target.relative_to(repo_root)
            if not _is_public_source(relative_target):
                raise RuntimeError(
                    "documentation link is outside the public source-view boundary: "
                    f"{markdown_path}: {relative_target}"
                )
            if not target.exists():
                raise RuntimeError(
                    f"documentation source link target does not exist: {relative_target}"
                )
            targets.add(target)

    # A component-directory page is more useful when its README is available.
    for directory in [target for target in targets if target.is_dir()]:
        readme = directory / "README.md"
        if readme.is_file() and _is_public_source(readme.relative_to(repo_root)):
            targets.add(readme)

    return targets


def _root_href(relative_path: Path) -> str:
    return "../" * len(relative_path.parts)


def _page_shell(*, title: str, eyebrow: str, relative_path: Path, body: str) -> str:
    formatter = HtmlFormatter(cssclass="source-highlight")
    syntax_css = formatter.get_style_defs(".source-highlight")
    safe_title = html.escape(title)
    safe_eyebrow = html.escape(eyebrow)
    safe_path = html.escape(relative_path.as_posix())
    home_href = html.escape(_root_href(relative_path), quote=True)

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
  <title>{safe_title} · QR Trust PoC source</title>
  <style>
    :root {{ color-scheme: light; --ink:#172033; --muted:#64748b; --line:#d8e0eb; --accent:#2563eb; }}
    * {{ box-sizing:border-box; }}
    body {{ margin:0; background:#f4f7fb; color:var(--ink); font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }}
    header {{ position:sticky; top:0; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:2rem; padding:1rem clamp(1rem,4vw,3rem); border-bottom:1px solid #2a3549; background:#121b2c; color:#f8fafc; }}
    .identity {{ min-width:0; }}
    .eyebrow {{ color:#7db0ff; font-size:.7rem; font-weight:750; letter-spacing:.12em; text-transform:uppercase; }}
    h1 {{ overflow:hidden; margin:.15rem 0 0; font-size:clamp(1rem,2vw,1.35rem); line-height:1.25; text-overflow:ellipsis; white-space:nowrap; }}
    .home {{ flex:0 0 auto; padding:.55rem .8rem; border:1px solid #506078; border-radius:7px; color:#e7edf6; font-size:.82rem; font-weight:650; text-decoration:none; }}
    .home:hover,.home:focus-visible {{ border-color:#8aa0c2; background:#1d2a40; outline:none; }}
    main {{ width:min(100% - 2rem, 112rem); margin:1.5rem auto 3rem; }}
    .meta {{ display:flex; flex-wrap:wrap; gap:.55rem; margin:0 0 1rem; }}
    .pill {{ padding:.3rem .55rem; border:1px solid var(--line); border-radius:999px; background:#fff; color:var(--muted); font:600 .72rem/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; }}
    .source-card,.directory-card {{ overflow:hidden; border:1px solid var(--line); border-radius:10px; background:#fff; box-shadow:0 14px 34px rgb(23 32 51 / 8%); }}
    .source-highlight {{ margin:0; overflow:auto; background:#fbfcfe; }}
    .source-highlight table {{ width:100%; border-spacing:0; }}
    .source-highlight td {{ padding:0; vertical-align:top; }}
    .source-highlight .linenos {{ min-width:3.5rem; padding:.9rem .75rem; border-right:1px solid var(--line); background:#f0f4f8; color:#8290a3; text-align:right; user-select:none; }}
    .source-highlight pre {{ margin:0; padding:.9rem 1rem; font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; tab-size:4; }}
    .directory-card {{ padding:1.25rem; }}
    .directory-card h2 {{ margin:0 0 .4rem; font-size:1rem; }}
    .directory-card p {{ margin:.2rem 0 1rem; color:var(--muted); }}
    .directory-card ul {{ display:grid; gap:.45rem; margin:0; padding:0; list-style:none; }}
    .directory-card a {{ display:block; padding:.65rem .75rem; border:1px solid var(--line); border-radius:7px; color:var(--accent); font:600 .82rem/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; text-decoration:none; }}
    .directory-card a:hover,.directory-card a:focus-visible {{ border-color:#93b4ee; background:#f3f7ff; outline:none; }}
    {syntax_css}
  </style>
</head>
<body>
  <header>
    <div class="identity"><div class="eyebrow">{safe_eyebrow}</div><h1>{safe_path}</h1></div>
    <a class="home" href="{home_href}">Documentation home</a>
  </header>
  <main>{body}</main>
</body>
</html>
"""


def _source_page(source_path: Path, relative_path: Path) -> str:
    size = source_path.stat().st_size
    if size > _MAX_SOURCE_BYTES:
        raise RuntimeError(
            f"referenced source file exceeds {_MAX_SOURCE_BYTES} bytes: {relative_path}"
        )

    try:
        source = source_path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeError(f"referenced source file is not UTF-8 text: {relative_path}") from exc

    try:
        lexer = get_lexer_for_filename(source_path.name, source)
    except ClassNotFound:
        lexer = TextLexer()

    formatter = HtmlFormatter(cssclass="source-highlight", linenos="table")
    highlighted = highlight(source, lexer, formatter)
    line_count = source.count("\n") + (1 if source else 0)
    meta = (
        '<div class="meta">'
        f'<span class="pill">{line_count:,} lines</span>'
        f'<span class="pill">{size:,} bytes</span>'
        '<span class="pill">read-only generated view</span>'
        "</div>"
    )
    return _page_shell(
        title=source_path.name,
        eyebrow="Public source file",
        relative_path=relative_path,
        body=meta + f'<section class="source-card" aria-label="Source code">{highlighted}</section>',
    )


def _directory_page(
    directory: Path,
    relative_path: Path,
    targets: set[Path],
) -> str:
    descendants = sorted(
        target.relative_to(directory)
        for target in targets
        if target.is_file() and _is_within(target, directory)
    )
    items = "".join(
        f'<li><a href="{html.escape(descendant.as_posix(), quote=True)}/">'
        f"{html.escape(descendant.as_posix())}</a></li>"
        for descendant in descendants
    )
    if not items:
        items = "<li>No individual files from this directory are referenced by the rendered documentation.</li>"

    body = (
        '<section class="directory-card">'
        "<h2>Referenced implementation files</h2>"
        "<p>This index exposes only public source files referenced by the generated documentation.</p>"
        f"<ul>{items}</ul></section>"
    )
    return _page_shell(
        title=directory.name,
        eyebrow="Public source directory",
        relative_path=relative_path,
        body=body,
    )


def on_post_build(*, config, **kwargs) -> None:
    """Write source pages after MkDocs has completed its normal output."""

    repo_root = Path(__file__).resolve().parents[2]
    docs_root = Path(config.docs_dir).resolve()
    site_root = Path(config.site_dir).resolve()
    targets = _linked_public_sources(repo_root, docs_root)

    for target in sorted(targets):
        relative_path = target.relative_to(repo_root)
        output_dir = site_root / relative_path
        output_dir.mkdir(parents=True, exist_ok=True)
        if target.is_dir():
            output = _directory_page(target, relative_path, targets)
        else:
            output = _source_page(target, relative_path)
        (output_dir / "index.html").write_text(output, encoding="utf-8")

    LOG.info("Generated %d public source-view routes", len(targets))
