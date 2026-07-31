# QR Trust Signer Recovery Runbook

Date: 2026-05-18

Status:
- draft reference runbook
- non-normative
- intended for the local reference network and implementation review

## Purpose

Signer recovery is the operational path used when a root-program,
delegated-authority, or issuer signing key can no longer be trusted. It is
narrower than ordinary key rotation because the system must assume that some
previously signed state may have been produced by a compromised signer.

This runbook keeps the paper's trust model intact:

- issuer legitimacy is still governed by root and authority enrollment
- destination binding is still governed by issuer policy
- runtime safety is still evaluated at scan time
- scanner-visible decisions remain green, orange, or red

The recovery process is not shown to end users as key-management detail. It is
reflected through verifier cache freshness, namespace status, reason codes, and
the final scanner-visible decision.

## Scope

Covered:

- root-program signing-key compromise
- delegated-authority signing-key compromise
- issuer signing-key compromise
- suspected signing-service compromise
- accidental private-key exposure
- verifier cache behavior after key compromise

Not covered:

- legal incident response
- final standards-body governance
- platform vendor enforcement policy
- malware attribution
- recovery of unrelated organizational accounts

## Recovery Roles

Root program:
- owns root trust anchors, delegation policy, and root-level emergency status
  events
- can revoke or suspend delegated-authority keys
- can publish replacement root manifests

Delegated authority:
- owns authority-scoped issuer and destination-policy artifacts
- can revoke or suspend issuer signing keys inside its namespace
- can publish replacement authority manifests and issuer records

Issuer:
- owns its destination policy requests and QR artifact generation flow
- must report suspected generator or signing-service compromise
- may request issuer-key rotation or suspension through the delegated authority

Verifier:
- consumes signed recovery artifacts
- refreshes affected cache scope
- refuses strong green decisions when recovery state is stale, missing, or
  unresolved

Scanner:
- presents the final decision state and user-facing reason
- does not ask ordinary users to inspect keys, manifests, or raw signatures

## Incident Classification

| Severity | Condition | Reference scanner outcome |
| --- | --- | --- |
| Sev 1 | confirmed root signing-key compromise | affected root scope cannot produce green until recovery manifest is verified |
| Sev 2 | confirmed delegated-authority compromise | affected authority scope cannot produce green until replacement authority state is verified |
| Sev 3 | confirmed issuer signing-key or generator compromise | affected issuer or QR artifact class is red or orange according to policy |
| Sev 4 | suspected exposure without evidence of misuse | force cache refresh, shorten TTL, and require operator review before green |

## Root Recovery Flow

1. Freeze ordinary root signing.
2. Open a recovery incident with timestamp, affected key IDs, and affected root
   program IDs.
3. Publish an emergency key-status event for the compromised root key from an
   accepted recovery signer or out-of-band root process.
4. Publish a replacement root manifest with the new active key set.
5. Publish delegated-authority revalidation requirements if authority state may
   have been affected.
6. Force verifiers to refresh root-program cache state before returning green
   for affected namespaces.
7. Mark stale verifier cache entries as not eligible for green until the new
   root manifest and key-status events are verified.
8. Publish an incident closure artifact that records the replacement manifest
   version and final affected-key status.

Verifier behavior:

- if the recovery event verifies, revoke or suspend the affected root key
- if the replacement root manifest cannot be fetched or verified, return orange
  or red according to local fail-closed policy
- if cache freshness extends beyond the recovery event, refresh before green
- if two root manifests conflict, prefer the manifest accepted by the configured
  recovery policy and expose operator evidence

## Delegated-Authority Recovery Flow

1. Freeze ordinary authority signing for the affected delegated authority.
2. Publish a root-signed or accepted-authority recovery event suspending the
   affected authority key.
3. Publish a replacement delegated-authority manifest scoped to the same root
   program and authority ID.
4. Reissue or reaffirm issuer records affected by that authority.
5. Reissue destination policies only when the compromised signer could have
   changed destination binding.
6. Force verifier cache refresh for the affected authority scope.
7. Keep unrelated delegated-authority scopes eligible for normal decisions.

Verifier behavior:

- reject future mutations signed by the suspended authority key
- keep the blast radius scoped to `(root_program_id, delegated_authority_id)`
- do not downgrade unrelated authorities under the same root unless root policy
  explicitly requires it
- return orange when recovery state is incomplete and no active block condition
  is known
- return red when an active block condition is known for the issuer,
  destination policy, or key

## Issuer Signing Or Generator Compromise Flow

1. Suspend affected issuer signing credentials.
2. Publish an issuer-scoped status event.
3. Identify whether the compromise affects all QR artifacts, one destination
   policy, or one generator client.
4. Revoke one-time QR artifacts when replay or credential theft is plausible.
5. Keep reusable public QR codes valid only if destination policy and runtime
   safety remain acceptable.
6. Require issuer revalidation before restoring green for affected destinations.

Verifier behavior:

- never treat the QR generator brand as the trust root
- evaluate issuer status before destination binding
- downgrade to orange when issuer recovery is pending but no malicious
  destination is confirmed
- return red when a signed status artifact marks the issuer, key, or destination
  policy as blocked

## Required Recovery Artifacts

Minimum artifact set:

- key-status event for each affected key
- replacement root or delegated-authority manifest when governance keys change
- issuer-status event when an issuer or generator path is affected
- destination-policy update when approved destinations change
- verifier-cache refresh record proving affected scope was recomputed
- incident closure artifact with final status and affected scope

Each artifact should include:

- artifact ID
- version
- root program ID
- delegated authority ID when applicable
- issuer ID when applicable
- affected key IDs
- effective time
- reason code
- signer ID
- signature algorithm ID
- content hash

## Verifier Cache Rules

Recovery-aware verifier caches must store:

- source artifact versions
- source key IDs
- generated time
- expiry time
- affected namespace scope
- recovery event IDs already applied

Fail-closed rules:

- a revoked key cannot authorize future cache mutation
- a suspended key cannot authorize future cache mutation unless explicitly
  reinstated by an accepted recovery artifact
- stale cache must not produce green for an affected recovery scope
- missing recovery artifacts should not be interpreted as proof of safety
- event-bus delivery is not enough; the verifier must fetch and verify durable
  artifacts

## Scanner-Visible Semantics

The scanner should not show raw key-management detail as the primary message.

Recommended mapping:

| Recovery state | User-facing color | User-facing wording |
| --- | --- | --- |
| verified replacement state and current policy pass | green | Looks safe |
| recovery state incomplete or verifier cache stale | orange | Could not fully verify this QR |
| issuer, key, destination policy, or runtime state blocked | red | Do not open |

Decision-path detail may say:

- issuer trust state changed recently
- verifier cache needs refresh
- signing key was revoked
- issuer is suspended
- destination policy changed

## Operational Evidence Checklist

Before closing recovery:

- affected key IDs are listed
- replacement manifest or issuer record is published
- stale cache entries are refreshed or invalidated
- scanner decisions for affected fixtures are no longer green until refresh
- unrelated namespaces still produce their expected outcomes
- event outbox shows no failed recovery-event rows
- verifier-sync evidence includes applied and rejected recovery artifacts
- operator handoff records the final reason codes

## Local Reference Acceptance

The reference implementation should prove recovery with deterministic fixtures:

- root key revoked: future root-signed mutation is rejected
- delegated-authority key revoked: future authority-scoped mutation is rejected
- issuer suspended: verifier cache removes green eligibility
- replacement key active: new signed status artifact is accepted
- stale cache: scanner decision requires refresh before green
- unrelated authority: scanner decision remains unchanged

Implemented deterministic smoke:

```sh
cd network
npm run signer-recovery:smoke
```

The smoke covers all six local checks: root and delegated-authority revocation,
issuer suspension through a replacement key, stale-cache downgrade, and
unrelated-authority blast-radius containment.

These checks may be implemented as smoke tests before live root or authority
services exist. The important boundary is that recovery changes durable trust
state first, then verifier cache state, then scanner-visible decisions.
