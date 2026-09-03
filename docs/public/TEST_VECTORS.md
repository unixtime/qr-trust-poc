# Test Vectors

These are behavior-level public test vectors for the current narrowed verifier
PoC. They describe the expected decision surface without embedding private
filing artifacts.

Implementation references:

- [narrowed_verifier_poc.py](../../backend/app/services/narrowed_verifier_poc.py)
- [narrowed_verifier_poc_demo.py](../../backend/scripts/narrowed_verifier_poc_demo.py)
- [payload_revalidation_poc_demo.py](../../backend/scripts/payload_revalidation_poc_demo.py)
- [qr_artifact_poc.py](../../backend/app/services/qr_artifact_poc.py)
- [qr_artifact_poc_demo.py](../../backend/scripts/qr_artifact_poc_demo.py)

## Baseline Assumptions

Unless a vector says otherwise:

- signed claims are canonical and valid, in the order `version`,
  `certificate_ref`, `issued_at`, `expires_at`, `payload`
- `version = "2"`; a `version = "1"` envelope is rejected
- `certificate_ref` matches the certificate
- `code_algorithm_id` matches the certificate algorithm
- certificate algorithm is `rsa-pss-sha256-v1`
- issuer state starts as:
  - `verified_domains = ["acme.example"]`
  - `allow_subdomains = false`
  - `certificate_active = true`
  - `certificate_revoked = false`
- payload is `https://acme.example/pay`

## Narrowed Verifier Vectors

### NV-001 Valid scan

- claims:
  - `version = "2"`
  - `certificate_ref = "cert:acme-demo:2026-01"`
  - `issued_at = now - 1 minute`
  - `expires_at = now + 5 minutes`
  - `payload = "https://acme.example/pay"`
- expected:
  - `allowed = true`
  - `stage = "accepted"`
  - `matched_rule = "acme.example"`

### NV-001A Repeat scan inside the validity window

- the same signed envelope as `NV-001`
- execute twice
- expected for both requests:
  - `allowed = true`
  - `stage = "accepted"`
  - `matched_rule = "acme.example"`

Every presentation of one envelope is evaluated the same way; the verifier
keeps no per-presentation state.

### NV-002 Unsupported claims version

- claims:
  - `version = "1"`, otherwise identical to `NV-001`
- expected:
  - `allowed = false`
  - `stage = "signed_schema"`
- the same envelope sent to `POST /scanner/decisions` never reaches the
  verifier: it fails to decode, and the route answers `unverified` with cause
  `invalid-trust-claim` and reason code `unsupported_claims_version`

### NV-003 Payload mismatch

- claims: as `NV-001`
- issuer state:
  - `verified_domains = []`
- expected:
  - `allowed = false`
  - `stage = "payload_revalidation"`

### NV-004 Retry after issuer-state restoration

- same signed envelope as `NV-003`
- issuer state restored to:
  - `verified_domains = ["acme.example"]`
- expected:
  - `allowed = true`
  - `stage = "accepted"`

### NV-005 Expired credential

- claims:
  - `issued_at = now - 10 minutes`
  - `expires_at = now - 1 minute`
- expected:
  - `allowed = false`
  - `stage = "time_window"`
  - on the scanner decision: `freshness` tier `block`, cause `object-expired`

### NV-006 Not yet valid

- claims:
  - `issued_at = now + 5 minutes`
  - `expires_at = now + 10 minutes`
- expected:
  - `allowed = false`
  - `stage = "time_window"`
  - on the scanner decision: cause `object-not-yet-valid`

### NV-007 Revoked certificate

- issuer state:
  - `certificate_revoked = true`
  - `certificate_revocation_reason = "Issuer revoked credential after merchant offboarding"`
- expected:
  - `allowed = false`
  - `stage = "issuer_status"`
  - `cause = "issuer-revoked"`

### NV-008 Inactive certificate

- issuer state:
  - `certificate_active = false`
- expected:
  - `allowed = false`
  - `stage = "issuer_status"`
  - `cause = "issuer-suspended"`

## Envelope Identity Vectors

### EI-001 Envelope identity is derived, not carried

- `envelope_id = sha256(canonical_claims + "." + signature)` as lowercase hex
  (64 characters), where `canonical_claims` is the claims serialized in the
  canonical order
- `envelope_fingerprint` is the first 16 hex characters of `envelope_id`
- expected:
  - the same claims and signature always produce the same `envelope_id`
  - `POST /verifier/demo-materials` returns the `envelope_id` for the artifact
    it generated
  - the scanner decision response carries the same `envelope_id`
  - mutating any signed claim changes `envelope_id`

## QR Artifact Vectors

### QA-001 Envelope roundtrip through QR PNG

- input:
  - valid signed envelope
- steps:
  - encode envelope as QR payload JSON
  - render PNG bytes
  - decode QR payload from the PNG
  - parse the decoded payload back into the signed envelope
- expected:
  - decoded QR payload exactly matches encoded QR payload
  - decoded envelope exactly matches the original envelope

### QA-002 Scanned verifier request path

- input:
  - valid `qr_payload`
  - matching certificate
  - active issuer state for `acme.example`
- execute:
  - `POST /verifier/verify-scanned`
- expected:
  - first request: `allowed = true`, `stage = "accepted"`
  - second request with the same QR payload: `allowed = true`,
    `stage = "accepted"` — the envelope is still inside its validity window

### QA-003 Invalid QR PNG bytes

- input:
  - bytes that are not a valid PNG image
- expected:
  - QR artifact decode rejects the input before verification

## Payload Revalidation Vectors

### PR-001 Exact host match

- payload: `https://acme.example/pay`
- verified domains: `["acme.example"]`
- `allow_subdomains = false`
- expected:
  - `allowed = true`
  - `matched_rule = "acme.example"`
  - reason contains `Exact host match`

### PR-002 WWW normalization

- payload: `https://www.acme.example/menu`
- verified domains: `["acme.example"]`
- expected:
  - `allowed = true`
  - `matched_rule = "acme.example"`

### PR-003 Subdomain blocked by exact-only policy

- payload: `https://login.acme.example/sign-in`
- verified domains: `["acme.example"]`
- `allow_subdomains = false`
- expected:
  - `allowed = false`

### PR-004 Subdomain allowed by policy

- payload: `https://login.acme.example/sign-in`
- verified domains: `["acme.example"]`
- `allow_subdomains = true`
- expected:
  - `allowed = true`
  - reason contains `Subdomain match`

### PR-005 Phishing mismatch

- payload: `https://evil.example/redirect?target=acme.example`
- verified domains: `["acme.example"]`
- expected:
  - `allowed = false`

### PR-006 Credential removed after issuance

- payload: `https://acme.example/pay`
- verified domains: `[]`
- expected:
  - `allowed = false`
  - reason contains `No currently verified domains`

### PR-007 Host rotation after issuance

- payload: `https://acme.example/pay`
- step 1 issuer state:
  - `verified_domains = ["acme.example"]`
- step 2 issuer state:
  - `verified_domains = ["pay.acme.example"]`
- step 3 issuer state:
  - `verified_domains = ["acme.example"]`
- expected:
  - step 1 allow
  - step 2 block
  - step 3 allow

### PR-008 Policy tightening after issuance

- payload: `https://login.acme.example/sign-in`
- step 1:
  - `verified_domains = ["acme.example"]`
  - `allow_subdomains = true`
- step 2:
  - `verified_domains = ["acme.example"]`
  - `allow_subdomains = false`
- expected:
  - step 1 allow
  - step 2 block

## Signed Schema Vectors

### SS-001 Unknown signed field rejected

- add any field outside:
  - `version`
  - `certificate_ref`
  - `issued_at`
  - `expires_at`
  - `payload`
- expected:
  - parse failure or signed-schema rejection

### SS-002 Missing signed field rejected

- omit any required claim
- expected:
  - parse failure or signed-schema rejection

### SS-003 Certificate reference mismatch

- signed `certificate_ref` does not match certificate record
- expected:
  - `allowed = false`
  - `stage = "signed_schema"`

### SS-004 Algorithm mirror conflict

- `code_algorithm_id` present but different from certificate algorithm
- expected:
  - `allowed = false`
  - `stage = "signed_schema"`

### SS-005 Tampered signed claims

- mutate any signed claim after signature generation
- expected:
  - `allowed = false`
  - `stage = "signed_schema"`

### SS-006 Unsupported claims version rejected

- `version = "1"` with an otherwise valid envelope
- expected:
  - parse failure with the unsupported-version diagnosis, ahead of any
    unknown-field diagnosis

## Execution Note

The behavior represented here is exercised by:

- [narrowed_verifier_poc_demo.py](../../backend/scripts/narrowed_verifier_poc_demo.py)
- [payload_revalidation_poc_demo.py](../../backend/scripts/payload_revalidation_poc_demo.py)

These vectors are intended to stay stable even if the surrounding API or
documentation changes.
