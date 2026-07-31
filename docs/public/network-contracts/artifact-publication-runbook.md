# Artifact Publication Worker Runbook

Date: 2026-05-19

Status:
- draft reference operations guide
- non-normative
- intended for local shared-infra and small-network reference deployments

## Purpose

The artifact-publication worker promotes canonical source rows into immutable
published artifacts and durable publication events. It is the first operational
step after a root program, delegated authority, issuer, destination policy, or
status artifact has been accepted for publication.

The worker does not publish to NATS directly. It writes to Postgres and enqueues
events into `qr_trust.event_outbox`; the outbox worker owns broker propagation.

## Required Boundary

Before starting the worker, verify these boundaries:

- Postgres is the source of truth.
- `qr_trust.artifact_publication_work_items` is the source queue.
- `qr_trust.published_artifacts` is the immutable artifact store.
- `qr_trust.event_outbox` is the durable propagation handoff.
- NATS, Redis, and scanner clients must not be treated as authoritative state.

## Local Shared-Infra Setup

The repo defaults expect a separate QR Trust database on the existing shared
Postgres service:

```sh
make ensure-shared-infra-db
make check-shared-infra-network
make apply-network-migrations
make check-network-migrations
```

`apply-network-migrations` is idempotent. It applies
`reference-postgres-schema.sql` without dropping `qr_trust`, records the applied
checksum in `qr_trust.schema_migrations`, then verifies that the expected
reference tables exist.

`check-network-migrations` is read-only. Use it before starting workers to
confirm that the migration ledger still matches the current reference files and
that the expected table inventory is present.

Use reset-guarded smokes only on disposable databases. Do not run
`check-network-live-postgres` against a database that contains state you care
about.

## Migration and Rollback Policy

Use `postgres-migration-deployment-policy.md` as the deployment gate for any
non-disposable database. The short version is: verify the target database,
capture a backup, apply only additive and idempotent migrations, rerun the
read-only status gate, and start workers only after migration readiness is
green.

Rollback is stop-write plus restore or roll-forward. Do not run destructive down
migrations against trust evidence, published artifacts, queue rows, verifier
cache rows, or scanner decisions.

## Start Worker

Start only the artifact-publication worker:

```sh
make up-network-artifact-publication-worker
make logs-network-artifact-publication-worker
```

For full propagation, start NATS and the outbox worker as separate processes:

```sh
make up-nats
make up-network-outbox-worker
make logs-network-outbox-worker
```

## Worker Contract

Each polling iteration:

1. Claims pending or expired-processing rows with `FOR UPDATE SKIP LOCKED`.
2. Writes the canonical artifact into `published_artifacts`.
3. Enqueues a deterministic publication event into `event_outbox`.
4. Marks each work item completed or failed.

Publication event IDs are deterministic from artifact ID, artifact hash, event
type, and version. If the worker crashes after artifact/event publication but
before marking the work item completed, retry should not create a second logical
event.

Completed and failed worker reports must both preserve artifact metadata. This
allows the signing-custody audit export to prove which artifacts were published
and which publication attempts failed without dropping failed rows from the
review record.

## Environment

Required:

- `QRTRUST_NETWORK_DATABASE_URL`

Operational knobs:

- `QRTRUST_ARTIFACT_PUBLICATION_WORKER_ID`
- `QRTRUST_ARTIFACT_PUBLICATION_BATCH_SIZE`
- `QRTRUST_ARTIFACT_PUBLICATION_CLAIM_TTL_MS`
- `QRTRUST_ARTIFACT_PUBLICATION_POLL_INTERVAL_MS`
- `QRTRUST_ARTIFACT_PUBLICATION_IDLE_POLL_INTERVAL_MS`
- `QRTRUST_ARTIFACT_PUBLICATION_IDLE_ITERATION_LIMIT`
- `QRTRUST_ARTIFACT_PUBLICATION_MAX_ITERATIONS`

Use bounded `MAX_ITERATIONS` for drills and one-shot jobs. Use unbounded
supervision for local demo services.

## Inspect Queue State

Use these read-only queries from `psql` or your Postgres client:

```sql
select work_status, count(*)::int
from qr_trust.artifact_publication_work_items
group by work_status
order by work_status;
```

```sql
select work_item_id, artifact_type, artifact_id, version, attempts, last_error
from qr_trust.artifact_publication_work_items
where work_status = 'failed'
order by created_at asc
limit 20;
```

```sql
select publish_status, count(*)::int
from qr_trust.event_outbox
group by publish_status
order by publish_status;
```

## Failure Handling

Treat failed work rows by cause:

- Contract or canonical JSON error: fix the source row or reject the source
  publication request. Do not force-publish malformed artifacts.
- Duplicate immutable artifact: verify artifact ID and version intent before
  retrying. The reference unique index prevents accidental duplicate active
  publication for the same artifact version.
- Event outbox enqueue conflict: inspect the existing event ID and artifact
  hash. A matching hash usually means a safe retry after a post-publication
  marking failure.
- Database outage: leave processing rows for the claim lease to expire, then
  restart the worker.

The safe retry shape is to move a reviewed failed row back to `pending` only
after fixing the underlying cause:

```sql
update qr_trust.artifact_publication_work_items
set work_status = 'pending',
    claimed_by = null,
    claimed_at = null,
    claim_expires_at = null,
    last_error = null
where work_item_id = '<reviewed-work-item-id>';
```

## Stop Worker

The runtime handles `SIGINT` and `SIGTERM` by stopping the supervisor loop after
the current iteration. If a process exits mid-iteration, uncompleted processing
rows become claimable again after `claim_expires_at`.

## Promotion Criteria

This worker is ready to promote beyond local reference deployment only when:

- `managed-signing-custody-deployment-policy.md` is satisfied for the source
  artifacts being queued
- schema application is controlled by the deployment system with the same
  migration-ledger checksum guarantees as the local runner
- queue and outbox metrics are monitored together
- failed rows have a documented owner and review cadence
- `make check-network-signing-custody-publication-audit` passes, proving failed
  and completed publication attempts remain audit-exportable
- scanner-visible decisions continue to derive from verified cache state, not
  worker success alone
