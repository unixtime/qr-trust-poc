# Public Roadmap

Date: 2026-04-11

Scope:
- public-safe QR verification PoC
- narrowed verifier implementation
- React verifier frontend
- native iPhone end-user scanner
- documentation and packaging for eventual open-source use

## Goal

Publish a clean technical repository centered on the narrowed verifier flow,
without patent filing materials, personal data, or submission artifacts.

## Current Status

Authoritative open items:
- [x] complete the scanner-release evidence packet: 30 scanner-fleet artifacts plus 12 provider-profile artifacts under `docs/public/evidence/iphone/`
- [x] keep `make release-audit-strict` blocked until the scanner-fleet and provider-profile evidence artifacts are tracked
- [ ] finish production-reference network obligations that are intentionally outside the local PoC: vendor-specific KMS/HSM credentials and ceremonies, production-owned restore artifacts, production-owned packaged deployment approval records, and the actual operator evidence refs required by the production evidence requirements contract
- [x] keep the Python verifier lab stable while TypeScript reference-network services mature behind contract smoke tests
- [x] continue end-user iOS polish only after the release evidence packet can be regenerated from the app without manual filename mapping
- [x] add a production-style QR Trust management plane so root programs, delegated authorities, issuer enrollment, domain proofs, destination policies, verifier keys, runtime providers, NATS subscribers, audit rows, and publication outbox rows are managed through secure API and CLI workflows instead of hardcoded fixtures or runtime-only config

Completed:
- [x] separated local-only patent and filing materials into ignored `private/`
- [x] excluded `archive/`, `private/`, `.claude/`, `.env`, and `.venv` from Git
- [x] kept active backend PoC services in the tracked repo
- [x] reduced `docs/` to public-safe documentation only
- [x] added a public release checklist
- [x] selected Apache-2.0 as the public license
- [x] added a bounded public patent-position statement
- [x] refreshed backend dependencies through `uv add`
- [x] added a pytest baseline for core verifier services and API routes
- [x] added a Dockerfile and `compose.yml` for `api`, `postgres`, and `redis`
- [x] added a schema-backed restore automation evidence packet and smoke check for backup, scratch restore, rollback rehearsal, and operator failover handoff
- [x] added a schema-backed packaged deployment approval evidence packet and smoke check for artifact fingerprinting, contract smoke, release/security/operations approval, and rollback acceptance
- [x] added a schema-backed operator evidence index and smoke check that maps the twelve readiness controls to reviewed public-safe or operator-owned evidence references
- [x] added a schema-backed production evidence requirements contract and smoke check for production-candidate operator proof obligations
- [x] added an operator-facing production evidence collection template and smoke check that turns required proof obligations into fillable `ops://qrtrust/` checklist slots without treating placeholders as proof
- [x] added a production evidence gap report and smoke check that compares required operator proof obligations against the production-candidate evidence index without treating the report as production proof
- [x] enforced role-qualified production evidence refs so the gap report counts only `ops://qrtrust/` refs reviewed by the required operational role for each control
- [x] mirrored production-candidate evidence role, operator-backed status, and `ops://qrtrust/` ref constraints into the public operator evidence schema and contract smoke checker
- [x] wired the production evidence gap report into the reference-network handoff bundle so reviewers see missing operator-owned refs beside adoption and readiness claims
- [x] split the reference handoff's general operator evidence packet from its production-candidate operator evidence packet and added consistency checks so the production evidence gap report cannot drift from the requirements and production index it summarizes
- [x] added a production evidence intake gate and smoke check that rejects incomplete gaps, placeholders, duplicate refs, and stale inputs before reviewer handoff
- [x] added a production evidence closure bundle that turns the remaining operator-owned production obligations into a local JSON/Markdown handoff without treating the public repo as private evidence storage
- [x] added a private production evidence handoff workflow that writes ignored operator starter templates and validates private operator evidence indexes without printing evidence refs or bodies
- [x] surfaced the production evidence closure bundle in `make release-readiness-report` so public-release readiness cannot be confused with production readiness
- [x] added CI coverage for release-readiness report production-boundary visibility
- [x] added a public-release audit guard against stale native-evidence blocker wording and updated public docs now that scanner-fleet and provider-profile evidence are tracked
- [x] reconciled the public companion plan and release checklist so stale native-evidence TODOs no longer appear as live blockers
- [x] validated the compose stack, migrations, and live verifier flow
- [x] added QR artifact encode/render/decode support for the narrowed verifier envelope
- [x] added end-to-end tests from QR PNG generation through scanned verification
- [x] added a browser-based verifier lab for local client testing
- [x] scaffolded a Vite 8 / React 19 / Tailwind v4 / shadcn frontend workspace
- [x] built a first-pass React verifier workbench for key issue, runtime status, QR generation, upload decode, and scanned verification
- [x] wired Vite proxying for `/verifier/*` so the frontend can stay same-origin in local development
- [x] removed the legacy `/poc/*` alias and kept `/verifier/*` as the only supported API surface
- [x] added a bundled fallback QR image decoder path for browsers without `BarcodeDetector`
- [x] removed private signing key exposure from the demo API surface
- [x] added QR payload and image decode size guardrails to the public verifier flow
- [x] tightened local runtime defaults with same-origin CORS behavior and localhost-only published ports
- [x] disabled the older broad write-oriented API routes by default
- [x] added per-client rate limits to the public verifier POST endpoints, with Redis-backed coordination when available
- [x] added sanitized request tracing with `X-Request-ID` and metadata-only request logs
- [x] added optional API key auth for verifier POST endpoints, with lab support when keys are configured
- [x] added admin-managed verifier API key issue, rotate, revoke, and list flow
- [x] added a runtime status endpoint so the lab and smoke tests can detect server posture directly
- [x] added compose-backed live HTTP smoke coverage for the running verifier service
- [x] added compose-backed workbench smoke coverage for the React shell and lab comparison route
- [x] expanded the browser lab with camera selection, request tracing, and QR export helpers
- [x] added an optional Playwright browser regression test for the verifier lab
- [x] added React workbench browser evidence capture for accepted, replay, and payload-mismatch outcomes
- [x] added a native SwiftUI iPhone scanner app for real-device user-facing decisions and immediate feedback
- [x] added session-backed iPhone demo generation so the phone can publish an exact QR display URL for a second screen
- [x] documented a deterministic iPhone payload-mismatch drill using timestamped nonces and a shareable display URL
- [x] added a public release audit for repo boundary, evidence, docs, and validation hooks
- [x] added a strict public-release audit gate for the final no-warning cut
- [x] added a local native iPhone evidence capture packet generator
- [x] added a native iPhone evidence status reporter for capture/import progress
- [x] added a local release readiness report for private-remote review
- [x] added a native iPhone evidence checker for captured screenshot or recording artifacts
- [x] switched native iOS evidence export to one shareable evidence folder and pointed its generated README at the combined scanner-release importer so release evidence can be regenerated without manual filename mapping
- [x] added public GitHub collaboration files for security reports, support, contributions, issues, and pull requests
- [x] added GitHub Actions CI for release audit, backend tests, frontend lint/build, compose workbench smoke, route-navigation smoke, and manual native iOS smoke
- [x] added Dependabot configuration and release-candidate status documentation
- [x] add scanner UX friction layer with risk stripe, reason codes, and hold-to-open gating for amber/red outcomes
- [x] added an ignored local iOS verifier-provider profile generator plus a tracked checker so physical-device builds do not depend on stale Xcode run-scheme variables
- [x] hardened native iPhone evidence import/status checks with PNG signature validation and structured accessibility trace validation
- [x] surfaced reusable, one-time, and time-limited QR use semantics in the native iOS result screen so printed/shared codes are not confused with replay-protected session codes
- [x] clarified native iOS provider and privacy copy so users understand what is checked, what is sent to the verifier, and why production profiles should be signed rather than pasted endpoints
- [x] added a first-run and revisitable native iOS QR-use guide explaining reusable public, one-time, and time-limited QR semantics without weakening the four-layer trust model
- [x] added a reviewer-facing iOS provider profile import path so local verifier endpoints can be refreshed without source edits or raw endpoint entry
- [x] prepared native iOS localization by moving generated scanner and provider status copy to `String(localized:)` and documenting the String Catalog handoff
- [x] added a signed iOS provider profile import contract with a constrained local-reviewer exception for localhost, `.local`, and private LAN verifier endpoints
- [x] added a signed iOS provider-profile fixture plus cryptographic fixture/generator checks for reviewer imports
- [x] added native iOS provider-profile evidence contract and non-strict status reporting for import, active, stale, revoked, rejected, and local-reviewer states
- [x] added a local iOS provider-profile evidence capture packet generator for screenshot and accessibility-trace handoff
- [x] added a strict iOS provider-profile evidence importer so captured screenshots and accessibility traces are validated before tracking
- [x] expanded iOS provider-profile evidence status so it reports local incoming capture files before strict import
- [x] split provider-profile evidence into its own public-release audit warning/check
- [x] split release-readiness reporting and public-release docs between scanner evidence and provider-profile evidence
- [x] isolated deterministic signing fixture keys in a clearly documented test-only module and added a public-release audit guard against PEM blocks elsewhere
- [x] reconciled public-release checklist status against the current audit so stale housekeeping items no longer hide the real native-evidence blockers

In progress:
- [x] review code and comments for filing-oriented naming that should become public technical naming
- [x] decide the public API surface for the verifier PoC
- [x] turn the verifier reference flow into an end-to-end scannable QR workflow
- [x] design the replacement client app for the archived `QRCode-PoC` scanner
- [x] harden the browser lab and QR artifact flow for broader device/browser coverage
- [x] reach camera-capture parity in the React frontend before retiring the backend-served static lab
- [x] define additive `scanner_ux` response contract for risk score, reason codes, hold requirement, and destination display

Next:
- [x] write a public verifier profile document
- [x] add public test vectors
- [x] add a public run guide for the backend demos
- [x] make `/verifier/*` the canonical reference API
- [x] add real-browser/device testing guidance for the verifier lab
- [x] generate actual QR artifacts and fixture payloads from the narrowed verifier flow
- [x] build a client scanner against `/verifier/verify-scanned`
- [x] decide whether the legacy `/poc/*` alias should stay once the client is rebuilt
- [x] replace the legacy password hashing path with direct `bcrypt`
- [x] add camera/browser compatibility notes and fallback guidance to the lab
- [x] verify the new frontend service in compose and document the split between the React workbench and the legacy camera page
- [x] add optional HTTPS support for the React frontend so iPhone Safari can treat the workbench as a secure context
- [x] scaffold a native iPhone scanner app for cases where browser camera feedback is insufficient
- [x] add iPhone-specific smoke coverage beyond the compile/build check
- [x] add browser screenshots for accepted, replay, and payload-mismatch outcomes
- [x] add a repeatable public-release audit target
- [x] add a validator for native-device evidence artifacts
- [x] add public GitHub collaboration templates and policies
- [x] add public CI workflows
- [x] add dependency update automation and release-candidate status
- [x] track the unified native iOS scanner-release evidence packet for green, orange, and red scanner outcomes plus provider-profile import/settings/rejection states
- [x] add an iOS provider-profile config check to catch stale local HTTPS verifier endpoints before physical-device testing
- [x] wire `scanner_ux` into the native iPhone scanner result card, decision path, and open-action friction
- [x] wire `scanner_ux` into the React lab scanner-visible preview and event log
- [x] add seeded A/B demo fixtures for control vs friction treatment logs
- [x] export scanner UX evidence logs with `risk_score`, `reason_codes`, `hold_required`, and open timing
- [x] reconcile the older public companion plan against the current repo so stale pre-release tasks no longer look like live blockers
- [x] add `CITATION.cff` for software citation metadata
- [x] add a production adoption gap map that ties the paper's trust layers to reference services, operator-owned controls, and required evidence
- [x] split governance fixture publication into an explicit ordered artifact-input plan before store, queue, or event-bus publication
- [x] add a Postgres-backed governance publication source that plans artifacts from active source-of-truth rows
- [x] add a minimal authority publication service that publishes Postgres governance bundles through the artifact event surface
- [x] prove authority publication handoff into Postgres event outbox rows and envelope-only NATS propagation messages
- [x] add a reset-guarded live authority outbox drill from Postgres governance rows through NATS JetStream
- [x] add a live verifier-cache drill that consumes propagated governance references and writes derived cache entries
- [x] add a live scanner-decision drill that reads persisted verifier-cache state plus runtime observations
- [x] close the remaining Section 7.2 authority hierarchy, naming, and state-distribution gaps with root-aware policy, namespace isolation, signed artifact validation, status-event invalidation, approved NATS subscriber materialization, and multi-root contradiction drills
- [x] build the production-style management plane: Alembic-owned QR Trust schema, scoped operator auth, management API, `qrtrustctl` CLI, operator UI workflows, DB-backed NATS subscriber authorization, audit logging, idempotent governance mutations, and removal of fixture/config-backed governance writes from production paths

## Section 7.2 Authority Hierarchy and State Distribution

Goal: align the PoC implementation with the paper's Section 7.2 flow where accepted roots are configured before scan evaluation, root-to-authority-to-issuer paths define the trust namespace, signed artifacts distribute issuer and policy state, and fresher revocation or status state overrides stale verifier cache entries.

Findings from the current codebase review:
- [x] accepted-root policy is now a first-class verifier-cache input, and ungoverned scanner decisions no longer publish fake demo-root governance events
- [x] namespace isolation now keys destination policies by `root_program_id`, `delegated_authority_id`, `issuer_id`, and `destination_policy_id`
- [x] verifier-cache materialization now requires signed-artifact acceptance before accepting root manifests, delegated-authority manifests, issuer records, destination policies, or status events
- [x] revocation, suspension, certificate-status, destination-policy-status, delegated-authority, and trust-key status events now invalidate or update derived verifier-cache state through signed status artifacts
- [x] approved NATS governance subscribers now run as durable workers, consume event envelopes only, fetch authoritative artifacts, validate hashes/signatures/scope, and materialize derived verifier-cache state
- [x] precedence rules now have deterministic drills for lower-level state without authority context, unaccepted roots, signed status invalidation, source refresh after invalidation, and multi-root isolation
- [x] state-distribution contracts now document accepted roots, artifact refs, freshness, subscriber authorization, source-of-truth fetch behavior, and PoC versus production NATS security
- [x] assurance-tier downgrade semantics should become a dedicated signed status artifact when the PoC needs a separate behavior from suspension, revocation, expiry, or retired trust-key state

Implementation plan:
- [x] make accepted roots explicit in TypeScript scanner decision, verifier cache materialization, and live drills; a missing or unaccepted root must produce an orange or red decision, not a green decision or a demo-root event
- [x] replace bare destination-policy cache keys with a stable namespace key: `root_program_id`, `delegated_authority_id`, `issuer_id`, and `destination_policy_id`
- [x] add signed-artifact verification to the read-model materializer before it accepts root manifests, delegated-authority manifests, issuer records, destination policies, or status events
- [x] emit and consume real issuer status, certificate status, destination-policy status, revocation, and suspension artifacts from the Postgres source of truth
- [x] add an approved NATS subscriber worker that treats NATS as notification transport only, fetches source-of-truth artifacts, validates signatures and freshness, then updates the verifier cache
- [x] add deterministic multi-root and stale-state drills for Section 7.2 precedence rules
- [x] document the complete state-distribution contract in `docs/public/network-contracts/`, including accepted roots, artifact refs, freshness windows, subscriber authorization, and failure behavior
- [x] add explicit assurance-change status artifacts only if the research/demo flow needs assurance downgrade to be modeled separately from the current lifecycle status events

Container and node plan:
- [x] do not add Kafka or a second database technology; Postgres remains the only source of truth, and NATS remains the propagation transport
- [x] add logical worker nodes as compose services only when implementation begins: `network-governance-subscriber-worker` for signed governance artifacts; `network-runtime-subscriber-worker` remains optional until runtime-feed subscriber implementation begins
- [x] add an optional second verifier-node service or profile only when federation demos need independent verifier-cache state, stale cache, or cross-root contradiction evidence
- [x] keep the production note: stronger but heavier NATS accounts, JWT, and NKeys are closer to production multi-tenant governance, but the setup is larger and should follow after the PoC's Postgres-source-of-truth and approved-subscriber flow is working

## Production Management Plane

Goal: make the PoC operable like a production QR Trust deployment without
turning local demos into hidden authority. Operators should manage root
programs, delegated authorities, issuer enrollment, domain proofs, destination
policies, verifier clients, runtime providers, and NATS subscribers through
controlled API, CLI, and UI workflows backed by Postgres.

Findings from the current codebase review:
- [x] governance fixture loaders and demo seed programs are isolated as
  non-production examples; production-like trust state is reproducible through
  management API/CLI/UI workflows backed by Postgres audit and outbox rows
- [x] backend Alembic is now the canonical migration owner for QR Trust schema
  and management-plane tables; TypeScript schema apply scripts remain
  non-production drift checks and reset-guarded smoke helpers
- [x] verifier client keys and admin tokens are still config, Redis, or memory
  backed; production-style operation needs DB-backed management keys, scoped
  operator roles, revocation records, and audit history
  - [x] `/admin/*` now accepts active DB-backed management API keys from
    `qr_trust.management_api_keys`, enforces route scopes, and attributes
    audit rows to the management key when present; local config admin tokens
    remain a development bootstrap path
  - [x] added management API key issue, list, and revoke workflows so scoped
    operator credentials can be created and retired through audited `/admin/*`
    endpoints instead of direct SQL
  - [x] constrained management key issuance to known management scopes so typo
    or unsupported grants cannot become durable credentials
  - [x] added scoped `/admin/verifier-clients/api-keys/*` workflows so verifier
    client keys are issued, listed, and revoked through DB-backed management
    credentials with audit rows instead of the legacy verifier admin surface
  - [x] tightened verifier-client key rotation semantics so only active
    Postgres-backed dynamic keys can rotate; revoked credentials cannot be
    reactivated through a rotation workflow
  - [x] centralized verifier-client key ID construction so management API and
    service-issued dynamic verifier-client records use the same `vkey_`
    identifier format while retaining full-hash lookup for authentication
  - [x] added `VERIFIER_BOOTSTRAP_ADMIN_TOKENS_ENABLED=false` as the secure
    default so config admin tokens are inert unless a local bootstrap run
    explicitly opts in; DB-backed management keys remain the production path
  - [x] added `VERIFIER_STATIC_API_KEYS_ENABLED=false` as the secure default
    so config verifier-client keys are inert unless a local static-key run
    explicitly opts in; Postgres-backed verifier-client keys remain the
    production path
  - [x] separated verifier-client credentials from operator evidence reads so
    scanner/API client keys cannot unlock `/verifier/status` operator posture;
    bootstrap admin tokens or DB-backed management keys with read scopes are
    required when verifier auth is enabled
  - [x] rejected expired credential `expires_at` values at the management API
    request boundary so management and verifier-client keys cannot be issued
    already invalid
  - [x] retired the legacy `/verifier/admin/api-keys/*` lab mutation surface
    with `410 Gone` pointers to `/admin/verifier-clients/api-keys/*`, and
    routed React/static lab key issuance plus live smoke coverage through the
    audited management endpoint
  - [x] blocked `verifier:client` keys from loading as management principals
    so scanner/API client credentials cannot authenticate to `/admin/*`
  - [x] added that verifier-client/admin separation to
    `qrtrustctl management-live-drill` so the production workflow drill proves
    scanner credentials cannot act as operator credentials
- [x] issuer enrollment, domain proofing, destination-policy publication, and
  status/revocation actions now have secure operator-facing API, CLI, and UI
  workflows backed by management audit and outbox rows
- [x] NATS is correctly treated as propagation transport, but approved
  subscriber identity, subject authorization, and replay/recovery ownership need
  DB-backed management records before the broker can be operated as a
  production-like service
  - [x] added management API and `qrtrustctl` workflows for DB-backed NATS
    subscriber authorization and subject allowlist inspection
  - [x] added fail-closed NATS subject validation at the management API and
    subscriber-loader boundaries so broad grants like `qrtrust.>` cannot become
    approved subscriber state
  - [x] added the same QR Trust subject validation to `qrtrustctl
    nats-subscriber-authorize` so scripted operator workflows reject malformed
    or over-broad grants before making management API calls
  - [x] isolated local worker NATS credentials by role so Compose overrides for
    the outbox publisher, governance subscriber, and runtime subscriber cannot
    accidentally collapse least-privilege broker users into one shared login
- [x] the React operator surface explains runtime posture and exposes guided
  governance workflows for enrollment, review, approval, publication,
  revocation, outbox health, and subscriber authorization
- [x] operator CLI workflows now cover bootstrap, emergency review, scripted
  issuer enrollment, subscriber registration, and outbox inspection
  - [x] added `qrtrustctl outbox-status` and `qrtrustctl audit-list` for
    management API-backed event-outbox and governance-audit inspection

Implementation plan:
- [x] make backend Alembic the canonical migration path for `qr_trust` schema
  evolution and management-plane additions; TypeScript schema apply scripts may
  remain drift checks and local smoke helpers, but not the production source of
  migration truth
  - [x] added a backend Alembic reference-schema revision that creates the
    QR Trust governance, evidence, cache, and event-outbox tables for compose
    databases before management API reads or writes need them
  - [x] moved shared-infra migration Make targets to backend Alembic and kept
    TypeScript reference-schema apply as a local drift/smoke helper
  - [x] reset-guarded live drills rewind the backend Alembic ledger to the
    pre-QR-Trust base revision and reapply Alembic after Postgres-to-NATS retry
    proof, preventing stale `alembic_version` state after schema reset drills
- [x] add DB-backed operator identities, role assignments, management API keys,
  idempotency keys, governance audit log, runtime provider registry, NATS
  subscriber registry, and subscriber subject authorization tables
  - [x] wired active operator role assignments into management authorization so
    DB-backed keys bound to operators fail closed and are limited by both key
    scopes and active operator roles
  - [x] added `/admin/operators` and `/admin/operator-role-assignments` so
    operators and role bindings can be managed through scoped API calls with
    audit rows instead of direct SQL
- [x] add a management service that writes governance state, audit rows, and
  event-outbox rows in one transaction; no API, CLI, or UI path should publish
  trust state without that transaction
  - [x] fixed management mutation row accounting for CTE-based state writes so
    transaction results report `SELECT 1` state mutations correctly
  - [x] added `Idempotency-Key` enforcement for management mutations so
    completed retries replay the recorded result and conflicting key reuse
    returns `409` without duplicating audit or outbox rows
  - [x] included the normalized request hash and request instance in
    management outbox event IDs for idempotency-keyed mutations so expired-key
    reuse cannot mutate source state and audit rows while colliding with an
    older outbox event
- [x] add scoped admin endpoints under `/admin/*` for root programs, delegated
  authorities, issuers, domain proofs, destination policies, status events,
  trust keys, verifier clients, runtime providers, NATS subscribers, outbox
  health, and audit review
  - [x] added root-program and delegated-authority upsert endpoints so issuer
    enrollment has operator-managed parent governance records
  - [x] added issuer enrollment and domain-proof upsert endpoints so
    destination-policy publication can depend on operator-managed issuer and
    domain-control state
  - [x] added issuer status update and guarded destination-policy upsert
    endpoints so policy rows require active issuer state plus verified
    domain-control evidence before entering the publication path
  - [x] added destination-policy status update endpoint for active,
    suspended, revoked, and expired policy state changes through the same
    audit/outbox transaction path
  - [x] added `/admin/outbox` and `/admin/audit` read paths backed by
    `qr_trust.event_outbox` and `qr_trust.governance_audit_log`
  - [x] added `/admin/management-keys/issue`, `/admin/management-keys`, and
    `/admin/management-keys/{key_id}/revoke` for DB-backed management key
    lifecycle operations with scoped auth and audit rows
  - [x] added audited outbox event remediation so operators can quarantine
    stale or malformed event rows and retry remediated rows through the
    management API without direct SQL
  - [x] guarded outbox remediation so already published propagation events stay
    immutable and require a correcting event instead of being requeued
  - [x] added runtime provider upsert/list endpoints backed by
    `qr_trust.runtime_safety_providers` so runtime safety providers can be
    managed through audited governance mutations instead of hardcoded config
  - [x] added verifier client key issue, list, and revoke endpoints under
    `/admin/verifier-clients/api-keys/*` with `verifier_clients:read` and
    `verifier_clients:write` scopes
  - [x] added trust-key upsert, status update, and list endpoints under
    `/admin/trust-keys*` with `trust_keys:read` and `trust_keys:write` scopes
    so signer key governance uses the same state/audit/outbox path
  - [x] rejected expired or reversed trust-key validity windows at the
    management API request boundary so signer keys cannot be created already
    unusable or with contradictory activation intervals
  - [x] rejected expired verified domain-proof windows and timezone-naive
    domain-proof expirations at the management API boundary so issuer
    enrollment cannot publish already-stale domain-control evidence
  - [x] rejected hierarchy role assignments that omit required scope IDs so
    root, delegated-authority, and issuer admins cannot be granted against
    ambiguous authority boundaries
- [x] add `qrtrustctl`, a stdlib-argparse CLI that calls the management API by
  default and reserves direct database access for explicit bootstrap or
  emergency modes
  - [x] added scripted root-program and delegated-authority upsert commands
    with `Idempotency-Key` support for retry-safe bootstrap
  - [x] added scripted issuer enrollment and domain-proof upsert commands so
    bootstrap flows can establish the publication preconditions through the
    management API
  - [x] added scripted issuer status update and destination-policy upsert
    commands for the active-issuer plus verified-domain publication gate
  - [x] added scripted destination-policy status update for emergency
    suspend/revoke workflows without direct database mutation
  - [x] added scripted NATS subscriber authorize/list commands through the
    management API
  - [x] constrained scripted NATS subject arguments to the management API
    subject contract so bad subscriber grants fail at CLI parse time
  - [x] added scripted outbox status and governance audit list commands through
    the management API
  - [x] added scripted outbox event remediation for retry and quarantine
    workflows through the management API
  - [x] added scripted management key issue, list, and revoke commands so
    bootstrap and credential retirement no longer require SQL access
  - [x] added scripted runtime provider upsert/list commands so runtime
    safety provider registry changes use the management API, audit log, and
    event outbox
  - [x] added scripted verifier client key issue/list/revoke commands through
    the management API so lab-scanner credentials can be managed without the
    legacy verifier admin route
  - [x] added scripted operator upsert/list and operator role upsert/list
    commands so bootstrap and access-control workflows can be performed
    without direct SQL
  - [x] added scripted trust-key upsert/list/status commands so key issuance,
    rotation, and revocation evidence can flow through the management API
  - [x] constrained operator status, operator role, trust-key scope, and
    trust-key lifecycle parser choices to the management API schema values so
    scripted access-control and key-governance workflows fail closed locally
  - [x] constrained delegated-authority type and management-key scope parser
    choices to the management API schema values so bootstrap credentials and
    authority setup cannot carry typo or verifier-client-only grants
  - [x] centralized delegated-authority type and management-key scope choices
    in a shared management contract module so the CLI and API cannot silently
    drift on authority setup or bootstrap credential grants
  - [x] centralized management lifecycle/status/parser choices in the same
    shared contract module so issuer, domain, destination, operator,
    runtime-provider, trust-key, and outbox remediation workflows use one
    API/CLI vocabulary
  - [x] constrained issuer, domain-proof, and destination-policy lifecycle
    parser choices to the management API schema values so scripted operator
    workflows reject invalid governance states before sending requests
  - [x] reused the management role-assignment request schema in `qrtrustctl`
    so scripted hierarchy-role grants fail locally when required scope IDs are
    missing instead of relying on an API round trip
  - [x] reused the management domain-proof request schema in `qrtrustctl` so
    scripted verified domain-control evidence rejects stale or malformed
    expiration windows before attempting an API mutation
  - [x] reused the management and verifier-client key issue schemas in
    `qrtrustctl` so scripted credential issuance rejects expired or malformed
    `expires_at` windows before attempting an API mutation
  - [x] reused the trust-key upsert request schema in `qrtrustctl` so scripted
    signer-key issuance rejects expired, reversed, or malformed validity
    windows before attempting an API mutation
  - [x] reused the destination-policy upsert request schema in `qrtrustctl` so
    scripted policy publication rejects empty or malformed approved-destination
    payloads before attempting an API mutation
  - [x] reused the remaining management request schemas in `qrtrustctl` so
    root, authority, issuer, runtime-provider, NATS subscriber, outbox
    remediation, and status mutation commands fail locally on malformed
    payloads before attempting API mutations
- [x] add operator UI workflows for enroll issuer, verify domain, create or
  approve destination policy, rotate or revoke keys, authorize subscribers,
  inspect outbox lag, and review audit history
  - [x] exposed read-only outbox status and governance audit evidence in the
    React operator workflow surface
  - [x] exposed DB-backed management key issue, list, copy-once, and revoke
    workflows in the React access-control surface without mixing them with
    lab verifier client keys
  - [x] added guided operator forms for authority setup, issuer enrollment and
    status, domain proof, destination policy and status, NATS subscriber
    authorization, and outbox remediation through the management API
  - [x] aligned operator destination-policy query controls with verifier
    semantics so strict no-query policies use `query_policy: "none"` and
    unsupported values are rejected before DB mutation
  - [x] added runtime provider management to the React operator workflow so
    provider status, TTL, stale behavior, and unavailable behavior can be
    governed through the same management API path
  - [x] routed React operator verifier client key issue/list flows through
    `/admin/verifier-clients/api-keys/*` and displays the Postgres-backed
    management record state
  - [x] converted trust-key validity-window inputs from browser-local
    `datetime-local` values to timezone-aware UTC payloads so operator key
    rotation workflows satisfy the management API request contract
- [x] route existing demo/seed flows through managed Postgres rows where they
  claim governance state; keep fixtures labeled as non-production examples
  - [x] added `qrtrustctl demo-bootstrap` to compose the reference demo root,
    authority, runtime provider, issuer, domain proof, active issuer status,
    destination policy, governance NATS subscriber, and runtime-observation
    NATS subscriber through retry-safe management API mutations instead of
    direct fixture writes
  - [x] routed lab verifier-client key issuance through the management API and
    disabled the older verifier-admin key routes so local demos do not bypass
    scoped management credentials or audit history
  - [x] kept live scratch-Postgres reset drills runnable while making their
    non-production reference seed opt-in explicit at the Makefile boundary
  - [x] made the live outbox-metrics smoke use the same disposable database,
    reset guard, and non-production seed opt-in path as the other live reset
    drills before it can apply schema or seed deterministic outbox rows
- [x] update NATS worker authorization so approved subscribers are loaded from
  Postgres and constrained by DB-managed subject allowlists
  - [x] added operator-managed subscriber registration/listing to feed the
    Postgres-backed allowlist used by the worker
  - [x] preserved the full DB-approved subject allowlist in the governance
    subscriber's JetStream consumer filters so multi-family subscribers do not
    silently consume only the first authorized subject
  - [x] kept local compose credentials service-specific for NATS workers so
    DB-managed subject authorization is not undermined by broad shared broker
    credentials in the development deployment path
  - [x] constrained governance and runtime subscriber workers to the subject
    families owned by their JetStream streams, and made runtime replay durable
    ownership come from the Postgres-approved subscriber record
- [x] add live drills for management transaction atomicity, idempotent mutation,
  issuer enrollment to publication, NATS subscriber allow/deny, and outbox
  retry after broker outage
  - [x] added `qrtrustctl management-live-drill` to exercise precondition
    failure, idempotent replay, managed issuer-to-policy publication, NATS
    allow/deny behavior, and optional failed-outbox retry through `/admin/*`
  - [x] expanded the live-drill report to show both approved subscriber lanes
    (governance state and runtime observations) before proving broad subject
    grants are rejected
  - [x] verified the drill against the local HTTPS admin stack with explicit
    local-only self-signed TLS handling
  - [x] added strict broker-outage retry evidence mode so production drill runs
    fail instead of silently skipping outbox remediation when no failed event is
    supplied
  - [x] added a reset-guarded live outbox retry drill that fails real Postgres
    outbox rows under simulated broker outage, recovers NATS, and proves the
    same rows publish after retry

Container and node plan:
- [x] no new database technology is required; Postgres remains the only source
  of truth
- [x] no new broker technology is required; NATS remains propagation transport
  for event envelopes and artifact references
- [x] add an optional management CLI container only when scripted deployment
  evidence needs a containerized operator command surface
  - [x] added an optional `management-tools` Compose profile and
    `qrtrustctl-container-help` target so scripted operator commands can run in
    the packaged backend runtime without adding a direct database writer
- [x] add worker services only as logical nodes on the existing network image:
  `network-event-outbox-worker`, `network-governance-subscriber-worker`, and
  `network-runtime-subscriber-worker`
  - [x] exposed `network-governance-subscriber-worker` through the NATS compose
    overlay, Makefile start/log targets, and run guide so approved subscriber
    materialization can be operated without hand-editing Docker commands
  - [x] added `network-runtime-subscriber-worker` to consume DB-authorized
    `runtime.verdict.observed` envelopes, fetch and hash-check runtime
    observation artifacts, and persist normalized runtime-observation rows
  - [x] updated the HTTPS shared-infra NATS target to start the outbox,
    governance subscriber, and runtime subscriber workers together so the
    production-like local stack includes the full propagation path
- [x] add an optional second verifier-node profile only for federation,
  stale-cache, subscriber authorization, or cross-root contradiction demos
  - [x] added an opt-in `verifier-federation` Compose profile with
    `api-verifier-b`, isolated `QRTRUST_SCANNER_VERIFIER_ID`, separate Redis DB,
    and Make targets for starting and tailing the secondary verifier node
- [x] keep the production note: stronger but heavier NATS accounts, JWT, and
  NKeys are closer to production multi-tenant governance, but that is a larger
  setup and should follow after the PoC's Postgres-source-of-truth and
  DB-approved subscriber flow works end to end


## Scanner UX Friction Layer

Goal: reduce blind opens without changing the core trust model.

Principles:
- hold-to-open is a friction control, not a trust mechanism
- green results stay fast and normal
- amber and red results expose concise reason codes and may require a short hold before opening
- random plain URL QR codes should usually be amber, not red, unless a concrete high-risk signal exists
- the final decision remains with the user, while the scanner makes issuer legitimacy, destination binding, runtime safety, and decision state visible

Implementation slices:
- [x] backend scanner decision responses include an additive `scanner_ux` block
- [x] reason codes map back to trust-model layers instead of replacing them
- [x] iOS result cards show risk stripe, domain display, reason summary, and hold-to-open for flagged opens
- [x] React lab mirrors the same risk stripe and reason codes for classroom/reviewer parity
- [x] heuristic scoring expands beyond trust-model state to include caption/domain mismatch, known-bad or new domains, suspicious URL syntax, redirect depth, HTTPS posture, and first-seen domain history
- [x] deterministic local scanner scoring covers embedded URL credentials, suspicious domain endings, HTTPS absence, and redirect depth without external domain-intelligence calls
- [x] acceptance logs include preview, hold start, hold completion, opened/cancelled, score, and reason codes
- [x] local event export returns recent scanner UX events for reviewer/demo evidence packets
- [x] seeded A/B fixture endpoint returns control vs treatment logs and acceptance metrics for reviewer demos

## Active Public Files

- `backend/app/services/replay_guard_poc.py`
- `.github/`
- `backend/app/services/payload_revalidation_poc.py`
- `backend/app/services/signed_schema_poc.py`
- `backend/app/services/narrowed_verifier_poc.py`
- `backend/app/services/qr_artifact_poc.py`
- `backend/app/services/scanner_ux_ab_fixture.py`
- `backend/tests/`
- `frontend/`
- `ios/`
- `backend/scripts/replay_guard_poc_demo.py`
- `backend/scripts/payload_revalidation_poc_demo.py`
- `backend/scripts/signed_schema_poc_demo.py`
- `backend/scripts/narrowed_verifier_poc_demo.py`
- `backend/scripts/qr_artifact_poc_demo.py`
- `backend/scripts/capture_react_lab_evidence.py`
- `backend/app/api/endpoints/verifier.py`
- `frontend/src/App.tsx`
- `frontend/src/lib/verifier-client.ts`
- `frontend/vite.config.ts`
- `frontend/Dockerfile`
- `backend/Dockerfile`
- `network/src/services/governance-publication.ts`
- `network/src/services/authority-publication.ts`
- `network/src/services/postgres-governance-publication-source.ts`
- `network/src/programs/governance-publication-plan-smoke.ts`
- `network/src/programs/authority-publication-service-smoke.ts`
- `network/src/programs/authority-publication-live-outbox-drill.ts`
- `network/src/programs/verifier-cache-live-read-model-drill.ts`
- `network/src/programs/scanner-decision-live-cache-drill.ts`
- `network/src/programs/ios-provider-profile-evidence-artifacts-status.ts`
- `network/src/programs/postgres-reference-seed.ts`
- `network/src/programs/postgres-governance-publication-source-smoke.ts`
- `network/src/services/postgres-verifier-cache.ts`
- `compose.yml`
- `scripts/compose_workbench_smoke.sh`
- `scripts/iphone_evidence_check.sh`
- `scripts/ios_provider_profile_evidence_packet.sh`
- `scripts/ios_provider_profile_evidence_status.sh`
- `scripts/import_ios_provider_profile_evidence.sh`
- `scripts/ios_provider_profile_evidence_check.sh`
- `scripts/ios_harness_smoke.sh`
- `scripts/public_release_audit.sh`
- `docs/public/OPEN_SOURCE_DIRECTION.md`
- `docs/public/PUBLIC_RELEASE_CHECKLIST.md`
- `docs/public/RELEASE_CANDIDATE_STATUS.md`
- `docs/public/RUN_GUIDE.md`
- `docs/public/VERIFIER_PROFILE.md`
- `docs/public/TEST_VECTORS.md`
- `docs/public/BROWSER_TEST_MATRIX.md`
- `docs/public/network-contracts/production-adoption-gap-map.md`
- `docs/public/network-contracts/ios-provider-profile-evidence.md`
- `docs/public/network-contracts/ios-provider-profile-evidence.schema.json`
- `docs/public/network-contracts/examples/ios-provider-profile-evidence-reference.json`
- `docs/public/evidence/README.md`
- `docs/public/evidence/iphone/README.md`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `SUPPORT.md`
- `LICENSE`

## Local-Only Material

The following are intentionally outside the tracked repo boundary:
- `private/`
- `archive/`
