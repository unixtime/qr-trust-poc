# Public Release Checklist

Use this checklist before pushing the repository to any public hosting or
treating it as an open-source release candidate.

Automated audit:

```bash
make release-readiness-report
make release-audit
make release-audit-strict
```

The audit catches tracked private paths, known personal or filing-only strings,
missing public docs, invalid tracked browser evidence artifacts, invalid tracked
iPhone evidence artifacts, tracked PDF text-layer matches, missing validation
targets, missing CI workflow gates, GitHub collaboration files, and
patent-position/license drift. The normal audit intentionally reports missing
native scanner-fleet and provider-profile evidence as warnings so that release
decision remains explicit. The strict audit fails on any warning and is the
final public-cut gate. The readiness report writes a local ignored snapshot
that summarizes the same gates plus native evidence status for private-remote
review.

Route-specific browser regression gate:

```bash
make check-route-navigation
```

Run it with the React dev server active. It validates query-driven handoffs
across the guided paper route, verifier lab, and operator surface.
CI also runs this smoke against a local Vite server on push and pull request.

## 1. Repo Boundary

- [x] `private/` is excluded by `.gitignore`
- [x] `archive/` is excluded by `.gitignore`
- [x] `.claude/` is excluded by `.gitignore`
- [x] `backend/.env` is excluded by `.gitignore`
- [x] `backend/.venv` is excluded by `.gitignore`
- [x] no filing packet, form drafts, patent-source files, or personal-data docs remain outside `private/`

Recommended checks:

```bash
git status --short
find . -maxdepth 3 -type f | sort
```

## 2. Sensitive Data Scan

- [x] deterministic signing fixture private keys are isolated in a documented test-only module
- [x] no live API keys or production secrets are present in tracked files
- [x] no personal addresses, phone numbers, or filing-account identifiers are present in tracked files
- [x] no provisional application numbers or filing-only identifiers are present in tracked files
- [x] no generated PDFs with personal or filing data are present in tracked files

Recommended checks:

```bash
rg -n --hidden --glob '!archive/**' --glob '!private/**' --glob '!.claude/**' --glob '!backend/.venv/**' --glob '!backend/.env' '(API[_-]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE KEY-----)'
```

The release audit also runs a second, maintainer-only scan for personal and
filing-only strings. Those patterns are deliberately not distributed with this
repository: `make release-audit` performs the scan automatically when the
maintainer's untracked pattern file is present, and records a skip note in a
clean public clone.

Current scan note:
- local development defaults, placeholder examples, negative-test tokens, and deterministic signing fixtures are intentionally tracked and guarded by the release audit
- actual private-key PEM blocks are limited to the documented deterministic fixture module

## 3. Public Naming And Messaging

- [x] README language is technical and implementation-focused
- [x] docs do not describe the repo as a filing packet or prosecution workspace
- [x] public docs do not claim broad uniqueness or patentability
- [x] public docs do not imply freedom to operate
- [x] public docs do not say "patented" unless a patent has actually issued
- [x] public docs describe the project as a verifier profile or reference PoC, not as ownership of the QR category

Preferred framing:
- reference implementation
- verifier profile
- replay-safe verification flow
- issuer-state revalidation
- canonical signed-schema handling

Avoid:
- "we patented secure QR"
- "industry-standard patented QR verification"
- "all secure QR implementations must license this"

Current scan note:
- remaining patent and filing terms in public docs are boundary exclusions, checklist items, or explicit non-claims

## 4. License And Patent Posture

- [x] choose an OSS license before public release
- [x] Apache-2.0 selected for permissive reuse plus an express patent grant from code contributors
- [x] add a short patent-position note if needed, but keep it precise
- [x] do not publish vague patent threats or broad reservation language

Recommended default:
- Apache-2.0 if you want permissive reuse plus an express patent license

Current files:
- `LICENSE`


## 5. Minimum Public Docs

- [x] `README.md`
- [x] `mkdocs.yml`
- [x] `ROADMAP.md`
- [x] `docs/README.md`
- [x] project overview with service and hardware guidance
- [x] published-paper citation guide and `CITATION.cff` preferred citation
- [x] filtered documentation build and local server targets
- [x] pinned Mermaid renderer with a generated-HTML regression gate
- [x] dependency-free diagram explorer with modal zoom, pan, keyboard controls,
  and semantic flow colors
- [x] generated read-only source views for repository links, constrained to
  the public code boundary
- [x] `docs/public/OPEN_SOURCE_DIRECTION.md`
- [x] public run instructions
- [x] public verifier profile document
- [x] public test-vector document
- [x] browser evidence manifest
- [x] browser evidence checker
- [x] route-query browser smoke
- [x] native iPhone test plan
- [x] local release readiness report
- [x] strict release audit target
- [x] native iPhone device preflight
- [x] native iPhone capture packet
- [x] native iPhone evidence status reporter
- [x] native iPhone evidence import helper
- [x] native iPhone evidence checker
- [x] native iPhone local provider-profile config checker
- [x] native iOS provider-profile evidence capture packet
- [x] native iOS provider-profile evidence status reporter
- [x] native iOS provider-profile evidence import helper
- [x] native iOS provider-profile evidence checker
- [x] unified scanner-release evidence packet
- [x] unified scanner-release evidence Downloads status checker
- [x] unified scanner-release evidence import helper
- [x] security reporting policy
- [x] contribution guide
- [x] support policy
- [x] GitHub issue and pull request templates
- [x] GitHub Actions CI for release audit, documentation rendering, backend tests, frontend lint/build, compose workbench smoke, and route-query browser smoke
- [x] manual GitHub Actions workflow for native iOS smoke build
- [x] Dependabot dependency update configuration
- [x] release-candidate status document
- [x] tracked scanner-fleet evidence artifacts
- [x] tracked provider-profile evidence artifacts
- [x] `CITATION.cff` if the public repository should be cited directly as software

Existing docs and validation hooks:
- `mkdocs.yml`
- `docs/public/PROJECT_OVERVIEW.md`
- `docs/public/CITING.md`
- `docs/public/RUN_GUIDE.md`
- `docs/public/VERIFIER_PROFILE.md`
- `docs/public/TEST_VECTORS.md`
- `docs/public/evidence/README.md`
- `docs/public/IPHONE_TEST_PLAN.md`
- `scripts/iphone_device_preflight.sh`
- `scripts/iphone_evidence_packet.sh`
- `scripts/iphone_evidence_status.sh`
- `scripts/import_iphone_evidence.sh`
- `scripts/iphone_evidence_check.sh`
- `scripts/ios_provider_config_check.sh`
- `scripts/ios_provider_profile_evidence_packet.sh`
- `scripts/ios_provider_profile_evidence_status.sh`
- `scripts/import_ios_provider_profile_evidence.sh`
- `scripts/ios_provider_profile_evidence_check.sh`
- `scripts/scanner_release_evidence_packet.sh`
- `scripts/scanner_release_evidence_export_status.sh`
- `scripts/import_scanner_release_evidence_export.sh`
- `scripts/scanner_release_evidence_todo.sh`
- `scripts/release_readiness_report.sh`
- `make docs-build`
- `make docs-serve`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `SUPPORT.md`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/research_or_vector.yml`
- `.github/dependabot.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/native-ios.yml`
- `docs/public/RELEASE_CANDIDATE_STATUS.md`

Remaining documentation decisions:
- update `CITATION.cff` if a public URL, release tag, or DOI is assigned
- keep the tracked scanner-release evidence packet aligned before each strict public cut
- keep generated evidence artifacts aligned with the reference packet filenames in `docs/public/network-contracts/examples/`

## 6. Code Review For Public Release

- [x] remove filing-oriented comments, labels, or filenames from tracked code
- [x] remove stale references to bridge filings, `SB/16`, `SB/15A`, or provisional workflows
- [x] confirm the PoC demos run without private inputs
- [x] confirm the PoC demos do not depend on local patent files
- [x] keep `.env.example` to placeholders and documented local-development defaults only
- [x] keep public issue templates scoped away from security-sensitive exploit detail

## 7. Release Mechanics

- [ ] create the release candidate only through the allowlist-based exporter
- [ ] initialize the exported tree as a fresh, single-commit repository
- [ ] push that exact candidate to a private GitLab review repository
- [ ] review the private GitLab tree, rendered docs, default branch, and CI result
- [ ] record the reviewed commit and tree hashes
- [ ] create an empty public GitHub repository without generated starter files
- [ ] push the exact reviewed commit to GitHub without rebuilding or editing it
- [ ] confirm the GitHub commit and tree hashes match the private GitLab candidate
- [ ] run GitHub Actions and review Dependabot output after the identical push
- [ ] run the manual native iOS workflow when macOS CI minutes are acceptable

Do not stage the private workspace with a broad pathspec or `git add -A` as a
release mechanism. The exporter is the publication boundary; it creates the
fresh-history candidate from the reviewed allowlist and deterministic overlay.

## 8. Public Release Gate

Treat the repository as ready for public release only when all of the following
are true:

- [x] no private filing artifacts are tracked
- [x] no personal data is tracked
- [x] no live secrets are tracked
- [x] public docs are implementation-focused
- [x] license choice is explicit
- [x] public run path is documented
- [x] verifier behavior is documented with test vectors
- [x] browser evidence artifacts are captured
- [x] native iPhone scanner has an automated smoke gate
- [x] native iPhone capture has a physical-device preflight
- [x] native iPhone evidence has a local capture packet
- [x] native iPhone evidence has a progress reporter
- [x] native iPhone evidence has an import helper
- [x] native iPhone evidence has an artifact checker
- [x] native iOS provider-profile evidence has a capture packet
- [x] native iOS provider-profile evidence has a progress reporter
- [x] native iOS provider-profile evidence has an import helper
- [x] native iOS provider-profile evidence has an artifact checker
- [x] scanner-release evidence has a unified packet, Downloads status checker, import helper, and todo reporter
- [x] browser evidence artifacts have an artifact checker
- [x] route-query navigation smoke runs in CI
- [x] local release readiness report exists for private-remote review
- [x] strict release audit exists for the final public cut
- [x] native iPhone evidence artifacts are captured
- [x] native iOS provider-profile evidence artifacts are captured
- [x] `make release-audit-strict` passes
