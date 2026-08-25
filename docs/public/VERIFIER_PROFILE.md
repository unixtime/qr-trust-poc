# Verifier Profile

This document defines the current public PoC behavior for the narrowed verifier
flow implemented in:

- [verifier.py](../../backend/app/api/endpoints/verifier.py)
- [narrowed_verifier_poc.py](../../backend/app/services/narrowed_verifier_poc.py)
- [replay_guard_poc.py](../../backend/app/services/replay_guard_poc.py)
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
- `POST /verifier/demo-materials`
- `POST /verifier/verify`
- `POST /verifier/verify-scanned`
- `POST /verifier/decode-image`

`POST /verifier/demo-materials` intentionally does not return the signing
private key. It returns only the material needed to exercise the verifier flow.

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
5. `nonce`
6. `payload`

Rules:

- no unknown signed-claim fields
- no missing signed-claim fields
- `version` must be exactly `1`
- `issued_at` and `expires_at` must be ISO-8601 timestamps with timezone information
- `expires_at` must be later than `issued_at`

The canonical claim order is defined in [signed_schema_poc.py](../../backend/app/services/signed_schema_poc.py).

## Certificate And Algorithm Rules

Current PoC rules:

- the signed `certificate_ref` must match the authoritative certificate record
- the signed `usage_policy` determines whether a QR is reusable or one-time
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
5. branch on signed `usage_policy`
6. for `one_time`, reserve the nonce atomically
7. revalidate the payload destination against issuer-controlled state
8. release the reservation on downstream mismatch when a one-time nonce was reserved
9. finalize one-time consumption on success

Supported usage policies:

- `reusable_public`: public or printed QR codes that may be scanned by many users
- `one_time`: login, payment, ticket, or other single-use QR codes
- `time_limited`: reusable QR codes bounded by `issued_at` and `expires_at`

## Issuer State Contract

Current issuer state fields:

- `verified_domains: list[str]`
- `allow_subdomains: bool`
- `certificate_active: bool`
- `certificate_revoked: bool`
- `certificate_revocation_reason: str | None`

Behavior:

- if `certificate_revoked` is true, verification fails before nonce reservation
- if `certificate_active` is false, verification fails before nonce reservation
- payload acceptance depends on the current `verified_domains` and `allow_subdomains` policy, not just the original signed payload

## Payload Revalidation Rules

Current normalization rules:

- trim surrounding whitespace
- if the payload lacks a scheme, parse it as `https://...`
- lowercase the host
- strip a trailing `.`
- strip leading `www.`

Current matching rules:

- exact host match is allowed
- subdomain match is allowed only when `allow_subdomains` is true
- matching is against the issuer's current verified domain set

Current PoC intentionally does not define:

- redirect-chain semantics
- path-based authorization rules
- query-parameter policy
- content inspection or reputation scoring

## Replay Guard Rules

Replay guard applies only when the signed `usage_policy` is `one_time`.
Reusable public and time-limited QR codes still enforce signature, certificate,
time-window, and destination-binding checks, but they do not consume the nonce.

Current one-time replay lifecycle:

1. `try_reserve(nonce, reservation_ttl_seconds)`
2. `release(nonce, owner_token)` on downstream failure
3. `finalize(nonce, owner_token, consumed_ttl_seconds)` on success

Properties:

- only one caller may own a nonce reservation at a time
- expired reservations can be reacquired
- consumed nonces remain blocked until the consumed TTL expires
- wrong-owner release is rejected
- finalize after reservation expiry fails

## Result Contract

Current response fields from the narrowed verifier:

- `allowed: bool`
- `stage: str`
- `reason: str`
- `canonical_claims_sha256: str | None`
- `matched_rule: str | None`
- `reservation_state: str | None`

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
- `certificate_status`
- `time_window`
- `replay_guard`
- `payload_revalidation`
- `accepted`

Current `reservation_state` values used by the PoC:

- `blocked`
- `released`
- `release_failed`
- `finalize_failed`
- `consumed`

## Non-Goals In This Profile

This profile does not currently define:

- interoperability across multiple certificate formats
- decentralized trust roots
- blockchain-backed replay state
- multi-algorithm or post-quantum envelopes
- transport-specific behavior beyond the current machine-readable payload contract
