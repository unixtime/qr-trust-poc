"""Pin the iOS scanner's open-destination contract.

The React lab has had scripts/frontend_scanner_open_contract_check.py guarding
its side of this for a while. iOS had no equivalent, and it drifted: every open
affordance gated on `destination != nil`, so a decision the verifier had already
refused still rendered "Review and open anyway". The server never offered that
action -- `_scanner_actions` returns "Do not open" plus a copy action when
`open_allowed` is false -- and IOS_END_USER_APP_DESIGN.md documents the blocked
state as the one state where "no escape hatch is offered". Only the client
disagreed, which is the client-side widening of a server trust decision that
this project exists to argue against.

The checks below pin the invariant that made the fix safe, rather than the
wording of any particular button: there is exactly one way to leave the app,
exactly one way to reach the sheet that leaves it, and both run through
`openableURL(for:)`, which refuses on the verifier's answer before it looks at
anything else.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import NoReturn


APP_DIR = Path("ios/VerifierLabApp/VerifierLabApp")
CONTENT_VIEW_PATH = APP_DIR / "ContentView.swift"
MODELS_PATH = APP_DIR / "Models.swift"
VIEW_MODEL_PATH = APP_DIR / "VerifierLabViewModel.swift"


def fail(message: str) -> NoReturn:
    print(f"ios scanner open contract failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def read(path: Path) -> str:
    if not path.exists():
        fail(f"missing {path}")
    return path.read_text(encoding="utf-8")


def swift_sources() -> list[Path]:
    paths = sorted(APP_DIR.glob("*.swift"))
    if not paths:
        fail(f"no Swift sources found under {APP_DIR}")
    return paths


def extract_func(source: str, name: str, label: str) -> str:
    """Return the full text of a Swift function, braces balanced."""
    match = re.search(rf"\bfunc\s+{re.escape(name)}\b", source)
    if match is None:
        fail(f"missing func {name} in {label}")

    start = source.find("{", match.end())
    if start == -1:
        fail(f"could not find body of {name} in {label}")

    depth = 0
    for index in range(start, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[match.start() : index + 1]

    fail(f"unbalanced braces in {name} in {label}")


def require_contains(body: str, needle: str, label: str) -> None:
    if needle not in body:
        fail(f"{label} must contain {needle!r}")


def require_ordered(body: str, label: str, *needles: str) -> None:
    cursor = -1
    for needle in needles:
        index = body.find(needle, cursor + 1)
        if index == -1:
            fail(f"{label} must contain {needle!r} after position {cursor}")
        cursor = index


def require_count(body: str, needle: str, count: int, label: str) -> None:
    actual = body.count(needle)
    if actual != count:
        fail(f"{label} expected {count} occurrence(s) of {needle!r}, found {actual}")


def check_single_exit_from_app() -> None:
    """Exactly one call can hand a URL to the system browser."""
    total_open_url = 0
    for path in swift_sources():
        source = read(path)
        if "UIApplication.shared.open" in source:
            fail(f"UIApplication.shared.open is not allowed in {path}")
        count = source.count("openURL(")
        if count and path != CONTENT_VIEW_PATH:
            fail(f"openURL call outside {CONTENT_VIEW_PATH} in {path}")
        total_open_url += count

    if total_open_url != 1:
        fail(f"expected exactly 1 openURL call across the app, found {total_open_url}")


def check_sheet_is_the_only_route() -> None:
    """The review sheet is the only thing that can reach that one call, and the
    sheet only presents for a result the chokepoint has already cleared."""
    source = read(CONTENT_VIEW_PATH)

    # One non-nil write to the sheet binding. The other two assignments clear it.
    require_count(source, "pendingOpenResult = result", 1, str(CONTENT_VIEW_PATH))

    prepare = extract_func(source, "prepareOpenDestination", str(CONTENT_VIEW_PATH))
    require_contains(prepare, "openableURL(for: result) != nil", "prepareOpenDestination")
    require_contains(prepare, "pendingOpenResult = result", "prepareOpenDestination")

    # The sheet body resolves its URL through the same chokepoint, so a result
    # that slipped past presentation still cannot produce a live link.
    require_contains(
        source,
        "if let destinationURL = openableURL(for: result)",
        "scanner review sheet",
    )


def check_chokepoint_refuses_first() -> None:
    """openableURL answers "may we?" before "with what?", in that order."""
    source = read(CONTENT_VIEW_PATH)
    body = extract_func(source, "openableURL", str(CONTENT_VIEW_PATH))

    require_ordered(
        body,
        "openableURL",
        "guard !result.verifierRefusedOpen else",
        "return nil",
        'scheme == "http" || scheme == "https"',
    )


def check_model_carries_the_answer() -> None:
    """ScanResult stores the verifier's answer and exposes only the fail-closed
    reading of it."""
    models = read(MODELS_PATH)

    # Optional at rest: history decodes as [ScanResult] under `try?`, so a
    # non-optional field would let one legacy record wipe every stored scan.
    require_contains(models, "private let openAllowed: Bool?", str(MODELS_PATH))

    # Private, so no caller can write `openAllowed != false` and turn "no
    # answer" into "allowed".
    require_contains(
        models,
        "var verifierRefusedOpen: Bool { openAllowed == false }",
        str(MODELS_PATH),
    )

    view_model = read(VIEW_MODEL_PATH)

    # The server's answer actually reaches the model.
    result_from = extract_func(view_model, "result", str(VIEW_MODEL_PATH))
    require_contains(result_from, "openAllowed: decision.openAllowed", "result(from:)")

    # A revoked provider profile is refused locally, before the verifier is ever
    # called. Stale stays nil: its tone is .caution and its own copy says a
    # destination may still be visible.
    local_gate = extract_func(
        view_model, "localProfileStateResult", str(VIEW_MODEL_PATH)
    )
    require_contains(
        local_gate,
        "openAllowed: isRevoked ? false : nil",
        "localProfileStateResult",
    )


def check_no_affordance_uses_the_wrong_predicate() -> None:
    """Every visible open control is gated on the chokepoint, not on whether a
    destination string happens to exist. This is the exact defect the fix
    removed, so it is checked structurally rather than by counting."""
    lines = read(CONTENT_VIEW_PATH).splitlines()

    for index, line in enumerate(lines):
        if "prepareOpenDestination(" not in line or "func " in line:
            continue

        for offset in range(1, 6):
            previous = index - offset
            if previous < 0:
                break
            candidate = lines[previous].strip()
            if not candidate.startswith("if "):
                continue
            if "openableURL(" not in candidate:
                fail(
                    f"{CONTENT_VIEW_PATH}:{index + 1} gates an open action on "
                    f"{candidate!r}; it must gate on openableURL(...)"
                )
            break
        else:
            fail(
                f"{CONTENT_VIEW_PATH}:{index + 1} calls prepareOpenDestination "
                "with no enclosing openableURL(...) gate"
            )


def check_copy_survives_a_refusal() -> None:
    """The server pairs "Do not open" with a copy action, so a refused
    destination must still be inspectable. Copy is gated on the destination
    existing, deliberately not on permission to open it."""
    source = read(CONTENT_VIEW_PATH)
    require_ordered(
        source,
        "history row swipe actions",
        "if openableURL(for: item) != nil {",
        "if item.destination != nil {",
        "UIPasteboard.general.string = item.destination",
    )


def main() -> None:
    check_single_exit_from_app()
    check_sheet_is_the_only_route()
    check_chokepoint_refuses_first()
    check_model_carries_the_answer()
    check_no_affordance_uses_the_wrong_predicate()
    check_copy_survives_a_refusal()
    print("iOS scanner open contract passed")


if __name__ == "__main__":
    main()
