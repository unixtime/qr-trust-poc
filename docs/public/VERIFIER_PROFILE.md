# Verifier Profile

This document defines the current public PoC behavior for the narrowed verifier
flow implemented in:

- [verifier.py](../../backend/app/api/endpoints/verifier.py)
- [narrowed_verifier_poc.py](../../backend/app/services/narrowed_verifier_poc.py)
- [payload_revalidation_poc.py](../../backend/app/services/payload_revalidation_poc.py)
- [signed_schema_poc.py](../../backend/app/services/signed_schema_poc.py)
- [qr_artifact_poc.py](../../backend/app/services/qr_artifact_poc.py)

## Goal

Define a verifier contract that is narrower and more explicit than generic
"signed QR" language. The current PoC focuses on deterministic acceptance and
failure behavior.

## API Surface

Current public reference endpoints:

- `GET /verifier/status`
- `GET /verifier/trust-store`
- `POST /verifier/demo-materials`
- `POST /verifier/verify`
- `POST /verifier/verify-scanned`
- `POST /verifier/decode-image`

`POST /verifier/demo-materials` intentionally does not return the signing
private key. It returns only the material needed to exercise the verifier flow,
plus a `trust` echo (`key_ref`, `key_state`, `issuer_status`,
`retired_key_refs`) naming the key the artifact was sealed under.

`GET /verifier/trust-store` is the read-only view of the issuers and keys the
scanned path trusts: `issuers[]` (`issuer_id`, `issuer_name`, `root_id`,
`status`, `issued_at`, `expires_at`, `verified_domains`, `allow_subdomains`)
and `keys[]` (`key_ref`, `issuer_id`, `algorithm_id`, `state`, `not_before`,
`not_after`, `revoked_at`, `revocation_reason`). It is gated like `/status`
evidence: open when verifier API key auth is disabled, otherwise it requires a
management credential. Nothing on this surface writes to the store; only
`demo-materials` does.

The primary interactive client is now the React frontend in
[frontend](../../frontend), which uses
the same `/verifier/*` API surface and can optionally be served over local
HTTPS for secure-context camera testing on iPhone Safari.

The older `/certificates/*`, `/qrcodes/*`, and `/organizations/*` experimental
routes have been removed from the codebase and return `404`.

POST endpoints under `/verifier/*` are rate-limited per client. Image decode is
subject to a stricter limit than the other verifier actions because it is the
most expensive parsing path. Redis-backed coordination is used when Redis is
connected; otherwise the PoC falls back to process-local in-memory limits.

DB-backed verifier-client keys protect POST endpoints under `/verifier/*`.
Static `VERIFIER_API_KEYS` are a local-only fallback and require explicit
`VERIFIER_STATIC_API_KEYS_ENABLED=true` opt-in. The interactive clients remain
public so they can load, but their POST actions must include the key when the
server requires one.

Verifier client keys are managed through audited management-plane endpoints
under `/admin/verifier-clients/api-keys/*`. The retired
`/verifier/admin/api-keys/*` lab mutation surface returns `410 Gone` so key
changes do not bypass scoped management credentials or audit history. The
verifier remains locked when API-key auth is enabled, even if no dynamic key is
currently active.

## QR Artifact Contract

The QR artifact layer serializes the signed envelope as compact JSON with this
shape:

- `claims`
- `signature`
- `code_algorithm_id` when present

Rules:

- `claims` must satisfy the exact signed-claims contract
- `signature` must be present in the QR payload
- unsupported top-level envelope keys are rejected
- QR payloads above the configured maximum size are rejected
- QR PNG rendering is a transport layer, not a source of truth
- verification of scanned QR data uses the decoded QR payload string, not image-level metadata
- image decode fallback is available through `POST /verifier/decode-image`
- oversized or over-large image decode requests are rejected before QR parsing

## Signed Claims Contract

Signed claims must contain exactly these fields, in this order:

1. `version`
2. `certificate_ref`
3. `issued_at`
4. `expires_at`
5. `payload`

Rules:

- no unknown signed-claim fields
- no missing signed-claim fields
- `version` must be exactly `2`
- `issued_at` and `expires_at` must be ISO-8601 timestamps with timezone information
- `expires_at` must be later than `issued_at`

The canonical claim order is defined in [signed_schema_poc.py](../../backend/app/services/signed_schema_poc.py).

## Envelope Identity

An envelope is identified by a value derived from what was signed, not by a
field carried inside the claims:

- `envelope_id = sha256(canonical_claims + "." + signature)`, lowercase hex,
  64 characters
- `envelope_fingerprint` is the first 16 hex characters of `envelope_id`, used
  where a short human-readable handle is wanted

`POST /verifier/demo-materials` returns the `envelope_id` of the artifact it
generated, and `POST /scanner/decisions` returns the `envelope_id` of the
envelope it evaluated. Mutating any signed claim changes `envelope_id`.
`GET /verifier/scan-activity?envelope_id=<64 hex>` reads scan activity for one
envelope.

## Certificate And Algorithm Rules

Current PoC rules:

- the signed `certificate_ref` must match the authoritative certificate record
- the certificate is the authoritative source of `algorithm_id`
- `code_algorithm_id` is optional and treated only as a mirror hint
- if `code_algorithm_id` is present and conflicts with the certificate, verification fails
- the current supported certificate algorithm is `rsa-pss-sha256-v1`

## Verifier Chain

The narrowed verifier evaluates a presented code in this order:

1. canonicalize signed claims
2. verify signed envelope against the authoritative certificate
3. enforce certificate status
4. enforce time window
5. revalidate the payload destination against issuer-controlled state

Every presentation of one envelope is evaluated the same way; the verifier
keeps no per-presentation state. Freshness is carried entirely by the validity
window (`issued_at` … `expires_at`) in the signed claims, and the `freshness`
residual family blocks past `expires_at`.

## Issuer State Contract

Current issuer state fields:

- `verified_domains: list[str]`
- `allow_subdomains: bool`
- `certificate_active: bool`
- `certificate_revoked: bool`
- `certificate_revocation_reason: str | None`

Optional lifecycle fields (the trust-store record supplies them on the scanned
path; `POST /verifier/verify` accepts them inline so a rehearsal can express
the same state):

- `issuer_status: "active" | "suspended" | "revoked" | None`
- `issuer_record_issued_at: str | None`, `issuer_record_expires_at: str | None`
- `key_state: "active" | "retired" | "revoked" | None`
- `key_not_before: str | None`, `key_not_after: str | None`
- `key_revocation_reason: str | None`

Behavior:

- `certificate_revoked = true` folds onto `issuer_status = "revoked"` and
  `certificate_active = false` onto `issuer_status = "suspended"`; both fail at
  the `issuer_status` stage (causes `issuer-revoked` and `issuer-inactive`)
- payload acceptance depends on the current `verified_domains` and `allow_subdomains` policy, not just the original signed payload

## Key Lifecycle Contract

A signing key is `active`, `retired`, or `revoked`, and an issuer is `active`,
`suspended`, or `revoked`. The rules run in this order, and the first one that
fires names the stage and cause:

| Condition | `stage` | `cause` |
| --- | --- | --- |
| issuer `revoked` | `issuer_status` | `issuer-revoked` |
| issuer not `active` | `issuer_status` | `issuer-inactive` |
| key `revoked` | `key_status` | `key-revoked` |
| issuer record not yet valid | `issuer_status` | `issuer-record-not-yet-valid` |
| issuer record expired | `issuer_status` | `issuer-record-expired` |
| artifact `issued_at` outside the key's `[not_before, not_after]` | `key_status` | `key-window-mismatch` |
| artifact not yet valid | `time_window` | `not-yet-valid` |
| artifact past `expires_at` | `time_window` | `object-expired` |
| otherwise | `accepted` | — |

Two consequences follow:

- **Rotation is not revocation.** A retired key still vouches for every
  artifact whose `issued_at` falls inside its window, so codes sealed before a
  rotation keep verifying. Only an artifact sealed after `not_after` fails, with
  `key-window-mismatch`.
- **Revocation is terminal.** A revoked key never returns to `active`; the
  demo issuer mints a fresh key reference instead. Everything the revoked key
  signed blocks with `key-revoked`, whatever its window says.

The demo issuer keeps one process-stable key. `POST /verifier/demo-materials`
accepts `rotate_key: true` (mint a successor, retire the current key) and
`key_state: "retired" | "revoked"` (set the current key's state), and echoes the
result under `trust`. The store is in-memory for this cycle and resets with the
API process.

## Payload Revalidation Rules

Destinations and policy rules are both reduced to canonical form (RFC 3986)
before any comparison:

- trim surrounding whitespace; a payload without a scheme is parsed as
  `https://...`
- lowercase the scheme and the host; encode the host as IDNA/punycode
- strip a single trailing `.` from the host; strip a leading `www.` for
  host matching
- fold default ports (`:80` for http, `:443` for https) to absent
- percent-decode unreserved characters only
- resolve dot-segments (RFC 3986 section 5.2.4)

A destination that cannot be canonicalized is rejected with cause
`destination-invalid`: userinfo, a backslash in the authority or path,
control characters, an empty host, or a non-http(s) scheme.

Current matching rules:

- exact host match is allowed
- subdomain match is allowed only when `allow_subdomains` is true
- matching is against the issuer's current verified domain set; a domain
  whose proof has expired no longer matches
- the destination scheme must appear in the rule's `allowed_schemes`
  (absent means `https` only)
- an explicit non-default port must appear in the rule's `allowed_ports`
  (absent means the scheme default only)
- path prefixes match on segment boundaries: a `/pay` prefix matches `/pay`
  and `/pay/...`, never `/payments`; a `/` prefix matches every path
- query keys are checked against the rule's `query_policy` and
  `allowed_query_keys` settings
- an invalid destination-policy document fails closed with cause
  `policy-invalid`; a missing policy document falls back to host matching
  alone

Current PoC intentionally does not define:

- content inspection or reputation scoring

Redirect chains are not observed in this build. A redirecting destination
is reported `unknown` with cause `redirect-unobserved`. A safe
redirect-observation service is specified for a later cycle; this profile
claims no live redirect verification today.

## Scan Accounting Rules

The verifier records scan evidence rather than gating on it. Only
`POST /scanner/decisions` records a scan; reading
`GET /verifier/scan-activity?envelope_id=<64 hex>` never does.

Per-envelope accounting bounds how much evidence one envelope may accumulate:

- `envelope_budget_limit`, `envelope_budget_remaining` and
  `envelope_budget_window_seconds` are reported on the scan-activity throttle
- `envelope_rate_limit_window_seconds` and `envelope_rate_limit_max_requests`
  are reported on `GET /verifier/status`

Exhausting a budget bounds recording, not acceptance: a decision is still
returned, and a repeat presentation inside the validity window still verifies.

## Result Contract

Current response fields from the narrowed verifier:

- `allowed: bool`
- `stage: str`
- `reason: str`
- `cause: str | None` — the structured cause behind a failing trust or
  freshness stage (see the Key Lifecycle Contract table)
- `canonical_claims_sha256: str | None`
- `matched_rule: str | None`

HTTP responses from the public verifier surface also include `X-Request-ID`
for request tracing without exposing request bodies in logs.

`GET /verifier/status` reports the current public runtime posture, including:

- whether verifier API key auth is enabled
- whether admin-managed API key flow is enabled
- whether Redis-backed coordination is active
- the current rate-limit window and thresholds
- whether the image decode fallback endpoint is available

Current `stage` values used by the PoC:

- `signed_schema`
- `issuer_status`
- `key_status`
- `time_window`
- `payload_revalidation`
- `accepted`

(`certificate_status` was the pre-lifecycle name for the issuer check; it is
now `issuer_status`, and key-level failures report as `key_status`.)

The scanner surface adds a `residual_vector` alongside the stage: six families
in the order `issuer_chain`, `destination_policy`, `redirect_flow`,
`runtime_safety`, `freshness`, `artifact_integrity`, each entry `{tier, cause}`.
A failing stage maps into that vector — `time_window` past `expires_at` becomes
`freshness` tier `block`, cause `object-expired`; a claims version this build
does not support becomes `issuer_chain` tier `invalid-managed-claim`, cause
`unsupported-claims-version`; `issuer_status` and `key_status` both become
`issuer_chain` tier `revoked-issuer` with the cause from the lifecycle table
(`key-revoked`, `issuer-inactive`, `key-window-mismatch`, …). The response also carries `model_decision`, with
`profile`, `primary_state`, `annotations`, `reason_codes` and `attention_level`.

## Non-Goals In This Profile

This profile does not currently define:

- interoperability across multiple certificate formats
- decentralized trust roots
- multi-algorithm or post-quantum envelopes
- transport-specific behavior beyond the current machine-readable payload contract
