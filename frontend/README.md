# Frontend Workspace

This directory contains the React-based verifier workbench.

Stack:
- Vite 8
- React 19
- Tailwind CSS v4
- shadcn/ui

Current scope:
- runtime posture from `GET /verifier/status`
- operator evidence panels for event-outbox propagation and runtime-safety
  observations when `QRTRUST_NETWORK_DATABASE_URL` is configured
- verifier API key issue and list flow
- scenario-based demo QR generation
- direct verification of the current QR payload
- live camera capture with browser decode or bundled fallback decode
- QR image upload and decode through `POST /verifier/decode-image`
- scanned verifier submission through `POST /verifier/verify-scanned`
- fullscreen QR display for cross-device scanning

Local development:

```bash
npm install
npm run dev
```

By default, the Vite dev server proxies `/verifier/*` and `/scanner/*` to the
HTTP API:

```text
http://127.0.0.1:8000
```

When the stack is running through `make up-https-admin` or
`make up-https-admin-shared-infra`, use the HTTPS dev target:

```bash
make dev-frontend-https
```

That points the Vite proxy at:

```text
https://127.0.0.1:8444
```

Override that target if needed:

```bash
VITE_BACKEND_TARGET=http://127.0.0.1:8000 npm run dev
```

Use that override only when the verifier API is actually running without TLS
on port 8000. If another local service owns port 8000, the lab will proxy to
the wrong app and QR generation can fail with unrelated 500 responses.

Optional local HTTPS for iPhone Safari camera testing:

```bash
FRONTEND_TLS_ENABLED=true \
FRONTEND_TLS_CERT_FILE=../local/https/verifier-lab.pem \
FRONTEND_TLS_KEY_FILE=../local/https/verifier-lab-key.pem \
VITE_BACKEND_TARGET=https://127.0.0.1:8444 \
npm run dev -- --host 0.0.0.0 --port 5173
```

If the operator page reports a 502 from `/verifier/status`, or the lab reports
500s from a Django/gunicorn server, the Vite dev server is pointing at the
wrong API mode. Restart it with the matching target instead of changing the
application code.

Build:

```bash
npm run build
npm run lint
```
