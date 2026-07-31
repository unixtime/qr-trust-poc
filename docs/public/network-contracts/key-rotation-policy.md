# QR Trust Key Rotation Policy

Date: 2026-05-18

Status:
- draft reference policy
- non-normative
- executable in `network/src/services/key-rotation-policy.ts`

## Purpose

Trust keys are part of governance state. They are not local verifier
configuration. A verifier should accept a signed QR trust artifact only when the
signing key resolves to an active key record in the accepted root program and
scope.

This policy defines the first operational rules for root and delegated-authority
key rotation. It keeps the paper's separation intact:

- issuer legitimacy is established by governance enrollment
- destination binding is established by issuer policy
- runtime safety is evaluated at scan time
- scanner-visible decisions depend on current verifier state

## Key Scopes

Root-program keys:
- authorize root trust-program metadata and delegated authority manifests
- rotate slowly
- require longer overlap windows
- should be recoverable only through an offline/root-governance process

Delegated-authority keys:
- authorize authority-scoped issuer, destination, and status artifacts
- rotate faster
- must never authorize another authority's namespace
- may be emergency-revoked by the root program or by the accepted authority
  recovery process

## Planned Rotation

A planned rotation publishes the new key before retiring the old key.

Reference overlap windows:

| Scope | Minimum overlap | Maximum overlap |
| --- | ---: | ---: |
| root program | 7 days | 45 days |
| delegated authority | 24 hours | 14 days |

Verifier behavior:
- both old and new keys may verify signed artifacts during the accepted overlap
  window
- scanner-visible green remains allowed only if verifier cache freshness is
  still within the key retirement window
- if a verifier cache entry outlives the retiring key, the verifier must refresh
  before returning green
- after retirement, the old key must be suspended, revoked, or expired in
  durable trust state

## Emergency Revocation

Emergency revocation is not a normal rotation. It is a fail-closed control for
key compromise, issuer-system compromise, or delegated-authority compromise.

Reference publication targets:

| Scope | Emergency status-event SLA |
| --- | ---: |
| root program | 60 minutes |
| delegated authority | 15 minutes |

Verifier behavior:
- a revoked or suspended key must stop authorizing future cache mutations
- verifier caches should refresh before returning green after accepting an
  emergency key status event
- if the verifier cannot refresh after a key compromise signal, it should avoid
  strong green decisions for affected namespace scope
- event loss is recoverable only by resynchronizing from durable artifact and
  key registries

## Signer Recovery

Signer recovery should be narrower than ordinary key rotation.

The operational recovery checklist lives in
`signer-recovery-runbook.md`. This policy keeps the executable rotation rules
small; the runbook defines incident classification, artifact publication,
verifier cache refresh, and scanner-visible recovery semantics.

Root recovery:
- requires a root-governance process outside the scanner path
- should publish an updated root manifest and status events for affected keys
- should force verifiers to refresh root-program cache state before green

Delegated-authority recovery:
- must remain scoped to one delegated authority
- must not alter issuer records outside that authority's namespace
- should publish a new delegated-authority manifest and trust-key status events
- should force verifier cache refresh for the affected authority scope

## Scanner Semantics

Key lifecycle is not shown to end users as cryptographic detail. It appears only
through the final scanner-visible decision:

- green: accepted issuer, bound destination, current runtime safety, fresh cache
- orange: trust path unavailable, stale, or partially unverifiable
- red: active block condition such as revoked issuer, revoked key, destination
  mismatch, or runtime block

The detailed decision path may expose that a key was revoked, suspended,
expired, or not yet trusted, but the primary UI should remain the simple
scanner-visible state.

## Reference Implementation

The TypeScript reference package exposes:

- `assessTrustKeyRotation`
- `defaultRootTrustKeyRotationPolicy`
- `defaultDelegatedAuthorityTrustKeyRotationPolicy`

Run the executable policy smoke with:

```sh
cd network
npm run key-rotation:smoke
```

The smoke verifies:

- planned delegated-authority rotation with an accepted overlap
- root rotation with a longer accepted overlap
- short overlap fails closed
- verifier cache outliving the retired key requires refresh before green
- emergency revocation requires the old key to become suspended or revoked
