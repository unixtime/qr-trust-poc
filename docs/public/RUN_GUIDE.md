# Run Guide

This guide covers the public-safe PoC paths in this repository.

## Prerequisites

- Python `3.12+`
- `uv`
- Node.js `22+`
- Docker with Compose support for the containerized stack
- Xcode for the native iPhone scanner app

## Environment Setup

From [backend](../../backend):

```bash
uv sync --frozen
```

This creates or updates `.venv` using [pyproject.toml](../../backend/pyproject.toml) and [uv.lock](../../backend/uv.lock).

From [frontend](../../frontend):

```bash
npm install
```

This creates the React 19 / Vite 8 / Tailwind v4 frontend workspace used for the replacement verifier workbench.

## Test Suite

From [backend](../../backend):

```bash
PYTHONPATH=.. ./.venv/bin/pytest
```

Coverage includes:

- unit tests for signed schema, payload revalidation, and the residual vector
- API tests for `/verifier/*`
- QR artifact tests for PNG render, decode, and scanned verification
- optional Playwright browser regression for the legacy backend-served lab
- live HTTP integration coverage when socket binding is available
- CI and release review rerun the backend, frontend, Compose, navigation, and
  release-boundary gates; do not infer current results from a historical count

Frontend validation:

From [frontend](../../frontend):

```bash
npm run lint
npm run build
```

Current baseline:

- TypeScript build succeeds
- Vite production bundle succeeds
- ESLint passes on the frontend workspace

## Documentation Site

The repository uses MkDocs for a filtered, locally browsable technical site.
From the repository root:

```bash
make docs-build
make docs-serve
```

Open <http://127.0.0.1:8088/>. `docs-build` runs MkDocs in strict mode.
`docs-serve` serves only the generated `site/` directory, rather than exposing
the maintainer workspace directly. The release exporter separately checks all
relative links against the complete public repository tree.

Rendered architecture and decision diagrams open in an interactive modal.
Select a diagram, then use the mouse wheel or `+`/`-` to zoom, drag to pan,
press `0` to fit, `1` for actual size, and `Esc` to close.

Links from the documentation to implementation files open generated, read-only
source views. The build creates those pages only for files referenced by
rendered documentation and only within the public source boundary; it never
serves the maintainer workspace directly.

Native iPhone app build validation:

From the repository root:

```bash
make smoke-ios
make build-ios
```

Current baseline:

- the SwiftUI iPhone scanner compiles for the iOS Simulator SDK
- the app includes native QR camera capture, scanner-decision submission, end-user green/orange/red results, local history, Learn, Settings, and immediate haptic/audio feedback
- `make smoke-ios` checks that developer-only verifier/admin/demo surfaces stay out of the end-user app

## Demo Scripts

From [backend](../../backend):

```bash
./.venv/bin/python scripts/payload_revalidation_poc_demo.py
./.venv/bin/python scripts/signed_schema_poc_demo.py
./.venv/bin/python scripts/narrowed_verifier_poc_demo.py
./.venv/bin/python scripts/qr_artifact_poc_demo.py
```

What each demo proves:

- `payload_revalidation_poc_demo.py`
  - exact host match, `www` normalization, subdomain policy behavior, and issuer-state changes
- `signed_schema_poc_demo.py`
  - fixed claim order, deterministic serialization, signature verification, and metadata-conflict rejection
- `narrowed_verifier_poc_demo.py`
  - full verifier chain across valid, expired, not-yet-valid, revoked, inactive-issuer, and destination-mismatch cases
- `qr_artifact_poc_demo.py`
  - signed envelope -> QR PNG -> decoded scan payload -> verifier result

## FastAPI Reference Surface

The canonical reference API is:

- `GET /verifier/status`
- `GET /verifier/trust-store`
- `POST /verifier/demo-materials`
- `POST /verifier/verify`
- `POST /verifier/verify-scanned`
- `POST /verifier/decode-image`

Notes:

- `POST /verifier/demo-materials` returns demo certificate data, issuer state,
  a ready-to-submit verifier request, QR artifact data, and a `trust` echo
  (`key_ref`, `key_state`, `issuer_status`, `retired_key_refs`) describing the
  key the artifact was sealed under
- the demo issuer keeps one process-stable signing key, so every demo QR
  issued since the API started keeps verifying; `rotate_key: true` mints a
  successor key and retires the previous one, and `key_state: "revoked"`
  revokes the current key (terminal — the next plain call mints a fresh key)
- `GET /verifier/trust-store` lists the issuers and keys the scanned path
  trusts right now, with each key's `state` (`active`, `retired`, `revoked`)
  and validity window; it is read-only and gated like `/status` evidence
  (open when verifier auth is disabled, otherwise a management credential)
- the trust store is in-memory for this cycle: it resets when the API
  container restarts, and demo artifacts sealed before the restart stop
  verifying until they are regenerated
- `GET /verifier/status` returns the current verifier posture for auth, rate
  limits, Redis-backed coordination, and decode fallback support
- it does not return the signing private key
- `POST /verifier/decode-image` rejects oversized image payloads before decode
- verifier POST routes are rate-limited per client, using Redis-backed coordination when Redis is available and in-memory fallback otherwise
- every signed QR code carries two scan-flood budgets that a flood spread across many source addresses cannot dodge: a per-envelope budget (`VERIFIER_ENVELOPE_RATE_LIMIT_MAX_REQUESTS`, default 300 per `VERIFIER_ENVELOPE_RATE_LIMIT_WINDOW_SECONDS`, default 60) checked before the signature is verified, and a per-issuer budget (`VERIFIER_ISSUER_RATE_LIMIT_MAX_REQUESTS`, default 3000) that only signature-valid scans spend; an exhausted budget returns `429` with `Retry-After` and records no scanner evidence. The budget bounds how much evidence one envelope may accumulate; it is not a per-presentation gate, and a repeat presentation inside the validity window still verifies
- behind a reverse proxy, set `FORWARDED_ALLOW_IPS` to the proxy's address (uvicorn's own setting; the compose files default it to `127.0.0.1`) so the per-client limit keys on the real client address instead of the proxy's; `GET /verifier/status` reports `forwarded_ip_trust_configured`, which is true only when something beyond loopback is trusted
- without Redis every limit is per-process and in-memory, so budgets do not add up across API replicas; the API logs a startup warning when it falls back
- verdicts are served from a short-lived cache: the first scan of an envelope in each window pays for the signature check, the budget spend and the evidence write, and identical scans inside the window get the same verdict back with `X-QR-Trust-Verdict: cached` (`computed` otherwise) and no evidence row. `VERIFIER_VERDICT_CACHE_TTL_SECONDS` (default `30`) caps the window, the code's own `expires_at` caps it further, and `0` disables the cache. Cached scans are still counted per code (a counter, not a row) so the workbench card stays honest; without Redis that counter, like the cache itself, is per API replica
- the evidence store doubles as the scan ledger: `GET /admin/scan-accounting` (management credential, `audit:read`) returns scans per issuer per UTC day with the green/orange/red split and a `distinct_envelopes` count, plus the envelopes currently spiking; a background monitor runs the same spike query every `VERIFIER_SCAN_SPIKE_INTERVAL_SECONDS` and writes one `scanner.spike.detected` outbox event per envelope per baseline window when the last `VERIFIER_SCAN_SPIKE_WINDOW_SECONDS` hold at least `VERIFIER_SCAN_SPIKE_MIN_SCANS` scans and at least `VERIFIER_SCAN_SPIKE_RATIO` times the code's own per-window baseline over `VERIFIER_SCAN_SPIKE_BASELINE_SECONDS` (defaults `60`, `60`, `30`, `10.0`, `3600`); the monitor only runs with `QRTRUST_NETWORK_DATABASE_URL` set and reports itself as `scan_spike_alerts_enabled` on `/verifier/status`
- at the edge, add a rate limit the application cannot see past: a Cloudflare or WAF rule of about 100 requests a minute per client address on `/verifier/*`, with a challenge on bursts, absorbs the volumetric flood before it reaches the per-code budget
- DB-backed verifier-client keys protect verifier POST routes; static
  `VERIFIER_API_KEYS` require explicit `VERIFIER_STATIC_API_KEYS_ENABLED=true`
  local opt-in
- verifier client keys are managed through audited
  `/admin/verifier-clients/api-keys/*` endpoints; retired
  `/verifier/admin/api-keys/*` routes return `410 Gone`
- responses include `X-Request-ID` for request tracing
- the older `/certificates/*`, `/qrcodes/*`, and `/organizations/*` experimental routes have been removed and return `404`

From [backend](../../backend):

```bash
PYTHONPATH=.. ./.venv/bin/uvicorn backend.app.main:app --reload
```

Then open:

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/docs`

The API is headless: `GET /` returns a JSON service descriptor, and the React
workbench in [frontend](../../frontend) is the interactive client. There are no
server-rendered HTML pages.

### Choosing a validity window

Signed claims carry `issued_at` and `expires_at` and nothing else about
freshness. The scanner consults the artifact the same way on every
presentation inside that window, and the `freshness` residual family blocks it
past `expires_at`. Every presentation of one envelope is evaluated the same
way; the verifier keeps no per-presentation state.

So the window is the whole decision. Pick it by how long the code must stay
valid, and re-issue rather than expect the verifier to remember anything:

- a code with a natural end — a campaign poster, an event week, a batch of
  packaging — should carry that end as `expires_at`
- a hand-off worth little once used — a ticket, a voucher — should carry a
  short window, minutes rather than days, so a photographed code goes cold on
  its own
- signage that genuinely cannot carry a short expiry stays acceptable for as
  long as the window and the issuer's certificate both hold; the per-envelope
  budget, the verdict cache and the edge rate limit bound the volume, not the
  acceptance

The workbench's **Validity window** section seals the window. It defaults to 5
minutes ahead and offers an **Expires at** picker up to 30 days out; the
server rejects longer lifetimes with `422`. The **Expired credential**
scenario seals an already-closed window whatever you pick. The step says how
long the next code will stay valid before you press **Generate**, and the
sealed card counts it down afterwards under its collapsed **Code details**
(see the `Expires` row below).

### Scan accounting and spike alerts

Every computed verdict lands in `qr_trust.scanner_decisions`, and the two
operator views built on it share one query each, so what the ledger shows is
what the alert fires on:

- `GET /admin/scan-accounting?days=7&limit=200` groups the evidence rows by
  issuer and UTC day (`days=1` is today so far; scans with no issuer on the
  envelope are reported under `issuer_id: null` rather than dropped). Each row
  carries `scan_count`, the `green_count`/`orange_count`/`red_count` split and
  `distinct_envelopes`, which is the number a hosted deployment would meter or
  cap per issuer.
- The same response lists `spikes`: envelopes whose scans in the trailing
  `spike_window_seconds` clear `spike_min_scans` and `spike_threshold_ratio`
  times the code's own per-window baseline. A code with no history is a spike
  as soon as it clears the floor, because a fresh code being hammered is the
  flood case the design is for.

A warm verdict cache answers a repeat scan of the same payload before the
evidence write and before the per-envelope budget, so a flood against a cached
code leaves only a couple of evidence rows a minute. The detector therefore
merges two sources: the evidence rows and the cache's own per-minute counters
(`verdict_rate:<fingerprint>:<minute>` in Redis, or the in-process fallback
when Redis is off, which then counts per API replica). Each spike record
carries `cached_recent_count` and `cached_baseline_count`, so an operator can
see how much of a burst never touched the database. Issuer-day rows count
computed verdicts only: a cached hit is known by envelope, not by issuer and day,
and it costs the deployment a Redis read rather than a verdict.

```bash
python3 - <<'PY'
import json, urllib.request
req = urllib.request.Request(
    "http://127.0.0.1:8000/admin/scan-accounting?days=3",
    headers={"X-Admin-Token": "local-lab-admin"},
)
body = json.load(urllib.request.urlopen(req))
for row in body["issuers"]:
    print(row["day"], row["issuer_id"], row["scan_count"], row["distinct_envelopes"])
print("spiking:", [s["envelope_fingerprint"] for s in body["spikes"]])
PY
```

The endpoint never emits anything. Alerts come from a background monitor in
the API lifespan that runs the identical detector every
`VERIFIER_SCAN_SPIKE_INTERVAL_SECONDS` and inserts a `scanner.spike.detected`
row into `qr_trust.event_outbox`. The payload is the same shape as every
other outbox row -- an event envelope (`type: scanner.spike.detected`,
`root_program_id` from the envelope's evidence rows, `artifact_hash` over the
body) with the spike record above as the body -- because the NATS relay
validates that envelope, maps the type onto a subject it knows
(`qrtrust.<root>.scanner.spike.detected.v1` in the `QRTRUST_SCANNER_AUDIT`
stream) and refuses anything else. A spike on unsigned payloads has no root
program to publish under, so it is logged and shown on
`/admin/scan-accounting` but never written to the outbox. The event
id is bucketed per envelope per baseline window, so repeated ticks, restarts and
extra API replicas collapse onto one row through the outbox's `event_id`
uniqueness, and the alert shows up through the same `/admin/outbox` path and
NATS relay as every other outbox event. The monitor needs
`QRTRUST_NETWORK_DATABASE_URL`; `0` for the interval disables it, and
`/verifier/status` reports `scan_spike_alerts_enabled` with the active knobs.

## React Verifier Workbench

The primary interactive client lives in [frontend](../../frontend).

From [frontend](../../frontend):

```bash
npm run dev
```

By default, Vite proxies `/verifier/*` to:

```text
https://127.0.0.1:8444
```

If your backend is running without TLS instead, override the proxy target:

```bash
VITE_BACKEND_TARGET=http://127.0.0.1:8000 npm run dev
```

Use the non-TLS override only when the verifier API is actually listening on
port `8000`. If another local app owns that port, Vite will proxy lab requests
to the wrong backend and errors such as Django/gunicorn 500 responses are not
verifier failures.

Then open:

- `http://127.0.0.1:5173/`

Current React workbench scope:

- runtime status
- admin key issue / key list refresh
- scenario-based QR generation, including the two key-lifecycle scenarios:
  `Rotated signing key` (verifies under the new key while a code sealed
  before the rotation still verifies under the retired key) and
  `Revoked signing key` (blocks at the issuer chain with cause `key-revoked`)
- direct verifier pass against the current QR payload
- live camera capture with browser decode or bundled fallback decode
- QR image upload and decode
- scanned payload verification
- fullscreen QR display for second-screen testing
- A/B comparison: pair the current scenario with one that differs by a single
  trust layer, see that layer named, and load the paired case from the verdict

### A/B comparison

The workbench can pair the current scenario (**A**) with a second one (**B**)
that differs from it by exactly one trust layer, so any change in the verdict
is attributable to one cause. Every scenario is the `valid` case with a single
layer perturbed, which is what makes the pairing meaningful.

- On step 1, open **Compare against a second scenario** and pick B. The pair is
  written to the URL as `?compare=<scenario>`, so a shared or reloaded link
  keeps it (for example `/?scenario=payload-mismatch&compare=valid`).
- The comparison card lists the evidence layers in verification order (issuer,
  destination binding, redirect policy, freshness, runtime safety, verifier
  cache, artifact integrity) and highlights the **changed layer**. If two
  scenarios exercise the same layers it says so instead of inventing a
  difference.
- On step 4 the same card offers **Load B**: it generates the paired QR, then
  swaps A and B, so the verdict can flip between the two cases without going
  back to step 1.

`make check-frontend-comparison` pins every scenario's summarised layers to its
documented `expectedOutcome.layer`; the route smoke additionally asserts the
card renders and names `Destination binding` for the documented pairs.

### Phone-scan feedback

When the sealed QR is on screen (step 2, or the full-screen display), the
workbench polls
`GET /verifier/scan-activity?envelope_id=<64 hex>` every 5 seconds and shows
what the verifier recorded for **this envelope**. The identifier is derived
from what was signed — `sha256(canonical_claims + "." + signature)` — so a
regenerated code is a different envelope with its own activity, and no
`issued_at` disambiguator is needed: the sealed `issued_at` is inside the hash.
`POST /verifier/demo-materials` returns the `envelope_id` the workbench polls
with. Reading scan activity never records a scan; only
`POST /scanner/decisions` does. The card shows:

- the QR frame itself: nothing is drawn on the code before the first scan
  (a scan can come from a phone, a tablet, a laptop camera or the browser
  lab, so the page does not guess). Once a scanner decision for the envelope
  exists the frame glows in the verdict colour — green, amber or red — and a
  moment later shows **Scanned · verified / needs review / blocked `<time>`**
  in the same colour. If the evidence store cannot answer, a muted pill says
  so instead of implying "no scans yet";
- `Expires` — a live countdown to the sealed claims' `expires_at` (`in 4m 43s`,
  then `expired 2m 10s ago`). It is computed from the signed claims on the
  page, not from the verifier. The window is the whole freshness input: inside
  it every presentation is evaluated the same way, and past `expires_at` the
  `freshness` family blocks the scan;
- `Scans` (total plus a verified / review / blocked breakdown), `First scan`
  (only once there is more than one scan), `Last scan`, and `Scanner`
  (`iPhone app`, `Web lab (simulated)` for the browser lab's own simulated scan,
  or `Unknown scanner`);
- `Verdict` — what the phone was told for the latest scan, in the verdict
  colour: the decision state plus `risk <n>/100` and `hold to open` when they
  apply. It is composed from the same recorded decision as the "observed
  decision" toast, so the two never disagree;
- `Destination` — what the scanner reported doing with that decision through
  `POST /scanner/ux-events`: `Opened by the scanner`, `Cancelled by the scanner`,
  `Hold completed, not opened`, `Previewed, not opened`, or `Not reported by the
  scanner`. UX events are kept in the verifier process's memory (not the
  evidence store), so this row says *not reported* rather than guessing when no
  event for the decision reached this verifier instance;
- `Vouched by` — the issuer and first verified domain the demo claims were
  signed for, shown only once a scan came back green, i.e. once the verifier
  has actually vouched for it;
- a `Throttle` row read from the scan-flood state the verifier reports for
  that envelope — how many scans were answered from the verdict cache and how
  much of the per-envelope budget is left in the current window
  (`3 cached · 297 of 300 scans left per minute`). The budget bounds how much
  evidence one envelope may accumulate; a repeat presentation inside the
  validity window still verifies.

Everything on the card is read back from data the verifier actually holds; a
row whose data is missing is omitted rather than filled in (there is no
region/geo row, for example, because no scan records a location).

The feedback is read back from the scanner-decision evidence store, so it is
only reported when the verifier has one (`QRTRUST_NETWORK_DATABASE_URL`; the
Compose stack configures it). Without one, or while the store is unreachable,
the card says **Scan feedback unavailable** and explains why — it never shows
`None yet` for scans it cannot see. Lookups are keyed by a fingerprint of the
the envelope identifier (`scanner_decisions.envelope_fingerprint`, migration
`0008`; the first 16 hex characters of `envelope_id`), never the full
identifier, and the endpoint is subject to the verifier API key and rate limit
like every other verifier read.

Optional local HTTPS for Safari or other secure-context camera testing:

```bash
FRONTEND_TLS_ENABLED=true \
FRONTEND_TLS_CERT_FILE=../local/https/verifier-lab.pem \
FRONTEND_TLS_KEY_FILE=../local/https/verifier-lab-key.pem \
VITE_BACKEND_TARGET=https://127.0.0.1:8444 \
npm run dev -- --host 0.0.0.0 --port 5173
```

## Native iPhone Scanner

The native iPhone scanner app lives in [ios/VerifierLabApp](../../ios/VerifierLabApp).

Use it when you need:

- immediate native feedback for blocked states such as `payload_revalidation`
- real camera behavior on iPhone without Safari/browser quirks
- an end-user scanner surface for QR decisions produced by the live verifier API

Open in Xcode:

```text
ios/VerifierLabApp/VerifierLabApp.xcodeproj
```

Local developer endpoint configuration:

- simulator: `http://127.0.0.1:8000`
- physical iPhone: generate the ignored Xcode provider profile with `make ios-provider-config`

The physical-device endpoint is a developer-side local lab setting. It is not
shown as an end-user app field, because production scanner users should receive
managed verifier providers rather than pasted raw endpoints.

For a real iPhone on the same Wi-Fi, start the backend with local TLS and admin tokens:

```bash
make up-https-admin
```

If another local stack already owns the default Postgres or Redis host ports,
keep this stack isolated by moving only the host-side DB and Redis bindings:

```bash
make up-https-admin POSTGRES_PUBLISH_PORT=55432 REDIS_PUBLISH_PORT=6385
```

The HTTPS stack publishes the React workbench at `https://<host>:8443` and the
API at `https://127.0.0.1:8444`. The `:8443` URL the iPhone app dials is the
workbench origin, which proxies `/verifier/*` and `/scanner/*` to the API.

If you want to reuse an existing local Postgres/Redis stack, use:

```bash
make ensure-shared-infra-db
make check-shared-infra-network
make up-https-admin-shared-infra
```

This uses the existing Postgres user `publisher`, creates or reuses database
`qr_trust_poc`, and keeps its verdict cache, per-envelope scan budgets and
request rate limits in Redis DB `5`.

Compose applies backend Alembic migrations before the API starts, including the
QR Trust reference tables used by `/admin/outbox`, `/admin/audit`, scanner
decision evidence, runtime observations, and event-outbox propagation. The
TypeScript network schema helper remains useful for shared-infra drift checks
and local smoke drills, but compose no longer depends on it as the normal source
of schema truth.

When the shared-infra or compose network database is configured through
`QRTRUST_NETWORK_DATABASE_URL`, `GET /verifier/status` also exposes
operator-visible evidence panels for:

- Postgres event-outbox propagation health
- runtime-safety observations written by provider integrations

These panels are read-only. They help operators see propagation and
present-time destination-safety posture without making the FastAPI verifier own
NATS workers or runtime-provider ingestion.

For production-style management inspection, use the management API through the
CLI. These commands read Postgres-owned state through `/admin/*`; they do not
read from NATS or mutate trust state.

For the local HTTPS stack started above, set the published API port and local
self-signed TLS mode once in the shell before running host-side `qrtrustctl`
commands:

```bash
export API_PUBLISH_PORT=8444
export QRTRUSTCTL_INSECURE_TLS=true
```

Without those variables, host-side `qrtrustctl` defaults to the plain local
Compose API at `http://127.0.0.1:8000`. You can always override discovery with
`QRTRUSTCTL_BASE_URL` or `--base-url`.

`local-lab-admin` is the local bootstrap credential used by this guide. The
same `X-Admin-Token` header can carry an active DB-backed management API key
from `qr_trust.management_api_keys`; `/admin/*` endpoints enforce the key's
scopes and write its key id into audit rows.

Issue a scoped management key when you want an operator credential that is
audited and revocable without keeping the bootstrap token in regular use. The
plaintext key is returned only once by the issue command; later list and audit
views expose metadata only:

```bash
python backend/scripts/qrtrustctl.py \
  --admin-token local-lab-admin \
  management-key-issue \
  --label "demo audit operator" \
  --scope audit:read \
  --scope outbox:read

python backend/scripts/qrtrustctl.py \
  --admin-token local-lab-admin \
  management-key-list

python backend/scripts/qrtrustctl.py \
  --admin-token local-lab-admin \
  management-key-revoke \
  --key-id mkey_example
```

```bash
python backend/scripts/qrtrustctl.py \
  --admin-token local-lab-admin \
  outbox-status

python backend/scripts/qrtrustctl.py \
  --admin-token local-lab-admin \
  audit-list
```

Use audited outbox remediation when a stale or malformed event should stop
retrying or when a failed event should be retried after fixing its dependency:

```bash
python backend/scripts/qrtrustctl.py \
  --admin-token local-lab-admin \
  outbox-event-remediate \
  --event-id evt_mgmt_stale_policy \
  --action quarantine \
  --reason "stale source policy event"

python backend/scripts/qrtrustctl.py \
  --admin-token local-lab-admin \
  outbox-event-remediate \
  --event-id evt_mgmt_stale_policy \
  --action retry
```

Published outbox events are immutable. If delivered trust state was wrong,
publish a correcting governance event instead of using remediation to requeue
the published row.

Run the production-management live drill when you want one command to exercise
the managed workflow boundary. It proves that destination-policy publication
fails before issuer/domain preconditions, management mutations are idempotent,
issuer enrollment can reach destination-policy publication, governance and
runtime NATS subscribers are authorized through managed allowlists before broad
subject grants are rejected, verifier client keys cannot authenticate to
`/admin/*`, and an optional failed outbox event can be requeued after a
broker-outage repair:

```bash
python backend/scripts/qrtrustctl.py \
  --base-url https://127.0.0.1:8444 \
  --admin-token local-lab-admin \
  --insecure-tls \
  management-live-drill \
  --idempotency-prefix local-management-drill

python backend/scripts/qrtrustctl.py \
  --base-url https://127.0.0.1:8444 \
  --admin-token local-lab-admin \
  --insecure-tls \
  management-live-drill \
  --idempotency-prefix local-management-drill \
  --outbox-retry-event-id evt_mgmt_failed_after_broker_outage \
  --require-outbox-retry
```

Use `--insecure-tls` only for local self-signed HTTPS endpoints. Production
operator commands should rely on normal certificate verification.
Use `--require-outbox-retry` for evidence runs that must prove broker-outage
recovery; the drill fails if no failed outbox event is supplied.

Use the reset-guarded live outbox retry drill when you need the lower-level
Postgres-to-NATS recovery proof. It creates pending authority outbox rows,
marks them failed under a simulated broker outage, reconnects to local NATS, and
asserts the same rows publish after recovery. Because this drill resets
`qr_trust`, reset Make targets reapply backend Alembic afterward so local
shared DBs return to the canonical migration head:

```bash
make check-network-live-outbox-retry
```

For scripted management mutations, use `qrtrustctl` with `--idempotency-key`.
A retry with the same key and same mutation reuses the completed management
result; a retry with different mutation content returns `409` and does not
write another audit or outbox row. Bootstrap root and authority records before
enrolling issuers:

The CLI can also run from the optional `management-tools` Compose profile when
operator scripts need the same packaged runtime as the API container. Use
`make qrtrustctl-container-help` to inspect the containerized command surface.
Set `QRTRUSTCTL_ADMIN_TOKEN` in the shell or pass `--admin-token`; the container
defaults `QRTRUSTCTL_BASE_URL` to `http://api:8000` and does not add another
database writer.

```bash
python backend/scripts/qrtrustctl.py \
  --admin-token local-lab-admin \
  --idempotency-key idem-root-demo \
  root-program-upsert \
  --root-program-id root:qrtrust-demo:2026 \
  --name "QR Trust Demo Root" \
  --program-scope "demo merchant QR trust" \
  --accepted-algorithm-id ES256

python backend/scripts/qrtrustctl.py \
  --admin-token local-lab-admin \
  --idempotency-key idem-authority-demo \
  delegated-authority-upsert \
  --root-program-id root:qrtrust-demo:2026 \
  --delegated-authority-id authority:qrtrust-demo:merchant-web \
  --name "Merchant Web Authority" \
  --authority-type merchant_operator

python backend/scripts/qrtrustctl.py \
  --admin-token local-lab-admin \
  --idempotency-key idem-issuer-demo \
  issuer-enroll \
  --root-program-id root:qrtrust-demo:2026 \
  --delegated-authority-id authority:qrtrust-demo:merchant-web \
  --issuer-id issuer:acme-demo \
  --display-name "ACME Demo" \
  --issuer-class business \
  --assurance-tier domain_controlled

python backend/scripts/qrtrustctl.py \
  --admin-token local-lab-admin \
  --idempotency-key idem-domain-proof-demo \
  domain-proof-upsert \
  --root-program-id root:qrtrust-demo:2026 \
  --delegated-authority-id authority:qrtrust-demo:merchant-web \
  --issuer-id issuer:acme-demo \
  --domain acme.example \
  --proof-method manual_review \
  --verification-status verified \
  --evidence-ref operator://manual-review/acme.example

python backend/scripts/qrtrustctl.py \
  --admin-token local-lab-admin \
  --idempotency-key idem-issuer-active-demo \
  issuer-status-update \
  --root-program-id root:qrtrust-demo:2026 \
  --delegated-authority-id authority:qrtrust-demo:merchant-web \
  --issuer-id issuer:acme-demo \
  --enrollment-status active

python backend/scripts/qrtrustctl.py \
  --admin-token local-lab-admin \
  --idempotency-key idem-policy-demo \
  destination-policy-upsert \
  --root-program-id root:qrtrust-demo:2026 \
  --delegated-authority-id authority:qrtrust-demo:merchant-web \
  --issuer-id issuer:acme-demo \
  --destination-policy-id policy:acme-demo:web-payments:v1 \
  --approved-destinations-json '[{"destination_id":"dest:acme-demo:pay","expected_final_url":"https://acme.example/pay","allowed_hosts":["acme.example"],"allow_subdomains":false,"path_prefixes":["/pay"],"query_policy":"allow_known_payment_query"}]'
```

Destination-policy upsert is intentionally guarded. It only writes the policy,
audit row, and outbox event when the issuer is active and every approved host
has a current verified domain proof in the same root, authority, and issuer
namespace.

Use the same management transaction path to suspend, revoke, expire, or
reactivate an existing destination policy. This is the preferred emergency
rollback path; it writes source state, audit history, and an outbox event
without direct SQL:

```bash
python backend/scripts/qrtrustctl.py \
  --admin-token local-lab-admin \
  --idempotency-key idem-policy-revoke-demo \
  destination-policy-status-update \
  --root-program-id root:qrtrust-demo:2026 \
  --delegated-authority-id authority:qrtrust-demo:merchant-web \
  --issuer-id issuer:acme-demo \
  --destination-policy-id policy:acme-demo:web-payments:v1 \
  --status revoked
```

The `/operator` route also includes a read-only management evidence panel for
the same outbox and audit read paths. Use it for classroom or developer review
when you need to explain what the API and CLI are reading from Postgres.

The same route renders the scanner trust store from `GET /verifier/trust-store`:
one row per issuer with its status and verified domains, and one row per key
with its `state` and validity window. Rotate or revoke the demo key from the
lab's generate step and the table updates on the next refresh.

To smoke-test only the runtime-safety observation report contract, run:

```bash
make check-network-runtime-observations
```

For the reference-network worker path, add local NATS JetStream without making
it the source of truth. The local broker uses static PoC users; the Makefile
and Compose defaults keep separate credentials for the outbox publisher,
governance subscriber, and runtime subscriber.

For the full local HTTPS admin stack with NATS propagation, use
`make up-https-admin-shared-infra-nats`. That target starts the API, frontend,
broker, outbox publisher, governance subscriber, and runtime subscriber together.
Run `qrtrustctl demo-bootstrap` first when the governance and runtime subscribers
need their DB-backed allowlist rows.

```bash
make up-nats
make check-network-stack-ready
make up-network-outbox-worker
make up-network-governance-subscriber-worker
make up-network-runtime-subscriber-worker
make check-network-worker-drill
```

The shared-infra preflight refuses the existing `publisher` database as the QR
Trust database name, checks the separate Postgres database, checks Redis DB `5`,
and reports whether the optional NATS monitor is already online. Host-side Redis
checks use `EXTERNAL_REDIS_SETUP_HOST` (default `127.0.0.1`), while Compose
containers still use `EXTERNAL_REDIS_HOSTNAME` (default `host.docker.internal`).

Use `make check-network-stack-ready` as the non-destructive readiness gate for
the reference-network path. It checks shared Postgres, Redis DB `5`, and live
NATS propagation without resetting the QR Trust schema. Use
`make check-network-worker-drill` only when you want the stronger local worker
proof; it runs the reset-guarded live worker smoke against the separate
`qr_trust_poc` database.

When overriding local NATS credentials, use the service-specific variables
`QRTRUST_OUTBOX_NATS_USER`, `QRTRUST_GOVERNANCE_SUBSCRIBER_NATS_USER`, and
`QRTRUST_RUNTIME_SUBSCRIBER_NATS_USER` with their matching password variables.
Do not collapse all workers onto one NATS user; the local broker permissions are
intentionally narrower per worker role.

Use `make up-network-governance-subscriber-worker` after authorizing the
subscriber through `/admin/nats/subscribers` or `qrtrustctl demo-bootstrap`.
The worker loads `QRTRUST_GOVERNANCE_SUBSCRIBER_ID` from Postgres, applies the
DB-managed subject allowlist, fetches authoritative artifacts by reference, and
materializes verifier-cache state. Tail it with
`make logs-network-governance-subscriber-worker`.

Use `make up-network-runtime-subscriber-worker` after authorizing a subscriber
for `qrtrust.*.runtime.verdict.observed.v1` or a broader runtime family subject
that covers it. `qrtrustctl demo-bootstrap` creates the default
`subscriber:runtime-observations` authorization alongside the governance
subscriber. The worker loads `QRTRUST_RUNTIME_SUBSCRIBER_ID` from Postgres, fetches
`runtime-safety-observation` artifacts by reference, validates artifact hashes,
and persists normalized rows into `qr_trust.runtime_observations`. Tail it with
`make logs-network-runtime-subscriber-worker`.

For federation, stale-cache, or cross-root contradiction demos, start the
optional second verifier node:

```bash
make up-secondary-verifier-node
make logs-secondary-verifier-node
```

The second node runs the same backend image under the `verifier-federation`
Compose profile, publishes on port `8001`, uses verifier id
`verifier:reference-http-runtime-b`, and keeps Redis state separate from the
primary verifier. It still reads QR Trust source state from Postgres; the
different verifier id lets cache entries and scanner decisions be compared
without adding a second source-of-truth database.

Before capturing native evidence, run:

```bash
make ios-provider-config
make check-ios-provider-config
make iphone-evidence-preflight
```

This writes and validates the ignored local provider profile, confirms the HTTPS
verifier is reachable, prints the primary local verifier candidate, detects a
paired physical iPhone, and reports if Developer Mode is disabled.

Native app scope:

- scan QR codes with the native camera
- submit the scanned payload to `/scanner/decisions`
- show green, orange, or red user-facing decisions
- preserve the destination so the user can still choose whether to open it
- show the four-layer decision path for reviewers or curious users
- keep local scan history according to the selected retention setting

Deterministic cross-device rule:

- generate the demo QR from the browser lab on the laptop
- do not click the browser lab's `Check scanner decision` action before the phone scan
- scan that laptop QR from the iPhone app

For the primary native mismatch test:

- browser lab `Scenario = payload-mismatch`
- expected iPhone result = red `Destination changed`
- expected decision-path stage = `payload_revalidation`

See [IPHONE_TEST_PLAN.md](./IPHONE_TEST_PLAN.md) for the full step-by-step drill.

## Important Runtime Note

[main.py](../../backend/app/main.py) attempts a Redis connection during startup when `REDIS_STARTUP_ENABLED=true`. If Redis is not running, startup logs an error and warning, but the narrowed PoC still works because the verifier reference flow falls back to the process-local in-memory verdict cache, scan budgets and rate limits in [verifier.py](../../backend/app/api/endpoints/verifier.py); those then count per API replica instead of across the fleet. Set `REDIS_STARTUP_ENABLED=false` when you want deterministic no-Redis startup behavior.

## Containerized Stack

Preferred local shortcuts from the repository root:

```bash
make up
make up-admin
make up-lan
make up-lan-admin
make up-https-admin
```

`make up-admin` is the standard local path when you want the workbench to issue verifier API keys with:

```text
VERIFIER_ADMIN_TOKENS='["local-lab-admin"]'
VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED=true
```

Production should leave `VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED=false` and use
DB-backed management keys instead of config admin tokens.

From the repository root:

```bash
docker compose up -d --build
docker compose logs -f api
```

This starts:

- `postgres`
- `redis`
- `api`
- `frontend`

The published API port defaults to `127.0.0.1:8000` for local development.
The published frontend port defaults to `127.0.0.1:5173`.
The published Postgres and Redis ports default to `127.0.0.1:5432` and
`127.0.0.1:6379`.
For phone or tablet testing on the same Wi-Fi, override the API and frontend host bind:

```bash
API_PUBLISH_HOST=0.0.0.0 FRONTEND_PUBLISH_HOST=0.0.0.0 docker compose up -d --build
```

If you want the frontend workbench reachable on the LAN as well:

```bash
API_PUBLISH_HOST=0.0.0.0 FRONTEND_PUBLISH_HOST=0.0.0.0 docker compose up -d --build
```

You can also override the published port:

```bash
API_PUBLISH_HOST=0.0.0.0 API_PUBLISH_PORT=8010 docker compose up -d --build
```

When another local stack already owns the default host ports, prefer this
side-by-side command:

```bash
make up-admin API_PUBLISH_PORT=8010 FRONTEND_PUBLISH_PORT=5175 POSTGRES_PUBLISH_PORT=5433 REDIS_PUBLISH_PORT=6380
```

The PoC still uses its own containerized `postgres` and `redis` services; these
overrides only move their published host ports away from existing projects.

After the stack is running, verify both the backend verifier contract and the
React workbench routes:

```bash
make smoke-compose FRONTEND_PUBLISH_PORT=5175
```

For an HTTPS stack started with `make up-https-admin` or
`make up-https-admin-shared-infra`, use:

```bash
make smoke-compose-https
```

The smoke target checks:

- `/verifier/status`
- API key issue, QR demo-material generation, and two accepted verifications of
  the same envelope inside its validity window
- the React root route
- the lab comparison route at `/?scenario=payload-mismatch&autogenerate=1&compare=valid`

For the React app itself, run the route-query navigation smoke while the dev
server is active:

```bash
make check-route-navigation FRONTEND_DEV_PORT=5173
```

That browser check pushes query-only route changes inside the same page session
and verifies that `/`, `/about`, and `/operator` refresh their state. It is
the regression guard for stale guided-track, scenario, or operator-handoff
state when only the query string changes.

If you run the React dev server outside Docker on `5173`, point its Vite proxy
at the published compose API port:

```bash
make dev-frontend API_PUBLISH_PORT=8010
```

The Vite proxy derives its default backend target from `API_PUBLISH_HOST` and
`API_PUBLISH_PORT`. Use `VITE_BACKEND_TARGET=http://127.0.0.1:8010` only when
you need to override that derived target explicitly.

To capture browser evidence for the primary engineering outcomes, keep the dev
server running and execute:

```bash
make capture-browser-evidence FRONTEND_DEV_PORT=5173
```

The capture script stores:

- `docs/public/evidence/browser/accepted.png`
- `docs/public/evidence/browser/payload-mismatch.png`

The compose flow runs Alembic migrations before starting the API. To stop the stack:

```bash
docker compose down
```

The current compose baseline was validated by:

- `docker compose config`
- `docker compose up -d --build`
- live verifier request cycle executed inside the API container

If your host already uses port `8000`, change `API_PUBLISH_PORT`.
If your host already uses `5173`, change `FRONTEND_PUBLISH_PORT`.
If your host already uses `5432` or `6379`, change `POSTGRES_PUBLISH_PORT` or
`REDIS_PUBLISH_PORT`.

## Phone Testing

To open the React workbench from your phone:

1. Start the stack with LAN publishing:

```bash
export VERIFIER_ADMIN_TOKENS='["local-lab-admin"]'
export VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED=true
API_PUBLISH_HOST=0.0.0.0 FRONTEND_PUBLISH_HOST=0.0.0.0 docker compose up -d --build
```

2. Find your Mac's LAN IP. Common commands on macOS are:

```bash
ipconfig getifaddr en0
ipconfig getifaddr en1
```

3. On the phone, while connected to the same Wi-Fi, open:

```text
http://<mac-lan-ip>:5173/
```

4. Open the React verifier workbench directly.

5. If verifier auth is enabled, enter the admin token in the workbench, issue a
   key, and the client will auto-load that key into the API key field.

Practical testing note:

- if you want to test the phone camera scanning path, display the generated QR
  on a second device such as your laptop screen
- if you only want to test the phone browser, upload a QR image or use `Verify
  current QR without scanning`
- if you scan the generated QR with the native Camera app instead of the workbench,
  the phone will open the QR payload URL directly and bypass verifier checks
- on iPhone Safari over plain `http://<mac-lan-ip>:...`, `getUserMedia` may be
  unavailable because the page is not in a secure context; use image upload,
  direct verify, or HTTPS if you need camera capture

## Local HTTPS With mkcert

If you want true iPhone Safari camera capture, use local HTTPS instead of plain
LAN HTTP.

Generate local certs from the repository root:

```bash
./scripts/create_local_https_certs.sh
```

That creates ignored local files under `local/https/`:

- `verifier-lab.pem`
- `verifier-lab-key.pem`
- `mkcert-rootCA.pem`

Start the stack with TLS enabled:

```bash
FRONTEND_PUBLISH_HOST=0.0.0.0 \
FRONTEND_TLS_ENABLED=true \
VERIFIER_ADMIN_TOKENS='["local-lab-admin"]' \
VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED=true \
docker compose up -d --build
```

Then open:

```text
https://<mac-lan-ip>:5173/
```

Important iPhone trust step:

1. Move `local/https/mkcert-rootCA.pem` to the iPhone.
2. Install the profile/certificate.
3. Enable trust in:
   `Settings > General > About > Certificate Trust Settings`

Without trusting the mkcert root CA on the phone, Safari will not treat the
React workbench as a secure context for camera capture.

## Minimal API Flow

1. Call `POST /verifier/demo-materials`
2. Use either:
   - the returned `verify_request` with `POST /verifier/verify`, or
   - the returned `qr_payload` with `POST /verifier/verify-scanned`
3. Re-send the same request: it is accepted again, because every presentation
   of one envelope inside its validity window is evaluated the same way
4. Optional: call `POST /verifier/demo-materials` again with
   `{"rotate_key": true}`. The new artifact verifies under the successor key
   and the first `qr_payload` still verifies through `POST /verifier/verify-scanned`,
   because a retired key keeps vouching for what it signed while current
5. Optional: call it with `{"key_state": "revoked"}` and re-scan the
   artifact it returns: `allowed = false`, `stage = "key_status"`, and the
   `residual_vector` `issuer_chain` entry carries cause `key-revoked`.
   `GET /verifier/trust-store` shows the same key as `revoked`

## Browser Clients

Primary React workbench:

- `http://127.0.0.1:5173/` in local development
- `http://<mac-lan-ip>:5173/` for LAN testing

It provides:

- runtime posture loading from `GET /verifier/status`
- scenario-based demo QR generation
- camera scanning using the browser `BarcodeDetector` API when available
- bundled verifier-side image decode fallback for browsers without `BarcodeDetector`
- fallback camera decoding that pauses/resumes on `429` instead of failing hard
- selectable camera sources for multi-camera devices
- QR image upload decoding
- QR PNG download, payload copy, and fullscreen QR display for cross-device testing
- direct submission to `POST /verifier/verify-scanned`
- verifier API key issue and list refresh when admin tokens are configured
- result history across verifier stages
- A/B comparison of two scenarios that differ by one trust layer (see above)

If API key auth is enabled on the server, enter the key in the workbench's
`API key` field. The value is stored only in local browser storage and attached
as `X-API-Key` on verifier POST requests.

If you run a separate frontend origin instead of the proxied workbench, set
`CORS_ORIGINS` explicitly. The default public-safe runtime is same-origin.

## Compose-Backed Live HTTP Smoke

If you want a real HTTP verification cycle against the running server rather
than `TestClient`, set an admin token and run the smoke script:

```bash
export VERIFIER_ADMIN_TOKENS='["local-lab-admin"]'
export VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED=true
docker compose up -d --build
cd backend
VERIFIER_SMOKE_ADMIN_TOKEN=local-lab-admin ./.venv/bin/python scripts/verifier_live_http_smoke.py
```

The smoke script calls the live `/verifier/status`,
`/admin/verifier-clients/api-keys/issue`, `/verifier/demo-materials`, and
`/verifier/verify-scanned` endpoints over HTTP.

## Request Logging Discipline

The public verifier surface uses sanitized request logging:

- request logs contain request ID, method, path, status, and duration
- request and QR payload bodies are not logged
- noisy third-party request logs are reduced to keep verifier traces readable

## Removed Experimental API

The older broad experimental surface has been removed from the codebase and is
no longer mounted under any flag:

- `/certificates/*`
- `/qrcodes/*`
- `/organizations/*`

Those routes performed unauthenticated write operations and did not match the
public PoC boundary. Requests to them now return `404`. The supported HTTP
surface is `/verifier/*`, `/scanner/*`, and `/admin/*`.

## Public Scope Boundary

This run guide does not cover:

- filing artifacts
- private form generation
- patent-source documents
- local-only materials under `private/`
