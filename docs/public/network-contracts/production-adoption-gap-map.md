# Production Adoption Gap Map

Date: 2026-05-20

Status:
- draft implementation planning note
- non-normative
- intended to guide reference deployments and reviewer discussions

## Purpose

The paper intentionally stops short of prescribing one production
infrastructure. This map explains what a production-ready reference
implementation must still own if the local PoC evolves into a QR trust network.

The goal is not to make the PoC look bigger than it is. The goal is to make the
next engineering boundary clear:

```text
paper trust model
  -> reference contracts
  -> local service surfaces
  -> operator-owned production controls
  -> scanner-visible decisions
```

## Infrastructure Stance

Postgres is the source of truth for durable trust state. Root manifests,
delegated authorities, issuer enrollment, destination policies, runtime
observations, cache projections, scanner decisions, event outbox rows, and audit
ledger rows need transactional storage and reviewable history.

NATS JetStream is useful for propagation, not authority. It can carry
publication, revocation, cache-refresh, and runtime-observation notifications
between authority nodes, verifier nodes, and workers. Consumers must still fetch
and verify the referenced signed artifacts by ID, hash, version, and scope.

Redis is hot-path support only. It can hold rate limits, short-lived replay
state, and local verifier cache hints, but it should not be the authoritative
record for issuer legitimacy, destination binding, or governance state.

KMS/HSM custody belongs at signer and authority boundaries. The reference code
can model signer keys and custody policy, but production adoption requires a
real key ceremony, access-control policy, rotation process, recovery process,
audit export, and incident drill.

## Adoption Stages

| Stage | Name | Use | Exit criteria |
| --- | --- | --- | --- |
| 0 | Local proof | Demonstrate the paper model and scanner decisions on one machine | Contract smoke tests pass, local QR scenarios prove green, amber, and red outcomes |
| 1 | Single-operator pilot | One operator manages root, issuer enrollment, verifier cache, and scanner profile | Postgres migrations, evidence bundle, signer custody policy, backup and restore drill, iOS provider profile |
| 2 | Multi-authority reference | Root delegates to more than one authority or enrollment operator | Delegation scope, authority identity checks, NATS propagation, revocation drill, cache freshness monitoring |
| 3 | Ecosystem candidate | Multiple independent scanners and issuers rely on the network | Public governance, external audit, stable compatibility contracts, independent verifier implementations |

## Layer Gap Matrix

| Paper layer | Reference surface | Current repo status | Production obligations | Evidence required |
| --- | --- | --- | --- | --- |
| Root trust program | `root-manifest.schema.json`, key registry, readiness report | Contracted and locally smoke-tested | Root operator identity, signer ceremony, accepted algorithms, root compromise process, public distribution endpoint | Root ceremony record, public key fingerprint, rotation drill, distribution endpoint review |
| Delegated authority | `delegated-authority.schema.json`, delegation scope, NATS subjects | Contracted and modeled | Verify delegated operator identity, constrain authority scope, publish delegation changes, revoke delegated authority safely | Delegation approval, authority identity proof, scope test, revocation event and verifier-cache update |
| Issuer enrollment | `issuer-record.schema.json`, `issuer_domain_proofs`, domain-proof boundary | Contracted, schema-backed, and locally evaluated | Decide who can enroll issuers, verify business or individual identity, bind domains through DNS, `.well-known`, directory, payment-processor, or manual review | Enrollment approval, domain proof artifact, proof expiration, issuer status audit |
| Destination binding | `destination-policy.schema.json`, guarded policy publisher | Contracted and guarded before publication | Define exact URL, resolver, subdomain, app-intent, and redirect policies per issuer | Policy version, approved host proof, negative tests for blocked subdomain and final-host mismatch |
| Runtime destination safety | `runtime-safety-observation.schema.json`, provider deployment policy | Contracted with local observations | Choose provider adapters, define stale/unavailable behavior, protect provider credentials, record observation provenance | Provider config, sample observation, stale-provider test, failure-mode decision record |
| Verifier cache | `verifier-cache-entry.schema.json`, cache materialization, read model, worker-operations evidence | Contracted, locally materialized, and worker-evidence modeled | Run cache workers, monitor freshness, prove source artifact hashes, fail closed on stale or missing source state | Cache sync log, freshness window, source artifact hashes, stale-cache decision test, replay/recovery drill |
| Scanner decision state | `scanner-decision.schema.json`, browser lab, iOS scanner, deployed-scanner readiness report | Implemented for local demo and end-user PoC | Distribute trusted provider profile, protect app configuration, keep UX faithful to issuer, binding, runtime, and decision state separation | iOS screenshots, scanner event logs, provider profile proof, green/amber/red acceptance traces, scanner readiness report |
| Usage policy and replay | One-time versus reusable policy in scanner decisions | Implemented for one-time and reusable local scenarios | Let issuers declare usage class explicitly, avoid blocking reusable printed QR codes as replay, preserve one-time controls for login/payment/ticket flows | Reusable printed QR test, one-time replay test, issuer usage policy record |
| Operator readiness | Readiness report, bundle, operator guide, evidence example, worker-operations evidence, restore-automation evidence, packaged-deployment approval evidence, operator evidence index | Contracted and locally generated | Own migrations, backups, restore automation, always-on workers, packaged release approval, KMS/HSM vendor config, custody audit export, production runbooks | Readiness bundle, backup proof, restore drill, restore automation packet, worker operations packet, packaged deployment approval packet, operator evidence index, KMS/HSM config reference, operator signoff |

## What A Public Reference Repo Should Provide

- Contracts for all trust-network artifacts and scanner-visible decisions.
- A local Postgres-backed source-of-truth schema and migration ledger.
- NATS propagation examples for artifact publication, revocation, and cache
  refresh events.
- A verifier-cache worker that proves cache entries are derived state, not
  authority.
- Scanner clients that show green, amber, and red without collapsing lack of
  enrollment into maliciousness.
- Demo issuer, delegated authority, and root fixtures that are clearly marked
  as non-production.
- Evidence packets for browser, iOS, contract, readiness, restore behavior, and
  packaged deployment approval.
- Worker operations evidence for artifact publication, event outbox,
  verifier-cache read-model, scanner decision runtime, monitoring, and
  replay/recovery drills.
- Restore automation evidence for scheduled backup creation, scratch restore,
  migration rollback rehearsal, and operator failover handoff.
- Packaged deployment approval evidence for artifact fingerprinting, contract
  smoke, release-owner approval, security review, operations review, and
  rollback acceptance.
- An operator evidence index that maps the twelve readiness controls to
  reviewed public-safe or operator-owned evidence refs.
- An operator-fillable production evidence collection template that translates
  the production evidence requirements into one placeholder slot per required
  artifact class.
- An executable production evidence gap report that compares the requirements
  contract against the production-candidate operator evidence index without
  claiming that the report is proof.
- Role-qualified production evidence refs. A production-candidate ref must use
  `ops://qrtrust/` and must be tagged with the control's required reviewer role
  before the gap report counts it toward a production-ready claim.

## What Must Stay Operator-Owned

- Real-world business, organization, or individual identity verification.
- Root and delegated-authority governance decisions.
- KMS/HSM vendor selection, credentials, ceremonies, and custody audit export.
- Production DNS, `.well-known`, directory, or payment-processor proof
  operation.
- Runtime safety provider contracts and credentials.
- Backup execution, restore automation evidence, alerting, and incident
  response.
- Production packaged deployment approval records, artifact provenance,
  environment-promotion logs, rollback acceptance, and release ownership.
- Production operator evidence refs for migration status, restore transcripts,
  KMS/HSM custody proof, scanner fleet evidence, worker evidence, release
  approval records, and runbook signoff.
- Legal terms, privacy policy, and ecosystem governance.

## Design Guardrails

- A QR scanner should not say a QR is malicious only because it lacks enrollment.
- A signed QR should not turn green unless issuer legitimacy, destination
  binding, runtime safety, and local policy all support the decision.
- Domain control should not be presented as business identity.
- Events should not be treated as trusted state. They are invalidation and
  propagation signals.
- Reusable public QR codes should not be blocked by one-time replay semantics.
- A production deployment should not pass readiness without evidence references
  for source-of-truth, propagation, custody, runtime safety, persistence, and
  operator runbook ownership.
- The operator evidence index is a reviewer map, not proof by itself. It can
  show which controls are reference-backed versus operator-backed, but
  production adoption still requires the referenced operator logs, approvals,
  restore transcripts, KMS/HSM evidence, and scanner fleet evidence.
- The production evidence gap report is an audit aid, not production evidence;
  it should make missing `ops://qrtrust/` refs visible without moving private
  operator artifacts into the public repository. It should also ignore refs
  reviewed by the wrong role, because a security review cannot substitute for
  database, custody, runtime, release, or operations ownership.
- The production evidence collection template is a checklist, not production
  evidence; placeholder refs should stay visibly incomplete until an operator
  replaces them with reviewed `ops://qrtrust/` refs in a private evidence
  store.
- A deployed-scanner readiness report can prove the verifier profile and native
  evidence packet are connected, but it should not hide incomplete screenshots,
  history entries, accessibility traces, or provider-profile failures behind a
  general readiness summary.

## Recommended Next Engineering Boundary

The next implementation phase should stay contracts-first but move beyond local
fixtures:

1. Keep the minimal authority publication service as the reference boundary for
   publishing root, delegated authority, issuer, and destination-policy
   artifacts from Postgres. The live authority outbox drill proves the
   source-to-publication-to-propagation path locally; the remaining production
   work is custody, operator-owned release approval refs, operator evidence,
   and owner-signed deployment artifacts.
2. Keep the NATS-backed propagation worker limited to artifact references and
   hashes. The live authority outbox drill proves authority-published Postgres
   event-outbox rows become envelope-only governance messages; the remaining
   production work is always-on worker operations, broker runbooks, monitoring,
   and replay/recovery evidence.
3. Keep the verifier-cache read-model worker as a derived-state boundary. The
   live verifier-cache drill proves authority-published artifact references and
   signed issuer status become cache entries plus scanner decisions in
   Postgres; the remaining production work is always-on worker operations,
   freshness monitoring, verifier fleet rollout, and recovery evidence.
4. Keep scanner decisions downstream of verifier cache. The live scanner
   cache-read drill proves a scanner decision can be produced from persisted
   verifier-cache entries plus runtime safety observations without reading or
   mutating source governance artifacts; the remaining production work is API
   deployment, verifier profile distribution, runtime-provider operations, and
   scanner fleet evidence.
5. Keep the cross-surface QR evidence packet as a required readiness artifact.
   It now proves the same QR can be explained across the contract fixture,
   worker drill, web lab, backend scanner decision, and iOS scanner. The
   remaining production work is replacing local proof references with captured
   screenshots, recordings, logs, and reviewer-owned evidence packets.
6. Keep worker operations evidence separate from readiness prose. The worker
   packet now binds artifact publication, event outbox propagation,
   verifier-cache materialization, and scanner-decision runtime to explicit
   monitoring signals, alert references, and replay/recovery drills. The
   remaining production work is replacing reference smoke scripts and docs-backed
   references with operator-owned metrics, alerts, broker replay logs, cache
   rebuild evidence, and scanner runtime incident drills.
7. Keep restore automation evidence separate from deployment confidence prose.
   The restore packet now binds scheduled backup creation, scratch restore,
   migration rollback rehearsal, and operator failover handoff to explicit
   command references, evidence references, backup artifact metadata, and
   scratch-only guardrails. The remaining production work is replacing
   docs-backed restore references with operator-owned backup logs, scratch
   restore transcripts, approval records, and incident-handoff evidence.
8. Keep packaged deployment approval evidence separate from readiness booleans.
   The approval packet now binds artifact fingerprint, contract smoke result,
   release/security/operations approvals, and rollback acceptance to explicit
   refs. The remaining production work is replacing docs-backed refs with
   operator-owned release approvals, artifact provenance, environment-promotion
   logs, rollback acceptance, and owner signoff.
9. Keep the reference-network handoff bundle as an index, not a new trust
   claim. The bundle pairs adoption-stage claims with deployment-readiness
   evidence and fingerprints the reports a reviewer needs, but the adoption
   report, readiness bundle, and operator evidence index remain independently
   reviewable.
10. Keep deployed-scanner readiness separate from global deployment readiness.
   The scanner report should block on verifier-profile distribution failures,
   warn on missing native scanner evidence, and stay focused on the scanner
   boundary rather than re-litigating the root, authority, worker, or packaged
   deployment controls already covered by the broader readiness bundle.

This keeps the implementation faithful to the paper: the network manages trust
state, and the scanner turns that state into an intelligible decision for the
user.
