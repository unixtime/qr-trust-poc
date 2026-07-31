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

- signed claims are canonical and valid
- `usage_policy = "one_time"` for replay vectors
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

### NV-001 Valid first scan

- claims:
  - `version = "1"`
  - `usage_policy = "one_time"`
  - `nonce = "demo-nonce-101"`
  - `payload = "https://acme.example/pay"`
  - `issued_at = now - 1 minute`
  - `expires_at = now + 5 minutes`
- expected:
  - `allowed = true`
  - `stage = "accepted"`
  - `reservation_state = "consumed"`
  - `matched_rule = "acme.example"`

### NV-001A Reusable public scan

- claims:
  - `version = "1"`
  - `usage_policy = "reusable_public"`
  - `nonce = "demo-nonce-public-101"`
  - `payload = "https://acme.example/pay"`
  - `issued_at = now - 1 minute`
  - `expires_at = now + 5 minutes`
- execute twice with the same signed envelope
- expected for both requests:
  - `allowed = true`
  - `stage = "accepted"`
  - `reservation_state = "not_required"`
  - `matched_rule = "acme.example"`

### NV-002 Replay of same code

- same one-time input as `NV-001`
- execute immediately after `NV-001`
- expected:
  - `allowed = false`
  - `stage = "replay_guard"`
  - `reservation_state = "blocked"`

### NV-003 Payload mismatch releases reservation

- claims:
  - `nonce = "demo-nonce-202"`
  - `payload = "https://acme.example/pay"`
- issuer state:
  - `verified_domains = []`
- expected:
  - `allowed = false`
  - `stage = "payload_revalidation"`
  - `reservation_state = "released"`

### NV-004 Retry after issuer-state restoration

- same signed envelope as `NV-003`
- issuer state restored to:
  - `verified_domains = ["acme.example"]`
- expected:
  - `allowed = true`
  - `stage = "accepted"`
  - `reservation_state = "consumed"`

### NV-005 Expired credential

- claims:
  - `nonce = "demo-nonce-expired"`
  - `issued_at = now - 10 minutes`
  - `expires_at = now - 1 minute`
- expected:
  - `allowed = false`
  - `stage = "time_window"`
  - `reservation_state = null`

### NV-006 Revoked certificate

- claims:
  - `nonce = "demo-nonce-revoked"`
- issuer state:
  - `certificate_revoked = true`
  - `certificate_revocation_reason = "Issuer revoked credential after merchant offboarding"`
- expected:
  - `allowed = false`
  - `stage = "certificate_status"`
  - `reservation_state = null`

### NV-007 Release failure surface

- same mismatch shape as `NV-003`
- replay guard behavior:
  - force `release()` to return false
- expected:
  - `allowed = false`
  - `stage = "payload_revalidation"`
  - `reservation_state = "release_failed"`

### NV-008 Finalize failure surface

- valid payload and issuer state
- replay guard behavior:
  - force `finalize()` to return false
- expected:
  - `allowed = false`
  - `stage = "replay_guard"`
  - `reservation_state = "finalize_failed"`

### NV-009 Concurrent first scans

- same valid envelope sent by multiple workers
- expected aggregate behavior:
  - exactly one result with `allowed = true`
  - all other losing results:
    - `allowed = false`
    - `stage = "replay_guard"`
    - `reservation_state = "blocked"`

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
  - second request with the same QR payload: `allowed = false`, `stage = "replay_guard"`

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
  - `nonce`
  - `payload`
- expected:
  - parse failure or signed-schema rejection

### SS-002 Missing signed field rejected

- omit `nonce` or any other required claim
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

## Execution Note

The behavior represented here is exercised by:

- [narrowed_verifier_poc_demo.py](../../backend/scripts/narrowed_verifier_poc_demo.py)
- [payload_revalidation_poc_demo.py](../../backend/scripts/payload_revalidation_poc_demo.py)

These vectors are intended to stay stable even if the surrounding API or
documentation changes.
