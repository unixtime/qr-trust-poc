# Governance Fixture Bundle

Date: 2026-05-15

Status:
- non-production demo fixture
- non-normative
- illustrative only
- not a proposed standard
- intended for local PoC testing, local smoke seeds, and review only
- not a production trust root or management-plane source of truth

## Purpose

These JSON fixtures make the paper's governance model concrete enough for code
and reviewer inspection. They are the machine-readable companion to
`docs/public/APPENDIX_GOVERNANCE_ARTIFACTS.md`.

Production-like governance state is managed through the Postgres-backed
management plane. These files and the TypeScript Postgres reference seed are
non-production examples only; local smoke tests must opt in before applying seed
rows that resemble issuer trust state.

The bundle represents one enrolled demo issuer under one delegated operator and
one root trust program. It is deliberately small:

- `root-manifest.json`
- `delegated-operator-manifest.json`
- `issuer-record.json`
- `destination-policy.json`
- `revocation-status-event.json`
- `trust-key-status-event.json`
- `verifier-cache-entry.json`
- `index.json`

## Boundary

The fixtures do not define a final wire format. They also do not make this repo
a deployed trust root, certification authority, malware scanner, or production
governance service.

Their job is narrower:

- show how issuer identity is scoped by root and delegated authority
- show where issuer assurance belongs
- show how destination policy is separate from QR generation
- show how runtime safety remains a separate scan-time signal
- show where freshness metadata belongs
- expose that freshness metadata through scanner decisions and generated demo
  materials
- provide stable IDs for backend and UI tests

## Current Demo Namespace

The effective issuer namespace is:

```text
(root:qrtrust-demo:2026, authority:qrtrust-demo:merchant-web, issuer:acme-demo)
```

That tuple is intentional. The paper argues that issuer identifiers should not
be treated as globally unique bare strings in a federated model.

## Validation

Run:

```sh
make check-governance-fixtures
```

The checker validates JSON syntax and the important cross-artifact references.
The network contract checker also smoke-validates the fixture shape against the
draft network schemas. Signature bytes are illustrative, but they are generated
with the same canonical JSON and Ed25519 fixture key path used by the network
smoke tests.

## Signed Status Events

`revocation-status-event.json` shows an issuer lifecycle event. The verifier may
apply it to cache state only after the signer resolves to an active root or
delegated-authority key and the Ed25519 signature verifies over canonical JSON.

`trust-key-status-event.json` shows the same status-event envelope targeting a
delegated-authority trust key. Once accepted, that key becomes inactive for
future artifacts. This keeps key lifecycle changes inside the managed trust
state instead of treating key revocation as an out-of-band manual cleanup.

## Runtime Safety Markers

The fixture runtime provider is deterministic. It exists to demonstrate the
paper's fourth layer without depending on a live reputation service:

- default destination: clean
- `?runtime=risky` or `/risky`: verified issuer, destination risky
- `?runtime=blocked` or `/blocked`: blocked
- `?runtime=unavailable`: caution because the provider could not be reached
- `?runtime=stale`: caution because runtime data is stale

## Redirect Policy Markers

The fixture redirect policy is also deterministic. It exists to demonstrate the
paper's short-URL and resolver-flow argument without following live redirects:

- approved resolver: `https://qr.acme.example/r/pay?final=https%3A%2F%2Facme.example%2Fpay&hops=1`
- final destination mismatch: use `final=https%3A%2F%2Fevil.example%2Fpay`
- excessive resolver chain: use `hops=3`
- nested shortener: use `nested=1`

These markers exercise the deterministic policy evaluator in unit tests. They
are not observations made by the scanner decision endpoint. Until a live
observer exists, `/scanner/decisions` ignores them as evidence, reports an
enrolled resolver as `unknown` / `redirect_unobserved`, leaves final URL and hop
count unset, disallows opening, and does not run runtime safety on an asserted
final destination.

## Scanner Projection

The backend projects a narrow subset of this bundle into `governance` fields on
generated demo materials and scanner decisions:

- root program ID
- delegated authority ID
- issuer ID and effective namespace tuple
- secondary assurance tier
- destination policy ID
- verifier cache entry ID
- cache publication, generation, expiry, maximum staleness, and stale behavior
- source artifact references

This projection is deliberately explanatory. It lets reviewers and students see
which governance state produced the scanner-visible decision without treating
these files as a final wire format.

The lab can also request deterministic cache profiles:

- `fresh`: normal fixture state, eligible for a positive scanner decision when
  issuer, binding, and runtime safety also pass
- `stale`: the cache has not expired, but it exceeds the configured maximum
  staleness window, so scanner decisions downgrade to caution
- `expired`: the cache validity window is closed, so scanner decisions block

These profiles are test controls, not separate governance standards.
