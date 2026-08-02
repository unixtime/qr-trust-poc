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


def _expect_pressed(page: Page, test_id: str, pressed: bool) -> None:
    expect(page.get_by_test_id(test_id)).to_have_attribute(
        "aria-pressed", "true" if pressed else "false", timeout=10_000
    )


def _check_about_and_removed_routes(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/about", wait_until="domcontentloaded")
    _expect_text(page, "How it works")
    expect(page.get_by_test_id("about-open-workflow")).to_be_visible(timeout=10_000)

    _push_route(page, "/learn?track=professor-seminar&step=0")
    _expect_text(page, "Route not found")

    _push_route(page, "/about")
    _expect_text(page, "Issuer legitimacy")


def _check_lab_query_refresh(page: Page, base_url: str) -> None:
    page.goto(
        f"{base_url}/?scenario=payload-mismatch&nonce=fixed&autogenerate=0&compare=valid",
        wait_until="domcontentloaded",
    )
    expect(page.get_by_test_id("flow-stepper")).to_be_visible(timeout=10_000)
    _expect_pressed(page, "scenario-payload-mismatch", True)
    _expect_text(page, "Payload mismatch")
    _expect_text(
        page,
        "The envelope is signed correctly, but the payload falls outside the issuer-approved destination set.",
    )

    _push_route(page, "/?scenario=subdomain-blocked&nonce=fixed&autogenerate=0&compare=subdomain-allowed")
    _expect_pressed(page, "scenario-subdomain-blocked", True)
    _expect_pressed(page, "scenario-payload-mismatch", False)
    _expect_text(page, "Subdomain blocked")
    _expect_text(
        page,
        "The same subdomain should fail when the issuer policy only trusts the exact registered domain.",
    )

    _push_route(page, "/lab?scenario=valid")
    _expect_text(page, "Route not found")


def _check_operator_query_refresh(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/operator?focus=runtime", wait_until="domcontentloaded")
    expect(page.get_by_test_id("operator-panel-runtime")).to_be_visible(timeout=10_000)

    _push_route(page, "/operator?focus=access")
    expect(page.get_by_test_id("operator-panel-access")).to_be_visible(timeout=10_000)

    _push_route(page, "/operator?focus=management")
    expect(page.get_by_test_id("operator-panel-management")).to_be_visible(timeout=10_000)


def main() -> None:
    base_url = os.environ.get("FRONTEND_BASE_URL", DEFAULT_FRONTEND_BASE_URL).rstrip("/")

    with sync_playwright() as playwright:
        browser = _launch_browser(playwright)
        try:
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            page.set_default_timeout(10_000)

            _check_about_and_removed_routes(page, base_url)
            print("PASS about and removed routes")

            _check_lab_query_refresh(page, base_url)
            print("PASS lab route query refresh")

            _check_operator_query_refresh(page, base_url)
            print("PASS operator route query refresh")

            _push_route(page, "/about")
            _expect_text(page, "How it works")
            _expect_text(page, "Issuer legitimacy")
            _expect_text(page, "Scanner decision")
            print("PASS about route renders")
        finally:
            browser.close()

    print("React route query navigation smoke passed")


if __name__ == "__main__":
    main()
