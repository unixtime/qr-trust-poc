# QR Trust Network Contracts

Date: 2026-05-17

Status:
- draft reference contracts
- non-normative
- intended for implementation planning and local validation only

## Purpose

These contracts turn the paper's trust model into a concrete implementation
surface without pretending to define a final standard. They are the bridge
between the current PoC fixtures and a production-reference QR trust network.

The core artifact chain is:

```text
root manifest
  -> delegated authority manifest
  -> issuer record
  -> destination policy and status event
  -> verifier cache entry
  -> scanner decision
```

Events notify verifiers that durable state changed. Events are not themselves
the trusted artifacts. Consumers should fetch and verify the referenced signed
artifact by ID, hash, version, and scope.

## Contract Set

- `root-manifest.schema.json`
- `delegated-authority.schema.json`
- `issuer-record.schema.json`
- `destination-policy.schema.json`
- `revocation-status-event.schema.json`
- `verifier-cache-entry.schema.json`
- `scanner-decision.schema.json`
- `runtime-safety-observation.schema.json`
- `deployment-readiness-report.schema.json`
- `deployment-readiness-bundle.schema.json`
- `verifier-profile.schema.json`
- `scanner-fleet-evidence.schema.json`
- `ios-provider-profile-evidence.schema.json`
- `cross-surface-qr-evidence.schema.json`
- `reference-network-adoption-stage.schema.json`
- `signing-custody-audit-export.schema.json`
- `worker-operations-evidence.schema.json`
- `restore-automation-evidence.schema.json`
- `packaged-deployment-approval-evidence.schema.json`
- `operator-evidence-index.schema.json`
- `production-evidence-requirements.schema.json`
- `event-envelope.schema.json`
- `key-rotation-policy.md`
- `signer-recovery-runbook.md`
- `managed-signing-custody-deployment-policy.md`
- `signing-custody-audit-export.md`
- `artifact-publication-runbook.md`
- `postgres-migration-deployment-policy.md`
- `reference-postgres-schema.sql`
- `nats-subjects.md`
- `scan-time-validation-sequence.md`
- `runtime-safety-provider-deployment-policy.md`
- `deployment-readiness-operator-guide.md`
- `scanner-decision-http-runtime.md`
- `verifier-profile-distribution.md`
- `scanner-fleet-evidence.md`
- `ios-provider-profile-evidence.md`
- `cross-surface-qr-evidence.md`
- `reference-network-adoption-stage.md`
- `worker-operations-evidence.md`
- `restore-automation-evidence.md`
- `packaged-deployment-approval-evidence.md`
- `operator-evidence-index.md`
- `production-evidence-requirements.md`
- `production-evidence-private-handoff.md`
- `production-evidence-closure-bundle.md`
- `production-adoption-gap-map.md`
- `deployment-readiness.evidence.example.json`
- `deployment-readiness.production.env.example`
- `reference-network-adoption.evidence.example.json`
- `reference-network-adoption.production.env.example`

## Design Rules

- Issuer identity is root-scoped:
  `(root_program_id, delegated_authority_id, issuer_id)`.
- Domain validation proves destination control. It is not business identity by
  itself.
- Lack of enrollment is not proof of maliciousness.
- Positive scanner decisions require issuer legitimacy, destination binding,
  runtime safety, and acceptable cache freshness.
- Runtime safety unavailable or stale must not produce a strong green state.
- Scanner decisions should expose user-facing color, reason codes, domain
  fingerprint, and a short decision path.
- Deployment readiness should stay explicit: reference drills may warn on
  operator-owned controls, but production mode must block until source-of-truth,
  propagation, custody, runtime safety, persistence, and runbook ownership are
  represented. Local readiness reports should be generated under `local/` and
  treated as environment-specific operator handoff artifacts, not committed
  network contracts. `deployment-readiness-operator-guide.md` defines the
  current review rule and environment inputs for that handoff.
  `deployment-readiness.evidence.example.json` shows the evidence-reference
  shape required for production pass checks: each passing control must have a
  reviewable label, URI, owner, and review date.
  `deployment-readiness.production.env.example` is intentionally fail-closed:
  sourcing it without replacing values should still produce a blocked
  production report.
  `deployment-readiness-bundle.schema.json` defines the machine-readable
  handoff manifest that fingerprints the local readiness report, Markdown
  summary, production env template, evidence map, operator guide, scanner
  decision runtime contract, scanner-fleet evidence packet, cross-surface QR
  evidence packet, worker-operations evidence packet, and restore-automation
  evidence packet, plus the packaged-deployment approval evidence packet. It
  also fingerprints the operator-evidence index packet that maps the readiness
  controls to reviewed public-safe or operator-owned evidence refs. It
  requires evidence packets, not only contract prose, so a readiness handoff
  cannot omit either the native/browser scanner fixture matrix or the same-QR
  evidence chain across fixture, worker, web lab, backend scanner decision, and
  iOS scanner surfaces. It also cannot omit the always-on worker boundary,
  recoverable source-of-truth evidence, or the explicit release approval chain
  for packaged deployment.
  `verifier-profile.schema.json`,
  `scanner-fleet-evidence.schema.json`,
  `ios-provider-profile-evidence.schema.json`, and
  `cross-surface-qr-evidence.schema.json` make the deployed-scanner boundary
  schema-backed: the active profile fingerprint, scanner-decision endpoint,
  minimum green/orange/red fixture matrix, native provider-profile import and
  settings states, hold-to-open evidence, cross-surface decision consistency,
  and privacy posture are now validated examples rather than prose-only
  promises. The scanner profile, scanner-fleet evidence, provider-profile
  evidence, and cross-surface evidence packets are also exercised by
  `npm run verifier-profile:distribution-smoke`,
  `npm run scanner-fleet:evidence-smoke`,
  `npm run ios-provider-profile:evidence-artifacts-status`, and
  `npm run cross-surface:evidence-smoke`, which prove profile distribution,
  profile binding, fixture coverage, native provider-profile evidence
  readiness, hold-to-open rules, shared artifact consistency, and redaction
  fail closed before native capture automation exists. Use
  `npm run ios-provider-profile:evidence-artifacts-check` only when the native
  provider-profile screenshots and accessibility traces are expected to be
  present. The bundle is a review index, not independent proof that a
  deployment remains production-ready.
  `reference-network-adoption-stage.schema.json` is the claim-language guard:
  stage 0 is local proof, stage 1 is a single-operator pilot, stage 2 is a
  multi-authority reference, and stage 3 is an ecosystem candidate. Required
  stage boundaries block missing claims, future-stage gaps warn in
  `reference_only` mode, and `production_candidate` mode cannot carry warnings.
  Stage 1 now requires a publication-worker-backed signing custody audit export
  so custody evidence is public-safe and reviewable, while managed KMS/HSM
  signing custody remains a stage 3/product-candidate obligation. Generate the
  local adoption-stage handoff with `make network-adoption-stage-report`; the
  output belongs under `local/` because it reflects the current environment and
  evidence set, not a committed network contract. Use
  `reference-network-adoption.production.env.example` as the fail-closed input
  template for stage 3 checks, and
  `reference-network-adoption.evidence.example.json` as the canonical evidence
  map shape for a production-candidate drill. Adoption-stage boundaries now
  expose an `evidence_tier`: `reference_backed` for repository docs/tests,
  `operator_backed` for operator-owned `ops://qrtrust/` evidence, and
  `unattached` for missing evidence. `make
  network-adoption-stage-production-drill` proves the gate can produce a clean
  production-candidate report only when every modeled boundary is explicitly
  enabled, operator-backed, and covered by
  `examples/operator-evidence-index-production-candidate.json`.
  `production-adoption-gap-map.md` maps each paper layer to the current
  reference surfaces, production obligations, and evidence required before a
  deployment can be treated as more than a local PoC.
- Worker operations evidence should keep the always-on runtime boundary
  reviewable. `worker-operations-evidence.schema.json` binds the artifact
  publication worker, event-outbox worker, verifier-cache read-model worker,
  and scanner decision runtime to their authority boundaries, smoke scripts,
  monitoring references, and replay/recovery drills. A reference drill may use
  docs-backed evidence, but a production candidate must mark every component
  `production_ready` and must not include private material markers.
- Restore automation evidence should stay separate from general operator
  confidence prose. `restore-automation-evidence.schema.json` binds scheduled
  backup creation, scratch restore completion, migration rollback rehearsal,
  and operator failover handoff to explicit command refs, evidence refs,
  backup artifact metadata, and scratch-only guardrails. A reference drill may
  cite committed docs and smoke scripts, but a production candidate must cite
  operator-owned `ops://qrtrust/` evidence and must not expose secrets or
  destructive restore shortcuts.
- Packaged deployment approval evidence should stay separate from readiness
  booleans. `packaged-deployment-approval-evidence.schema.json` binds the
  deployable artifact fingerprint, contract smoke result, release-owner
  approval, security review, operations review, and rollback acceptance to
  explicit refs. A reference drill may cite committed docs and smoke scripts,
  but a production candidate must cite operator-owned `ops://qrtrust/`
  approvals, provenance, promotion logs, and rollback records.
- Production evidence requirements should describe minimum proof obligations,
  not carry the proof itself. `production-evidence-requirements.schema.json`
  names the twelve required operator controls, minimum review roles, retention
  posture, and artifact classes for a production-candidate claim. Actual
  production evidence remains in operator-owned `ops://qrtrust/` stores and is
  referenced later by operator evidence indexes, readiness handoffs, or release
  packets.
- The production evidence collection template should turn those obligations
  into operator-fillable slots without pretending the public repo contains
  production proof. `make network-production-evidence-collection-template`
  writes a local JSON and Markdown checklist with one placeholder per required
  artifact class. Operators replace those placeholders with reviewed
  `ops://qrtrust/` refs in their private evidence store before updating a
  production-candidate operator evidence index.
- Production-candidate operator evidence refs must carry the review role that
  satisfies the matching requirement. The gap report counts only
  `ops://qrtrust/` refs whose `review_role` matches the control's
  `minimum_review_role`; public-safe reference-drill refs remain useful for
  demos, but they cannot satisfy a production-ready claim. The
  `operator-evidence-index.schema.json` contract mirrors this boundary:
  `production_candidate` indexes require every control to be
  `operator_backed`, every evidence ref to use the `ops://qrtrust/` scheme,
  and every evidence ref to name its reviewer role.
- The reference-network handoff bundle fingerprints the generated production
  evidence collection template and gap report alongside adoption, readiness,
  and operator evidence indexes. That makes missing operator-owned refs visible
  during review without converting a public local report into production proof.
  The handoff keeps the general reference operator evidence packet separate
  from the production-candidate operator evidence packet and verifies that the
  collection template matches the production requirements and that the
  production evidence gap report matches the production requirements plus that
  production-candidate index. A stale collection template, stale gap report, or
  mismatched evidence index should fail before a reviewer receives the bundle.
- The production evidence intake report is the final pre-review gate for the
  operator packet. It rejects incomplete gap reports, stale template or gap
  inputs, placeholder refs, duplicate evidence URIs, and unsatisfied
  role-qualified controls. Passing intake means the packet is ready for human
  review; it is not a production approval.
- The private production evidence handoff is the operator-owned workflow for
  filling the missing `ops://qrtrust/` refs outside this repository. `make
  network-production-evidence-private-template` writes an ignored starter
  template, and `make check-network-production-evidence-private-index`
  validates a configured private operator evidence index while omitting ref
  URIs and evidence bodies from its output. The public repo owns the contract
  and checker; operators own the evidence store, retention, access control,
  and production approval.
- The production evidence closure bundle is the final public-reference operator
  handoff. It combines the requirements, collection template, gap report, and
  intake report into a local JSON/Markdown bundle that lists the remaining
  private `ops://qrtrust/` refs to collect. It does not contain production
  evidence and cannot satisfy vendor KMS/HSM, restore, broker, or release
  approval obligations by itself.
- Managed signing must be auditable without exporting secrets.
  `signing-custody-audit-export.schema.json` and
  `signing-custody-audit-export.md` define the public-safe evidence boundary
  for custody-backed artifact signing. The export records artifact hashes,
  signer/key scope, managed provider references, provider audit IDs,
  automation identity, and publication result counts while rejecting private
  material markers and fixture-only secret references.
- One-time and reusable QR usage policies are different. Replay blocking should
  apply only when policy requires one-time use.
- Root and delegated-authority signer keys are scoped records. A verifier
  should resolve the signer to an active key, accepted algorithm, and expected
  governance scope before accepting a status artifact.
- Destination policy publication should be gated by issuer-scoped domain-control
  proof for every named approved host. Owning `example.com` does not silently
  authorize `checkout.example.com` unless the policy explicitly permits
  subdomain inheritance.

The reference service package now includes an executable domain-proof boundary
for the `issuer_domain_proofs` table. The boundary can say that a verified DNS,
`.well-known`, delegated platform, enterprise-directory, payment-processor, or
manual-review proof supports destination binding for an approved host. It also
proves the negative rule: domain control cannot make an inactive issuer
legitimate, cannot rescue a host outside destination policy, and cannot be
presented as business identity by itself. A Postgres-shaped domain-proof store
now reads issuer-scoped proof rows from `issuer_domain_proofs` and feeds that
same boundary, so the table contract is exercised before live enrollment
automation exists.

A destination-policy publication gate now sits above that boundary. It checks
whether an active issuer has verified domain-control evidence for every host in
the policy before the policy is publishable. The gate is intentionally stricter
than scan-time lookup: pending, expired, or missing proofs block publication;
verified parent-domain proof supports subdomain publication only when the
destination rule explicitly allows subdomains. This keeps enrollment automation
from turning domain control into identity proof while still making destination
binding operational. The gate is now enforced by a guarded destination-policy
publisher, not only by a standalone evaluator: a blocked policy does not write
an artifact and does not emit a publication event. The publisher also fails
closed when the issuer enrollment namespace and destination-policy namespace do
not match exactly. Generic artifact-publication queue workers should wrap their
base publisher with the destination-policy-aware publisher before processing
`destination_policy` work items. In that mode, non-policy artifacts still flow
through the generic publication path, but destination-policy rows are decoded
back into their projection, resolved against issuer enrollment plus domain-proof
context, and marked failed without an artifact or event if the gate rejects
them.

The reference Postgres context resolver makes that queue path concrete: it
loads issuer enrollment from `issuers`, loads issuer-scoped domain proofs from
`issuer_domain_proofs`, and fails closed when the issuer row is missing before
the guarded publisher is allowed to evaluate the policy.

## Implementation Use

Phase 1 should validate the existing governance fixtures against these schemas.
Phase 2 should generate signed artifacts from service state and validate those
same artifacts before publication.

The governance publisher now has an explicit artifact-input planning boundary:
`planReferenceGovernancePublication` returns the ordered root manifest,
delegated authority manifest, issuer record, and destination policy publication
inputs before any store, queue, or event bus is touched. That keeps the
authority decision about what should be published separate from the transport
mechanism that publishes it.

The Postgres governance publication source makes the same boundary concrete for
durable state: `makePostgresGovernancePublicationSource` reads one active
root/delegated-authority/issuer/destination-policy bundle from Postgres and
turns it into the same ordered artifact inputs. Postgres remains the authority;
publication workers and NATS still only transport the resulting artifacts.

The authority publication service is the first source-to-publication facade on
top of that boundary. `makeAuthorityPublicationService` asks the Postgres source
for the active governance bundle, publishes the root manifest, delegated
authority manifest, issuer record, and destination policy in order, and returns
the artifact IDs plus event types as operator evidence. It does not introduce a
new source of trust; it only connects durable authority rows to the existing
artifact publication surface.

Run the draft contract smoke check with:

```sh
make check-network-contracts
make check-network-adoption-stage
make check-network-signing-custody-audit-export
make check-network-worker-operations-evidence
make check-network-restore-automation-evidence
make check-network-packaged-deployment-approval-evidence
make check-network-operator-evidence-index
make check-network-production-evidence-collection-template
make check-network-production-evidence-closure-bundle
make check-network-production-evidence-intake
make check-network-reference-handoff-bundle
```

That check now validates the deployment-readiness examples semantically, not
only by required fields. A report cannot claim production readiness while still
listing blocking checks, reference reports cannot hide production warnings,
production pass checks must carry evidence references, and non-pass checks must
carry remediation text.
The handoff bundle example is also semantically checked: it must identify
itself as an operator handoff, summarize a valid readiness-report status, carry
the canonical file roles exactly once, fingerprint every file entry, and include
review notes for the operator.
The adoption-stage example is also semantically checked: it must keep the
canonical stage-gate boundary order, match stage number to stage name, keep
blocking and warning summaries synchronized with boundary statuses, require
evidence references on passing boundaries, and fail closed when a stage or
production-candidate claim is overstated.
The worker-operations example is semantically checked as well: it must keep the
canonical worker order, preserve Postgres/NATS/cache/scanner authority
boundaries, require monitoring signals and replay/recovery drills, reject unsafe
evidence refs, reject misbound signal evidence, and fail closed if a
production-candidate packet includes reference-only workers.
The restore-automation example is semantically checked too: it must keep the
canonical drill order, prove backup, scratch restore, rollback rehearsal, and
operator failover handoff references, reject private material, enforce
scratch-only restore targets, and require operator-owned refs for production
candidate packets.
The packaged-deployment approval example is also semantically checked: it must
keep the canonical approval-gate order, prove artifact fingerprinting, contract
smoke success, release/security/operations approval, rollback acceptance,
evidence refs, and reviewer ownership, reject private material, and require
operator-owned refs for production candidate packets.
The operator-evidence index example is semantically checked: it must enumerate
the canonical readiness controls in order, keep every evidence ref public-safe,
require reviewed evidence dates, and require `ops://qrtrust/` refs before a
production-candidate claim. The production-candidate operator index fixture also
anchors the adoption-stage production drill by covering every
`reference-network-adoption.evidence.example.json` ref.
The reference handoff smoke keeps the final reviewer bundle honest: it rebuilds
the production-drill handoff, then proves that a reference-only operator index
and stale production evidence collection template or gap report are rejected
before the bundle can be handed to reviewers.
The production evidence intake smoke checks the same pre-review boundary more
directly: it blocks the current example packet while the gap report is
incomplete, accepts a synthetic complete packet, and rejects placeholder,
duplicate, or stale evidence inputs before any reviewer handoff.

The first service package should treat these schemas as the shared boundary
between:

- Postgres source-of-truth records
- artifact publication workers
- verifier cache sync
- scanner decision APIs
- iOS and browser scanner clients

`reference-postgres-schema.sql` is a draft source-of-truth schema for the
network services. It is idempotently applyable through
`make apply-network-reference-schema` for local shared-infra and small-network
reference deployments. The preferred local deployment command is
`make apply-network-migrations`, which records the applied checksum in
`qr_trust.schema_migrations` and fails on drift. After applying it, use
`make check-network-migrations` as the read-only pre-worker gate; it verifies
the ledger, migration checksums, and expected table inventory without mutating
the database. `postgres-migration-deployment-policy.md` defines the current
reference posture for those controls: additive/idempotent migrations, checksum
drift detection, backup-before-apply, read-only status gates, and
restore-or-roll-forward rollback instead of destructive down migrations. These
commands remain non-normative; production deployments still need packaged
migration ownership, approval, backup execution, and operator-owned restore
automation evidence. The
reference schema exists so the service design can be reviewed against durable
root, authority, issuer, policy, cache, runtime, decision, and event-outbox
tables before implementation.

The schema keeps public contract identifiers as text, not generated UUIDs.
Examples include `artifact_id`, `status_event_id`, `event_id`, and scanner
`decision_id`. Internal row IDs may still use UUIDs, but durable trust-network
references must round-trip with the JSON contracts.

The first TypeScript persistence boundary is intentionally driverless. It builds
SQL statements and values in the order a later Postgres transaction should use:
published artifacts, derived status rows, event outbox rows, verifier-cache
projections, and scanner decisions.

The `artifact_publication_work_items` table is the first Postgres queue
contract for source artifact publication. Rows carry the canonical artifact
JSON plus the event metadata needed to publish through the artifact publication
port. Workers claim rows with `FOR UPDATE SKIP LOCKED`, write immutable
artifacts, emit the publication event through the event-bus boundary, and mark
each source row completed or failed. This keeps source artifact publication
separate from downstream event-outbox propagation.

That queue now has a deployable supervisor/runtime boundary. In runtime mode,
artifact publication uses a Postgres-backed event bus that enqueues publication
events into `qr_trust.event_outbox` instead of relying on in-memory delivery.
Publication event IDs are deterministic from artifact ID, hash, type, and
version, so a retry after a post-publication marking failure does not create a
second logical event for the same immutable artifact.
`artifact-publication-runbook.md` defines the current operator sequence for
schema apply, worker startup, propagation handoff, queue inspection, failure
review, and safe retry.

The first verifier-cache materialization boundary now turns a verified artifact
chain into a schema-shaped cache entry: root manifest, delegated authority
manifest, issuer record, destination policy, and active status event. The cache
entry remains derived state. Source artifacts and their hashes stay the
auditable authority, while the materialized issuer and destination-policy
projections feed scanner decisions and the Postgres persistence mapping.

The first verifier-cache read-model worker boundary consumes those already
published artifact refs, fetches the source artifacts through the artifact-store
port, materializes the cache entry, and persists only derived read-model rows:
verifier-cache entries and optional scanner proof decisions. This keeps source
publication, queue propagation, and cache derivation as separate operational
steps.

The `verifier_cache_work_items` table is the first Postgres queue contract for
that derived read model. Queue rows contain only verifier ID, source artifact
refs, materialization time, and optional scanner probes. Workers claim rows with
`FOR UPDATE SKIP LOCKED`, write derived verifier-cache/scanner-decision rows,
then mark the queue row completed or failed. The queue does not authorize source
trust state and does not make NATS or Redis authoritative.

The first Postgres-shaped artifact-store adapter is also driverless. It uses the
same `published_artifacts` table contract for artifact upserts and artifact ID
lookups, so publication and verifier-sync code can keep depending on the
`ArtifactStore` port before a live database driver is introduced.

The first live Postgres driver boundary now adapts `pg` clients and pools to the
same statement, artifact lookup, and transaction ports. It still uses local
smoke tests rather than a running database, but the transaction contract is now
explicit: begin, write/read, commit on success, rollback on failure, and release
the client in both paths.

The first Postgres trust-key registry adapter stores signer scope, algorithm,
public verification material, and key lifecycle status behind the same registry
port used by the signature-verification service. This keeps signed key
revocation and rotation in durable trust state instead of treating verifier key
lookups as local fixture data.

`key-rotation-policy.md` defines the first operational policy for root and
delegated-authority key rotation. It is intentionally executable in the
TypeScript reference package so planned overlap, emergency revocation, and
verifier-cache refresh behavior stay testable rather than becoming prose-only
guidance.

`signer-recovery-runbook.md` defines the first operational response path for
root, delegated-authority, issuer, and signing-service compromise. It keeps the
blast radius scoped, requires durable recovery artifacts before verifier cache
mutation, and maps unresolved recovery state to scanner-visible orange or red
instead of exposing raw key ceremony detail to ordinary users.

`managed-signing-custody-deployment-policy.md` defines the first deployment
boundary for KMS/HSM or managed-key signing. It keeps private keys outside
normal verifier and worker processes, requires scope and lifecycle checks before
signing, and treats provider audit IDs as operator evidence rather than scanner
state.

An optional live Postgres smoke can now apply `reference-postgres-schema.sql` to
a disposable database, seed the minimum reference source rows, persist the
governance publication batch, and read the root artifact back through the same
artifact-store port. It is not part of the default checks because it resets the
`qr_trust` schema.

The first NATS propagation boundary is also driverless. It maps published event
envelopes to subject names, JetStream stream names, idempotency headers, and
envelope-only payloads before a live broker adapter sends anything.

A live JetStream publisher port now wraps that same boundary without adding
NATS as an authority. The port takes an injected broker publisher, sends the
already-normalized subject and envelope payload, passes the `Nats-Msg-Id`
idempotency header, and records only accepted messages. Durable state and retry
ownership still belong to Postgres plus `qr_trust.event_outbox`.

A local JetStream broker smoke now creates or updates the three reference
streams and publishes the deterministic reference event set through the real
broker. The matching live worker smoke persists those events into
`qr_trust.event_outbox`, claims them from Postgres, publishes them to JetStream,
and verifies the durable rows are marked `published`.

An event-outbox publisher boundary now accepts Postgres-shaped outbox rows,
validates the embedded event envelope, publishes valid rows through the same
JetStream sink, and reports per-row outcomes.

An event-outbox worker boundary now sits above that publisher. The worker
claims `pending` rows or stale `publishing` rows with `for update skip locked`,
sets a bounded claim expiry, calls the publisher only after the source
transaction has committed, marks accepted rows `published`, and marks malformed
rows `failed` for operator review. This keeps replay, retry, and failure
ownership in Postgres while keeping NATS in the propagation role.

The live authority-publication outbox drill now closes the source-to-transport
seam for governance state. It starts from live Postgres source-of-truth rows,
publishes root, delegated-authority, issuer, and destination-policy artifacts,
persists the artifact rows, enqueues four `qr_trust.event_outbox` rows, and then
uses the live outbox worker to propagate envelope-only governance messages to
NATS JetStream. This keeps artifact bodies in the authority store and treats
NATS as distribution, not source of truth.

```sh
make check-network-live-authority-outbox
```

This target is intentionally opt-in and reset-guarded. It drops and reapplies
the disposable `qr_trust` schema in the configured QR Trust database.

The live verifier-cache read-model drill now closes the next seam: it starts
from the same live authority-published governance artifacts, adds a signed
issuer-status artifact, queues one verifier-cache work item, claims it through
the Postgres-backed read-model queue, and writes derived
`qr_trust.verifier_cache_entries` plus `qr_trust.scanner_decisions` rows. The
worker records source artifact hashes and does not republish source artifacts
or enqueue additional outbox events. This keeps verifier cache as derived state,
not authority.

```sh
make check-network-live-verifier-cache
```

This target is also opt-in and reset-guarded. It drops and reapplies the
disposable `qr_trust` schema in the configured QR Trust database.

The live scanner-decision drill closes the scanner-side seam. It starts from
the same authority-published governance artifacts, materializes one
verifier-cache entry through the read-model worker, then creates scanner
decision services whose cache ports read only
`qr_trust.verifier_cache_entries`. The direct service path and the packaged
HTTP runtime both use that derived cache plus runtime safety observations. The
drill asserts that scanner decisions do not republish source artifacts or treat
source governance tables as scanner-owned state, and that the HTTP runtime
persists only scanner-decision evidence.

```sh
make check-network-live-scanner-decision
```

This target is opt-in and reset-guarded for the same reason as the live
verifier-cache drill: it resets the disposable `qr_trust` schema in the
configured QR Trust database. It verifies `GET /healthz`, a valid
`POST /scanner/decisions` response, malformed-destination rejection, the
persisted scanner-decision row, and the scanner-decision event-outbox row.

The scanner-decision HTTP runtime packages that cache-read seam into a
scanner-facing service boundary. `POST /scanner/decisions` accepts a QR payload
and returns the scanner-decision contract, while `GET /healthz` exposes only a
small runtime readiness response. The runtime reads verifier-cache state and
runtime-safety observations; it does not query source governance tables or
publish authority artifacts during a scan.

```sh
make check-network-scanner-decision-http-runtime
```

`verifier-profile-distribution.md` documents how scanner clients receive the
managed trust profile that binds them to a root program, verifier cache,
scanner-decision endpoint, runtime safety policy, and freshness rules. The QR
payload is not allowed to supply those values by itself.
`verifier-profile.schema.json` and
`examples/verifier-profile-reference.json` provide the current
machine-readable reference shape.

`scanner-fleet-evidence.md` documents the evidence packet expected before a
scanner population is treated as deployment-ready: app build, active profile
fingerprint, endpoint fingerprint, fixture matrix, green/orange/red traces,
hold-to-open evidence, history evidence, and decision records without secrets.
`scanner-fleet-evidence.schema.json` and
`examples/scanner-fleet-evidence-reference.json` provide the current
machine-readable reference shape. The smoke checker enforces the minimum
scanner fixture matrix, row-to-fixture consistency, active profile fingerprint
binding, non-green hold-to-open evidence, non-empty reason codes, compact
redacted domain fingerprints, screenshot/history/accessibility references,
unique evidence artifact references, red-outcome no-open behavior, and a
no-secrets privacy posture. `npm run scanner-fleet:evidence-artifacts-status`
reports whether the referenced native evidence files are present; the strict
`npm run scanner-fleet:evidence-artifacts-check` gate is reserved for the point
where the iPhone capture package is expected to be complete.

An event-outbox metrics boundary now exposes the minimum operational evidence
needed before running that worker continuously: pending propagation lag,
publishing rows with expired claims, failed-row counts, retryable failed rows,
maximum attempts, and a bounded failed-row sample for operator review.

An event-outbox supervisor boundary now wraps the worker and metrics ports. It
does not own Postgres or NATS directly. It repeatedly calls the worker with
bounded polling, stops on idle limits or shutdown signals, aggregates publish
counts, and returns the latest metrics health so an operator surface can show
whether propagation is healthy, degraded, or blocked.

The running Python verifier now exposes a narrow operator bridge for that same
outbox telemetry. When `QRTRUST_NETWORK_DATABASE_URL` is configured,
`/verifier/status` includes the outbox health, status counts, lag, failed rows,
and database label. If the network database is absent or unreachable, the
endpoint reports `unavailable` instead of failing the verifier runtime status.

The first signature-verification boundary now signs and verifies status-event
artifacts with Ed25519 over canonical JSON bytes. Signature transport metadata
is excluded from the signed payload, so changing status, reason, target, signer,
or scope after signing invalidates the event. A status event can mutate verifier
cache state only when its signer resolves to an active root or delegated
authority trust-key record with accepted algorithm, matching scope, public-key
material, and a valid signature.

Status events may also target `trust_key` records. Verifiers must apply those
key-lifecycle events only after the status event itself passes signature
verification; after application, a suspended, revoked, or expired key must no
longer authorize future verifier-cache mutations.

`nats-subjects.md` maps durable state changes to event subjects. It keeps the
event bus in the propagation role: useful for verifier synchronization, but not
authoritative trust state.

`scan-time-validation-sequence.md` describes the online verifier path from a
decoded QR payload to the scanner-visible decision returned to browser and iOS
clients.

The PoC `/scanner/decisions` response now includes a `contract` projection that
matches the scanner-visible decision contract shape: decision color, risk score,
reason codes, hold-to-open requirements, cache freshness, destination
fingerprint, and the four-layer trust path. The surrounding API response remains
UI-friendly, while `contract` is the handoff artifact for acceptance checks,
review packets, and future service integration.

`runtime-safety-provider-deployment-policy.md` defines the deployment boundary
for live redirect, reputation, safe-browsing, and TLS/HTTPS inspectors. Runtime
safety is scan-time evidence only: it may downgrade or block a decision, but it
cannot enroll issuers, approve destinations, or make an unknown issuer green.

`runtime-safety-observation.schema.json` defines the persistable provider
verdict shape for scan-time destination evidence. It is intentionally not a
source-of-truth artifact: each observation records provider identity,
destination fingerprint, verdict, reason codes, privacy posture, and a
`source_of_truth: false` decision role before scanner decisions combine it with
issuer, destination, and cache state.

The first runtime-safety examples now cover the two important non-green
verified-issuer cases:

- runtime risk: issuer and destination binding pass, but present-time safety
  reports elevated risk, so the scanner returns orange with hold-to-open.
- runtime block: issuer and destination binding pass, but present-time safety
  blocks opening, so the scanner returns red.
- provider observations: clear, risky, blocked, and unavailable runtime verdict
  examples that can be stored or audited without granting trust by themselves.

Destination binding remains terminal. A mismatched destination must not be
rescued by a later runtime signal.
