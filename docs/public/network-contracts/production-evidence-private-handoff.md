# Production Evidence Private Handoff

Date: 2026-05-26

Status:
- draft operator workflow
- non-normative
- public-safe contract and tooling only

## Purpose

The public repository can define production evidence requirements and validate
the shape of an operator packet. It must not store the operator's private
production proof.

This handoff defines the recommended path for closing the remaining production
reference blocker: collect external production-reference evidence under an
operator-owned evidence store such as `ops://qrtrust/`, validate the private
operator evidence index locally, then route the packet to human operational
review.

## Workflow

Generate the ignored starter template:

```sh
make network-production-evidence-private-template
```

This writes:

- `local/production-evidence-private-template.json`
- `local/production-evidence-private-template.md`

Fill a private operator evidence index outside the public repository. The
index should satisfy the same `operator-evidence-index.schema.json` contract,
use `claim_level: "production_candidate"`, and replace placeholders with
reviewed `ops://qrtrust/` refs owned by the production operator.

Validate the private index:

```sh
QRTRUST_PRODUCTION_EVIDENCE_INDEX_JSON=/private/path/operator-evidence-index.json \
  make check-network-production-evidence-private-index
```

This writes sanitized local summaries:

- `local/production-evidence-private-index-validation.json`
- `local/production-evidence-private-index-validation.md`

Those summaries intentionally omit evidence ref URIs and evidence bodies. They
are safe to use as a readiness signal for review routing, but the private
evidence index and source proof remain operator-owned.

## Success Rule

The private index check must report `ready_for_human_review` before the packet
can move to human production review. That result does not approve production.
It only proves the packet is complete enough for the required reviewers to
inspect the underlying private evidence.

## Guardrails

- Do not commit filled private operator evidence indexes.
- Do not paste secrets, key material, tokens, private reviewer notes, or
  evidence bodies into public files.
- Keep production evidence storage, retention, access control, and approval
  history under operator governance.
- Vendor KMS/HSM ceremonies, restore proof, broker operations proof, and
  release approval proof remain external production evidence.
- Stronger NATS accounts, JWT, and NKeys are closer to production multi-tenant
  governance, but they are heavier than this PoC path. Add that hardening
  after the Postgres source-of-truth and approved-subscriber flow remains
  stable.

## Containers

No additional containers are required for this handoff. The next external
systems should be an operator evidence store or GRC repository, a managed KMS
or HSM provider, backup/restore infrastructure, and a deployment approval
system. The public PoC keeps Postgres as source of truth and NATS as
notification transport.
