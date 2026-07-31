# Verifier Profile Distribution Contract

Date: 2026-05-20

Status:
- draft reference contract
- non-normative
- deployment handoff boundary

## Purpose

A verifier profile is the scanner-side configuration that tells a scanner
fleet which trust program, verifier cache, scanner-decision runtime, runtime
safety policy, and freshness rules it is allowed to use.

The profile is not scanned from the QR code. It is distributed by the scanner
operator, enterprise administrator, app vendor, browser vendor, MDM provider, or
other accountable channel before scan time.

This keeps the paper's trust model intact:
- the QR artifact remains a scan-time input
- the verifier profile represents managed trust state
- the scanner combines both before showing a user-visible decision

## Minimum Profile Fields

The machine-readable reference profile is defined in
`verifier-profile.schema.json`; `examples/verifier-profile-reference.json`
shows the current local PoC profile used by the scanner fleet evidence packet.

A production verifier profile should bind at least:

- `profile_id`: stable identifier for the scanner-visible decision policy
- `profile_version`: monotonically increasing profile version
- `profile_fingerprint`: hash shown in operator and fleet evidence
- `root_program_id`: accepted root trust program
- `accepted_delegated_authority_ids`: bounded authority set or policy selector
- `verifier_id`: verifier/cache operator that owns the decision endpoint
- `scanner_decision_endpoint`: HTTPS endpoint used by scanner clients
- `runtime_safety_policy_id`: runtime safety provider and policy reference
- `cache_freshness_budget_seconds`: maximum accepted cache age
- `decision_color_policy`: green/orange/red mapping rules
- `hold_to_open_policy`: rules for user interaction gates on risky scans
- `valid_from` and `valid_until`: profile validity window
- `signing_key_id` and `signature`: profile authenticity binding

The scanner should persist the active profile fingerprint with each scan
decision event so reviewers can prove which managed trust configuration was in
force.

## Distribution Channels

Acceptable reference channels include:

- mobile-device-management profile
- enterprise app configuration
- signed app-bundled default profile
- signed remote profile fetched through pinned update metadata
- browser or operating-system managed profile
- scanner SDK configuration pushed by a verified platform operator

The channel may vary by ecosystem. The required property is accountability:
the scanner can identify who supplied the profile and which profile fingerprint
produced a decision.

## Fail-Closed Rules

A scanner must not produce a strong green decision when:

- no verifier profile is installed
- the profile signature is invalid
- the profile is outside its validity window
- the profile root program is not accepted by local policy
- the scanner-decision endpoint does not match the profile
- the runtime safety policy referenced by the profile is unavailable or stale
- the profile fingerprint cannot be logged with the decision

Recommended user-visible behavior:

- missing profile: orange, "Could not fully verify this QR"
- invalid or revoked profile: red, "Protection profile is not trusted"
- stale profile: orange unless local policy requires red
- endpoint mismatch: red

In the local PoC, these profile-state fixtures are represented by the scanner
client field `client.verifier_profile_state`. The native iOS app does not show
that field to users; it reads the value from the compiled provider profile via
`QRTRUST_VERIFIER_PROFILE_STATE`. This keeps the behavior testable while leaving
production profile installation as a signed-distribution problem.

## Rotation and Revocation

Profile rotation should be explicit and reviewable:

- new profile version is published before old profile expires
- scanner keeps the previous accepted profile only inside a short grace window
- revoked profiles are rejected even if their `valid_until` has not passed
- fleet evidence records the old and new profile fingerprints during rollout
- emergency rotation should invalidate stale scanner-decision endpoints

The scanner may cache profiles for availability, but the cache must not erase
the distinction between "trusted profile" and "stale or unavailable profile".

## Scanner Boundary

The scanner may read these values from the active profile:

- accepted trust program and authority scope
- scanner-decision runtime endpoint
- freshness and retry policy
- color and hold-to-open policy
- user-facing disclosure defaults

The scanner must not infer these values from the QR payload alone:

- root trust program
- issuer legitimacy
- delegated-authority scope
- destination binding policy
- runtime safety provider
- scanner-decision endpoint

## Evidence Requirements

Deployment review should include:

- active profile JSON or signed profile bundle
- profile fingerprint and signing key ID
- profile distribution channel description
- scanner app build or browser extension version
- endpoint TLS identity or pinning evidence
- stale-profile test result
- revoked-profile test result
- sample scan decision carrying the profile fingerprint

This contract is satisfied only when the scanner-side configuration path is
reviewable independently from the QR artifact being scanned.

The executable smoke check validates that the reference profile is HTTPS-bound,
fingerprinted with a `sha256:` prefix, scoped to an accepted delegated
authority, signed by an accepted key, enables hold-to-open for non-green
decisions, and preserves the paper's required green controls: issuer
recognition, destination binding, runtime-clear status, and fresh cache state.

Run it with:

```sh
make check-network-verifier-profile
```

Generate the reviewer-facing distribution report with:

```sh
make network-verifier-profile-distribution-report
```

That writes `local/verifier-profile-distribution-report.json` and
`local/verifier-profile-distribution-report.md`, isolating the active scanner
profile, local policy gates, control checks, and distribution receipt before
they are combined with native scanner evidence.

The smoke also proves fail-closed behavior for:

- plain HTTP scanner-decision endpoints
- expired or revoked profiles
- endpoint mismatch against local policy
- unaccepted delegated authorities or signing keys
- missing green controls
- disabled or too-short hold-to-open gates
- missing hold triggers for orange/red, caption mismatch, or risk-score gates
