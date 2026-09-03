# Trust Residuals Conformance Evaluation

Generated: `2026-09-02T16:11:05.992006+00:00`

This report is a synthetic conformance suite: every case is an
author-constructed fixture with a specified expected outcome, so the
match counts below measure conformance of the implementation to the
paper's decision semantics — not effectiveness against field traffic.

Conformance is checked against two oracles. The corpus stores expected
labels per case, and `scripts/trust_residuals_formal_table.py` holds an
independently authored encoding of the paper's formal decision table
(D0–D15) that imports nothing from the implementation; the latter is
compared with the implementation on every corpus case and on an
exhaustive sweep of all modeled residual vectors, policy profiles, and
mandatory-family configurations.

## Summary

- Corpus cases: `37`
- Semantic matches: `37/37`
- Residual-vector matches: `37/37`
- Residual verifier unsafe positives: `0`
- Residual verifier attention undercuts: `0`
- Formal-table conformance (corpus): `37/37`
- Formal-table conformance (exhaustive sweep): `2212160` comparisons over `6912` residual vectors × `5` profiles × `64` mandatory-family configurations, plus the undecodable-capture rule per profile × configuration; `0` mismatches
- Δ decision latency median/p95/max ns: `750` / `1250` / `1292`
- Latency methodology: timed span is decoded-case decide(R, P) only; residual vectors precomputed; capture outcomes excluded; 20 warmup + 200 timed iterations per case, each call timed individually with time.perf_counter_ns around each individual call; summary statistics taken over per-case medians (CPython 3.12.2; Darwin 25.5.0; arm64).

## Baseline Construction

Each baseline decodes the artifact (decodability is a scanner
precondition, not a signal), then consults exactly one evidence channel
and is deliberately blind to every other channel, so the comparison
matrix below measures what a single-signal scanner gives up rather than
implementation quality:

- **decode-only**: `unreadable` if the QR is undecodable, else `unverified`; never claims positive trust.
- **https-only**: `verified-issuer` iff the decoded URL scheme is `https`, else `unverified`.
- **signature-only**: `verified-issuer` for any valid signature; `blocked` for an invalid managed trust claim; else `unverified`.
- **reputation-only**: mirrors the runtime-safety verdict alone: `blocked` on a blocking verdict, `verified-issuer-destination-risky` on a risky verdict, `unverified` when the provider is unavailable, and `verified-issuer` otherwise — including when no runtime check ran, which is why it can claim positive trust on cases the other baselines cannot.

## Baseline Comparison Matrix

Three metrics separate what a weaker baseline actually gets wrong. An
**unsafe positive** asserts positive trust where the reference outcome
does not. An **attention undercut** renders strictly less user attention
than the reference outcome demands (including a neutral rendering of a
case that requires a warning) without necessarily asserting anything.
A **state mismatch** is any difference in primary state. Unsafe-positive
and attention-undercut rates are over the 35 attention cases (expected outcome anything other than an unannotated positive
state); state-mismatch rates are over
all 37 cases.

| Baseline | Unsafe positives | Attention undercuts | State mismatches |
|---|---:|---:|---:|
| decode-only | 0/35 (0.00%) | 32/35 (91.43%) | 31/37 (83.78%) |
| https-only | 34/35 (97.14%) | 34/35 (97.14%) | 26/37 (70.27%) |
| signature-only | 29/35 (82.86%) | 30/35 (85.71%) | 23/37 (62.16%) |
| reputation-only | 27/35 (77.14%) | 29/35 (82.86%) | 23/37 (62.16%) |

Per-baseline case lists:

- **decode-only** — unsafe positives: none; attention undercuts: C2, C4, C6, C7, C8, C9, C10a, C10b, C11a, C11b, C12, C13a, C13b, C14, C15a, C15c, C16a, C16b, C17, C18, C19a, C19b, C20, C21a, C21b, C22, C23a, C23b, C24a, C24b, C25a, C25b
- **https-only** — unsafe positives: C1, C2, C4, C6, C7, C8, C9, C10a, C10b, C11a, C11b, C12, C13a, C13b, C14, C15a, C15b, C15c, C16a, C16b, C17, C18, C19a, C19b, C20, C21a, C21b, C22, C23a, C23b, C24a, C24b, C25a, C25b; attention undercuts: C1, C2, C4, C6, C7, C8, C9, C10a, C10b, C11a, C11b, C12, C13a, C13b, C14, C15a, C15b, C15c, C16a, C16b, C17, C18, C19a, C19b, C20, C21a, C21b, C22, C23a, C23b, C24a, C24b, C25a, C25b
- **signature-only** — unsafe positives: C2, C4, C6, C7, C8, C9, C10a, C10b, C11a, C11b, C12, C13a, C13b, C14, C15c, C17, C18, C19a, C19b, C20, C21a, C21b, C22, C23a, C23b, C24a, C24b, C25a, C25b; attention undercuts: C2, C4, C6, C7, C8, C9, C10a, C10b, C11a, C11b, C12, C13a, C13b, C14, C15a, C15c, C17, C18, C19a, C19b, C20, C21a, C21b, C22, C23a, C23b, C24a, C24b, C25a, C25b
- **reputation-only** — unsafe positives: C1, C2, C4, C6, C9, C10a, C10b, C11a, C12, C13a, C13b, C14, C15b, C16a, C16b, C17, C18, C19a, C19b, C20, C21a, C21b, C22, C24a, C24b, C25a, C25b; attention undercuts: C1, C2, C4, C6, C9, C10a, C10b, C11a, C11b, C12, C13a, C13b, C14, C15b, C16a, C16b, C17, C18, C19a, C19b, C20, C21a, C21b, C22, C23b, C24a, C24b, C25a, C25b

## Residual Ablation Coverage

| Residual family | Changed output | Reduced attention | Reduced-attention cases |
|---|---:|---:|---|
| issuer_chain | 8 | 7 | C1, C2, C9, C15b, C16a, C25a, C25b |
| destination_policy | 2 | 2 | C4, C18 |
| redirect_flow | 3 | 2 | C12, C19a |
| runtime_safety | 8 | 8 | C7, C8, C11a, C11b, C15a, C15c, C23a, C23b |
| freshness | 3 | 3 | C10a, C10b, C17 |
| artifact_integrity | 8 | 8 | C13a, C13b, C14, C21a, C21b, C22, C24a, C24b |

## Artifact Fixture Analysis

| Case | Fixture | Analyzer | Integrity | Indicators |
|---|---|---|---|---|
| C1 | `fixtures/qr-clean-url.png` | `qrsafe-image` | `pass` | - |
| C13a | `fixtures/invoice-overlay.pdf` | `qrsafe-pdf` | `warn` | colored_overlay_frame |
| C14 | `fixtures/qr-low-quiet-zone.png` | `qrsafe-image` | `warn` | low_quiet_zone |
| C21b | `fixtures/qr-multiple-conflicting.png` | `qrsafe-image` | `warn` | conflicting_qr_payloads, multiple_qr_symbols |
| C22 | `fixtures/email-qr-attachment.eml` | `qrsafe-email` | `warn` | low_quiet_zone |

## Case Results

| Case | Profile | Expected | Residual verifier | Semantic match |
|---|---|---|---|---|
| C0 | strict-online | capture `unreadable` | capture `unreadable` | True |
| C1 | strict-online | `unverified` | `unverified` | True |
| C2 | strict-online | `signed-unaccepted-issuer` | `signed-unaccepted-issuer` | True |
| C3 | strict-online | `verified-issuer` | `verified-issuer` | True |
| C4 | strict-online | `blocked` | `blocked` | True |
| C5 | strict-online | `verified-issuer` | `verified-issuer` | True |
| C6 | strict-online | `blocked` | `blocked` | True |
| C7 | strict-online | `blocked` | `blocked` | True |
| C8 | bounded-offline | `verified-issuer-destination-risky` | `verified-issuer-destination-risky` | True |
| C9 | strict-online | `blocked` | `blocked` | True |
| C10a | strict-online | `blocked` | `blocked` | True |
| C10b | bounded-offline | `verified-issuer` + `stale-offline-warning` | `verified-issuer` + `stale-offline-warning` | True |
| C11a | strict-online | `blocked` | `blocked` | True |
| C11b | bounded-offline | `verified-issuer` + `limited-runtime-safety-visibility` | `verified-issuer` + `limited-runtime-safety-visibility` | True |
| C12 | strict-online | `blocked` | `blocked` | True |
| C13a | strict-online | `blocked` | `blocked` | True |
| C13b | bounded-offline | `verified-issuer` + `artifact-warning` | `verified-issuer` + `artifact-warning` | True |
| C14 | bounded-offline | `verified-issuer` + `artifact-warning` | `verified-issuer` + `artifact-warning` | True |
| C15a | strict-online | `blocked` | `blocked` | True |
| C15b | bounded-offline | `unverified` | `unverified` | True |
| C15c | strict-online | `blocked` | `blocked` | True |
| C16a | production-trusted | `blocked` | `blocked` | True |
| C16b | reference-testing | `unverified` + `invalid-trust-claim-warning`, `policy-profile-warning` | `unverified` + `invalid-trust-claim-warning`, `policy-profile-warning` | True |
| C17 | strict-online | `blocked` | `blocked` | True |
| C18 | strict-online | `blocked` | `blocked` | True |
| C19a | strict-online | `blocked` | `blocked` | True |
| C19b | reference-testing | `verified-issuer` + `redirect-variation-warning`, `policy-profile-warning` | `verified-issuer` + `redirect-variation-warning`, `policy-profile-warning` | True |
| C20 | strict-online | `blocked` | `blocked` | True |
| C21a | strict-online | `blocked` | `blocked` | True |
| C21b | bounded-offline | `verified-issuer` + `artifact-warning` | `verified-issuer` + `artifact-warning` | True |
| C22 | bounded-offline | `verified-issuer` + `artifact-warning` | `verified-issuer` + `artifact-warning` | True |
| C23a | strict-online | `blocked` | `blocked` | True |
| C23b | bounded-offline | `verified-issuer` + `limited-runtime-safety-visibility` | `verified-issuer` + `limited-runtime-safety-visibility` | True |
| C24a | strict-online | `unverified` + `artifact-warning` | `unverified` + `artifact-warning` | True |
| C24b | strict-online | `blocked` | `blocked` | True |
| C25a | strict-online | `blocked` | `blocked` | True |
| C25b | bounded-offline | `unverified` + `incomplete-verification-warning` | `unverified` + `incomplete-verification-warning` | True |
