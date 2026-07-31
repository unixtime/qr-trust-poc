# Worker Operations Evidence

Date: 2026-05-21

Status:
- draft reference contract
- non-normative
- intended for reviewer and operator handoff

## Purpose

The paper separates source governance state from scanner-visible decisions. A
production reference implementation needs workers to move state between those
boundaries, but the workers must not become new sources of authority.

This contract defines a reviewable evidence packet for those workers:

```text
Postgres source of truth
  -> artifact publication worker
  -> event outbox worker
  -> verifier cache read-model worker
  -> scanner decision runtime
```

The packet is not proof that a deployment is production-ready. It is a
structured way to show that worker operation, monitoring, replay, and recovery
have been considered before claiming a single-operator pilot or a
multi-authority reference.

## Required Components

The packet must list these components in order:

1. `artifact_publication_worker`
2. `event_outbox_worker`
3. `verifier_cache_read_model_worker`
4. `scanner_decision_runtime`

Each component must include:

- input references
- output references
- a runbook reference
- a smoke script
- a metrics reference
- a recovery reference
- an operational status

## Authority Boundaries

The required authority boundary is fixed for each component:

| Component | Boundary |
| --- | --- |
| `artifact_publication_worker` | `postgres_source_of_truth` |
| `event_outbox_worker` | `nats_propagation_only` |
| `verifier_cache_read_model_worker` | `derived_read_model` |
| `scanner_decision_runtime` | `scanner_decision_runtime` |

This is the main invariant. Postgres remains authoritative. NATS carries
propagation signals only. The verifier cache is a derived read model. Scanner
decisions consume verifier state and runtime observations; they do not rewrite
issuer governance.

## Replay And Recovery Drills

Each component must have at least one replay or recovery drill. The drill should
name:

- the trigger
- the expected recovery behavior
- the evidence reference

Examples:

- A destination-policy work item is blocked by the publication gate.
- NATS is unavailable after a Postgres outbox row is committed.
- A verifier cache entry is stale and must be rebuilt from source artifacts.
- A scanner decision runtime sees a cache miss and fails closed.

## Monitoring

The packet must include a monitoring snapshot with:

- capture time
- stale work-item threshold
- maximum publish-lag threshold
- metrics references
- canonical signal evidence for each required worker

This keeps the worker boundary operational. A worker that only has a happy-path
smoke test but no freshness or lag evidence is not ready for production claims.

The required signal evidence is:

| Signal | Component | Purpose |
| --- | --- | --- |
| `artifact_publication_lag` | `artifact_publication_worker` | Shows whether authoritative publication work is blocked or aging before it becomes public evidence. |
| `event_outbox_publish_lag` | `event_outbox_worker` | Shows whether committed Postgres event-outbox rows are waiting too long before NATS propagation. |
| `verifier_cache_staleness` | `verifier_cache_read_model_worker` | Shows whether derived verifier cache entries are within the accepted freshness window. |
| `scanner_decision_error_rate` | `scanner_decision_runtime` | Shows whether scanner-visible decisions are failing or degrading at runtime. |

Each signal must include:

- threshold
- metric reference
- alert reference
- replay or recovery reference
- owner

This makes operator evidence concrete. A production candidate should be able to
point from a worker to the signal that would alert an operator, then to the
replay or recovery drill that proves the system can return to a trustworthy
scanner-visible state.

## Claim Modes

`reference_drill`:
- Components may be `reference_ready` or `production_ready`.
- Components may not be `blocked`.
- Local smoke scripts and docs-backed evidence are acceptable.

`production_candidate`:
- Every component must be `production_ready`.
- Every referenced runbook, metric, and recovery drill must be owned by the
  deployment operator.
- No secret material may appear in the packet.

## Validation

Run:

```bash
make check-network-worker-operations-evidence
make check-network-contracts
```

The TypeScript smoke proves the contract fails closed for missing components,
wrong boundaries, blocked workers, missing drills, unsafe evidence refs, missing
monitoring, missing monitoring signals, misbound monitoring signals, unsafe
alert refs, and private-material markers.
