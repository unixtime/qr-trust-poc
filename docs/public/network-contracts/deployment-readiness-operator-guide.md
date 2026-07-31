# Deployment Readiness Operator Guide

Date: 2026-05-20

Status:
- draft operator guide
- non-normative
- intended for local reference deployments and pre-production review

## Purpose

The readiness report separates two very different claims:

- `reference` mode means the repo is usable for a local implementation drill.
- `production` mode means every modeled operator-owned control is represented.

This distinction keeps the public PoC honest. A local QR trust network can
demonstrate root delegation, issuer enrollment, destination binding, verifier
cache materialization, runtime safety, and scanner decisions without implying
that deployment custody, restore, or provider operations are complete.

## Commands

Generate the default local reference report:

```sh
make network-readiness-report
```

Generate the production-mode report:

```sh
make network-readiness-report-production
```

Run the evidence-backed production drill fixture:

```sh
make network-readiness-report-production-drill
```

Use the fail-closed production input template when preparing an operator review:

```sh
set -a
source docs/public/network-contracts/deployment-readiness.production.env.example
set +a
make network-readiness-report-production
```

The template should still produce `blocked_for_production` until real operator
controls replace the empty values and `false` booleans. A configured control is
not enough by itself: production pass checks also require evidence references.
Reference mode defaults scanner-decision persistence to enabled so local drills
remain useful; production mode does not. In production, explicitly set
`QRTRUST_SCANNER_DECISION_PERSISTENCE_ENABLED=true` only after scanner-visible
outcomes are actually persisted and reviewable.

Use the example evidence map when testing a production-ready drill:

```sh
QRTRUST_DEPLOYMENT_READINESS_EVIDENCE_JSON=docs/public/network-contracts/deployment-readiness.evidence.example.json
```

The deployment-readiness bundle should also carry the signing-custody audit
contract and the publication-worker-backed audit export example. That keeps
operator handoff evidence concrete: reviewers can inspect both successful and
failed publication rows, including stable failure reason codes, without
receiving private signing material.

The bundle also treats packaged deployment ownership as a production control.
Before production mode can pass, the operator should identify who owns
deployable artifacts, image provenance, release approval, environment
promotion, and rollback. This is separate from the local compose reference
stack; the public repo can prove the contract, but it does not own a production
release train.

For production-ready bundles, the `evidence_map` is not only fingerprinted. It
is semantically checked against the production report: every passing readiness
check must have a non-empty evidence entry in the bundled map, and unknown check
IDs are rejected. This prevents an operator handoff from claiming production
readiness while attaching a stale or incomplete evidence map.
Malformed evidence references are also rejected: each entry must provide a
label, URI, owner, and `YYYY-MM-DD` review date so the reviewer has a concrete
evidence owner, location, and review point for every passing control.

The outputs are ignored by git:

- `local/network-readiness-report.json`
- `local/network-readiness-report.md`
- `local/network-readiness-production-report.json`
- `local/network-readiness-production-report.md`
- `local/network-readiness-production-drill-report.json`
- `local/network-readiness-production-drill-report.md`

## Production Inputs

Production mode reads the same report generator with stricter status mapping.
Missing controls become blocking checks instead of warnings.

| Environment variable | Control represented | Expected production meaning |
| --- | --- | --- |
| `QRTRUST_DEPLOYMENT_READINESS_EVIDENCE_JSON` | Review evidence map | JSON object keyed by readiness check ID with label, URI, owner, and review date |
| `QRTRUST_NETWORK_DATABASE_URL` | Postgres source of truth | Dedicated QR trust database, not another app's database |
| `QRTRUST_MIGRATION_LEDGER_ENABLED` | Migration ledger | Schema changes are gated through a checksum ledger |
| `QRTRUST_RESTORE_AUTOMATION_DOCUMENTED` | Backup and restore | Backup, restore drill, and rollback ownership are documented |
| `QRTRUST_PACKAGED_DEPLOYMENT_OWNERSHIP_DOCUMENTED` | Packaged deployment | Deployable artifacts, image provenance, release approval, promotion, and rollback owners are documented |
| `QRTRUST_NETWORK_NATS_URL` | Propagation | NATS JetStream is available for durable state-change notification |
| `QRTRUST_MANAGED_KEY_MATERIAL_PROVIDER` | Public key material | Verifier cache uses a managed source for public verification material |
| `QRTRUST_MANAGED_SIGNING_CUSTODY_PROVIDER` | Signing custody | Artifact signing is backed by KMS, HSM, or equivalent managed custody |
| `QRTRUST_CUSTODY_AUDIT_EXPORT_CONFIGURED` | Custody audit | Signing custody events are exported to an operator-owned audit trail |
| `QRTRUST_RUNTIME_SAFETY_PROVIDER` | Runtime safety | Live reputation, redirect, TLS, or malware inspection is configured |
| `QRTRUST_SCANNER_DECISION_PERSISTENCE_ENABLED` | Scanner decisions | Scanner-visible outcomes are persisted for audit and review |
| `QRTRUST_WORKER_OPERATIONS_EVIDENCE_READY` | Worker operations | Publication, outbox, verifier-cache, scanner-runtime, monitoring, and replay/recovery evidence are attached |
| `QRTRUST_OPERATOR_RUNBOOKS_DOCUMENTED` | Operations | Issuance, rotation, outage, worker recovery, and rollback procedures exist |

Boolean values accept `true`, `false`, `yes`, `no`, `enabled`, or `disabled`.

## Review Rule

For a reference drill:

- `ready_for_reference_drill` is acceptable even with warnings.
- Warnings should be preserved because they identify production-owned work.

For production:

- `blocked_for_production` means the deployment is not production-ready.
- `ready_for_production_drill` requires every modeled check to pass.
- Every production `pass` check must include at least one evidence reference.
- A production-ready bundle must also include an `evidence_map` entry for every
  passing check in the report.
- Do not override a blocking check with a manual note. Add the missing
  operational control or keep the deployment in reference mode.

## Boundary

The readiness report is not a security certification. It is a deployment
hygiene gate that makes the paper's trust-model boundaries explicit:

- Postgres remains source of truth.
- NATS propagates state-change notifications only.
- Redis is hot-path cache only.
- Verifier cache is derived state.
- Scanner-visible decisions are the user-facing output.
- Runtime safety is scan-time evidence, not issuer identity.
