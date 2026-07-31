# QR Trust Network NATS Subject Map

Date: 2026-05-17

Status:
- draft reference event map
- non-normative
- intended for local reference implementation planning

## Position

NATS JetStream is useful for propagating trust-state changes to verifiers, but
it should not be the source of truth. Postgres remains authoritative. Services
write durable state and an `event_outbox` row in the same transaction; a
publisher worker then emits the event envelope to JetStream.

Kafka is a later analytics and large-scale pipeline option. It is not required
for the first reference implementation.

## Authorization Boundary

The local PoC broker uses static NATS users with subject-level permissions:

- `qrtrust_outbox_worker` can publish QR Trust event subjects and manage the
  local JetStream streams needed by the outbox worker.
- `qrtrust_governance_subscriber`, `qrtrust_runtime_subscriber`, and
  `qrtrust_scanner_audit_subscriber` are read-only subscriber identities scoped
  to their subject families. They may also use narrowly scoped JetStream
  consumer and ack APIs for their own streams so approved subscribers can replay
  missed updates without gaining event-publish rights.
- anonymous clients are not approved subscribers and must be rejected by the
  broker.

This local setup proves the approved-entity boundary without turning NATS into a
trust authority. Subject permissions only decide who may receive propagation
messages. Consumers still validate event envelopes and fetch authoritative
state from Postgres-backed artifact APIs before updating their local trust view.

Production note: static local users are not the final multi-tenant governance
model. A production broker should use NATS accounts with JWT/NKey identities and
per-entity exports/imports or credentials so delegated operators, scanners,
verifiers, and audit consumers are isolated by tenant and role.
Stronger but heavier: NATS accounts/JWT/NKeys is closer to production
multi-tenant governance, but it is a bigger setup and would slow this PoC down.

## Subscriber Authorization

The PoC now uses Postgres-backed subscriber authorization before introducing
heavier NATS account/JWT/NKey governance. A subscriber is approved only when
`qr_trust.nats_subscribers.status = 'active'` and the requested subject matches
a row in `qr_trust.nats_subscriber_subjects`.

Operators manage these rows through the management plane:

- `POST /admin/nats/subscribers` creates or updates an approved subscriber,
  replaces its subject allowlist, writes governance audit evidence, and enqueues
  a management event-outbox record.
- Management APIs and subscriber workers both reject over-broad allowlists such
  as `qrtrust.>`; trust-root approved subjects must follow
  `qrtrust.<root>.<family>.<event>.v1` or the family-scoped
  `qrtrust.<root>.<family>.>` form, where family is one of the documented QR
  Trust subject families. The reserved `control-plane` routing token is allowed
  only for documented exact management-event subjects, not family wildcards or
  trust-state subjects.
- `GET /admin/nats/subscribers` lists the active registry view used by
  approved subscriber workers.
- `qrtrustctl nats-subscriber-authorize` and `qrtrustctl nats-subscriber-list`
  provide the scripted operator path for the same API.
- Governance and runtime materializer workers derive purpose-specific
  JetStream filters from the DB-approved allowlist. A broad approved family
  such as `qrtrust.*.runtime.>` can authorize a worker, but the runtime
  observation materializer subscribes only to
  `qrtrust.*.runtime.verdict.observed.v1`; verifier-cache governance workers
  similarly narrow to artifact-backed publication and status subjects.
- Subscriber workers also constrain approved subjects to the stream they own.
  Governance workers use only root, authority, issuer, destination, and
  certificate families; runtime workers use only runtime and verifier families.
  A DB-approved subject outside the worker stream is rejected before consumer
  creation, and the worker durable/replay identity comes from the approved
  Postgres subscriber record.

NATS remains propagation transport. Subscriber approval does not make NATS
authoritative; consumers still fetch source artifacts from Postgres-backed
stores and verify hash, signature, scope, version, and freshness before writing
verifier-cache state.

Production hardening note: NATS accounts, JWT, and NKeys are stronger and
closer to multi-tenant governance, but the setup is heavier. Adopt them after
Postgres-source-of-truth and DB-approved subscriber flow works end to end.

## Section 7.2 Subscriber Contract

Postgres is the source of truth for Section 7.2 trust state. The event outbox
publishes NATS messages only after durable source rows commit, and subscribers
must treat those messages as distribution hints that trigger authoritative
artifact reads and verifier-cache projection.

Verifier subscribers apply state in the paper precedence order:

1. accepted root manifest
2. delegated authority manifest under that root
3. issuer record under that authority
4. destination policy under that issuer
5. status events that revoke, suspend, expire, or later refresh derived cache
   state

Lower-level state cannot stand alone. A destination policy without an issuer is
a miss, issuer plus policy remains untrusted without accepted root and authority
context, and unaccepted roots never produce scanner-trusted cache hits. Status
events are applied after the source authority chain and can invalidate or update
the derived verifier cache.

Approved subscribers are the broker identities documented above:
`qrtrust_governance_subscriber`, `qrtrust_runtime_subscriber`, and
`qrtrust_scanner_audit_subscriber`. They are scoped readers, not writers, and
their NATS permissions do not make received events authoritative.

Production note: static PoC users prove the boundary cheaply. NATS accounts with
JWT/NKey identities, per-tenant exports/imports, and role-scoped credentials are
closer to production multi-tenant governance, but they add setup weight that is
larger than this PoC needs.

## Subject Convention

```text
qrtrust.<root_program_id>.<scope>.<event_name>.v1
```

Rules:
- `root_program_id` must be normalized for subject use.
- rootless operator-control events use the reserved `control-plane` routing
  token; consumers must not treat that token as an accepted trust root.
- subject names are routing hints, not authorization claims.
- consumers must validate the event envelope and fetch referenced artifacts.
- a positive scanner state must never rely on an event alone.
- implementation adapters should fail closed for unmapped event types rather
  than silently publishing to ad hoc subjects.

## Subjects

| Subject | Producer | Consumer | Purpose |
| --- | --- | --- | --- |
| `qrtrust.<root>.root.manifest.published.v1` | root service | authority sync, verifier sync | Root manifest publication or rotation |
| `qrtrust.<root>.authority.manifest.published.v1` | authority service | verifier sync | Delegated authority manifest publication |
| `qrtrust.<root>.issuer.record.published.v1` | enrollment service | verifier sync | Issuer enrollment or assurance update |
| `qrtrust.<root>.issuer.status.changed.v1` | enrollment service | verifier sync | Issuer suspension, revocation, or reactivation |
| `qrtrust.<root>.destination.policy.published.v1` | policy service | verifier sync | Destination allow-list or redirect policy update |
| `qrtrust.<root>.destination.policy.revoked.v1` | policy service | verifier sync | Destination policy revocation |
| `qrtrust.<root>.certificate.trust-key.upserted.v1` | management plane | audit, operators | Trust-key registry management notification |
| `qrtrust.<root>.certificate.trust-key.status.changed.v1` | management plane | audit, operators | Trust-key registry status management notification |
| `qrtrust.<root>.certificate.status.changed.v1` | key service | verifier sync | Issuer signing key rotation, suspension, or revocation |
| `qrtrust.<root>.verifier.cache.refreshed.v1` | verifier sync | observability | Local verifier cache refresh evidence |
| `qrtrust.<root>.runtime.verdict.observed.v1` | runtime safety service | verifier cache, observability | Runtime destination verdict refresh |
| `qrtrust.<root>.scanner.decision.recorded.v1` | scanner decision service | audit, metrics | Scanner-visible decision evidence |
| `qrtrust.control-plane.runtime.provider.upserted.v1` | management plane | audit, operators | Rootless runtime provider registry notification |
| `qrtrust.control-plane.authority.nats-subscriber.authorization.changed.v1` | management plane | audit, operators | Rootless approved-subscriber registry notification |

## Event Envelope Requirements

Each event must conform to `event-envelope.schema.json` and include:

- `event_id`
- `type`
- `occurred_at`
- `root_program_id`
- referenced artifact ID, hash, or version when the event points to durable trust state

For trust-state events, `root_program_id` is an actual accepted root identifier.
For rootless operator-control events, `root_program_id` is the reserved
`control-plane` routing token so these notifications do not inherit demo-root
authority.

Events that alter trust state should carry only enough data to route and fetch
the signed artifact. Duplicating full issuer or policy state in the event bus
creates drift risk.

`qrtrust.<root>.runtime.verdict.observed.v1` events should point to or carry a
normalized `runtime-safety-observation.schema.json` payload. A runtime verdict
event is evidence for verifier or scanner evaluation; it is not authority to
mutate issuer enrollment or destination policy.

## First JetStream Streams

```text
QRTRUST_GOVERNANCE
  subjects:
    qrtrust.*.root.>
    qrtrust.*.authority.>
    qrtrust.*.issuer.>
    qrtrust.*.destination.>
    qrtrust.*.certificate.>

QRTRUST_RUNTIME
  subjects:
    qrtrust.*.runtime.>
    qrtrust.*.verifier.>

QRTRUST_SCANNER_AUDIT
  subjects:
    qrtrust.*.scanner.>
```

Retention guidance:
- governance stream: durable retention with replay for verifier bootstrap
- runtime stream: shorter retention because observations expire
- scanner audit stream: environment-specific retention because it can contain sensitive usage metadata

## Implementation Notes

- Publish from `qr_trust.event_outbox`; do not publish before the database transaction commits.
- Use idempotent consumers keyed by `event_id`.
- Include artifact hash and version to prevent stale event replay from overwriting newer verifier state.
- Treat event loss as recoverable: verifiers can resynchronize from the artifact APIs and Postgres-backed publication indexes.
- Avoid per-scan NATS dependencies in the user path; scanner decisions should query the verifier API directly.
- Do not publish ungoverned scanner decisions on a trust-root subject. Plain URL
  and other non-governed scan outcomes stay in Postgres scanner-decision
  evidence unless a later governance mapping assigns an explicit root scope.
- The current TypeScript reference package includes a driverless propagation
  adapter that maps event envelopes to these subjects, assigns each message to
  `QRTRUST_GOVERNANCE`, `QRTRUST_RUNTIME`, or `QRTRUST_SCANNER_AUDIT`, and
  emits envelope-only payloads. The live broker adapter wraps that boundary
  instead of duplicating routing rules.
- The local JetStream smoke creates or updates the three reference streams and
  publishes the deterministic governance plus scanner-audit event set through
  the real broker.
- The live publisher port now wraps that mapped message boundary. It accepts an
  injected JetStream publisher, forwards the normalized subject, envelope-only
  payload, idempotency message ID, headers, and expected stream, and records
  only messages that the broker accepted. This keeps NATS in the propagation
  role: broker success never makes an event authoritative, and broker failure
  leaves the durable outbox row available for retry.
- The first outbox publisher boundary consumes Postgres-shaped
  `event_outbox.payload` rows, validates the embedded event envelope, publishes
  each valid row through the same JetStream sink, and returns per-row
  success/failure results.
- The first outbox worker boundary claims `pending` or expired `publishing`
  rows using `for update skip locked`, increments attempts when a row is
  claimed, applies a bounded claim expiry, marks broker-accepted rows
  `published`, and marks malformed rows `failed` without treating NATS as the
  source of truth.
