# Scanner Decision HTTP Runtime

Date: 2026-05-20

Status:
- draft reference contract
- non-normative
- intended for local runtime validation and deployment review

## Purpose

The scanner-decision HTTP runtime is the narrow service edge that scanner
clients call at scan time. It adapts HTTP requests to the scanner-decision
service and reads only the verifier cache plus runtime-safety provider state.

It is not an authority service. It must not decide issuer enrollment,
destination policy publication, key custody, or governance delegation from
source tables during a scan. Those decisions are made upstream and projected
into verifier-cache state before the scanner asks for a decision.

## Runtime Endpoints

### `GET /healthz`

Returns a small readiness response for load balancers and smoke tests.

Example response:

```json
{
  "service": "qrtrust-scanner-decision-runtime",
  "status": "ok",
  "verifier_id": "verifier:reference-http-runtime",
  "decisions_endpoint": "/scanner/decisions"
}
```

### `POST /scanner/decisions`

Accepts a QR payload and returns a `scanner-decision.schema.json` response.

Example request:

```json
{
  "payload": "https://acme.example/pay",
  "issuer_hint_host": "acme.example",
  "observed_at": "2026-05-20T18:02:00.000Z"
}
```

Rules:

- `payload` is required and must be a non-empty string.
- `issuer_hint_host` is optional and should be the host implied by a trusted
  caption, app context, or generator hint when available.
- `observed_at` is optional and must be an ISO-8601 timestamp when supplied.
- Both snake-case and camel-case field names are accepted for scanner clients
  that cannot easily normalize request JSON.

## Source-of-Truth Boundary

The runtime reads:

- `qr_trust.verifier_cache_entries` through the verifier-cache port
- runtime-safety provider observations through the runtime-safety port

The runtime writes:

- scanner decision rows through the persistence port
- scanner decision events through the event-bus port

The runtime must not:

- query root, delegated-authority, issuer, or destination-policy source tables
  during a scanner request
- publish source governance artifacts
- enqueue NATS propagation events as part of the request path
- treat Redis or NATS as authoritative trust state

Postgres remains the durable authority for trust-network state. NATS is a
propagation path. Redis may be a hot-path optimization, but a Redis miss cannot
be treated as a governance decision.

## Failure Posture

The HTTP adapter should fail closed at the transport boundary:

- malformed JSON returns `400`
- missing or invalid request fields return `400`
- syntactically malformed destinations return `422`
- unexpected runtime failures return `500`

The scanner-decision service should still preserve the paper's user-visible
discipline:

- unknown or unavailable trust state maps to orange, not green
- explicit destination mismatch, block state, or an expired envelope
  (`freshness` block, cause `object-expired`) maps to red
- runtime safety unavailable must not produce a strong green state
- positive green decisions require issuer legitimacy, destination binding,
  runtime safety, and acceptable verifier-cache freshness

## Environment

The reference runtime uses these inputs:

```sh
QRTRUST_NETWORK_DATABASE_URL=postgres://publisher:publisher@127.0.0.1:5432/qrtrust
QRTRUST_SCANNER_DECISION_HOST=127.0.0.1
QRTRUST_SCANNER_DECISION_PORT=8090
QRTRUST_SCANNER_VERIFIER_ID=verifier:reference-http-runtime
```

The production verifier ID should identify the scanner fleet or verifier cache
profile whose derived state is being used.

## Verification

Run the deterministic HTTP smoke without Postgres:

```sh
cd network && npm run scanner-decision:http-runtime-smoke
```

Run the Postgres-backed scanner decision drill:

```sh
make check-network-live-scanner-decision
```

That target resets the disposable QR Trust schema, publishes the reference
governance artifacts, materializes verifier-cache state, then exercises both
the direct scanner-decision service and the HTTP runtime. It verifies
`GET /healthz`, a valid `POST /scanner/decisions`, a malformed-destination
`422`, and the persisted scanner-decision/event-outbox evidence.

Run the local packaged runtime against a configured network database:

```sh
cd network && QRTRUST_NETWORK_DATABASE_URL=postgres://publisher:publisher@127.0.0.1:5432/qrtrust npm run scanner-decision:runtime:dev
```

The deployment readiness bundle fingerprints this contract so operators can
review the scanner-facing runtime boundary beside the readiness report,
evidence map, production environment template, and runbook.
