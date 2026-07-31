# Signing Custody Audit Export

Date: 2026-05-21

Status:
- draft reference contract
- non-normative
- intended for public-safe review packets and local validation only

## Purpose

The signing-custody audit export is the public-safe evidence boundary for
managed trust-artifact signing. It records that an artifact was submitted to a
managed signing path, which signer and key scope were used, which managed
custody provider produced audit evidence, and whether publication succeeded.

It is not a new source of authority. The source of authority remains the root,
delegated authority, issuer, destination-policy, and status artifacts validated
by verifiers. This export exists so operators can hand reviewers evidence that
signing was performed through a managed custody path without exposing private
key material.

## Recorded Fields

Each entry records:

- artifact ID, type, version, and `sha256:` hash
- root, delegated-authority, and optional issuer scope
- signer ID, key ID, and algorithm ID
- managed custody provider reference
- provider audit ID
- automation identity that requested signing
- request timestamp
- publication result: `published`, `rejected`, `failed`, or `pending`
- optional reason codes for rejected or failed publication

The summary records total entry count, result counts, and the managed provider
references represented in the export.

## Public-Safe Boundary

The export must have `redaction_status: public_safe`.

Allowed custody references are intentionally indirect:

- `kms://...`
- `hsm://...`
- `managed://...`

The contract rejects private-material references and obvious private-key leak
markers such as `pem://`, `env://`, `file://`, `private_key`,
`private-key`, and PEM private-key blocks. A public-safe audit export may prove
that a managed signing system was used, but it must not carry private keys,
inline credentials, environment-variable names, or filesystem secret paths.

## Publication Worker Integration

The audit export can be generated from an artifact-publication worker report
after publication has been attempted. This makes the export describe real
publication outcomes rather than a standalone fixture.
The bundle-ready reference example is
`docs/public/network-contracts/examples/signing-custody-publication-audit-export-reference.json`;
it intentionally includes both a published row and a failed row with
`reason_codes` so deployment handoff can prove fail-closed publication evidence
is preserved.

The worker report must preserve enough metadata for both completed and failed
rows:

- work item ID
- artifact ID, type, version, and `sha256:` hash
- root, delegated-authority, and issuer scope when present
- publication result and stable reason code for failures

The publication worker still does not own custody authority. A separate managed
custody resolver must provide signer ID, key ID, algorithm ID, managed provider
reference, and provider audit ID. That boundary keeps worker success/failure
separate from proof that signing happened through an approved KMS, HSM, or
managed custody path.

## Validation

Run:

```sh
make check-network-signing-custody-audit-export
make check-network-signing-custody-publication-audit
make check-network-contracts
```

The first command exercises the TypeScript service boundary and negative
fixtures. The second confirms a real artifact-publication worker report can be
converted into a public-safe signing custody audit export for both published and
failed rows. The third validates the public JSON schema, reference example,
summary counts, provider-ref restrictions, scope matching, duplicate-event
rejection, and private-material redaction rules.
