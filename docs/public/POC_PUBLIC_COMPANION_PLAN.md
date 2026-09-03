# Public PoC Companion Baseline and Gap Record

Purpose:
- record the minimum technical stack and repository surface used for the public companion to the QR trust research
- separate the published companion PoC from a much larger production platform effort

This is a reconciliation record, not the current roadmap or evidence ledger.
The public repository already exists; checked items record its baseline and
unchecked items identify production-reference work outside the PoC.

Current status:
- the public companion repository now exists in this checkout
- the core verifier PoC, React lab, native iPhone scanner, browser evidence,
  release-audit gates, GitHub collaboration files, CI, and reference-network
  contract package are implemented
- checked items reflect work that has landed, and unchecked items are the
  remaining production-reference gaps

## 1. What The Public Repo Must Prove

The public companion does not claim to solve the full production-governance
problem. Its evidence is scoped to four things:

1. the paper's trust model can be represented in code and data
2. the verifier can emit the paper's user-visible decision states
3. the sample artifacts and outcomes are reproducible by outsiders
4. the system can be run locally without private files, unpublished infrastructure, or hidden operator context

Those four conditions define the companion-PoC boundary.

## 2. Minimum Technical Scope

The first public release established a deliberately narrow baseline.

The baseline includes:
- issuer manifest or issuer record ingestion
- QR artifact generation or fixture loading
- destination binding checks
- runtime safety stub or simulated provider
- scanner decision-state output
- deterministic sample cases for the main outcomes

The baseline does not claim:
- production operation of the included multi-operator management workflows
- production trust-root custody or governance ceremonies
- real-time commercial threat-intel dependencies
- mobile production applications as a required path
- enterprise dashboards or admin portals
- cloud-only deployment assumptions

## 3. Recommended Technical Stack

The published companion uses this stack.

Backend:
- Python `3.12+`
- FastAPI
- `uv` for environment and dependency management
- `pytest` for unit and integration tests

Frontend:
- React
- Vite
- simple verifier workbench UI

Packaging:
- Docker
- Docker Compose

Docs:
- Markdown docs in-repo

Fixtures:
- JSON or YAML sample data stored in-repo

Native client:
- native iPhone scanner harness for live-device demonstrations

Why this stack is appropriate:
- low barrier for outside reviewers
- easy local startup
- good fit for deterministic API and fixture-driven verification logic
- already consistent with the existing repository

## 4. Minimum Public Repo Surface

These are the root files and directory families in the published companion.

Root files:
- `README.md`
- `LICENSE`
- `NOTICE`
- `CITATION.cff`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `.env.example`
- `compose.yml`

Top-level directories:
- `backend/`
- `frontend/`
- `docs/`
- `examples/`
- `scripts/`
- `tests/`

Native-client directory:
- `ios/`

Original target shape (retained as historical planning context):

```text
backend/
frontend/
docs/
  architecture.md
  data-model.md
  examples.md
  threat-model.md
examples/
  issuer-records/
  delegation-manifests/
  destination-policies/
  qr-artifacts/
  runtime-safety/
  expected-outcomes/
scripts/
  seed_examples.py
  run_demo.sh
tests/
  fixtures/
  integration/
ios/
compose.yml
.env.example
README.md
CONTRIBUTING.md
SECURITY.md
CITATION.cff
LICENSE
NOTICE
```

## 5. Release Checklist For The Technical Companion

The first public release satisfied the following controls. Each later snapshot
must repeat the applicable release gates rather than treating these historical
checks as current evidence.

Repository contract:
- [x] README explains what the PoC implements and what it does not claim
- [x] license and notice files are present
- [x] citation file exists
- [x] contribution and security policy files exist
- [x] `.gitignore` excludes `private/`, `archive/`, local env files, and virtual environments
- [x] final public-release audit confirms no private, filing-only, personal-data, or secret material remains in tracked files

Runtime:
- [x] `docker compose up --build` starts the local stack
- [x] backend can run without external paid services
- [x] frontend can run without private environment files
- [x] sample governance data is stored in-repo and documented
- [x] shared-infra run path exists for developers who already run local Postgres and Redis

Technical coverage:
- [x] the verifier can produce all core scanner outcomes
- [x] issuer legitimacy logic is demonstrated
- [x] destination binding logic is demonstrated
- [x] runtime safety logic is demonstrated through deterministic providers and persisted observation summaries
- [x] deterministic QR roundtrips are included from artifact generation to verification result

Examples:
- [x] at least one example for `unverified`
- [x] at least one example for `signed, unknown issuer`
- [x] at least one example for `verified issuer`
- [x] at least one example for `verified issuer, destination risky`
- [x] at least one example for `blocked`

Tests:
- [x] unit tests cover verifier logic
- [x] integration tests cover end-to-end fixture flows
- [x] expected outcomes are asserted, not described only in prose
- [x] compose-backed smoke tests exist for the API and React workbench

Docs:
- [x] architecture notes map repo components to the paper
- [x] data-model notes explain core manifests, verifier inputs, and network contracts
- [x] examples and test-vector notes map fixtures to paper claims
- [x] threat-model and security notes explain the intended safety boundary of the PoC

Public-release state:
- [x] scanner-fleet and provider-profile native evidence are tracked under `docs/public/evidence/iphone/`
- [x] `make release-audit-strict` passes against the current tracked evidence set
- [x] add `CITATION.cff` so the public repo can be directly cited as software

Production-reference work still separate from the PoC:
- [ ] vendor-specific KMS/HSM credentials, ceremonies, and access-control wiring
- [ ] signing-custody audit export
- [ ] restore automation and backup proof for operator-owned deployments
- [ ] packaged deployment ownership and evidence references for production readiness

## 6. Example Dataset Baseline

The example data is part of the implementation evidence, not decorative sample
content.

Minimum example categories:
- root trust program
- delegated authority manifest
- issuer record
- destination policy
- QR artifact
- runtime safety result
- expected verifier outcome

Recommended example set:

1. `unverified-basic`
- QR points to a plausible destination
- no accepted issuer path exists
- expected outcome: `unverified`

2. `signed-unknown-issuer`
- QR has a valid signed claim
- issuer does not resolve through an accepted root path
- expected outcome: `signed, unknown issuer`

3. `verified-issuer-clean`
- issuer path valid
- destination binding valid
- runtime safety clean
- expected outcome: `verified issuer`

4. `verified-issuer-destination-risky`
- issuer path valid
- destination binding valid
- runtime safety warns on redirect abuse, phishing, or malware simulation
- expected outcome: `verified issuer, destination risky`

5. `blocked-destination-mismatch`
- issuer path valid
- destination no longer matches current issuer-approved policy
- expected outcome: `blocked`

6. `blocked-revoked`
- issuer or delegated authority revoked
- expected outcome: `blocked`

7. `blocked-stale-required-state`
- verifier lacks sufficiently fresh state under configured policy
- expected outcome: `blocked`

Each example should have:
- input fixtures
- human-readable explanation
- expected machine-readable result
- a test that asserts the result

## 7. Documentation Baseline

The public repo explains the research technically without reproducing the
papers.

Minimum documentation set:

`README.md`
- what the PoC is
- what it is not
- quick start
- architecture sketch
- relation to the paper

`docs/public/PROJECT_OVERVIEW.md` and `docs/public/NETWORK_ARCHITECTURE_PLAN.md`
- service boundaries
- verifier flow
- trust-layer mapping

`docs/public/network-contracts/README.md`
- issuer records
- destination policies
- QR artifact inputs
- runtime safety inputs

`docs/public/TEST_VECTORS.md`
- list of provided scenarios
- expected outcomes
- how each one maps to the paper

`docs/public/TRUST_MODEL_FAILURE_MODES.md` and `SECURITY.md`
- what threats are represented
- what threats are explicitly out of scope

Most important README boundary:
- this repository implements a narrow reference PoC for the research and the
  posted individual Internet-Draft; it is not a production trust service,
  working-group adoption, IETF consensus, or a completed governance deployment

## 8. Public Versus Private Boundary

The line between the public demonstration and private work remains hard.

Safe to keep public:
- verifier logic
- sample manifests and example QR artifacts
- deterministic sample data
- Docker and Compose files
- test vectors
- docs that explain the framework technically
- screenshots or recordings that show verifier outcomes

Should stay private unless deliberately released:
- unpublished institutional partnership materials
- real operator enrollment data
- production signing keys
- internal risk-provider integrations
- live secrets or API keys
- legal strategy or patent-prosecution material
- private evaluation notes tied to non-public deployments

## 9. Historical Work Estimate

The original planning estimate allocated the public-companion work as follows:

- `25%` code narrowing and cleanup
- `35%` sample fixtures and expected outcomes
- `25%` docs and packaging
- `15%` tests and compose reliability

This is useful because it shows where the real effort is. The hard part is not choosing a trendy stack. The hard part is making the technical claims reproducible for someone who was not part of the paper process.

## 10. Practical Recommendation

The repository has passed the original companion-PoC threshold: it has a backend
verifier API, React verifier lab, native iPhone scanner, Compose run path,
canonical scenarios, deterministic outputs, tests, evidence tooling, and
reference-network contracts.

The practical recommendation is now narrower:
- keep the current PoC stable
- keep scanner-fleet and provider-profile evidence reproducible through the
  tracked native evidence workflow
- keep `CITATION.cff` current when the public URL, release tag, or DOI changes
- keep production-reference work contracts-first and gated by deployment
  readiness evidence
- do not market the repo as a deployable trust network until operator-owned
  custody, recovery, restore, and evidence controls are implemented
