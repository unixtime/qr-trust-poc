# Managed Signing Custody Deployment Policy

Date: 2026-05-19

Status:
- draft reference operations policy
- non-normative
- intended for local shared-infra and small-network reference deployments

## Purpose

Managed signing custody keeps private signing keys outside normal verifier,
worker, and scanner processes. The QR trust network still needs signed root,
delegated-authority, issuer, destination-policy, and status artifacts, but
ordinary application services should hold only scoped key references such as
`kms://`, `hsm://`, or `managed://`.

This policy defines the minimum deployment controls for a production-style
signing-custody adapter without choosing a specific cloud KMS, hardware HSM, or
managed key service.

## Boundary

The signing-custody adapter may:

- select an active signer that matches root, authority, issuer, scope, and
  accepted algorithm policy
- submit canonical artifact bytes to a managed signing client
- receive the signature, key ID, algorithm ID, and provider audit reference
- return the signed artifact envelope to the artifact-publication flow

The adapter must not:

- expose private key material to application memory, logs, HTTP responses, or
  event payloads
- let scanner clients or verifier-cache workers invoke signing
- let NATS, Redis, or event-outbox messages authorize signing
- sign artifacts whose scope does not match the selected key
- continue signing with revoked, suspended, expired, or unknown keys

## Required Controls

Before enabling managed custody for any non-disposable environment:

1. Register root and delegated-authority signing keys as durable trust-state
   records with explicit scope, algorithm, lifecycle status, and material refs.
2. Require signer selection through the same scope and algorithm checks used by
   the reference signing-custody port.
3. Keep application credentials limited to signing operations for the specific
   key refs and artifact classes they are allowed to publish.
4. Store provider audit IDs or signing request IDs with the publication record
   or operator audit log.
5. Run the relevant smoke tests before publishing source artifacts:
   `npm run signing-custody:smoke`, `npm run signature-verification:smoke`, and
   `npm run signer-recovery:smoke`.
6. Start artifact-publication workers only after migration readiness is green
   and custody configuration has been verified by an operator.

## Approval Model

Custody deployment should distinguish routine and sensitive signing:

- Routine issuer or destination-policy artifacts may be signed by an approved
  delegated-authority key after normal publication checks pass.
- Root manifests, delegated-authority manifests, emergency revocations, and
  recovery artifacts require a higher approval path.
- Break-glass signing must produce explicit audit evidence and should force
  verifier-cache refresh or downgrade behavior until recovery state is visible.

The reference implementation does not define the human approval tool. It
requires that the resulting signed artifact remain verifiable through the same
contract and key-lifecycle rules.

## Key Lifecycle

Managed custody must preserve the key lifecycle model already used by verifier
cache authorization:

- `active` keys may sign only inside their scope and validity window
- `suspended` keys must not sign new artifacts
- `revoked` keys must not sign new artifacts and must trigger recovery handling
- `expired` keys must not sign new artifacts unless a documented emergency
  policy explicitly allows recovery-only signing

Key rotation requires overlap long enough for verifier caches to refresh.
Emergency revocation should map affected scanner decisions to orange or red
until replacement state is verified.

## Audit Requirements

Each managed signing operation should retain:

- artifact ID, artifact type, version, and hash
- root program, delegated authority, and issuer scope
- selected key ID and algorithm ID
- custody provider reference, without secrets
- provider audit ID or signing request ID
- approver or automation identity
- request time and publication result

Audit logs are evidence. Do not rewrite them to hide failed signing attempts.

## Failure Handling

If managed custody is unavailable:

- stop publication of artifacts that require managed signing
- keep verifier-cache and scanner-decision workers running against already
  published verified state
- report custody unavailability to operators
- do not fall back to fixture, environment, filesystem, or static private keys
  in a shared or production-like environment

If a signing request returns a signature that fails local verification, reject
the artifact, capture the provider audit ID, and escalate as a custody incident.

## Production Adoption Notes

A production adapter should map this policy onto the chosen provider's native
controls:

- key policy and IAM or HSM partition authorization
- hardware-backed or managed rotation
- dual control for high-risk artifacts
- signing audit export
- emergency disablement
- tested restore and recovery procedures

The provider is an implementation detail. The trust-network contract remains
the same: signed artifacts are accepted only when key lifecycle, scope,
algorithm, canonical bytes, and signer authority all match.
