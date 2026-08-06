# QR Trust Network Services

Status:
- draft reference implementation scaffold
- non-normative
- partially surfaced in the current Python verifier PoC through operator
  runtime status only

This package is the first code layer beyond the current verifier lab. It keeps
the paper's model explicit:

1. root and authority governance publish durable artifacts
2. issuers enroll and bind destinations
3. verifier caches synchronize signed state
4. runtime checks are combined at scan time
5. scanner-visible decisions stay simple enough for browser and iOS clients

## Why Effect

The trust-network path has explicit failure modes: stale cache, invalid
artifact, suspended issuer, destination mismatch, runtime unavailable, replay
policy conflict, and event-bus outage. Effect gives the package a way to model
those as typed service boundaries before the reference implementation grows
into real Postgres, NATS, and runtime-safety adapters.

## Current Scope

Implemented now:

- scanner decision contract schemas in Effect Schema
- service ports for artifact storage, event publication, verifier cache, and
  scanner decision generation
- in-memory adapters for deterministic local development
- an artifact publication boundary that stores immutable fixture artifacts and
  emits contract-validated event envelopes
- an artifact-publication queue worker boundary that claims pending source
  artifact publication work items, publishes through the same artifact
  publication port, and records row-level completion or failure before event
  propagation workers run
- a deployable artifact-publication queue supervisor/runtime that repeatedly
  claims Postgres source-artifact work, writes immutable artifacts, enqueues
  durable publication events through the Postgres outbox boundary, applies
  bounded polling, and exits cleanly on shutdown signals
- a Postgres-backed event-bus adapter for artifact publication that keeps event
  propagation durable by writing publication envelopes to `event_outbox` instead
  of relying on an in-memory bus in runtime worker paths
- a governance publication service that emits a full reference chain:
  root manifest, delegated authority manifest, issuer record, and destination
  policy
- an issuer domain-proof boundary that evaluates DNS, `.well-known`, delegated
  platform, enterprise-directory, payment-processor, or manual-review evidence
  as destination-control support only; it cannot make an inactive issuer
  legitimate or turn domain control into business identity
- a driverless Postgres domain-proof store that reads scoped
  `issuer_domain_proofs` rows, decodes timestamp/status fields, and feeds the
  same destination-control boundary used by the in-memory smoke tests
- a verifier sync boundary that consumes recent events, fetches referenced
  artifacts, verifies event-to-artifact hashes, and projects active issuer
  records plus destination-policy artifacts into the verifier cache
- destination-policy evaluation for approved hosts, path prefixes,
  deterministic resolver final targets, and redirect hop limits
- revocation and suspension projection that removes stale active issuer or
  destination-policy state from the verifier cache only when the status artifact
  signature-verification boundary accepts the root program or delegated
  authority signer
- an Ed25519 signature-verification boundary for status events that verifies
  canonical JSON bytes against root or delegated-authority public-key material
  and rejects unknown signers, inactive keys, unsupported algorithms, scope
  misuse, missing signatures, or tampered event fields before verifier-cache
  state can change
- a trust-key lifecycle projection path where signed status events can suspend,
  revoke, or expire root or delegated-authority signing keys before subsequent
  status events are accepted, confined to the authority that signed them: a
  root-program signer reaches every key in its program, a delegated authority
  reaches only the keys issued under it, so a valid signature on one authority's
  key cannot revoke a peer authority's key or the root program's own
- a driverless Postgres trust-key registry adapter that persists key material
  references, public verification material, signer scope, and key lifecycle
  status behind the same lookup/update port used by signature verification
- an executable trust-key rotation policy boundary that evaluates root and
  delegated-authority overlap windows, emergency revocation, and verifier-cache
  refresh behavior before scanner-visible green can be trusted
- a key-material provider boundary that resolves public verification material
  from inline records, fixture refs, environment refs, or filesystem refs before
  cryptographic signature verification
- a managed key-material provider boundary that resolves `kms://`, `hsm://`, or
  `managed://` public verification material refs through an injected client
  without changing verifier-cache authorization
- a signing-custody provider boundary that signs canonical trust artifacts
  through fixture, environment, filesystem, or static providers without exposing
  private key material to normal verifier services
- a managed signing-custody provider boundary that accepts `kms://`, `hsm://`,
  or `managed://` private-key material references and delegates canonical
  payload signing to an injected custody client without exposing private key
  material to normal verifier services
- a driverless Postgres artifact-store adapter that implements the same
  `ArtifactStore` port as the in-memory store, using the draft
  `published_artifacts` table contract for upsert and lookup paths
- a driverless Postgres persistence boundary that maps contract-native text IDs
  into the draft source-of-truth tables for published artifacts, status events,
  verifier-cache entries, runtime observations, scanner decisions, and the event
  outbox
- a batch persistence service that executes those statements in source-of-truth
  order: artifacts, derived status rows, event outbox, verifier-cache
  projections, runtime observations, and scanner decisions
- a verifier-cache materialization boundary that derives a scanner-ready cache
  entry from the signed root, delegated-authority, issuer, destination-policy,
  and active status-event artifact chain while preserving source artifact
  hashes for audit and persistence
- a verifier-cache read-model worker boundary that consumes already-published
  artifact refs, materializes the scanner-ready verifier cache, optionally runs
  scanner proof probes, and persists only derived cache rows plus scanner
  decisions without republishing source artifacts
- a Postgres-shaped verifier-cache read-model work queue that claims pending or
  expired-processing work items with `FOR UPDATE SKIP LOCKED`, materializes one
  success path and one failure path in smoke tests, then marks rows completed or
  failed without publishing source artifacts
- a verifier-cache work-item authorization boundary that verifies externally
  supplied status-event artifacts are scoped to the issuer record, signed by the
  delegated authority, and cryptographically accepted before queue workers can
  materialize cache state
- deployable verifier-cache read-model worker authorization wiring that resolves
  status-event public keys from Postgres `trust_keys` plus the default
  key-material provider before claiming externally supplied cache work items,
  with the authorization gate enabled by default
- a verifier-cache read-model queue supervisor/runtime that repeatedly claims
  Postgres work, applies bounded polling and graceful shutdown, and can be run
  as a deployable local compose worker against the shared QR Trust database
- a live Postgres driver boundary that adapts `pg` clients and pools to the
  current statement, artifact-store, and transaction ports while preserving
  typed persistence failures and explicit commit/rollback cleanup
- an optional live Postgres smoke that resets the draft `qr_trust` schema in a
  scratch database, applies `reference-postgres-schema.sql`, seeds the minimum
  root-authority-issuer-policy source rows, persists a governance publication
  batch, and reads the root artifact back through the same artifact-store port
- a driverless NATS/JetStream propagation boundary that maps event envelopes to
  documented subjects, streams, idempotency headers, and envelope-only payloads
  without requiring a live broker
- a live JetStream publisher port that wraps the same mapped-message boundary
  around an injected broker client without making NATS authoritative
- a local NATS JetStream broker adapter that ensures the three reference
  streams and publishes envelope-only governance/runtime/scanner-audit events
  against a real broker
- an event-outbox publisher boundary that validates Postgres-shaped outbox rows
  and reports per-row publish success or failure for retry workers
- an event-outbox worker boundary that claims pending or expired-publishing
  Postgres outbox rows, publishes them only after the source transaction has
  committed, then marks accepted rows published and malformed rows failed
- an event-outbox metrics boundary that exposes propagation lag, expired
  claims, retry candidates, status counts, and failed-row evidence without
  making the broker authoritative
- an event-outbox supervisor boundary that repeatedly invokes the worker with
  bounded polling, idle shutdown, explicit shutdown-signal handling, and the
  latest operator-visible outbox health snapshot
- a deployable event-outbox worker runtime that connects live Postgres to local
  NATS JetStream, ensures the reference streams, runs the supervisor with
  bounded polling defaults, and exits cleanly on `SIGINT` or `SIGTERM`
- a Python verifier operator-status bridge that reads the same Postgres outbox
  metrics from `/verifier/status` when `QRTRUST_NETWORK_DATABASE_URL` is
  configured, without making the Python verifier own the worker
- a Python verifier runtime-observation bridge that reads persisted provider
  evidence from `/verifier/status` when `QRTRUST_NETWORK_DATABASE_URL` is
  configured, without making the Python verifier own runtime-safety ingestion
- a Python verifier scanner-decision bridge that reads persisted
  scanner-visible decisions from `/verifier/status`, reports green/orange/red
  outcome counts, hold-to-open counts, risk score evidence, and recent
  decisions, without treating scanner evidence as operator-health failure
- a seeded scanner UX experiment fixture at `/scanner/ux-ab-fixture` that
  returns control versus hold-to-open treatment logs and acceptance metrics for
  reviewer demos
- a deterministic runtime-safety adapter that keeps present-time destination
  safety separate from issuer legitimacy and destination binding, including
  orange risk/unavailable outcomes and red runtime-blocked outcomes
- a runtime-safety observation JSON contract with clear, risky, blocked, and
  unavailable examples for persistable provider evidence
- a runtime-safety observation report boundary that reads persisted provider
  evidence from Postgres and summarizes provider health, stale observations,
  blocked destinations, and highest-risk hosts for operator review
- a signer-recovery smoke that proves revoked root and delegated-authority keys
  cannot mutate cache state, an active replacement authority key can apply
  recovery state, stale verifier cache cannot produce green, and unrelated
  delegated-authority scopes remain unaffected
- redirect-inspection and reputation-provider ports behind the runtime-safety
  adapter, with deterministic implementations that make live provider
  integration possible without changing scanner decision semantics
- a deterministic deployment-readiness report that distinguishes a usable
  reference drill from a production deployment, blocking production mode when
  Postgres ownership, migration gating, restore automation, NATS propagation,
  packaged deployment ownership, managed key material, managed signing
  custody, custody audit export, live runtime safety, scanner-decision
  persistence, worker operations evidence, or operator runbooks are absent
- a smoke program that publishes the governance chain, syncs issuer and
  destination-policy projections from that chain, proves direct binding, path
  mismatch, resolver final-destination mismatch, applies an issuer suspension,
  and emits scanner-visible outcomes that prove stale active state no longer
  produces green

Important implementation boundary:

- root and delegated-authority artifacts establish the reference governance
  path for the local trust program
- issuer artifacts provide issuer identity, assurance, status, and a
  destination-policy reference
- destination-policy artifacts provide approved hosts, subdomain behavior, path
  policy, and resolver/final-destination policy
- the verifier cache combines both artifacts at resolve time, so issuer
  legitimacy and destination binding remain separate trust layers

## Section 7.2 Verification Sequence

The Section 7.2 precedence smoke runs without live services:

```sh
npm run section-7-2:precedence-smoke
```

It publishes the paper-style hierarchy through the existing in-memory store,
event bus, verifier sync, and verifier cache: root manifest, delegated authority
manifest, issuer record, destination policy, then status events. The smoke
proves destination-policy-only state is a cache miss, issuer plus policy remains
untrusted until the accepted root and delegated-authority context is present,
signed status events invalidate derived cache state afterward, later source
refreshes can update that derived cache, and unaccepted roots do not resolve.

Not implemented yet:

- production migration ownership for external deploy systems. A local
  migration-ledger runner and draft deployment/rollback policy now exist, but
  packaged release execution, backup execution, approvals, and restore
  automation are still operator responsibilities. The readiness report now
  models packaged deployment ownership as a production gate; it does not ship
  the operator's real release train. `npm run
  deployment:readiness-smoke` now keeps that distinction executable instead of
  implicit in prose.
- production vendor-specific KMS/HSM client configuration, credentials, signing
  ceremony, and access controls for the managed signing-custody provider. A
  draft vendor-neutral deployment policy now exists in
  `docs/public/network-contracts/managed-signing-custody-deployment-policy.md`.
- production runbook automation for the draft operational signer-recovery
  procedure in `docs/public/network-contracts/signer-recovery-runbook.md`
- managed signing-custody deployment automation for the artifact-publication
  queue worker. Draft policy and operator runbook coverage now exist; vendor
  custody configuration, approval tooling, and audit export remain deployment
  work.
- production vendor-specific KMS/HSM public-key material source configuration
  and operation for the verifier-cache work-item authorization boundary
- live production runtime-safety provider credentials, transport, and provider
  contract adapters. A draft deployment policy now exists in
  `docs/public/network-contracts/runtime-safety-provider-deployment-policy.md`.

## Verifier-Cache Authorization Runtime

The deployable verifier-cache read-model worker now enforces status-event
authorization by default before it materializes externally supplied cache work
items. The worker uses:

- `published_artifacts` as the immutable artifact source
- `trust_keys` as the signer lookup table. Status writes against this table are
  confined to the authority that signed them: an update carrying a
  `delegated_authority_id` only matches rows in that authority, so a
  delegated-authority signer cannot suspend or revoke the root program's key or
  a peer authority's. Root-program signers omit the predicate and keep their
  full reach over the program.
- inline `public_key_material_pem`, `env://VAR_NAME`, `file://path`, or fixture
  key-material refs through the default key-material provider
- Ed25519 verification over canonical status-event JSON bytes

Runtime flag:

- `QRTRUST_VERIFIER_CACHE_REQUIRE_STATUS_EVENT_AUTHORIZATION=true` is the
  default and should remain enabled for shared, demo, staging, or production-like
  environments.
- Set `QRTRUST_VERIFIER_CACHE_REQUIRE_STATUS_EVENT_AUTHORIZATION=false` only for
  narrow local fixture migration or debugging where queued work items are
  already trusted by construction.

## Managed Signing Custody Boundary

The reference signing-custody port now includes a managed provider shape for
production-style private-key custody. It is intentionally vendor-neutral:

- signing keys keep only private material references such as `kms://...`,
  `hsm://...`, or `managed://...`
- trust keys can likewise keep managed public-key material references resolved
  through an injected key-material client
- the provider delegates canonical payload signing to an injected custody client
- signer selection, scope checks, algorithm checks, and result shape stay inside
  the same trust-artifact signer contract used by fixture, environment,
  filesystem, and static providers

This proves the application boundary without embedding AWS, GCP, Azure, HSM, or
ceremony-specific logic in the reference package. Vendor-specific credential
loading, key policy, approval workflow, audit export, and break-glass operation
remain deployment work. The minimum deployment posture is documented in
`docs/public/network-contracts/managed-signing-custody-deployment-policy.md`.

## Runtime Safety Provider Boundary

The runtime-safety adapter is downstream of issuer legitimacy and destination
binding. It can mark a destination clear, risky, blocked, or unavailable at scan
time, but it cannot enroll an issuer or approve a destination by itself.

The current package uses deterministic redirect-inspection and
reputation-provider implementations for repeatable tests. Live safe-browsing,
reputation, redirect, or TLS/HTTPS inspectors should preserve the same contract:

- provider failures map to orange/unavailable, not green
- red requires an explicit block condition or local fail-closed policy
- provider verdicts carry reason codes, freshness, and provider identity
- scanner-visible decisions disclose concise state instead of raw provider
  payloads
- third-party provider calls should minimize payload and user data exposure

The deployment posture is documented in
`docs/public/network-contracts/runtime-safety-provider-deployment-policy.md`.
The normalized provider observation contract lives in
`docs/public/network-contracts/runtime-safety-observation.schema.json`. It
records provider identity, destination fingerprint, verdict, reason codes,
privacy disclosure, and `source_of_truth: false`.

The TypeScript runtime-safety observation builder normalizes provider verdicts
into that contract and the Postgres persistence boundary maps them into
`qr_trust.runtime_observations` before scanner decisions are inserted.

The runtime-safety observation report boundary is read-only. It gives operators
an aggregated view of provider posture, risky or blocked destinations, stale
observations, and provider unavailability without promoting runtime provider
evidence into source-of-truth trust state.

The scanner-decision persistence report is also read-only. It lets operators
confirm that scanner-visible outcomes were actually recorded as network
evidence, while treating red or orange decisions as expected decision evidence
rather than as failures of the status endpoint itself.

## Local Commands

After installing package dependencies:

```sh
cd network
npm install
npm run typecheck
npm run build
npm run artifact-publication:queue-worker-smoke
npm run artifact-publication:queue-supervisor-smoke
npm run contract:smoke
npm run deployment:readiness-report
npm run deployment:readiness-report:production
npm run deployment:readiness-bundle
npm run deployment:readiness-bundle-smoke
npm run deployment:readiness-smoke
npm run deployed-scanner:readiness-report
npm run scanner-fleet:capture-drill
npm run verifier-cache:materialization-smoke
npm run verifier-cache:read-model-worker-smoke
npm run verifier-cache:read-model-queue-worker-smoke
npm run verifier-cache:work-item-authorization-smoke
npm run verifier-cache:read-model-queue-supervisor-smoke
npm run event-outbox:smoke
npm run event-outbox:worker-smoke
npm run event-outbox:supervisor-smoke
npm run event-outbox:metrics-smoke
npm run event-outbox:live-metrics-smoke
npm run runtime:observation-report-smoke
npm run key-material:smoke
npm run signing-custody:smoke
npm run signer-recovery:smoke
npm run key-rotation:smoke
npm run postgres:artifact-store-smoke
npm run postgres:driver-smoke
npm run postgres:apply-reference-schema
npm run postgres:live-smoke
npm run postgres:persistence-smoke
npm run postgres:trust-key-smoke
npm run nats:live-broker-smoke
npm run nats:propagation-smoke
npm run nats:live-publisher-smoke
npm run runtime:observation-report-smoke
npm run runtime:safety-smoke
npm run signature:smoke
npm run verifier-sync:signature-gate-smoke
```

`npm run deployment:readiness-report` writes local operator handoff artifacts to
`local/network-readiness-report.json` and `local/network-readiness-report.md`
from the current environment. The output is intentionally ignored by git because
it can contain deployment-specific readiness posture, even though the report
itself avoids printing secrets.

`npm run deployment:readiness-report:production` writes the same report in
production mode to `local/network-readiness-production-report.json` and
`local/network-readiness-production-report.md`. In production mode, missing
operator-owned controls are blockers, not reference-drill warnings. Passing
production checks must also carry evidence references through
`QRTRUST_DEPLOYMENT_READINESS_EVIDENCE_JSON`; a configured control without a
reviewable label, URI, owner, and review date still blocks the production
claim.

`docs/public/network-contracts/deployment-readiness.production.env.example` is
the fail-closed input template for production-readiness review. Sourcing it
without replacing empty values and `false` booleans should still produce
`blocked_for_production`; only real source-of-truth, propagation, custody,
runtime-safety, persistence, worker operations evidence, packaged deployment
ownership, and runbook controls should flip the report to
`ready_for_production_drill`. Use
`docs/public/network-contracts/deployment-readiness.evidence.example.json` as
the evidence-map shape, not as proof for a real deployment.

`make network-readiness-report-production-drill` runs the same production gate
with the checked-in example controls and evidence bundle, then writes
`local/network-readiness-production-drill-report.json` and
`local/network-readiness-production-drill-report.md`. Treat that target as a
reference drill only: it proves the gate can pass with complete inputs, not that
the current operator environment is production-ready.

`npm run deployment:readiness-bundle` reads the local readiness JSON report and
writes `local/network-readiness-bundle.json`. The bundle fingerprints the JSON
report, Markdown report, production env template, evidence map, operator guide,
scanner/runtime contracts, and required evidence packets so a reviewer can
verify the handoff set without treating copied prose as source of truth.
Generate the readiness report first; the bundle deliberately fails if a required
file role is missing.

`make network-readiness-bundle-production-drill` generates the production-drill
report and writes `local/network-readiness-production-drill-bundle.json` using
the production-candidate operator evidence index. Use it when the handoff needs
to show the stronger evidence-backed drill shape rather than the reference-mode
bundle.

`npm run reference-network:handoff-bundle` reads the local adoption-stage report
and deployment-readiness bundle, validates that their claims are compatible, and
writes `local/reference-network-handoff-bundle.json`. This is the reviewer-facing
stage-plus-readiness index: it fingerprints the adoption reports, architecture
plan, gap map, readiness bundle, readiness reports, and operator evidence index
without collapsing those separate claims into one opaque artifact.

`make network-reference-handoff-production-drill` generates the production-drill
adoption report, the production-drill readiness bundle, and
`local/reference-network-production-drill-handoff-bundle.json`. Use it when a
review needs one local handoff file that proves the reference implementation has
both a stage-3 production-candidate claim and a matching production-drill
readiness gate. It is still not a live deployment claim.

`npm run deployed-scanner:readiness-report` writes
`local/deployed-scanner-readiness-report.json` and
`local/deployed-scanner-readiness-report.md`. This narrower report checks the
scanner deployment boundary by combining the active verifier-profile receipt
with scanner-fleet artifact coverage and native provider-profile evidence. A
failed verifier profile blocks the report; missing scan result screenshots,
history entries, accessibility traces, or provider-profile Settings/import
artifacts remain explicit warnings until captured. In the incomplete state, the
report points directly to `make scanner-fleet-capture-drill`,
`local/scanner-fleet-capture-drill.md`, and the provider-profile evidence
packet/import commands as the next operator handoff.

`npm run scanner-fleet:capture-drill` writes
`local/scanner-fleet-capture-drill.json` and
`local/scanner-fleet-capture-drill.md`. The drill expands the scanner-fleet
packet into concrete browser-lab URLs, native iPhone capture steps, and exact
artifact filenames. Set `QRTRUST_SCANNER_LAB_BASE_URL` when the laptop lab is
served from a LAN host rather than the default local URL.

`npm run ios-provider-profile:evidence-artifacts-status` reports tracked
provider-profile native evidence and now includes the exact capture handoff:
create the local packet, fill the incoming directory, import the exports, rerun
status, then run the strict check only when the native screenshots and
accessibility traces are present.

The root repository exposes the same validation and report commands:

```sh
make check-network-contracts
make network-readiness-report
make network-readiness-bundle
make network-readiness-report-production
make network-readiness-report-production-drill
make network-readiness-bundle-production-drill
make network-reference-handoff-bundle
make network-reference-handoff-production-drill
make network-deployed-scanner-readiness-report
make scanner-fleet-capture-drill
make ios-provider-profile-evidence-packet
make ios-provider-profile-evidence-status
make import-ios-provider-profile-evidence IOS_PROVIDER_PROFILE_EVIDENCE_SOURCE_DIR=local/ios-provider-profile-evidence-packet/incoming
make check-ios-provider-profile-evidence
```

From the repository root, run this package's typecheck and smoke path with:

```sh
make check-network-services-offline
make check-network-services-runtime
make check-network-services
```

`make check-network-services-offline` is the sandbox-safe lane: it runs the
contract, persistence, worker, evidence, NATS mapping, runtime-safety, signing,
and readiness checks without opening a local HTTP listener.

`make check-network-services-runtime` runs only the scanner-decision HTTP
runtime smoke. It binds `127.0.0.1` on an ephemeral port and validates
`GET /healthz` plus `POST /scanner/decisions`. If this target fails with
`listen EPERM` inside Codex or another sandbox, rerun the runtime or full target
outside that sandbox; the failure is a local socket permission issue, not a
contract failure.

`make check-network-services` runs both lanes and remains the full local
confidence target.

The local NATS JetStream broker is optional and runs as its own compose overlay:

```sh
make up-nats
make check-network-live-nats
```

That smoke ensures the reference streams exist and publishes governance plus
scanner-audit envelopes through the real broker. NATS remains a propagation
layer only; Postgres and the event outbox remain authoritative.

The live Postgres smoke is intentionally separate because it resets the
`qr_trust` schema. Run it only against a disposable database:

```sh
QRTRUST_NETWORK_DATABASE_URL='postgres://user:pass@127.0.0.1:5432/qrtrust_scratch' \
QRTRUST_NETWORK_LIVE_SMOKE_RESET=true \
make check-network-live-postgres
```

For shared-infra or small-network reference deployments, apply backend Alembic
migrations without dropping existing `qr_trust` state:

```sh
make apply-network-migrations
make check-network-migrations
```

These root Make targets now delegate to backend Alembic, which owns QR Trust
schema evolution and management-plane tables. The deployment/rollback posture
is documented in
`docs/public/network-contracts/postgres-migration-deployment-policy.md`.
Production deployments should still own rollout approval, backup execution, and
restore automation. `check-network-migrations` is the compatibility alias for
the backend Alembic state check.

The live event-outbox metrics smoke uses the same reset guard, non-production
seed opt-in, and disposable database expectation. It applies the reference
schema, seeds deterministic outbox rows, and verifies status counts, stale
claims, retryable failures, age metrics, and the blocked operator health summary
against live Postgres:

```sh
QRTRUST_NETWORK_DATABASE_URL='postgres://user:pass@127.0.0.1:5432/qrtrust_scratch' \
QRTRUST_NETWORK_LIVE_SMOKE_RESET=true \
QRTRUST_ALLOW_NON_PRODUCTION_REFERENCE_SEED=true \
make check-network-live-outbox-metrics
```

When using the shared local Docker Postgres and Redis stack, the root Makefile
defaults match the local PoC database convention:

```sh
make ensure-shared-infra-db
make check-shared-infra-network
make apply-network-migrations
make check-network-migrations
make up-nats
make check-network-stack-ready
make up-network-outbox-worker
make up-network-artifact-publication-worker
make up-network-verifier-cache-worker
make check-network-worker-drill
make check-network-live-outbox-worker
make up-https-admin-shared-infra-nats
```

Defaults:

- Postgres: `postgres://publisher:publisher@127.0.0.1:5432/qr_trust_poc`
- Redis hot path: `redis://host.docker.internal:6379/5`
- NATS JetStream: `nats://127.0.0.1:4222`
- Local NATS publisher identity: `qrtrust_outbox_worker`

`make check-shared-infra-network` is non-destructive. It verifies that the QR
Trust database is separate from the existing `publisher` database, confirms the
shared Postgres database is reachable from the host, checks Redis DB 5 with a
raw Redis PING from `EXTERNAL_REDIS_SETUP_HOST` (default `127.0.0.1`), and
reports whether the optional NATS monitor is already online.

`make apply-network-reference-schema` is a non-production drift/smoke helper for
the TypeScript network workers. It is safe to rerun on the separate QR Trust
database because the reference SQL uses `create ... if not exists` and verifies
the expected table inventory after applying, but it is not the production
migration owner.

`make apply-network-migrations` is a compatibility alias for backend Alembic.
Use `make apply-backend-migrations` when naming the canonical owner matters.

`make check-network-migrations` is a compatibility alias for
`make check-backend-migrations`. It does not apply migrations.

`make check-network-stack-ready` is the safe pre-worker readiness gate. It
creates or reuses only the separate QR Trust database, verifies shared
Postgres/Redis, and publishes the reference event envelopes through live NATS
JetStream. It does not reset the `qr_trust` schema.

`make check-network-worker-drill` is the stronger local proof. It runs the same
readiness gate and then executes reset-guarded live worker smokes, which rebuild
the `qr_trust` schema inside the separate `qr_trust_poc` database before proving
Postgres event-outbox rows publish through NATS. Reset helpers rewind Alembic to
the pre-QR-Trust base revision, and each reset Make target reapplies backend
Alembic afterward so shared local DBs do not keep stale migration state.

`make up-network-outbox-worker` starts only the NATS broker and the deployable
outbox worker against the shared local Postgres database. The full
`make up-https-admin-shared-infra-nats` path starts the HTTPS verifier lab,
frontend, NATS broker, and outbox worker together.

`make up-network-artifact-publication-worker` starts the supervised
artifact-publication queue worker against the shared QR Trust database. This
worker claims canonical source-artifact rows from Postgres, writes immutable
artifacts through the same artifact-store port, and enqueues publication events
into the durable Postgres event outbox. NATS propagation still belongs to the
separate outbox worker.

`make up-network-verifier-cache-worker` starts the deployable verifier-cache
read-model queue worker against the same shared QR Trust database. This worker
does not publish to NATS. It consumes Postgres work rows and commits derived
verifier-cache plus scanner-decision rows, keeping source artifacts
authoritative in Postgres.

The worker process is configured by environment:

- `QRTRUST_NETWORK_DATABASE_URL`: required Postgres source-of-truth database
- `QRTRUST_NETWORK_NATS_URL`: NATS JetStream endpoint
- `QRTRUST_NETWORK_NATS_USER`: NATS publisher identity for the outbox worker
- `QRTRUST_NETWORK_NATS_PASSWORD`: NATS publisher password for local PoC auth
- `QRTRUST_ACCEPTED_ROOT_PROGRAM_IDS`: comma-separated accepted root anchors
  for Postgres-backed verifier-cache reads and governance subscriber updates;
  defaults to the local demo root
- `QRTRUST_OUTBOX_WORKER_ID`: operator-visible worker identity
- `QRTRUST_OUTBOX_BATCH_SIZE`: claimed rows per polling iteration
- `QRTRUST_OUTBOX_POLL_INTERVAL_MS`: delay after active iterations
- `QRTRUST_OUTBOX_IDLE_POLL_INTERVAL_MS`: delay after idle iterations
- `QRTRUST_OUTBOX_IDLE_ITERATION_LIMIT`: idle shutdown limit, or `unbounded`

The artifact-publication queue worker uses its own environment namespace:

- `QRTRUST_NETWORK_DATABASE_URL`: required Postgres source-of-truth database
- `QRTRUST_ARTIFACT_PUBLICATION_WORKER_ID`: operator-visible worker identity
- `QRTRUST_ARTIFACT_PUBLICATION_BATCH_SIZE`: claimed source-artifact rows per
  polling iteration
- `QRTRUST_ARTIFACT_PUBLICATION_CLAIM_TTL_MS`: processing claim lease duration
- `QRTRUST_ARTIFACT_PUBLICATION_POLL_INTERVAL_MS`: delay after active
  iterations
- `QRTRUST_ARTIFACT_PUBLICATION_IDLE_POLL_INTERVAL_MS`: delay after idle
  iterations
- `QRTRUST_ARTIFACT_PUBLICATION_IDLE_ITERATION_LIMIT`: idle shutdown limit, or
  `unbounded`
- `QRTRUST_ARTIFACT_PUBLICATION_MAX_ITERATIONS`: optional bounded loop limit
  for drills and one-shot deployments

The verifier-cache read-model worker uses a separate environment namespace:

- `QRTRUST_NETWORK_DATABASE_URL`: required Postgres source-of-truth database
- `QRTRUST_VERIFIER_CACHE_WORKER_ID`: operator-visible worker identity
- `QRTRUST_VERIFIER_CACHE_BATCH_SIZE`: claimed work rows per polling iteration
- `QRTRUST_VERIFIER_CACHE_CLAIM_TTL_MS`: processing claim lease duration
- `QRTRUST_VERIFIER_CACHE_POLL_INTERVAL_MS`: delay after active iterations
- `QRTRUST_VERIFIER_CACHE_IDLE_POLL_INTERVAL_MS`: delay after idle iterations
- `QRTRUST_VERIFIER_CACHE_IDLE_ITERATION_LIMIT`: idle shutdown limit, or
  `unbounded`
- `QRTRUST_VERIFIER_CACHE_REQUIRE_STATUS_EVENT_AUTHORIZATION`: defaults to
  `true`; when enabled, queued status-event work must be scoped to the issuer,
  signed by the delegated authority, and accepted by the Postgres-backed
  signature-verification boundary before cache materialization
