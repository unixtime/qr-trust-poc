from __future__ import annotations

import base64
import tempfile
from pathlib import Path

import pytest


try:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover - dependency is managed in dev installs
    sync_playwright = None
    PlaywrightError = Exception
    PlaywrightTimeoutError = Exception


def test_verifier_lab_browser_flow(live_verifier_server_with_db) -> None:
    # `live_verifier_server_with_db`, not `live_verifier_server`: the first
    # thing this flow does is issue a verifier API key, and that endpoint
    # answers 503 "management persistence unavailable" without a reachable
    # Postgres. The plain fixture pins its DSN at a closed port on purpose so
    # `test_verifier_live_http.py` can assert that 503 -- which is the exact
    # opposite of what the happy path here needs.
    if sync_playwright is None:
        pytest.skip("Playwright is not installed. Run `uv sync --frozen` in backend.")

    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(headless=True)
        except PlaywrightError as exc:
            pytest.skip(
                "Playwright browser is not installed or cannot launch. "
                "Run `python -m playwright install chromium`.\n"
                f"{exc}"
            )

        page = browser.new_page()

        # A Playwright timeout only ever says which locator never appeared, and
        # every interesting step of this flow reports its own outcome into a
        # status banner first. Without these, a red run says "waiting for
        # get_by_text('Image Decoded')" and nothing about the decode error the
        # page had already rendered two lines above it.
        console_errors: list[str] = []
        page.on("pageerror", lambda error: console_errors.append(f"pageerror: {error}"))
        page.on(
            "console",
            lambda message: (
                console_errors.append(f"console.{message.type}: {message.text}")
                if message.type == "error"
                else None
            ),
        )

        def banner(selector: str) -> str:
            element = page.locator(selector)
            if element.count() == 0 or element.get_attribute("hidden") is not None:
                return "<empty>"
            return element.inner_text().replace("\n", " | ")

        try:
            page.goto(
                f"{live_verifier_server_with_db.base_url}/verifier/lab",
                wait_until="networkidle",
            )

            page.get_by_label("Admin token").fill(live_verifier_server_with_db.admin_token)
            page.get_by_label("New key label").fill("browser-lab-client")
            page.get_by_role("button", name="Issue verifier key").click()
            page.get_by_text("Verifier Key Issued").wait_for(timeout=10_000)

            api_key_value = page.locator("#api-key-input").input_value()
            assert api_key_value.startswith("vkey_")

            page.get_by_role("button", name="Generate demo QR").click()
            page.wait_for_function(
                "() => document.querySelector('#artifact-image')?.getAttribute('src')?.startsWith('data:image/png;base64,')",
                timeout=10_000,
            )

            qr_data_url = page.locator("#artifact-image").get_attribute("src")
            assert qr_data_url is not None
            image_base64 = qr_data_url.split(",", 1)[1]
            image_bytes = base64.b64decode(image_base64)

            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
                temp_file.write(image_bytes)
                temp_path = Path(temp_file.name)

            try:
                page.locator("#image-input").set_input_files(str(temp_path))
                # Wait for either upload outcome, not just the happy one. The
                # change handler reports a decode failure into this same banner
                # as "Image Decode Failed", so waiting on "Image Decoded" alone
                # burns the full 10s on a verdict the page rendered instantly,
                # then reports a bare locator timeout. Both outcomes start
                # "Image Decode" and the previous step left "Demo Ready" here,
                # so this settles on whichever actually arrived.
                page.locator('#scan-status strong:text-matches("^Image Decode")').wait_for(timeout=10_000)
                # `text_content`, not `inner_text`: the banner title is styled
                # `text-transform: uppercase`, and `inner_text` returns the
                # rendered text, so it reads "IMAGE DECODED". The selector above
                # matches the DOM text, so reading the DOM text here keeps the
                # wait and the assertion looking at the same string.
                scan_outcome = page.locator("#scan-status strong").text_content()
                assert scan_outcome == "Image Decoded", (
                    f"upload did not decode: {banner('#scan-status')}"
                )

                scanned_payload = page.locator("#scanned-payload").input_value()
                assert scanned_payload

                # Scoped to `#result-panel`, the banner `setStatus` writes the
                # verify outcome into. An unscoped `get_by_text("Accepted")`
                # matched the page's own field guide -- it lists
                # `<code>accepted</code>` in prose, and text matching is
                # case-insensitive substring -- so it returned before the
                # verify request had even been sent. The replay step below then
                # raced the first verification, and whichever response landed
                # last owned the panel.
                result_panel = page.locator("#result-panel")

                page.get_by_role("button", name="Verify scanned payload").click()
                result_panel.locator("strong", has_text="Accepted").wait_for(timeout=10_000)

                page.get_by_role("button", name="Verify current QR without scanning").click()
                result_panel.locator("strong", has_text="Blocked").wait_for(timeout=10_000)
                # The stage is asserted against the history feed, not the
                # banner: `setStatus` folds it into a CSS class
                # (`status-replay_guard`) and only `renderHistory` renders it as
                # text, as the heading of the newest entry.
                page.locator("#history-list strong", has_text="replay_guard").wait_for(timeout=10_000)

                runtime_posture = page.locator("#runtime-status-grid").inner_text()
                assert "required via X-API-Key" in runtime_posture
                assert "enabled via X-Admin-Token" in runtime_posture
            finally:
                temp_path.unlink(missing_ok=True)

        except PlaywrightTimeoutError as exc:
            pytest.fail(
                f"Verifier lab browser flow timed out: {exc}\n"
                f"scan banner:   {banner('#scan-status')}\n"
                # Not `#scanned-payload`: `generateDemo` fills that in two
                # steps earlier, so it is populated no matter where the upload
                # stalls. The capture indicator is only written from inside
                # `handleUploadedImage`, between the decode and the feedback
                # await, so it does distinguish the two.
                f"capture text:  {page.locator('#capture-indicator-text').inner_text()}\n"
                f"access banner: {banner('#access-status')}\n"
                f"result banner: {banner('#result-panel')}\n"
                f"page errors:   {console_errors or 'none'}"
            )
        finally:
            browser.close()
