# Production Evidence Requirements

Date: 2026-05-22

Status:
- draft reference contract
- non-normative
- public-safe requirements only

## Purpose

The public repository can define what a production QR trust operator must prove,
but it should not contain the operator's private production proof. This contract
is therefore a requirements artifact, not an evidence packet.

It lists the twelve operator-owned controls that must have reviewable evidence
before a deployment can claim production readiness:

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

Each control also declares a minimum review role. That role is part of the
evidence requirement, not just reviewer metadata: a production-candidate
operator evidence index only satisfies a control when the supporting
`ops://qrtrust/` evidence refs are reviewed by the required role for that
control.

## Boundary

This artifact answers: what evidence must exist?

The operator evidence index answers: where is that evidence for this operator?

The production evidence intake report answers: is this operator packet ready to
send to human reviewers?

Production candidate references must use an operator-owned reference scheme such
as `ops://qrtrust/...`. Committed docs, schemas, smoke scripts, and reference
fixtures are valid for a reference drill, but they are not proof that production
restore records, approvals, custody ceremonies, provider health, or runbooks
exist.

## Guardrails

- Requirements are not evidence.
- Public repositories must not contain operator secrets or private proof.
- Production claims require operator-owned `ops://qrtrust/` references.
- Production refs must be reviewed by the required role for the control they
  support; a different operational role does not satisfy the requirement.
- Operators own evidence storage, retention, and access control.

## Intake Gate

The intake gate is a pre-review quality gate. It combines the production
evidence requirements, the operator evidence index, the generated collection
template, and the generated gap report. The gate accepts a packet for review
only when:

- the operator evidence index is a `production_candidate` packet
- the collection template still matches the current requirements
- the gap report still matches the current requirements and index
- every required control is satisfied by role-qualified `ops://qrtrust/` refs
- no placeholder refs remain
- no evidence ref URI is reused across controls

An accepted intake report does not approve a deployment. It only means the
packet is complete enough for human operational review.

Run the smoke check with:

```sh
make check-network-production-evidence-intake
```

Generate the local JSON and Markdown intake report with:

```sh
make network-production-evidence-intake
```

## Relationship To The Paper

The paper intentionally avoids prescribing one universal deployment topology.
This contract keeps that boundary intact: it does not mandate a vendor, cloud,
HSM, NATS topology, or scanner distribution channel. It only makes the minimum
proof obligations explicit for the paper's core layers: issuer legitimacy,
destination binding, runtime safety, and scanner-visible decisions.
