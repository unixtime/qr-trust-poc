# Postgres Migration Deployment Policy

Date: 2026-05-19

Status:
- draft reference operations policy
- non-normative
- intended for local shared-infra and small-network reference deployments

## Purpose

The QR trust network treats Postgres as the source of truth for root programs,
delegated authorities, issuers, destination policies, published artifacts,
verifier cache entries, scanner decisions, and worker queues. Schema changes
therefore need an explicit deployment policy before reference workers are
treated as continuously runnable services.

This policy defines the minimum migration discipline for the local reference
implementation. It is not a substitute for a production deployment system, but
it records the controls a production system should preserve.

## Authority Boundary

The migration runner may create or extend the `qr_trust` schema. It must not:

- drop `qr_trust` or any application table
- delete trust-state rows
- truncate queues, artifacts, cache entries, or scanner decisions
- rewrite an applied migration checksum
- treat Redis, NATS, or scanner clients as schema authorities

The local runner is allowed to apply additive, idempotent SQL and record the
checksum in `qr_trust.schema_migrations`.

## Required Gates

Before starting reference workers against a shared database:

1. Run `make ensure-shared-infra-db`.
2. Run `make check-shared-infra-network`.
3. Run `make apply-network-migrations` only after confirming the target is the
   separate QR Trust database, not another project database.
4. Run `make check-network-migrations`.
5. Start workers only if `check-network-migrations` reports `ready`.

`check-network-migrations` is the safe default gate for status checks because it
is read-only. It should be used by operators, demos, and CI jobs that need to
inspect readiness without mutating a database.

## Migration Packaging Rules

Each migration must have:

- a stable migration ID in the form `NNNN_short_name`
- a human-readable description
- a checked-in SQL file or checked-in generated SQL artifact
- a SHA-256 checksum recorded at apply time
- an idempotent apply path
- a documented rollback posture
- a smoke or status command that can prove the expected tables or columns exist

Migration IDs are append-only. Editing an already-applied SQL file must fail the
next status check through checksum drift. The correct repair is a new migration,
not rewriting history.

## Rollback Posture

For this reference implementation, rollback means stopping new writes and
restoring from a known-good database snapshot. It does not mean automatically
running destructive down migrations.

Reason:

- trust artifacts and scanner decisions are audit evidence
- queue rows may represent accepted governance work
- deleting or rewriting those rows can change the historical trust record

Allowed rollback actions:

- stop artifact-publication, verifier-cache, and outbox workers
- block new issuer or policy publication
- restore the QR Trust database from a pre-migration backup
- roll forward with a corrective additive migration
- mark bad worker rows failed for review

Disallowed rollback actions:

- `drop schema qr_trust cascade` on a shared or non-disposable database
- truncating `published_artifacts`, `status_events`, `scanner_decisions`, or
  queue tables to force a green worker status
- deleting applied migration ledger rows to re-run changed SQL
- editing a signed artifact in place

## Backup Requirement

Before applying migrations outside disposable local development, the operator
must capture:

- a database backup or snapshot
- current `qr_trust.schema_migrations` rows
- `make check-network-migrations` output
- worker versions or image digests that will run after the migration

The backup must be restorable before the migration is considered approved.

## Drift Handling

If `check-network-migrations` reports checksum drift:

1. Do not start workers.
2. Do not delete the ledger row.
3. Compare the applied checksum to the current checked-in migration file.
4. If the change is intentional, create a new migration.
5. If the checked-in file was accidentally edited, restore the migration file
   to the applied checksum.

If expected tables are missing, run the migration apply command only after
confirming the database target. If unknown ledger rows exist, treat the database
as managed by a newer or different deployment and stop the local rollout.

## Worker Start Policy

Workers may start only after migration readiness is green:

- artifact-publication worker requires `artifact_publication_work_items`,
  `published_artifacts`, and `event_outbox`
- verifier-cache worker requires `verifier_cache_work_items`,
  `verifier_cache_entries`, `scanner_decisions`, `trust_keys`, and
  `published_artifacts`
- event-outbox worker requires `event_outbox`

If readiness is not green, the operator should leave workers stopped. A partially
working schema can produce misleading scanner outcomes because publication,
cache derivation, and propagation are intentionally separate stages.

## Production Adoption Notes

A production deployment should replace the local runner with the platform's
approved migration mechanism while preserving the same controls:

- checksum or immutable migration artifact tracking
- backup and restore verification
- additive-first migrations
- no automatic destructive rollback for trust evidence
- pre-worker readiness gate
- post-deploy table and ledger inventory

This keeps the reference implementation faithful to the paper: scanner-visible
trust depends on governed source state and derived verifier cache state, not on
best-effort runtime side effects.
