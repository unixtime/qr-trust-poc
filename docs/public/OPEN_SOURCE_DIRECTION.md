# Open Source Direction

## Repository Scope

This repository is intended to hold the public-safe reference implementation
for QR verification hardening, not the private patent or filing packet.

Public repository scope:
- narrowed verifier PoC
- replay-guard behavior under concurrency
- payload revalidation against issuer-controlled state
- canonical signed-schema handling
- demo scripts and implementation notes that do not contain personal or filing data

Excluded scope:
- provisional filing materials
- form drafts and submission packets
- personal contact data
- prior application identifiers tied to filing operations
- private patent prosecution strategy

## Technical Core

The current implementation centers on this verifier chain:

1. canonicalize the signed fields
2. resolve authoritative certificate metadata
3. verify the signature
4. enforce certificate status
5. enforce the time window
6. reserve the nonce atomically
7. revalidate the destination against issuer-controlled state
8. release on downstream failure
9. finalize one-time consumption on success

## Next Public Deliverables

- a sanitized verifier profile document
- test vectors for valid, replayed, revoked, expired, and mismatched payloads
- a minimal API contract for the narrowed verifier endpoint
- cleanup of any remaining patent-oriented naming in code comments or docs
- a public release gate using `PUBLIC_RELEASE_CHECKLIST.md`

Current public docs:

- `RUN_GUIDE.md`
- `VERIFIER_PROFILE.md`
- `TEST_VECTORS.md`
- `NETWORK_ARCHITECTURE_PLAN.md`
- `network-contracts/`
- `../../network/`
- `PUBLIC_RELEASE_CHECKLIST.md`

Next architecture direction:

- `NETWORK_ARCHITECTURE_PLAN.md` defines the production-reference network path
  beyond the PoC: root programs, delegated authorities, issuer enrollment,
  destination policy, verifier cache synchronization, runtime safety, and
  scanner-visible decisions.
- `network-contracts/` starts the contracts-first implementation boundary for
  root, authority, issuer, destination policy, revocation, verifier cache,
  scanner decision, and network event envelopes.
- `network/` is the first code scaffold for that boundary: an Effect
  TypeScript package with scanner-decision schemas, service ports, in-memory
  adapters, and a contract smoke path. It is intentionally not wired into the
  current Python verifier PoC yet.

Current public API direction:

- canonical reference path: `/verifier/*`
- primary browser client path: React workbench over local HTTPS on `:8443` (`:5173` is only the plain-compose dev default)
