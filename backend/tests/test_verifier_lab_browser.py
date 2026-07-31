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


def test_verifier_lab_browser_flow(live_verifier_server) -> None:
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

        try:
            page = browser.new_page()
            page.goto(f"{live_verifier_server.base_url}/verifier/lab", wait_until="networkidle")

            page.get_by_label("Admin token").fill(live_verifier_server.admin_token)
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
                page.get_by_text("Image Decoded").wait_for(timeout=10_000)

                scanned_payload = page.locator("#scanned-payload").input_value()
                assert scanned_payload

                page.get_by_role("button", name="Verify scanned payload").click()
                page.get_by_text("Accepted").wait_for(timeout=10_000)

                page.get_by_role("button", name="Verify current QR without scanning").click()
                page.locator("strong", has_text="Blocked").wait_for(timeout=10_000)
                page.locator("strong", has_text="replay_guard").wait_for(timeout=10_000)

                runtime_posture = page.locator("#runtime-status-grid").inner_text()
                assert "required via X-API-Key" in runtime_posture
                assert "enabled via X-Admin-Token" in runtime_posture
            finally:
                temp_path.unlink(missing_ok=True)

        except PlaywrightTimeoutError as exc:
            pytest.fail(f"Verifier lab browser flow timed out: {exc}")
        finally:
            browser.close()
