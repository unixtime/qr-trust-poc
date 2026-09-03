# Open Source Direction

## Repository Scope

This repository is the public-safe reference implementation for QR verification
hardening. Private legal and filing materials are outside its scope.

Public repository scope:
- narrowed verifier PoC
- envelope scan accounting and verdict caching under concurrency
- payload revalidation against issuer-controlled state
- canonical signed-schema handling
- demo scripts and implementation notes that do not contain personal or filing data

Excluded scope:
- provisional filing materials
- form drafts and submission packets
- personal contact data
- prior application identifiers tied to filing operations
- private patent prosecution strategy

The PoC also does not claim, and the 2026-08-26 scope-honesty pass removed:

- usage policies (`reusable_public`, `one_time`, `time_limited`)
- nonces and one-time consumption
- a replay guard or any other per-presentation verifier state
- the suspicious-TLD destination heuristic from the verifier (the `network/`
  runtime-safety layer keeps its own provider-supplied signal of that name,
  which is a provider input rather than a verifier trust-model claim)

Those are presentation-QR mechanisms or ungrounded heuristics. What replaced
them: claims v2, `envelope_id`, the six-family residual vector with its model
decision on the scanner response, and a validity-window UI in place of the
usage-policy picker.

## Technical Core

The current implementation centers on this verifier chain:

1. canonicalize signed claims
2. verify the signed envelope against the authoritative certificate
3. enforce certificate status
4. enforce the time window
5. revalidate the destination against issuer-controlled state

Every presentation of one envelope is evaluated the same way; the verifier
keeps no per-presentation state.

## Published Baseline

The published repository includes:

- a sanitized verifier profile document
- test vectors for valid, repeated, revoked, expired, and mismatched payloads
- a minimal API contract for the narrowed verifier endpoint
- implementation-focused public naming
- a repeatable public release gate using `PUBLIC_RELEASE_CHECKLIST.md`

Current public docs:

- `RUN_GUIDE.md`
- `VERIFIER_PROFILE.md`
- `TEST_VECTORS.md`
- `NETWORK_ARCHITECTURE_PLAN.md`
- `network-contracts/`
- `../../network/`
- `PUBLIC_RELEASE_CHECKLIST.md`

Architecture boundary:

- `NETWORK_ARCHITECTURE_PLAN.md` defines the production-reference network path
  beyond the PoC: root programs, delegated authorities, issuer enrollment,
  destination policy, verifier cache synchronization, runtime safety, and
  scanner-visible decisions.
- `network-contracts/` starts the contracts-first implementation boundary for
  root, authority, issuer, destination policy, revocation, verifier cache,
  scanner decision, and network event envelopes.
- `network/` implements the reference control and worker layer in Effect
  TypeScript. The FastAPI verifier does not call those TypeScript services in
  its per-scan path; it loads its working trust projection directly from
  authoritative Postgres rows and fails closed when that projection is stale.

Current public API:

- canonical reference path: `/verifier/*`
- primary browser client path: React workbench over local HTTPS on `:8443` (`:5173` is only the plain-compose dev default)
