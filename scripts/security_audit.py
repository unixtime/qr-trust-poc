#!/usr/bin/env python3
"""Judge a bandit or semgrep JSON report and fail on anything short of a clean scan."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    args = parse_args()

    try:
        report = json.loads(args.report.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        # Both scanners write JSON to a file that a non-quiet run corrupts with
        # progress output, and both still exit 0 when they do. An unreadable
        # report means no verdict was produced, so it fails here rather than
        # passing silently -- that is exactly how a gate becomes a no-op.
        print(f"FAIL: cannot read {args.report}: {exc}", file=sys.stderr)
        if args.tool_status != 0:
            print(f"FAIL: {args.command} exited {args.tool_status}", file=sys.stderr)
        return 1

    failures = check_bandit(report, args) if args.command == "bandit" else check_semgrep(report, args)

    if args.tool_status != 0:
        failures.insert(0, f"{args.command} exited {args.tool_status}")

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    return 0


def check_bandit(report: dict, args: argparse.Namespace) -> list[str]:
    failures: list[str] = []
    totals = report.get("metrics", {}).get("_totals", {})

    for result in report.get("results", []):
        failures.append(
            f"{result.get('test_id')} {result.get('issue_severity')}/"
            f"{result.get('issue_confidence')} at {result.get('filename')}:"
            f"{result.get('line_number')}: {result.get('issue_text')}"
        )

    # _totals is flat with dotted keys -- "SEVERITY.HIGH", not a nested SEVERITY
    # mapping. Indexing it the nested way raises KeyError instead of reporting a
    # clean scan, which is why every key is spelled out. The counters are a
    # cross-check on the results array above: a truncated report would show zero
    # results while the totals still remember what was found.
    for key in ("SEVERITY.HIGH", "SEVERITY.MEDIUM", "SEVERITY.LOW", "SEVERITY.UNDEFINED"):
        count = totals.get(key, 0)
        if count:
            failures.append(f"bandit counted {count} findings at {key}")

    # nosec counts blanket markers; skipped_tests counts id-scoped ones. A gate
    # asserting only "no findings" would accept a blanket `# nosec` on every one
    # of them and still report clean, so blanket markers are banned outright and
    # the id-scoped count is pinned to a reviewed baseline.
    nosec = totals.get("nosec", 0)
    if nosec:
        failures.append(
            f"{nosec} blanket `# nosec` markers; every suppression must name its test id"
        )

    skipped = totals.get("skipped_tests", 0)
    if skipped != args.expected_skips:
        failures.append(
            f"{skipped} id-scoped suppressions, expected {args.expected_skips}; "
            "read the new marker and move BANDIT_EXPECTED_SKIPS deliberately"
        )

    # A scan that matches no files exits 0 with no findings. The floor is what
    # separates "clean" from "never looked".
    loc = totals.get("loc", 0)
    if loc < args.min_loc:
        failures.append(
            f"bandit scanned {loc} lines, below the {args.min_loc} floor -- the scan scope collapsed"
        )

    if not failures:
        print(
            f"PASS: bandit clean over {loc} lines, "
            f"{skipped} id-scoped suppressions, 0 blanket."
        )
    return failures


def check_semgrep(report: dict, args: argparse.Namespace) -> list[str]:
    failures: list[str] = []

    for result in report.get("results", []):
        extra = result.get("extra") or {}
        start = result.get("start") or {}
        failures.append(
            f"{result.get('check_id')} at {result.get('path')}:{start.get('line')}: "
            f"{first_line(extra.get('message'))}"
        )

    # Same false-clean guard as bandit's loc floor. semgrep limits itself to
    # git-tracked files, so a checkout that lost its history scans nothing.
    scanned = len((report.get("paths") or {}).get("scanned") or [])
    if scanned < args.min_targets:
        failures.append(
            f"semgrep scanned {scanned} targets, below the {args.min_targets} floor "
            "-- the scan scope collapsed"
        )

    # Errors are not findings, but they hide them: three Pro-only rules once
    # crashed the matcher 600 times and took real analysis down with them, 8
    # reported where 16 existed. The cap keeps lost coverage loud rather than
    # letting it read as a clean scan.
    errors = (report.get("errors") or [])
    if len(errors) > args.max_errors:
        failures.append(
            f"semgrep reported {len(errors)} errors, above the {args.max_errors} cap; "
            "a crashing rule silently drops the findings it would have matched"
        )
        for error in errors:
            failures.append(
                f"semgrep error {stringify(error.get('type'))} at "
                f"{error.get('path')}: {first_line(error.get('message'))}"
            )

    if not failures:
        print(
            f"PASS: semgrep clean over {scanned} targets, "
            f"{len(errors)} error(s) within the {args.max_errors} cap."
        )
    return failures


def first_line(message: object) -> str:
    """Collapse a scanner message to its first line, tolerating None and blanks."""
    lines = stringify(message).strip().splitlines()
    return lines[0].strip() if lines else "(no message)"


def stringify(value: object) -> str:
    # semgrep reports error types as a bare string in some versions and as a
    # ["PartialParsing", [...]] pair in others.
    if isinstance(value, (list, tuple)):
        return " ".join(stringify(item) for item in value)
    return "" if value is None else str(value)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--tool-status",
        type=int,
        default=0,
        help="exit status of the scanner that wrote the report",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    bandit = subparsers.add_parser("bandit", help="judge a bandit JSON report")
    bandit.add_argument("report", type=Path)
    bandit.add_argument("--expected-skips", type=int, required=True)
    bandit.add_argument("--min-loc", type=int, required=True)

    semgrep = subparsers.add_parser("semgrep", help="judge a semgrep JSON report")
    semgrep.add_argument("report", type=Path)
    semgrep.add_argument("--min-targets", type=int, required=True)
    semgrep.add_argument("--max-errors", type=int, required=True)

    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(main())
