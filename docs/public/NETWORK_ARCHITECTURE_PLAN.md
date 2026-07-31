# QR Trust Network Architecture Plan

Date: 2026-05-17

Status:
- planning document
- non-normative
- intended to guide a production-reference implementation, not to define a final standard

Purpose:
- extend the paper-backed PoC into a small but credible QR trust network design
- keep the implementation faithful to the paper's four-layer model
- separate governance, enrollment, publication, synchronization, runtime safety, and scanner-visible decisions
- give reviewers and implementers a concrete answer to "what would this require in production?"

## 1. Scope Boundary

The paper intentionally does not prescribe final infrastructure, a universal
schema, or a single global governance operator. That boundary should remain.

This architecture plan is narrower:
- it defines one reference network that can run locally or in a small managed environment
- it demonstrates root delegation, issuer enrollment, destination policy, verifier cache synchronization, runtime safety, and scanner decision states
- it produces auditable signed artifacts and deterministic scanner-visible outcomes
- it remains replaceable by other operators, standards bodies, or platform vendors

This plan does not claim:
- a universal QR standard
- a global certification authority
- a legal identity system
- complete malware or phishing detection
- platform-native adoption by Apple, Google, browser vendors, or scanner apps

## 2. Reference Network Roles

### Root trust program

Responsibilities:
- publish root manifest
- publish root public keys
- define accepted delegated-authority classes
- define delegation depth
- define minimum proofing and revalidation rules
- publish signed revocation and policy events

Examples:
- payment QR trust program
- public-service QR trust program
- enterprise QR trust program
- education or campus QR trust program

The root is not expected to generate most QR codes. It defines the trust domain
and delegates operational authority.

### Delegated authority

Responsibilities:
- enroll issuers inside a bounded scope
- verify issuer proofs
- issue signed issuer records
- approve destination policies
- suspend or revoke issuers
- publish operator status and artifact endpoints

Examples:
- payment operator
- government or public-service operator
- merchant platform
- enterprise operator
- university or campus operator

### Issuer

Responsibilities:
- prove control over the organization, account, domain, or destination scope
- register approved destinations and resolver behavior
- consent to the monitoring level required by the trust program
- sign or request signed QR artifacts
- maintain destination policy and report compromise

Examples:
- restaurant
- merchant
- public agency
- university department
- enterprise service owner
- verified individual in a lower-assurance program

### Verifier

Responsibilities:
- fetch and validate signed root, authority, issuer, destination-policy, and status artifacts
- maintain a local cache with explicit freshness metadata
- evaluate scanned QR artifacts against current cached state
- integrate runtime safety checks
- emit scanner-visible states without exposing unnecessary governance complexity to users

Examples:
- browser scanner
- iOS scanner app
- Android scanner app
- point-of-sale verifier
- enterprise secure-browser plugin
- backend verifier used by a scanner SDK

## 3. Recommended Small-Network Stack

### Postgres

Use Postgres as the source of truth.

Stores:
- root programs
- delegated authorities
- issuer applications
- proof records
- issuer records
- destination policies
- signed artifact metadata
- revocation and suspension events
- verifier cache snapshots
- scanner decision logs
- audit log

Postgres is authoritative because trust state must be queryable, durable,
auditable, and reconstructable after a worker or message bus failure.

Recommended extensions:
- `pgcrypto` for UUID generation and artifact hashes where needed
- `citext` for case-insensitive normalized identifiers where appropriate
- `btree_gin` or `gin` indexes for JSONB artifact search if signed artifact bodies are stored in JSONB

Do not use Redis, NATS, or Kafka as the system of record for trust state.

### NATS JetStream

Use NATS JetStream as the first event bus for the reference network.

Good fit:
- low operational burden
- simple local compose deployment
- durable consumers
- fast propagation of revocation and policy updates
- enough replay for verifier-cache workers and demo operators

Initial subjects:
- `qrtrust.root.manifest.published`
- `qrtrust.authority.manifest.published`
- `qrtrust.issuer.record.published`
- `qrtrust.issuer.status.changed`
- `qrtrust.destination.policy.published`
- `qrtrust.runtime.verdict.published`
- `qrtrust.verifier.cache.refreshed`
- `qrtrust.scanner.decision.recorded`

NATS should distribute updates. It should not decide trust.

### Kafka

Defer Kafka.

Kafka becomes useful if the network later needs:
- very high-throughput analytics
- long-retention event streams
- large multi-tenant data pipelines
- cross-organization SIEM export
- large-scale replay of historical scanner events

For the first production-reference implementation, Kafka adds complexity before
the governance and verifier semantics are proven.

### Redis

Use Redis only for hot-path runtime state.

Good uses:
- one-time nonce replay guard
- short-lived runtime verdict cache
- rate limits
- transient scanner-session state
- temporary challenge tokens for domain validation

Bad uses:
- root manifest source of truth
- issuer record source of truth
- destination policy source of truth
- audit log

### Object storage or artifact table

Signed artifacts should be immutable and content-addressable.

Small reference network:
- store artifact bodies in Postgres JSONB plus hash metadata

Larger deployment:
- store artifacts in object storage
- store hash, signature, version, and index metadata in Postgres

## 4. Effect TypeScript Service Layer

Effect TS is a good candidate for the next implementation layer because the
network has many explicit failure modes:
- invalid signature
- stale manifest
- missing delegation path
- suspended issuer
- destination policy mismatch
- runtime safety unavailable
- expired cache
- message bus unavailable
- database unavailable

Use Effect for:
- typed domain errors
- schema validation at service boundaries
- dependency-injected service layers
- retry and timeout policies
- background sync workers
- resource cleanup
- OpenTelemetry integration
- testable service composition

Recommended approach:
- do not rewrite the existing Python PoC first
- add a new `network/` or `services/` TypeScript package for the reference trust-network services
- keep the existing FastAPI PoC as the verifier lab until the new services are proven
- define shared JSON contracts before replacing any runtime path

Current repository scaffold:
- `docs/public/network-contracts/` defines the first shared JSON contract set
- `network/` starts the Effect TypeScript implementation layer around those
  contracts
- the scaffold currently includes Effect Schema validation, service ports,
  in-memory adapters, artifact publication, governance publication, and
  verifier-sync boundaries, and a smoke program that publishes the full
  root-manifest to delegated-authority to issuer-record to destination-policy
  chain before materializing verifier cache, evaluates host, path, resolver
  final-target, and redirect-hop binding rules, applies authorized issuer
  suspension, and verifies that stale active issuer state no longer produces
  scanner-visible green
- the scaffold also includes a driverless Postgres persistence boundary that
  maps contract-native artifact IDs, status-event IDs, event IDs, verifier-cache
  projections, and scanner decision IDs into the draft source-of-truth schema,
  with a batch service that preserves the intended transaction order before a
  live database driver is introduced
- the scaffold also includes a driverless Postgres artifact-store adapter that
  implements the same artifact storage port as the in-memory adapter while
  using the `published_artifacts` upsert and lookup contract from the draft
  source-of-truth schema
- the scaffold also includes an artifact-publication queue worker boundary that
  claims canonical source artifact publication work from Postgres, publishes
  through the existing artifact-publication port, marks each row completed or
  failed before event-outbox propagation workers run, and now has a deployable
  supervisor/runtime wrapper for shared local infrastructure
- artifact-publication runtime paths enqueue publication events through a
  Postgres-backed event bus, so durable `event_outbox` rows remain the handoff
  to later NATS propagation instead of relying on in-memory delivery
- the scaffold also includes a live Postgres driver boundary around `pg` clients
  and pools, so the current statement and artifact-store ports can be exercised
  with explicit typed persistence failures, transaction begin/commit, rollback,
  and resource cleanup before the application routes are rewired
- the scaffold also includes a driverless Postgres trust-key registry adapter
  that persists public verification material, signer scope, algorithm, and key
  lifecycle status behind the same registry port used by the signature verifier
- the scaffold also includes a managed key-material provider port that resolves
  KMS/HSM-shaped public verification material references through an injected
  client before verifier-cache work-item authorization
- the scaffold also wires the deployable verifier-cache read-model worker to
  that Postgres trust-key registry and the default key-material provider, so
  externally supplied status-event work items are authorized before cache
  materialization by default
- the scaffold also includes a signing-custody boundary that signs canonical
  trust artifacts through fixture, environment, filesystem, or static providers
  while keeping root and delegated-authority private key material outside normal
  verifier services
- the scaffold also includes a managed signing-custody provider port that
  accepts KMS/HSM-shaped private material references and delegates signing to an
  injected custody client without binding the reference implementation to a
  specific cloud or HSM vendor
- the scaffold also includes an optional live Postgres smoke that applies the
  draft source-of-truth schema to a disposable database, seeds the minimum root,
  delegated-authority, issuer, and destination-policy rows required by the
  foreign-key graph, persists a governance publication batch, and reads the root
  artifact back through the same artifact-store port
- the scaffold also includes a driverless NATS/JetStream propagation boundary
  that maps event envelopes to normalized subjects, stream names, idempotency
  headers, and envelope-only payloads before a live broker is introduced
- the scaffold also includes a local live NATS JetStream broker smoke that
  creates the three reference streams, publishes envelope-only governance and
  scanner-audit events, and keeps NATS as propagation rather than authority
- it is not yet connected through production Postgres migrations or the live
  FastAPI verifier routes, but the event outbox now has a deployable
  supervised worker process boundary

Potential package boundary:

```text
network/
  packages/
    contracts/
    root-service/
    authority-service/
    enrollment-service/
    issuer-registry/
    destination-policy/
    artifact-publication/
    verifier-sync/
    scanner-decision/
    runtime-safety/
```

## 5. Core Services

### Root service

Owns:
- root program records
- root keys
- delegation rules
- accepted operator classes
- root manifest publication

Outputs:
- signed root manifest
- root revocation events
- root policy version events

### Authority service

Owns:
- delegated authority registration
- authority key records
- operator scope
- allowed issuer classes
- delegated authority status

Outputs:
- signed delegated authority manifest
- delegated authority revocation or suspension event

### Enrollment service

Owns:
- issuer application
- proof collection
- review decisions
- proof expiration
- issuer revalidation
- monitoring consent

Proof types:
- DNS TXT challenge
- HTTPS `.well-known` challenge
- business registration
- payment processor verification
- enterprise directory identity
- government or institution registry
- Apple, Google, or business profile verification

The service should store proof evidence privately and publish only the public
assurance result required by scanners.

### Issuer registry

Owns:
- enrolled issuer namespace
- issuer public keys
- issuer assurance tier
- issuer status
- issuer revocation and reinstatement

Issuer namespace:

```text
(root_program_id, delegated_authority_id, issuer_id)
```

Issuer IDs must not be treated as globally unique bare strings.

### Destination policy service

Owns:
- approved domains
- approved subdomains
- path policy
- query policy
- resolver policy
- redirect policy
- app-intent policy
- runtime safety requirements

The first production-reference implementation should support:
- exact host allow
- explicit subdomain allow
- resolver URL
- expected final URL
- allowed redirect hosts
- maximum redirect hops
- nested-shortener policy
- HTTPS requirement
- runtime verdict TTL

### Artifact publication service

Owns:
- signed artifact canonicalization
- versioning
- content hash
- immutable publication
- artifact index
- distribution endpoint generation

Artifacts:
- root manifest
- delegated authority manifest
- issuer record
- destination policy
- revocation or suspension event
- verifier cache bundle
- signed QR artifact

### Verifier sync service

Owns:
- artifact download
- signature verification
- chain validation
- conflict resolution by local policy
- cache materialization
- cache freshness metadata
- downgrade or block behavior for stale state

The verifier cache must expose:
- generated time
- source artifact versions
- expiry time
- maximum staleness
- stale behavior
- root and authority scope

### Runtime safety service

Owns:
- redirect inspection
- reputation adapter calls
- risky destination verdicts
- unavailable or stale verdict semantics
- verdict TTLs

The reference implementation may use deterministic providers first. Real
adapters can be added later.

Possible adapters:
- safe browsing provider
- enterprise secure web gateway
- phishing feed
- malware feed
- screenshot/rendering sandbox
- resolver-hop inspector

### Scanner decision service

Owns:
- scanner-visible decision contract
- green, orange, red state mapping
- reason codes
- hold-to-open policy
- domain fingerprinting
- user-facing decision path

Inputs:
- decoded QR payload
- signed QR artifact if present
- verifier cache
- destination policy
- runtime safety verdict
- local scanner policy

Outputs:
- `green`: approved for this use
- `orange`: visible destination, but not fully verified or runtime state is inconclusive
- `red`: do not open without a fresh or trusted QR

The service should never treat lack of enrollment as proof of maliciousness.

## 6. Registration And Verification Workflows

### Issuer enrollment

1. Issuer applies under a delegated authority.
2. Enrollment service determines issuer class.
3. Issuer supplies required proofs.
4. Destination scope is registered.
5. Monitoring consent is accepted.
6. Authority approves issuer.
7. Issuer record is signed and published.
8. Verifier sync services ingest the update.

### Domain validation

Minimum supported methods:
- DNS TXT challenge
- HTTPS `.well-known/qrtrust-challenge`
- delegated enterprise or platform proof

Domain validation proves control of a domain. It does not by itself prove the
issuer is a verified business, institution, or government entity.

### Third-party QR generator registration

QR generators should be registered as clients under an issuer or delegated
authority.

Rules:
- generator registration does not make the generator a trust root
- generator credentials are scoped to issuer and policy IDs
- generator compromise should be containable by revoking credentials or issuer QR signing keys
- scanner trust should depend on issuer enrollment and destination policy, not generator brand alone

### Scanner app registration

Scanner apps or SDKs should register as verifier clients.

They should declare:
- accepted root programs
- cache policy
- decision-profile version
- user-visible warning policy
- telemetry and privacy policy

End users should not configure API keys, root URLs, or trust providers manually
in ordinary use.

## 7. Data Model Sketch

Core relational tables:

```text
root_programs
root_keys
delegated_authorities
authority_keys
issuer_applications
issuer_proofs
issuer_records
issuer_keys
destination_policies
signed_artifacts
revocation_events
verifier_cache_snapshots
runtime_verdicts
scanner_decisions
audit_events
```

Important constraints:
- issuer namespace uses `(root_program_id, delegated_authority_id, issuer_id)`
- signed artifacts are append-only
- revocations supersede older active state
- destination policies are versioned
- verifier cache snapshots record source artifact versions
- scanner decision logs store reason codes without storing unnecessary payload content

## 8. Event Model Sketch

Events are append-only notifications of durable state already committed to
Postgres.

Example event envelope:

```json
{
  "event_id": "evt_01",
  "type": "issuer.record.published",
  "occurred_at": "2026-05-17T00:00:00Z",
  "root_program_id": "root:qrtrust-demo:2026",
  "delegated_authority_id": "authority:merchant-web",
  "issuer_id": "issuer:acme-demo",
  "artifact_id": "art_issuer_01",
  "artifact_hash": "sha256:...",
  "version": 4
}
```

Consumers should always fetch or verify the referenced artifact rather than
trusting the event body as the artifact itself.

## 9. First Implementation Phases

### Phase 1: Architecture and contracts

Deliverables:
- this architecture plan
- draft JSON contracts under `docs/public/network-contracts/` for root, authority, issuer, destination policy, revocation, verifier cache, scanner decision, and event envelopes
- schema validation tests
- sequence diagrams for enrollment, publication, sync, and scan-time decision

### Phase 2: Local reference network

Deliverables:
- Postgres schema and migrations
- NATS JetStream compose service
- artifact publication worker
- verifier sync worker
- scanner decision API backed by signed fixture artifacts
- Ed25519 trust-key registry and canonical signature gate for status events
  before verifier-cache mutation
- key-material provider port for resolving public verification material from
  inline records, fixture refs, environment refs, or filesystem refs
- signed trust-key status events for suspending, revoking, or expiring root and
  delegated-authority signing keys
- an executable operational key-rotation policy for root and delegated-authority
  overlap windows, emergency revocation, and verifier-cache refresh behavior
- an operational signer-recovery runbook for root, delegated-authority, issuer,
  and signing-service compromise cases

Success criteria:
- an issuer can be enrolled from fixtures
- a destination policy can be published
- a verifier cache can be materialized from signed artifacts
- scanner decision results match expected green, orange, and red outcomes
- invalid or unauthorized status events cannot remove active verifier-cache state
- inactive keys, unsupported algorithms, and delegated-authority scope mistakes
  are rejected before verifier-cache mutation
- accepted trust-key lifecycle events prevent the affected key from authorizing
  subsequent status events
- short rotation overlap fails closed, stale verifier caches refresh before
  green, and emergency key revocation cannot leave compromised keys active
- signer recovery fixtures reject post-recovery root and delegated-authority
  cache mutations, while accepting a replacement delegated-authority key for
  new signed status events
- recovery state has a documented artifact, cache, and scanner-visible decision
  path before signing-custody service code is introduced

### Phase 3: Enrollment and proofing

Deliverables:
- issuer application workflow
- DNS TXT challenge
- HTTPS `.well-known` challenge
- manual approval path
- issuer suspension and reinstatement

Success criteria:
- domain proof failure cannot produce a green state
- expired proof downgrades or blocks according to policy
- issuer revocation reaches verifier cache and scanner decision output

### Phase 4: Runtime safety adapters

Deliverables:
- deterministic provider remains available for tests
- redirect inspector
- provider interface for reputation or safe browsing
- stale and unavailable verdict behavior

Success criteria:
- verified issuer with risky destination becomes orange or red according to policy
- runtime unavailable never creates a strong green state

Current implementation note:
- the TypeScript reference package now includes the deterministic provider
  boundary for clear, risky, blocked, and unavailable runtime verdicts
- the runtime-safety boundary now splits into redirect-inspection and
  reputation-provider ports, with deterministic adapters that can be replaced
  by live resolver-chain or safe-browsing integrations without changing the
  scanner decision contract
- scanner decisions apply runtime safety only after issuer legitimacy and
  destination binding pass; destination mismatch remains terminal
- a draft runtime-safety provider deployment policy now defines live provider
  boundaries, privacy minimization, outage behavior, caching posture, and
  scanner decision mapping
- runtime-safety observations now have a checked JSON contract and examples
  for clear, risky, blocked, and unavailable provider verdicts; observations
  remain evidence, not source-of-truth trust state
- live reputation, safe-browsing, redirect-inspection, and TLS/HTTPS provider
  credentials and network transports remain future adapter wiring behind the
  same boundary
- the TypeScript reference package now also includes a live JetStream publisher
  port around the driverless propagation boundary; it forwards envelope-only
  payloads, headers, message IDs, and expected streams to an injected broker
  publisher while leaving Postgres and the event outbox authoritative
- an event-outbox publisher boundary now validates Postgres-shaped outbox rows,
  emits valid rows through the same JetStream sink, and returns row-level
  success or failure outcomes for an eventual worker loop
- an event-outbox worker boundary now claims pending or expired-publishing
  rows with `for update skip locked`, publishes only claimed rows, marks
  accepted rows `published`, and leaves malformed rows explicitly `failed`
- an event-outbox metrics boundary now exposes propagation lag, expired
  publishing claims, retryable failed rows, status counts, max attempts, and a
  bounded failed-row sample for operator review
- the reference package also includes an opt-in live Postgres metrics smoke
  that resets a scratch `qr_trust` schema, applies the reference schema, seeds
  representative outbox rows, and validates status counts, stale claims,
  retryable failures, age metrics, and blocked health summaries against real
  database behavior
- the reference package also includes an opt-in local NATS JetStream smoke that
  creates or updates the reference governance, runtime, and scanner-audit
  streams and publishes the deterministic reference event set through a real
  broker
- the reference package also includes an opt-in live Postgres plus NATS worker
  smoke that resets the scratch `qr_trust` schema, persists reference events
  into the Postgres event outbox, claims the rows, publishes them to JetStream,
  and verifies all rows are marked `published`
- the reference package also includes an opt-in live authority outbox drill that
  starts from Postgres governance source rows, publishes root,
  delegated-authority, issuer, and destination-policy artifacts, enqueues the
  resulting governance events in `qr_trust.event_outbox`, and proves the live
  worker propagates envelope-only messages to the `QRTRUST_GOVERNANCE` stream
- the reference package also includes an opt-in live verifier-cache read-model
  drill that starts from live authority-published governance artifacts, adds a
  signed issuer-status artifact, claims a Postgres
  `verifier_cache_work_items` row, writes a derived verifier-cache entry and
  scanner decision, and verifies the read-model worker does not republish
  source artifacts or enqueue transport events
- the reference package also includes an opt-in live scanner-decision cache
  drill that reads persisted `verifier_cache_entries` through a Postgres-backed
  cache adapter, combines that derived state with runtime safety observations,
  and verifies the scanner read path does not republish source artifacts,
  mutate source governance rows, or enqueue propagation events
- the reference package also includes a scanner-decision HTTP runtime boundary
  that exposes `GET /healthz` and `POST /scanner/decisions`, adapts scanner
  requests to the cache-read service, persists scanner-decision evidence, and
  keeps source governance publication outside the scan-time request path
- the network-service validation path is now split into an offline lane and a
  localhost runtime lane: `make check-network-services-offline` keeps
  contract/service checks sandbox-safe, while `make check-network-services-runtime`
  isolates the HTTP listener smoke that may need local socket permissions
- the network-contract docs now include schema-backed verifier-profile
  distribution and scanner-fleet evidence handoff contracts, so the deployment
  path separates "a scanner can call the runtime" from "a managed scanner
  population received the right profile and presented the right user-visible
  outcomes"; the deployment-readiness bundle now fingerprints the
  scanner-fleet evidence packet itself, not only the scanner-fleet contract;
  the scanner-fleet artifact status command reports whether referenced native
  screenshots, history entries, and accessibility traces have actually been
  captured before the strict evidence gate is enabled
- the network-contract docs also include a schema-backed restore automation
  evidence packet that keeps scheduled backup creation, scratch restore,
  migration rollback rehearsal, and operator failover handoff reviewable
  without treating generic deployment confidence prose as recoverability proof
- the network-contract docs also include a schema-backed packaged deployment
  approval evidence packet that keeps artifact fingerprinting, contract smoke,
  release-owner approval, security review, operations review, and rollback
  acceptance reviewable without treating readiness booleans as release approval
- the network-contract docs also include a schema-backed operator evidence
  index that maps the twelve readiness controls to public-safe or
  operator-owned evidence refs, keeping production claims separate from
  reference docs
- the network-contract docs also include a schema-backed production evidence
  requirements contract that names the minimum operator proof obligations for a
  production-candidate claim without storing the proof in the public repo. The
  contract is intentionally fail-closed: every control must require
  `ops://qrtrust/` references, review ownership, retention posture, and artifact
  classes before a deployment can claim production readiness.
- the reference package also writes an operator-facing production evidence
  collection template from those requirements. The template gives reviewers and
  operators one checklist slot per required artifact class, but it contains
  placeholders only; it must not be treated as proof until the operator replaces
  every placeholder with reviewed `ops://qrtrust/` evidence refs in a private
  evidence store.
- the reference package also writes a production evidence intake report that
  sits after the collection template and gap report. The intake gate rejects
  incomplete gaps, stale inputs, placeholder refs, duplicate evidence URIs, and
  unsatisfied role-qualified controls before the packet is handed to human
  reviewers. Passing intake means "ready for review", not "production
  approved".
- the reference package also includes a verifier-profile distribution boundary
  that builds a scanner-side receipt for the active profile and fails closed on
  HTTP endpoints, endpoint mismatch, expired or revoked profiles, unaccepted
  authorities or signing keys, missing green controls, and weak hold-to-open
  gates. The boundary now also writes a standalone verifier-profile
  distribution report, so reviewers can inspect profile scope, endpoint
  binding, signing scope, color policy, hold-to-open policy, and receipt
  logging before reading the combined deployed-scanner readiness report.
- the event-outbox worker is now wrapped by a supervised polling boundary that
  stops on bounded idle polling, honors shutdown signals, aggregates worker
  publish counts, and attaches the latest event-outbox metrics health summary
  for operator review
- the supervised event-outbox worker now has a deployable runtime wrapper and
  Docker Compose service that connect live Postgres to local NATS JetStream,
  ensure the reference streams, use bounded polling defaults, and stop cleanly
  on host shutdown signals
- the running Python verifier now exposes a narrow `/verifier/status`
  operator bridge for the network outbox: when `QRTRUST_NETWORK_DATABASE_URL`
  is configured, it reports outbox health, status counts, propagation lag,
  failed-row evidence, and the network database label; when unavailable, it
  reports an operator-visible unavailable state without failing the verifier
  status endpoint
- the same `/verifier/status` response now exposes a read-only runtime-safety
  observation bridge: when `QRTRUST_NETWORK_DATABASE_URL` is configured, it
  summarizes persisted provider observations, highest-risk destinations,
  provider availability, and blocked or risky runtime posture without making
  the Python verifier own provider ingestion
- the same `/verifier/status` response now exposes a read-only
  scanner-decision persistence bridge: when `QRTRUST_NETWORK_DATABASE_URL` is
  configured, it summarizes persisted scanner-visible outcomes, color counts,
  hold-to-open evidence, highest observed risk score, and recent decisions
  without treating red or orange scan outcomes as operator-health failures
- the contracts docs now include a draft signer-recovery runbook that scopes
  root, delegated-authority, issuer, and generator/signing-service compromise;
  requires durable recovery artifacts before verifier cache mutation; and maps
  unresolved recovery state to scanner-visible orange or red
- the reference package now includes a deterministic signer-recovery smoke that
  revokes root and delegated-authority signing keys, proves future mutations
  from those keys are rejected before cache mutation, and proves a replacement
  authority key can restore accepted status publication
- the signer-recovery smoke also now proves verifier-cache freshness is a
  scanner-visible gate: expired cache state downgrades to orange with
  hold-to-open, while unrelated delegated-authority scopes remain green during
  an affected authority recovery
- the Python verifier now exposes a deterministic `/scanner/ux-ab-fixture`
  endpoint for reviewer-facing scanner UX measurement: it returns paired
  control and treatment sample logs, flagged blind-open counts, held-open
  counts, benign median delay, false-friction rate, risk scores, and reason
  codes without claiming to be durable production analytics storage
- the scanner UX risk model now includes deterministic local URL syntax checks
  for embedded credentials, suspicious domain endings, HTTPS absence, and
  redirect depth; live known-bad, newly registered, caption-mismatch, and
  first-seen-domain signals remain provider or device-history adapters rather
  than hard-coded trust-model inputs

### Phase 5: Scanner UX and measurement

Deliverables:
- domain fingerprint
- risk stripe
- hold-to-open for risky or mismatched QR
- event logging for acceptance checks
- A/B experiment scaffold

Success criteria:
- flagged QR cannot instant-open in treatment mode
- logs include risk score and reason codes
- benign QR median delay remains within the target threshold

## 10. Architecture Decisions

### ADR-001: Use Postgres as source of truth

Decision:
- use Postgres for durable governance and audit state
- keep the local reference database separate from any unrelated `publisher`
  database that may already be running on the developer machine

Reason:
- trust state must survive worker failures, be auditable, and support historical reconstruction
- a reference network must never reuse another application's database as a
  convenience shortcut, because that would blur ownership and audit boundaries

### ADR-002: Use NATS JetStream before Kafka

Decision:
- use NATS JetStream for the first reference event bus
- keep a local NATS compose overlay and a shared-infra preflight for developers
  who already run Postgres and Redis for other projects

Reason:
- lower operational complexity and enough durability for policy, revocation, and cache update propagation
- the preflight makes the intended boundary explicit: Postgres is authoritative,
  Redis is hot-path only, and NATS is optional propagation until the worker is
  started
- readiness is intentionally split: `check-network-stack-ready` verifies shared
  infra plus live NATS propagation without resetting the database schema, while
  `check-network-worker-drill` runs the reset-guarded local Postgres-to-NATS
  worker proof plus the live authority publication outbox and verifier-cache
  read-model drills against the separate QR Trust database

Kafka remains a later integration target for analytics-heavy deployments.

### ADR-003: Keep Redis hot-path only

Decision:
- Redis is allowed for replay guards, rate limits, and short-lived cache

Reason:
- Redis is useful for speed but not appropriate as the source of truth for governance state

### ADR-004: Treat domain validation as destination control, not identity

Decision:
- DNS and `.well-known` validation prove destination control, not business legitimacy

Reason:
- the paper separates issuer legitimacy from destination binding; collapsing them would recreate the same trust ambiguity the model is trying to fix

Implementation status:
- covered by the TypeScript `domain-proof` boundary and smoke test, which
  accepts verified domain control only as support for destination binding and
  explicitly rejects inactive issuers, pending or expired proofs, unapproved
  hosts, and implicit subdomain inheritance.
- backed by a Postgres-shaped `issuer_domain_proofs` store and decoder, so
  persisted issuer proof rows can drive the same boundary before live DNS or
  `.well-known` proof automation is added.

### ADR-005: Keep scanner output user-facing

Decision:
- scanner APIs return green, orange, red, reason codes, and a user-readable decision path

Reason:
- a trust layer only helps if the scanner can make the managed state intelligible to users

## 11. Immediate Next Tasks

1. Promote the verifier-cache read-model queue worker from source-artifact
   verification smoke to a live Postgres-to-cache drill that consumes
   governance event references published by the outbox path and writes derived
   cache entries transactionally. Status: implemented as a reset-guarded live
   Postgres verifier-cache read-model drill that materializes one cache entry
   and one scanner decision from authority-published governance artifacts plus
   a signed issuer-status artifact.
2. Wrap the Postgres-shaped verifier-cache read-model queue worker in a
   deployable supervisor/runtime that claims verified artifact/status-event work
   items from live Postgres and commits derived cache plus scanner-decision rows
   transactionally. Status: implemented as a local compose worker target and
   supervisor smoke, with a work-item authorization boundary that checks
   status-event scope and delegated-authority signatures through Postgres
   `trust_keys` plus configured key material before cache materialization.
   Status: managed key-material provider port added; vendor-specific KMS/HSM
   key-source credentials and operations remain separate.
3. Add a scanner-decision API boundary that reads only verifier cache plus
   runtime safety observations. Status: implemented as a reset-guarded live
   scanner-decision cache-read drill plus a scanner-facing HTTP runtime using
   a Postgres-backed verifier-cache adapter. Verifier profile distribution and
   scanner fleet evidence are now documented, schema-backed, and executable as
   deployment handoff contracts. The verifier-profile distribution smoke builds
   an active profile receipt and rejects untrusted endpoint, freshness,
   authority, signer, green-control, and hold-to-open-policy conditions.
   Scanner fleet evidence has an executable packet builder and smoke test that
   requires full fixture coverage, active profile fingerprint matching,
   non-empty reason codes, compact redacted domain fingerprints,
   screenshot/history/accessibility references, hold-to-open proof for non-green
   outcomes, red-outcome no-open behavior, and public redaction. Automated
   native capture remains separate implementation work. A deployed-scanner
   readiness report now combines the active verifier-profile receipt with
   scanner-fleet artifact coverage, so reviewer handoff can distinguish a
   profile/configuration failure from incomplete native evidence captures.
   A standalone verifier-profile distribution report is generated through
   `make network-verifier-profile-distribution-report` when the reviewer needs
   profile-only evidence before the scanner-fleet bundle.
4. Add a production-oriented KMS or HSM-backed signing-custody adapter after
   the fixture, environment, filesystem, and static custody ports remain stable
   under contract smoke tests. Status: implemented as a vendor-neutral managed
   custody provider port, smoke test, draft managed-custody deployment policy,
   and schema-backed public-safe custody audit export. Vendor-specific KMS/HSM
   credentials, ceremonies, and access-control wiring remain deployment work.
5. Promote the artifact-publication queue worker from local deployable runtime
   to migration-managed deployment after managed custody policy is stable.
   Status: queue table contract, Postgres command adapter, queue-worker smoke,
   supervisor smoke, compose worker target, durable Postgres outbox enqueue
   path, idempotent shared-infra schema apply, migration-ledger checksum
   recording, a read-only migration status gate, a draft operator runbook, a
   draft migration deployment/rollback policy, and an executable
   deployment-readiness smoke are implemented. Packaged deployment ownership is
   now represented as a production readiness gate covering deployable
   artifacts, image provenance, release approval, environment promotion, and
   rollback ownership. Restore automation now has a schema-backed reference
   evidence packet for backup, scratch restore, rollback rehearsal, and
   operator failover handoff. Packaged deployment approval now has a
   schema-backed reference evidence packet for artifact fingerprinting,
   contract smoke, release-owner approval, security review, operations review,
   and rollback acceptance. The operator evidence index now maps all twelve
   readiness controls to reviewed public-safe or operator-owned references so a
   reviewer can see which controls are still reference-backed. Production
   evidence requirements now define the minimum proof obligations and enforce
   `ops://qrtrust/` as the production evidence reference scheme. Production
   restore artifacts, production-owned packaged approval records,
   operator-owned evidence references, and vendor-specific managed custody
   deployment wiring remain operator-owned deployment work, and production mode
   blocks when those controls are not represented in the readiness report.
6. Keep the current Python verifier lab stable while the TypeScript reference
   services mature behind contract smoke tests.

Recommended decision:
- keep contracts first and continue validating `docs/public/network-contracts/`
- treat verifier-cache materialization and the Postgres read-model queue worker
  as the established derived-state boundary before widening infrastructure
- use `reference-postgres-schema.sql` as the first persistence adapter target
- use `nats-subjects.md` for propagation after Postgres-backed artifacts work
- use the deployment-readiness report as the pre-production gate that separates
  local reference drills from operator-owned production obligations
- generate `local/network-readiness-report.json` and
  `local/network-readiness-report.md` before deployment reviews so the
  readiness posture is inspectable without committing environment-specific
  output
- generate `local/network-readiness-production-report.json` and
  `local/network-readiness-production-report.md` when the claim is stronger
  than a reference drill; production mode treats missing operator controls as
  blockers, and passing production controls must carry evidence references
  rather than naked boolean assertions
- use `docs/public/network-contracts/deployment-readiness-operator-guide.md`
  as the current handoff rule for reviewers and implementers filling the
  readiness inputs
- use `docs/public/network-contracts/deployment-readiness.production.env.example`
  as the fail-closed production input template; an unedited template should
  continue producing `blocked_for_production`
- use `docs/public/network-contracts/deployment-readiness.evidence.example.json`
  as the canonical evidence-map shape for labels, URIs, owners, and review
  dates required by production pass checks
- use `local/network-readiness-bundle.json` as the reviewer handoff index after
  generating a readiness report; it fingerprints the report, Markdown summary,
  production env template, evidence map, operator guide, scanner runtime
  contract, verifier-profile contract, scanner-fleet contract, scanner-fleet
  evidence packet, cross-surface evidence packet, worker-operations evidence
  packet, restore-automation evidence packet, packaged-deployment approval
  evidence packet, and operator evidence index without converting the bundle
  itself into a
  production-readiness claim
- use `make network-readiness-bundle-production-drill` when the reviewer handoff
  should include the production-drill readiness report plus the
  production-candidate operator evidence index in one fingerprinted local
  bundle
- use `make network-reference-handoff-production-drill` when the reviewer needs
  one stage-plus-readiness index that pairs the stage-3 production-candidate
  adoption report with a compatible production-drill readiness bundle and the
  production-candidate operator evidence index; the handoff also fingerprints
  the production evidence requirements, operator collection template, and
  current evidence gap report so the reviewer sees exactly which operator-owned
  refs are still missing. The handoff validates that the collection template and
  gap report were generated from the production requirements and that the gap
  report matches the production-candidate evidence index, not the
  reference-drill evidence packet.
- use `make check-network-reference-handoff-bundle` before sharing that handoff;
  it exercises the production-drill handoff generator and confirms the bundle
  rejects a reference-only operator index, stale production evidence collection
  template, or stale production evidence gap report.
- use `docs/public/network-contracts/production-evidence-requirements.schema.json`
  and `production-evidence-requirements.md` before any production-candidate
  claim; actual production proof must remain operator-owned and be referenced
  with `ops://qrtrust/` evidence URIs rather than committed into the public repo
- use `make network-production-evidence-gap-report` to write
  `local/production-evidence-gap-report.json` and
  `local/production-evidence-gap-report.md`; this compares the requirements
  contract with the production-candidate operator evidence index, but remains an
  audit aid rather than proof of production readiness
- use `make network-production-evidence-collection-template` to write
  `local/production-evidence-collection-template.json` and
  `local/production-evidence-collection-template.md`; this is the
  operator-fillable evidence checklist generated from the requirements contract,
  not a public repository substitute for actual production logs, approvals, or
  custody records
- use `make network-production-evidence-intake` to write
  `local/production-evidence-intake-report.json` and
  `local/production-evidence-intake-report.md`; this checks whether the
  requirements, operator evidence index, collection template, and gap report are
  consistent and free of placeholders before reviewer handoff, but it remains a
  review-intake artifact rather than approval
- use `docs/public/network-contracts/verifier-profile.schema.json` and
  `docs/public/network-contracts/scanner-fleet-evidence.schema.json` as the
  deployed-scanner boundary; use
  `make network-verifier-profile-distribution-report` to inspect profile-only
  distribution gates before the combined readiness report, and use
  `npm run scanner-fleet:evidence-artifacts-status` to audit missing native
  scanner evidence without making incomplete captures fail the default
  contracts gate
- use `make network-deployed-scanner-readiness-report` before claiming scanner
  fleet readiness; the report blocks on verifier-profile distribution failures
  and keeps missing native scanner evidence as explicit warnings rather than
  hidden release risk
- keep the current Python verifier lab stable during the transition
