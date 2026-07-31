# Packaged Deployment Approval Evidence

This contract records the minimum evidence a packaged QR Trust network deployment candidate must carry before it is treated as more than a local PoC artifact. It is intentionally evidence-oriented: it does not deploy infrastructure, distribute secrets, or claim that a production operator has approved the public repository.

## Boundary

The paper leaves production deployment practice out of scope. This packet fills that implementation gap without changing the paper's claim:

- Postgres remains the authoritative trust-state store.
- NATS and workers remain propagation and materialization surfaces.
- Operator credentials, release approvals, and production rollback records remain outside the public repo.
- A production candidate must reference operator-owned evidence through `ops://qrtrust/` references.

## Required Gates

Every packet must include these gates in canonical order:

- `artifact_fingerprinted`: the packaged artifact or readiness bundle has a stable fingerprint.
- `contract_smoke_passed`: the public contract smoke path passed for the candidate.
- `operator_approval_recorded`: release, security, and operations approval records exist.
- `rollback_plan_accepted`: rollback and restore rehearsal evidence exists before promotion.

## Required Approval Roles

Every packet must include approvals in canonical order:

- `release_owner`
- `security_reviewer`
- `operations_reviewer`

All three decisions must be `approved`. A `rejected` or `deferred` approval is a block, not a partial pass.

## Reference Drill

The repository carries a public-safe reference example:

- Schema: `docs/public/network-contracts/packaged-deployment-approval-evidence.schema.json`
- Reference packet: `docs/public/network-contracts/examples/packaged-deployment-approval-evidence-reference.json`
- Smoke target: `make check-network-packaged-deployment-approval-evidence`

Reference mode may point at public docs and smoke programs. Production-candidate mode must point at operator-owned evidence references, for example:

```text
ops://qrtrust/releases/2026-05-21/approval/release-owner
ops://qrtrust/releases/2026-05-21/approval/security-review
ops://qrtrust/releases/2026-05-21/rollback/rehearsal
```

## Non-Goals

- It does not define a vendor-specific CI/CD platform.
- It does not store production secrets, private keys, API keys, or passwords.
- It does not make NATS authoritative for trust state.
- It does not replace release-manager judgment; it only makes that approval auditable.
