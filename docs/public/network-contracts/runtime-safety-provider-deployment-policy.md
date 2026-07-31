# Runtime Safety Provider Deployment Policy

Date: 2026-05-19

Status:
- draft deployment policy
- non-normative
- intended for local shared-infra and small-network reference deployments

## Purpose

Runtime safety is scan-time evidence. It is not issuer legitimacy, destination
approval, or source-of-truth governance state.

This policy defines how live redirect, reputation, safe-browsing, and TLS/HTTPS
inspection providers should be attached to the QR trust network without
collapsing the paper's trust layers. A provider may downgrade or block a scanner
decision when present-time destination evidence is risky. It must not make an
unknown issuer trusted, approve a destination, or mutate durable trust state.

## Placement

Runtime safety runs after the verifier has already resolved the QR artifact
against the verifier cache:

1. issuer legitimacy is evaluated from root, authority, issuer, and status
   state
2. destination binding is evaluated against the issuer-approved destination
   policy
3. runtime safety inspects current destination conditions
4. the scanner maps the combined evidence into a user-visible decision

Destination binding remains terminal. A destination mismatch is not rescued by a
later clean runtime-safety verdict.

## Provider Boundary

Runtime-safety providers may inspect:

- normalized destination URL or destination host
- resolver URL and bounded redirect chain
- final destination host and final destination URL
- HTTPS/TLS presence and validation outcome
- malware, phishing, reputation, or block-list verdicts
- verdict freshness, provider version, and provider reason codes

Runtime-safety providers must not:

- enroll issuers
- approve destinations
- sign trust artifacts
- mutate root, authority, issuer, destination-policy, or verifier-cache source
  records
- turn an unknown issuer into a green scanner state
- require raw QR payloads, user identifiers, or session secrets unless a
  provider contract explicitly justifies that data

## Required Verdict Shape

Live providers should normalize their output to the same contract used by the
deterministic reference adapters:

- `clear`: no current runtime risk was reported
- `risky`: elevated risk was reported, but no explicit block condition was
  reached
- `blocked`: the destination should not be opened under current policy
- `unavailable`: the provider could not return a usable verdict

Each verdict should include:

- provider ID
- provider version when available
- checked-at timestamp
- freshness timestamp or provider TTL when available
- bounded reason codes
- sanitized destination fingerprint
- final host and redirect hop count when redirect inspection was performed

The scanner should expose concise user-facing state. Raw provider payloads are
operator evidence, not ordinary scanner copy.

The persistable observation shape is defined in
`runtime-safety-observation.schema.json`. Deployments may store provider-native
payloads separately for operators, but scanner-facing and outbox-facing
evidence should use the normalized observation contract.

## Decision Mapping

Runtime safety can strengthen or weaken a decision only inside the existing
trust path:

- `clear` can contribute to green only when issuer legitimacy, destination
  binding, and verifier-cache freshness also pass
- `risky` maps to orange when issuer and destination binding pass but current
  destination risk is elevated
- `blocked` maps to red when an explicit block condition or local fail-closed
  policy is reached
- `unavailable` maps to orange by default because present-time safety could not
  be checked

Fail-closed red for `unavailable` is allowed only as a local policy decision for
high-risk issuer classes or regulated workflows. That policy must be visible in
operator configuration and scanner-decision reason codes.

## Provider Classes

### Redirect Inspector

A redirect inspector follows a bounded resolver chain and records:

- resolver URL
- final URL
- final host
- observed hop count
- hop-limit violations
- nested shortener detection
- resolver-to-final host mismatch

It should stop at configured hop limits and return a bounded reason code rather
than trying to prove general URL safety.

### Reputation or Safe-Browsing Provider

A reputation provider returns current known-bad, risky, or clear destination
evidence. It should preserve provider freshness metadata and should avoid
sending user identifiers or complete QR payloads when a host-level or normalized
URL query is sufficient.

### TLS/HTTPS Inspector

A TLS/HTTPS inspector records absent HTTPS, invalid certificate state, or other
transport evidence. This evidence may raise risk or block according to local
policy, but it does not replace issuer legitimacy or destination binding.

## Privacy Controls

Deployments should minimize provider disclosure:

- prefer host-level queries when provider accuracy allows it
- send normalized URLs only when full-path context is required
- never send verifier API keys, signed payload secrets, or user identifiers to
  third-party runtime providers
- keep raw provider payloads out of scanner responses
- retain only bounded operator evidence needed for audit and troubleshooting

## Failure Handling

Provider failures must not silently produce green.

Default failure mapping:

- timeout: orange, `runtime_provider_unavailable`
- provider auth failure: orange, `runtime_provider_unavailable`
- malformed provider response: orange, `runtime_provider_unavailable`
- explicit known-bad verdict: red, provider-specific block reason
- local fail-closed policy match: red, local policy reason

Provider credential compromise should disable that provider, mark verdicts
unavailable, rotate credentials, and preserve durable issuer and destination
state unchanged.

False positives should be handled by provider-specific review or override
processes. Overrides must be scoped, audited, and time-bounded.

## Caching

Runtime-safety verdicts may be cached for performance, but the cache is not
durable trust state.

Cached verdicts should record:

- provider ID and version
- checked-at timestamp
- provider freshness timestamp or TTL
- destination fingerprint
- reason codes
- original verdict state

Stale runtime-safety cache entries should map to orange or trigger a fresh
provider check. They must not silently preserve green.

## Deployment Gates

Before live provider traffic is enabled, operators should verify:

- `npm run runtime-safety:smoke`
- scanner-decision examples for green, orange-unavailable, orange-risky, and
  red-blocked outcomes
- runtime-safety observation examples for clear, risky, blocked, and unavailable
  provider verdicts
- bounded provider timeout behavior
- no raw QR payloads or user identifiers are sent unless explicitly required
- `make check-network-contracts`

Provider credentials, rate-limit policies, regional routing, audit exports, and
vendor-specific safe-browsing or reputation contracts remain deployment work.
