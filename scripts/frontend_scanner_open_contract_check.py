from __future__ import annotations

import re
import sys
from pathlib import Path


FRONTEND_SRC = Path("frontend/src")
CONTROLLER_PATH = FRONTEND_SRC / "routes/lab/useLabController.ts"
WORKBENCH_PATH = FRONTEND_SRC / "routes/lab/components/ScanWorkbenchSection.tsx"
VERIFIER_CLIENT_PATH = FRONTEND_SRC / "lib/verifier-client.ts"


def fail(message: str) -> None:
    print(f"frontend scanner open contract failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def read(path: Path) -> str:
    if not path.exists():
        fail(f"missing {path}")
    return path.read_text(encoding="utf-8")


def extract_function(source: str, name: str) -> str:
    match = re.search(
        rf"\b(?:async\s+)?function\s+{re.escape(name)}\b",
        source,
    )
    if match is None:
        fail(f"missing function {name}")

    params_start = source.find("(", match.end())
    if params_start == -1:
        fail(f"could not parse parameter list for {name}")

    paren_depth = 0
    params_end = -1
    for index in range(params_start, len(source)):
        char = source[index]
        if char == "(":
            paren_depth += 1
        elif char == ")":
            paren_depth -= 1
            if paren_depth == 0:
                params_end = index
                break

    if params_end == -1:
        fail(f"could not parse parameter list for {name}")

    start = source.find("{", params_end)
    if start == -1:
        fail(f"could not parse function body for {name}")

    depth = 0
    for index in range(start, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[match.start() : index + 1]

    fail(f"could not parse function body for {name}")


def require_contains(body: str, needle: str, label: str) -> None:
    if needle not in body:
        fail(f"{label} must contain {needle}")


def require_ordered(body: str, label: str, *needles: str) -> None:
    cursor = -1
    for needle in needles:
        index = body.find(needle, cursor + 1)
        if index == -1:
            fail(f"{label} must contain {needle} after position {cursor}")
        cursor = index


def require_count(body: str, needle: str, count: int, label: str) -> None:
    actual = body.count(needle)
    if actual != count:
        fail(f"{label} expected {count} occurrence(s) of {needle}, found {actual}")


def check_no_unapproved_navigation() -> None:
    allowed_window_open_files = {
        CONTROLLER_PATH,
        VERIFIER_CLIENT_PATH,
    }

    for path in FRONTEND_SRC.rglob("*"):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        source = read(path)
        if "window.open(" in source and path not in allowed_window_open_files:
            fail(f"unapproved window.open call in {path}")
        if "location.href =" in source or "window.location.href =" in source:
            fail(f"direct location.href navigation is not allowed in {path}")
        if "location.assign(" in source or "window.location.assign(" in source:
            fail(f"direct location.assign navigation is not allowed in {path}")


def check_open_controller_contract() -> None:
    source = read(CONTROLLER_PATH)
    require_count(source, "window.open(", 1, str(CONTROLLER_PATH))

    open_body = extract_function(source, "openScannerDestination")
    require_count(open_body, "window.open(", 1, "openScannerDestination")
    require_count(
        open_body,
        'recordScannerUxEvent("cancel", decision, elapsedMs)',
        2,
        "openScannerDestination",
    )
    require_ordered(
        open_body,
        "openScannerDestination",
        "scannerDestinationUrl(decision)",
        'recordScannerUxEvent("cancel", decision, elapsedMs)',
        'window.open(destinationUrl, "_blank", "noopener,noreferrer")',
        'recordScannerUxEvent("cancel", decision, elapsedMs)',
        'recordScannerUxEvent("open", decision, elapsedMs)',
        "rememberScannerKnownHost(destinationUrl)",
    )

    hold_body = extract_function(source, "completeScannerHold")
    require_ordered(
        hold_body,
        "completeScannerHold",
        'recordScannerUxEvent("hold_complete", decision, elapsedMs)',
        "openScannerDestination(decision, elapsedMs)",
    )

    start_hold_body = extract_function(source, "startScannerHold")
    require_contains(
        start_hold_body,
        'recordScannerUxEvent("hold_start", decision)',
        "startScannerHold",
    )

    cancel_body = extract_function(source, "cancelScannerDestination")
    require_contains(
        cancel_body,
        'recordScannerUxEvent("cancel", decision, elapsedMs)',
        "cancelScannerDestination",
    )


def check_workbench_hold_gate_contract() -> None:
    source = read(WORKBENCH_PATH)
    require_count(
        source,
        "onOpenDestination(decision)",
        1,
        "ScanWorkbenchSection direct open action",
    )
    require_contains(source, "holdRequired ? (", "ScannerDecisionPanel")
    require_ordered(
        source,
        "ScannerDecisionPanel user action",
        "holdRequired ? (",
        "<HoldToOpenButton",
        "onHoldComplete={onHoldComplete}",
        ") : (",
        "<Button onClick={() => onOpenDestination(decision)}>",
    )


def check_qr_display_escape_hatch() -> None:
    source = read(VERIFIER_CLIENT_PATH)
    require_count(source, "window.open(", 1, str(VERIFIER_CLIENT_PATH))
    qr_display_body = extract_function(source, "openQrDisplayWindow")
    require_ordered(
        qr_display_body,
        "openQrDisplayWindow",
        "window.localStorage.setItem(storageKey, JSON.stringify(payload))",
        "window.open(",
        'throw new Error("The browser blocked the QR display window.")',
    )


def main() -> None:
    check_no_unapproved_navigation()
    check_open_controller_contract()
    check_workbench_hold_gate_contract()
    check_qr_display_escape_hatch()
    print("React lab scanner open contract passed")


if __name__ == "__main__":
    main()
