# Reference Network Adoption Stage Gate

Date: 2026-05-21

Status:
- draft reference contract
- non-normative
- intended to prevent overstated deployment claims

## Purpose

The paper intentionally avoids prescribing a production infrastructure standard.
This contract adds the next engineering boundary: a deployment may describe
which adoption stage it has reached, but only if the required evidence surfaces
are present.

The gate is not a product certification. It is a self-auditing review artifact
for implementation work that wants to move beyond a local PoC without weakening
the paper's scope discipline.

## Stages

### Stage 0: Local proof

The deployment proves the scanner-visible decision model locally.

Required boundaries:
- scanner-visible decision runtime
- scanner-fleet evidence packet
- cross-surface QR evidence packet

Appropriate claim:
- "This is a local proof of the scanner-visible decision model."

Inappropriate claim:
- "This is a QR trust network."

### Stage 1: Single-operator pilot

One operator controls the source of truth, publication path, verifier cache, and
scanner decision runtime.

Required boundaries:
- Postgres trust-state authority
- authority artifact publication
- verifier cache read model
- scanner-visible decision runtime
- scanner-fleet evidence packet
- cross-surface QR evidence packet
- publication-backed signing custody audit export
- operator runbooks
- backup and restore drill

Appropriate claim:
- "This is a single-operator reference pilot."

Inappropriate claim:
- "This is ready for federation or production custody."

### Stage 2: Multi-authority reference

Multiple authorities or verifier instances can consume propagated trust-state
events without treating the propagation bus as the source of trust.

Additional required boundary:
- NATS JetStream propagation

Appropriate claim:
- "This is a multi-authority reference network."

Inappropriate claim:
- "The broker is the trust authority."

### Stage 3: Ecosystem candidate

All boundaries are present, including production-owned custody, runtime safety,
and external governance review.

Additional required boundaries:
- managed signing custody
- live runtime-safety provider
- external governance audit

Appropriate claim:
- "This is an ecosystem-candidate reference deployment."

Inappropriate claim:
- "This is a standard."

## Boundary Rules

- Postgres remains the source of truth for trust state.
- NATS propagates events only; it never becomes the authority.
- Redis and cache entries are read models, not governance state.
- Scanner-visible decisions must remain green, orange, or red outcomes with
  explainable reason codes and a short decision path.
- Future-stage gaps are warnings in `reference_only` mode.
- Required-stage gaps are blockers.
- Production-candidate mode cannot carry warnings.
- Passing boundaries must cite reviewable evidence references.
- Passing boundaries carry an `evidence_tier`:
  `reference_backed`, `operator_backed`, or `unattached`.
- `reference_backed` means the claim is supported by repository docs,
  examples, or smoke programs. It is acceptable for reference claims.
- `operator_backed` means the claim cites operator-owned `ops://qrtrust/`
  evidence. It is required for production-candidate pass boundaries.
- `unattached` means no evidence reference is attached to the boundary.
- Warning or blocking boundaries must include remediation text.

## Example

`examples/reference-network-adoption-stage-1.json` shows a stage 1
single-operator pilot. It passes the single-operator boundaries and warns on
later-stage concerns: NATS propagation, managed KMS/HSM signing custody, live
runtime safety provider integration, and external governance audit. The stage 1
example still includes publication-worker signing custody audit evidence because
a pilot claim needs public-safe custody proof even before production custody is
managed by KMS, HSM, or an equivalent provider.

Run:

```sh
make network-adoption-stage-report
make network-adoption-stage-production-drill
make check-network-adoption-stage
make check-network-contracts
```

`make network-adoption-stage-report` writes a local JSON and Markdown report to
`local/reference-network-adoption-stage.*`. By default it emits the current
stage 1 reference-pilot claim with tracked evidence references and leaves
future-stage production concerns as warnings. Set
`QRTRUST_ADOPTION_REFERENCE_PRESET=false` to require every readiness boundary to
come from explicit environment flags.

`make network-adoption-stage-production-drill` writes
`local/reference-network-adoption-production-drill-report.*` with stage 3,
`production_candidate`, no reference preset, and explicit evidence references
for every adoption boundary. Production-candidate pass boundaries must cite
operator-owned `ops://qrtrust/` evidence, not repository reference artifacts.
The drill also loads a production-candidate operator evidence index and verifies
that every adoption-stage evidence reference appears in that index. This keeps
the stage gate from accepting disconnected operator URLs that are not part of a
reviewable handoff packet.
This drill is not a production claim by itself; it proves that the stage gate can
fail closed until all stage 3 controls and operator-owned evidence references
are supplied.

The public helper files are:
- `reference-network-adoption.production.env.example`: fail-closed
  production-candidate input template.
- `reference-network-adoption.evidence.example.json`: evidence-reference map
  keyed by the canonical adoption boundary order.
- `examples/operator-evidence-index-production-candidate.json`:
  production-candidate operator evidence index covering the adoption drill refs.

Useful environment switches:
- `QRTRUST_ADOPTION_STAGE=0|1|2|3`
- `QRTRUST_ADOPTION_CLAIM_MODE=reference_only|production_candidate`
- `QRTRUST_ADOPTION_EVIDENCE_JSON=/path/to/evidence-map.json`
- `QRTRUST_ADOPTION_OPERATOR_EVIDENCE_INDEX_JSON=/path/to/operator-index.json`
- `QRTRUST_ADOPTION_JSON=/path/to/report.json`
- `QRTRUST_ADOPTION_MD=/path/to/report.md`

## Relationship To The Paper

This gate preserves the paper's central separation:

- issuer legitimacy
- destination binding
- runtime destination safety
- scanner-visible decision state

It does not add a universal governance model. It makes implementation claims
auditable so a local PoC, a single-operator pilot, and a future ecosystem
candidate are not described with the same language.
