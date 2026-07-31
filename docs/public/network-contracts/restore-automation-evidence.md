# Restore Automation Evidence

Status:
- draft reference contract
- non-normative
- public-safe review artifact

## Purpose

Restore automation is the proof that the QR trust network can recover the
state that makes scanner-visible decisions meaningful. It is not enough to
say that backups exist. A reviewer needs a packet that shows the authoritative
Postgres state can be backed up, restored into a scratch target, checked
against migration boundaries, and handed to another operator without exposing
private deployment material.

This contract exists because the paper's model depends on managed issuer
legitimacy, destination binding, verifier cache freshness, runtime safety, and
scanner-visible decisions. If the source-of-truth state cannot be restored,
those layers become operational claims rather than reviewable controls.

## Authority Boundary

- Postgres remains the authoritative trust-state store.
- NATS JetStream is propagation only and is not a restore source of truth.
- Redis and verifier caches are hot-path or derived state and are not restore
  authorities.
- Restore drills must target isolated scratch environments unless an operator
  explicitly approves a destructive production recovery.

## Required Drills

The evidence packet must include these drills in canonical order:

- `scheduled_backup_created`: a backup artifact is created from the
  authoritative Postgres trust-state store.
- `scratch_restore_completed`: the backup is restored into a scratch target and
  schema-level trust-state tables are validated.
- `migration_rollback_rehearsed`: migration failure and rollback boundaries are
  rehearsed without rewriting published trust state.
- `operator_failover_handoff`: another operator can find the backup artifact,
  recovery objective, escalation path, and review evidence.

All drills must pass for a packet to claim readiness. A failed or blocked drill
belongs in a readiness report as a production blocker, not in a passing restore
automation evidence packet.

## Evidence Rules

- `reference_drill` packets may cite public repository paths under
  `docs/public/` or `network/`.
- `production_candidate` packets must cite operator-owned evidence under
  `ops://qrtrust/`.
- Evidence references must include a label, URI, owner, and `reviewed_at` date.
- Packets must not include private keys, bearer tokens, API keys, passwords,
  raw filesystem paths, environment-variable references, or PEM material.
- Backup artifacts must include a stable artifact ID, storage reference,
  lowercase SHA-256 digest, creation timestamp, retention policy, and
  encryption mode.
- Recovery objectives must include positive RPO and RTO values, owner, and an
  escalation reference.

## Guardrails

Every passing packet must assert:

- `postgres_authoritative: true`
- `restore_targets_scratch_only: true`
- `no_secret_material: true`
- `destructive_restore_requires_operator_approval: true`

These guardrails keep the reference implementation aligned with the paper. The
trust model is federated, but scanner trust still depends on recoverable shared
state. Restore automation therefore proves operational continuity without
turning propagation buses, caches, or scanner clients into sources of
authority.

## Reference Commands

```sh
make check-network-restore-automation-evidence
make check-network-contracts
make network-readiness-bundle
```

The first command checks the TypeScript packet rules. The contract smoke check
then validates the public schema and example packet. The readiness bundle uses
the packet as a reviewable file role so an operator handoff cannot claim
restore automation without carrying the evidence artifact.
