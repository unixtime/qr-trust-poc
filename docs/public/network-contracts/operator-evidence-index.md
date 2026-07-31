# Operator Evidence Index

Date: 2026-05-21

Status:
- draft reference contract
- non-normative
- intended to make operator-owned deployment evidence reviewable without
  committing production secrets or private approval records

## Purpose

The local PoC can prove the QR trust model, but production adoption depends on
operator-owned evidence: source-of-truth ownership, migration posture, restore
drills, packaged deployment approval, propagation, custody, runtime safety,
scanner runtime behavior, worker operations, and runbooks.

This index is the review artifact that binds those references together. It does
not replace the underlying packets. It points to them and states whether each
control is only reference-backed or backed by operator-owned production
evidence.

## Required Control Order

The index uses the same operator-review order as the deployment readiness
evidence map:

1. `postgres_source_of_truth`
2. `migration_ledger`
3. `restore_automation`
4. `packaged_deployment_ownership`
5. `nats_propagation`
6. `managed_key_material`
7. `managed_signing_custody`
8. `custody_audit_export`
9. `runtime_safety_provider`
10. `scanner_decision_persistence`
11. `worker_operations_evidence`
12. `operator_runbooks`

## Claim Modes

`reference_drill` may cite committed docs, schemas, smoke scripts, and reference
evidence packets. This is the right mode for the public repository.

`production_candidate` must cite operator-owned references such as
`ops://qrtrust/...`. It must not rely on committed docs as proof that production
approvals, restore artifacts, custody controls, or runtime provider controls
exist.

For a production-candidate claim, every control must be marked
`operator_backed`. Every evidence reference must use the `ops://qrtrust/`
scheme, include `reviewed_at`, and name the reviewer role that satisfies the
matching production evidence requirement. A reference-drill evidence ref may
omit that role, but if it provides one, the role must still be one of the
recognized operator evidence review roles:

- `database_operator`
- `release_owner`
- `security_reviewer`
- `operations_reviewer`
- `custody_operator`
- `runtime_operator`

## Guardrails

- Evidence references are required for every control.
- Production candidate controls must use `operator_backed` status and
  operator-owned `ops://qrtrust/` refs.
- Production candidate evidence refs must carry the required reviewer role for
  the control they support.
- Public evidence must not contain secrets, credentials, private keys, bearer
  tokens, or private file paths.
- Operator controls remain external to the public repo.

## Relationship To Readiness

The deployment readiness bundle should include both:

- the evidence map, which supports the readiness report checks
- this operator evidence index, which summarizes the control ownership posture
  for reviewers

That separation keeps the readiness report machine-checkable while keeping the
human review handoff compact.
