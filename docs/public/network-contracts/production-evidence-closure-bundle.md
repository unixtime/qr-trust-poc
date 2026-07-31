# Production Evidence Closure Bundle

Date: 2026-05-26

Status:
- draft reference contract
- non-normative
- public-safe operator handoff

## Purpose

The production evidence closure bundle is the final public-reference handoff for
operator-owned production obligations. It combines the production evidence
requirements, collection template, gap report, and intake report into one
operator-facing checklist.

It does not contain production evidence and does not approve deployment. It
answers one question: what private `ops://qrtrust/` evidence refs still need to
be collected before the packet can be accepted for human production evidence
review?

## Inputs

The bundle is generated from:

- `production-evidence-requirements-reference.json`
- `local/production-evidence-collection-template.json`
- `local/production-evidence-gap-report.json`
- `local/production-evidence-intake-report.json`

The generator verifies that those inputs still match before writing the bundle.
Stale input IDs, stale gap status, or stale intake status fail closed.

## Output

Run:

```sh
make network-production-evidence-closure-bundle
```

This writes:

- `local/production-evidence-closure-bundle.json`
- `local/production-evidence-closure-bundle.md`

The JSON is for automation. The Markdown is for operator review.

## Guardrails

- The bundle is a handoff artifact, not evidence.
- Production proof stays in the operator evidence store under
  `ops://qrtrust/`.
- Vendor KMS, HSM, broker, restore, and release-approval proof remains outside
  the public repository.
- A ready bundle still requires human production evidence review before any
  production-ready claim.

## Smoke Check

Run:

```sh
make check-network-production-evidence-closure-bundle
```

The smoke check proves the current public production-candidate example remains
blocked until the operator supplies the missing private refs. It also verifies
that closure slots use `ops://qrtrust/` and that the generated bundle matches
its inputs.
