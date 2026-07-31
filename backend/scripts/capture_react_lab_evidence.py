from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Browser, Page, Playwright, sync_playwright


DEFAULT_FRONTEND_BASE_URL = "http://127.0.0.1:5173"
DEFAULT_OUTPUT_DIR = "docs/public/evidence/browser"


def _goto_lab(
    page: Page,
    base_url: str,
    scenario: str,
    nonce: str,
    *,
    usage: str = "reusable_public",
) -> None:
    page.goto(
        f"{base_url}/lab?scenario={scenario}&nonce={nonce}&usage={usage}",
        wait_until="networkidle",
    )
    page.get_by_role("button", name="Generate demo QR").wait_for(timeout=10_000)


def _launch_browser(playwright: Playwright) -> Browser:
    try:
        return playwright.chromium.launch(headless=True)
    except PlaywrightError as bundled_error:
        try:
            return playwright.chromium.launch(channel="chrome", headless=True)
        except PlaywrightError as chrome_error:
            raise SystemExit(
                "Playwright Chromium is not installed and system Chrome could not launch. "
                "Run `cd backend && ./.venv/bin/python -m playwright install chromium`, "
                "or install Google Chrome for the fallback launcher.\n"
                f"Bundled Chromium error: {bundled_error}\n"
                f"System Chrome error: {chrome_error}"
            ) from chrome_error


def _ensure_local_lab_key(page: Page) -> None:
    issue_key_button = page.get_by_role("button", name="Issue local lab key")
    if issue_key_button.count() == 0:
        return
    issue_key_button.click()
    page.get_by_text("Local lab key issued").first.wait_for(timeout=10_000)


def _generate_qr(page: Page) -> None:
    page.get_by_role("button", name="Generate demo QR").click()
    page.get_by_text("Demo QR ready").wait_for(timeout=10_000)
    page.wait_for_selector("img[src^='data:image/png;base64,']", timeout=10_000)


def _verify_current_qr(page: Page) -> None:
    page.get_by_role("button", name="Verify current QR").click()


def _check_scanner_decision(page: Page) -> None:
    page.get_by_role("button", name="Check scanner decision").click()


def _capture(page: Page, output_path: Path) -> None:
    page.screenshot(path=str(output_path), full_page=True)
    print(f"captured {output_path}")


def main() -> None:
    base_url = os.environ.get("FRONTEND_BASE_URL", DEFAULT_FRONTEND_BASE_URL).rstrip("/")
    output_dir = Path(os.environ.get("EVIDENCE_OUTPUT_DIR", DEFAULT_OUTPUT_DIR))
    output_dir.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = _launch_browser(playwright)

        try:
            context = browser.new_context(viewport={"width": 1440, "height": 1100})
            page = context.new_page()

            _goto_lab(page, base_url, "valid", "timestamped")
            _ensure_local_lab_key(page)
            _generate_qr(page)
            _verify_current_qr(page)
            page.get_by_text("Verifier accepted payload").wait_for(timeout=10_000)
            _capture(page, output_dir / "accepted.png")

            _verify_current_qr(page)
            page.get_by_text("replay_guard").first.wait_for(timeout=10_000)
            _capture(page, output_dir / "replay-guard.png")

            _goto_lab(page, base_url, "payload-mismatch", "timestamped")
            _generate_qr(page)
            _verify_current_qr(page)
            page.get_by_text("payload_revalidation").first.wait_for(timeout=10_000)
            _capture(page, output_dir / "payload-mismatch.png")

            _goto_lab(page, base_url, "runtime-risky", "timestamped")
            _generate_qr(page)
            _check_scanner_decision(page)
            page.get_by_text("verified issuer destination risky").first.wait_for(
                timeout=10_000,
            )
            _capture(page, output_dir / "runtime-risky.png")

            _goto_lab(page, base_url, "stale-cache", "timestamped")
            _generate_qr(page)
            _check_scanner_decision(page)
            page.get_by_text("stale trust state").first.wait_for(timeout=10_000)
            _capture(page, output_dir / "stale-cache.png")
        finally:
            browser.close()

    print("browser evidence capture passed")


if __name__ == "__main__":
    main()
