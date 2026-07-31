from __future__ import annotations

import os

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Browser, Page, Playwright, expect, sync_playwright


DEFAULT_FRONTEND_BASE_URL = "http://127.0.0.1:5173"


def _launch_browser(playwright: Playwright) -> Browser:
    executable_path = os.environ.get("PLAYWRIGHT_BROWSER_EXECUTABLE")
    launch_options = {"headless": True}
    if executable_path:
        launch_options["executable_path"] = executable_path

    try:
        return playwright.chromium.launch(**launch_options)
    except PlaywrightError as bundled_error:
        try:
            return playwright.chromium.launch(channel="chrome", headless=True)
        except PlaywrightError as chrome_error:
            raise SystemExit(
                "Playwright Chromium is not installed and system Chrome could not launch. "
                "Run `cd backend && ./.venv/bin/python -m playwright install chromium`, "
                "or set PLAYWRIGHT_BROWSER_EXECUTABLE to an installed Chromium-family browser.\n"
                f"Bundled Chromium error: {bundled_error}\n"
                f"System Chrome error: {chrome_error}"
            ) from chrome_error


def _push_route(page: Page, path: str) -> None:
    page.evaluate(
        """(nextPath) => {
          window.history.pushState({}, "", nextPath);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }""",
        path,
    )


def _expect_text(page: Page, text: str) -> None:
    expect(page.get_by_text(text).first).to_be_visible(timeout=10_000)


def _check_learn_query_refresh(page: Page, base_url: str) -> None:
    page.goto(
        f"{base_url}/learn?track=professor-seminar&step=0",
        wait_until="domcontentloaded",
    )
    _expect_text(page, "Prepared sequence active")
    _expect_text(page, "Current sequence step 1 of 5")

    _push_route(page, "/learn?track=reviewer-defense&step=0")
    _expect_text(page, "Prepared sequence active")
    _expect_text(page, "Current sequence step 1 of 4")

    _push_route(page, "/learn?track=professor-seminar&step=3")
    _expect_text(page, "Current sequence step 4 of 5")
    _expect_text(page, "Ground the architecture in policy-driven binding")


def _check_lab_query_refresh(page: Page, base_url: str) -> None:
    page.goto(
        f"{base_url}/lab?scenario=payload-mismatch&nonce=fixed&autogenerate=0&compare=valid",
        wait_until="domcontentloaded",
    )
    _expect_text(page, "Payload mismatch")
    _expect_text(
        page,
        "The envelope is signed correctly, but the payload falls outside the issuer-approved destination set.",
    )

    _push_route(page, "/lab?scenario=subdomain-blocked&nonce=fixed&autogenerate=0&compare=subdomain-allowed")
    _expect_text(page, "Subdomain blocked")
    _expect_text(
        page,
        "The same subdomain should fail when the issuer policy only trusts the exact registered domain.",
    )


def _check_operator_query_refresh(page: Page, base_url: str) -> None:
    page.goto(
        f"{base_url}/operator?focus=runtime&scenario=valid&compare=expired&source=reviewer-defense",
        wait_until="domcontentloaded",
    )
    _expect_text(page, "Operator Surface")
    _expect_text(page, "valid vs expired")
    _expect_text(page, "Start with runtime posture")

    _push_route(page, "/operator?focus=access&scenario=revoked&compare=valid&source=committee-review")
    _expect_text(page, "revoked vs valid")
    _expect_text(page, "Start with access control")
    _expect_text(page, "committee review handoff")


def main() -> None:
    base_url = os.environ.get("FRONTEND_BASE_URL", DEFAULT_FRONTEND_BASE_URL).rstrip("/")

    with sync_playwright() as playwright:
        browser = _launch_browser(playwright)
        try:
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            page.set_default_timeout(10_000)

            _check_learn_query_refresh(page, base_url)
            print("PASS learn route query refresh")

            _check_lab_query_refresh(page, base_url)
            print("PASS lab route query refresh")

            _check_operator_query_refresh(page, base_url)
            print("PASS operator route query refresh")
        finally:
            browser.close()

    print("React route query navigation smoke passed")


if __name__ == "__main__":
    main()
