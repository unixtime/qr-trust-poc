from __future__ import annotations

import re
import sys
from pathlib import Path


CONTROLLER_PATH = Path("frontend/src/routes/lab/useLabController.ts")
SCANNER_ENDPOINT = '"/scanner/decisions"'
ENGINEERING_ENDPOINT = '"/verifier/verify-scanned"'


def fail(message: str) -> None:
    print(f"frontend scanner contract failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def extract_async_function(source: str, name: str) -> str:
    match = re.search(rf"\basync\s+function\s+{re.escape(name)}\b", source)
    if match is None:
        fail(f"missing async function {name}")

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


def require_not_contains(body: str, needle: str, label: str) -> None:
    if needle in body:
        fail(f"{label} must not contain {needle}")


def main() -> None:
    if not CONTROLLER_PATH.exists():
        fail(f"missing {CONTROLLER_PATH}")

    source = CONTROLLER_PATH.read_text(encoding="utf-8")

    if source.count(SCANNER_ENDPOINT) != 1:
        fail(f"expected exactly one React lab {SCANNER_ENDPOINT} call")

    if source.count(ENGINEERING_ENDPOINT) != 1:
        fail(f"expected exactly one React lab {ENGINEERING_ENDPOINT} call")

    run_scanner_decision = extract_async_function(source, "runScannerDecision")
    require_contains(
        run_scanner_decision,
        SCANNER_ENDPOINT,
        "runScannerDecision",
    )
    require_not_contains(
        run_scanner_decision,
        ENGINEERING_ENDPOINT,
        "runScannerDecision",
    )

    run_scanned_verifier = extract_async_function(source, "runScannedVerifier")
    require_contains(
        run_scanned_verifier,
        ENGINEERING_ENDPOINT,
        "runScannedVerifier",
    )
    require_not_contains(
        run_scanned_verifier,
        SCANNER_ENDPOINT,
        "runScannedVerifier",
    )

    for function_name in (
        "scanCameraFrame",
        "verifyScannedPayload",
        "handleImageSelection",
    ):
        body = extract_async_function(source, function_name)
        require_contains(body, "runScannerDecision({", function_name)
        require_not_contains(body, "runScannedVerifier({", function_name)
        require_not_contains(body, ENGINEERING_ENDPOINT, function_name)

    verify_current = extract_async_function(source, "verifyCurrent")
    require_contains(verify_current, "runScannedVerifier({", "verifyCurrent")

    print("React lab scanner endpoint contract passed")


if __name__ == "__main__":
    main()
