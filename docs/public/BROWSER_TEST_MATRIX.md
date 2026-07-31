# Browser Test Matrix

Use this checklist when testing the React verifier workbench on real browsers and devices.

Entry points:

- `http://127.0.0.1:5173/`
- `GET /verifier/status`
- `GET /verifier/lab` as the legacy static comparison page

## Preflight

1. Start the stack with `docker compose up -d --build`.
   For phone testing, prefer `API_PUBLISH_HOST=0.0.0.0 FRONTEND_PUBLISH_HOST=0.0.0.0 docker compose up -d --build`.
2. If verifier auth is enabled for local bootstrap, set
   `VERIFIER_ADMIN_TOKENS` and `VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED=true`,
   then use the workbench's `Access Control` panel to issue a verifier API key.
3. Confirm the `Runtime Posture` panel shows the expected server state:
   - verifier auth mode
   - admin flow enabled or disabled
   - rate limits
   - Redis connected or local fallback

## Scripted Browser Check

For a headless browser regression before device testing:

```bash
cd backend
./.venv/bin/python -m playwright install chromium
PYTHONPATH=.. ./.venv/bin/pytest tests/test_verifier_lab_browser.py
```

That test covers:

- lab bootstrap
- admin token entry and API key issue
- QR generation
- QR image upload decode
- accepted verification
- replay block on the next verification action

## Browser Coverage

- Safari on iPhone
  - confirm the phone can load `http://<mac-lan-ip>:5173/`
  - if the page is plain LAN HTTP, confirm the workbench reports camera unavailability clearly instead of throwing a JS error
  - if testing over HTTPS with a trusted mkcert CA, confirm camera permission prompt appears at `https://<mac-lan-ip>:5173/`
  - verify live scan works
  - verify QR image upload works
  - verify payload copy fallback behavior if clipboard access is restricted
- Chrome on Android
  - confirm environment-facing camera can be selected
  - verify live scan works
  - verify key issue / rotate / revoke flow if admin token is configured
- Chrome on desktop
  - verify camera enumeration lists more than one source when available
  - verify QR image download and re-upload loop
- Firefox on desktop
  - verify bundled `/verifier/decode-image` fallback works when `BarcodeDetector`
    is unavailable
  - verify image upload path still reaches `accepted`

## Scenario Pass Criteria

For each browser/device, validate:

1. `Valid first scan`
   - with `Reusable public QR`, repeated verification returns `accepted`
   - with `One-time QR`, first verification returns `accepted` and repeat verification returns `replay_guard`
2. `Expired credential`
   - verification returns `time_window`
3. `Revoked certificate`
   - verification returns `certificate_status`
4. `Subdomain allowed`
   - verification returns `accepted`
5. `Subdomain blocked`
   - verification returns `payload_revalidation`
6. `Payload mismatch`
   - verification returns `payload_revalidation`

## Trace Checks

- confirm the lab shows a fresh `X-Request-ID` after each action
- confirm the action label matches the request you just triggered
- confirm the runtime panel still matches the server posture after issuing or
  revoking API keys

## Live HTTP Smoke

After the compose stack is up, you can run:

```bash
cd backend
VERIFIER_SMOKE_ADMIN_TOKEN=local-lab-admin ./.venv/bin/python scripts/verifier_live_http_smoke.py
```

That script exercises the running HTTP server, not `TestClient`.
