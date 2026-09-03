# Trust-Residual Decision Semantics

This page summarizes the decision layer the PoC implements: how a scan
becomes one bounded decision state by evaluating what remains *unproven*
— the trust residuals — rather than by accumulating positive signals.
The semantics are defined in the paper *Trust Residuals for Navigation
QR Codes: Decision Semantics for Issuer, Destination, and Runtime
Safety State* ([SSRN 7225699](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7225699));
this page is the implementation-oriented view of what the repository
actually ships. The executable references are
[`backend/app/services/trust_residuals_decision.py`](../../backend/app/services/trust_residuals_decision.py)
(the implementation) and
[`scripts/trust_residuals_formal_table.py`](../../scripts/trust_residuals_formal_table.py)
(an independently authored encoding of the decision table that imports
nothing from the implementation; the two are compared on every corpus
case and on an exhaustive sweep — see
[Evaluation results](evaluation/trust_residuals_results.v1.md)).

## The verification function

A verifier maps a scanned artifact to three outputs:

```
V(artifact, time, cached_trust_state, profile) -> (state, residual_vector, evidence)
```

- **state** — exactly one bounded decision state (below), optionally
  carrying annotations.
- **residual_vector** — one severity per residual family, recording what
  the verifier could not prove.
- **evidence** — the signed artifacts, observations, and freshness
  windows consulted, sufficient to reconstruct the decision later.

The profile is decision *context*, not evidence: it selects how strict
each rule is, and it never appears in the residual vector.

## The residual vector

Six families, each with a pass condition and an enumeration of residual
causes. A family that cannot meet its pass condition records a residual;
the decision rules then determine what that residual costs.

| Family | Question it answers | Example residual causes |
|---|---|---|
| `issuer_chain` | Does a managed trust claim verify under a key that chains to an accepted root, with nothing revoked, suspended, or expired? | `no-trust-claim`, `invalid-signature`, `unaccepted-root`, `issuer-revoked` |
| `destination_policy` | Do the final destination and first-hop resolver fall inside the issuer's signed destination policy? | `destination-not-authorized`, `resolver-not-authorized`, `policy-expired` |
| `redirect_flow` | Under controlled resolution, does the redirect chain stay within allowed hosts and depth and end where the policy says? | `depth-exceeded`, `nested-shortener`, `unauthorized-intermediary` |
| `runtime_safety` | Does a fresh, signed runtime-safety verdict report the destination clean *right now*? | `verdict-warn`, `verdict-block`, `provider-unavailable` |
| `freshness` | Is every governance object consulted within its validity window, with monotonic sequence numbers and acceptable clock skew? | `object-expired`, `sequence-rollback`, `clock-skew-exceeded` |
| `artifact_integrity` | Does capture-side analysis of the physical or digital artifact show tampering indicators? | `overlay-suspected`, `conflicting-symbols`, `framed-symbol-anomaly` |

Severities are ordered as an evidence lattice:

```
pass < unknown < stale < warn < fail < block
```

`unknown` is refined into three causes the rules can distinguish:
`not-applicable` (the family does not apply under this profile),
`not-checked` (the verifier did not evaluate it), and `unavailable`
(evaluation was attempted and the required state could not be
obtained). The lattice orders evidence quality, not decision
precedence: a *mandatory* family at `unknown` can outweigh an optional
family at `warn`, because any mandatory family short of its pass
condition is fatal to positive eligibility. Runtime safety has no
`not-applicable` tier — every navigation has a present-time safety
question.

## Evaluation result types

An evaluation returns exactly one of two disjoint result shapes:

- `capture_outcome: unreadable` with `capture_action: re-capture` when no
  reliable payload can be extracted; no trust decision exists in this branch
- `primary_state` after a payload decoded and the residual decision procedure
  ran

The corpus uses `expected.capture_outcome` for D0 and
`expected.primary_state` for decoded cases. It rejects a case that carries
both fields or puts `unreadable` in `primary_state`.

## Decision states

Every successfully decoded artifact maps to exactly one primary state. The
five-state set is deliberately closed: open-ended scores and ad hoc warning
strings are what make current scanner behavior unreviewable.

| State | Attention | Meaning |
|---|---|---|
| `unverified` | neutral | No managed trust claim present (or a profile carve-out routes an invalid claim here with warnings). An ordinary link; nothing positive is asserted. |
| `signed-unaccepted-issuer` | warning | The signature is cryptographically valid, but the delegation path ends outside every accepted root. The verifier asserts the signature's validity and nothing more. |
| `verified-issuer` | positive *only when unannotated* | The full positive-eligibility predicate holds. Any annotation drops the attention level to at least neutral. |
| `verified-issuer-destination-risky` | warning | The issuer path is positive-eligible, but the runtime-safety verdict for the destination is warn-grade. |
| `blocked` | block | A mandatory block condition matched. No one-tap continuation is offered from this state. |

Annotations carried alongside a primary state (the closed set the PoC
implements): `artifact-warning`, `stale-offline-warning`,
`limited-runtime-safety-visibility`, `redirect-variation-warning`,
`invalid-trust-claim-warning`, `policy-profile-warning`,
`incomplete-verification-warning`. An annotated `verified-issuer` is
not the positive attention level — annotations exist precisely so that
partial verification can never render as full verification.

## Decision rules

The decision function is a total, ordered first-match evaluation. In
paraphrase (the formal table script is the precise reference):

| Rule | Condition | Outcome |
|---|---|---|
| D0 | capture yields no reliable payload | capture outcome `unreadable`; re-capture |
| D1 | no managed trust claim | `unverified` |
| D2 | valid signature, no path to an accepted root | `signed-unaccepted-issuer` |
| D3 | invalid signature, malformed chain, revoked/suspended issuer or key | `blocked` |
| D4 | full positive eligibility | `verified-issuer` |
| D5 | positive-eligible except a warn-grade safety verdict | `verified-issuer-destination-risky` |
| D6 | destination or resolver outside the signed policy | `blocked` |
| D7 | redirect abuse in trusted mode (depth, intermediary, nested shortener) | `blocked` |
| D8 | blocking runtime-safety verdict | `blocked` |
| D9 | mandatory family stale | strict profiles: `blocked`; bounded/testing: annotated non-positive |
| D10 | conflicting decodable symbols, or an overlay on a document the policy declares signed | `blocked` (regardless of profile) |
| D11 | artifact-integrity `fail` | mandatory: `blocked`; else `unverified` + `artifact-warning` |
| D12 | artifact-integrity `warn`, otherwise positive-eligible | `verified-issuer` + annotation |
| D13 | cross-root contradiction | adverse annotation; never positive |
| D14 | any mandatory family below its pass condition | positive-ineligible (strict: `blocked`; bounded/testing: `unverified` + annotation) |
| D15 | any vector not matched above | non-positive default |

Evaluation order groups the rules into classes — capture first, then
mandatory blocks, then downgrades and annotations, then claim status,
insufficiency, the risky downgrade, a totality default, and the
positive terminal last. Two properties follow directly: adverse
evidence preempts claim status (an unsigned code with a blocking safety
verdict is `blocked`, not `unverified`), and insufficiency gates only
the positive path (missing evidence never *creates* a block under
bounded and testing profiles; it removes eligibility for trust).

## Invariants

The rules are checkable against seven invariants stated independently
of the table. The ones that do the most work:

- **Non-upgrade by runtime safety** — a benign reputation verdict never
  raises the state of a payload whose issuer chain does not pass.
  Reputation can reduce trust; it cannot create it.
- **Non-upgrade by transport** — HTTPS and certificate validity never
  raise the state. Transport security is necessary, never sufficient.
- **Destination-binding precedence** — a destination outside the signed
  policy prevents any positive state regardless of issuer validity. A
  signed claim pointing outside its own policy is adverse evidence, not
  missing evidence.
- **Freshness precedence** — expired mandatory state never silently
  supports the decision it supported when fresh.
- **No silent fallback to trust** — unavailability of any required
  input never defaults to a positive state. Fail-open exists only as an
  explicit, annotated profile choice.

Plus root isolation (cross-root artifacts only surface contradictions,
never trust) and evidence preservation (every state ships with the
residual vector and evidence that produced it).

## Verification profiles

The PoC implements a closed profile enum — `strict-online`,
`bounded-online`, `bounded-offline`, `production-trusted`, and
`reference-testing`. Strict-class profiles refuse stale or missing
mandatory evidence outright (block); bounded-class profiles surface it
as explicitly annotated non-positive outcomes; `reference-testing`
additionally carves invalid trust claims out of the block path so
negative test fixtures can flow through pipelines, always paired with
`policy-profile-warning`. An unrecognized profile string is rejected,
not defaulted — otherwise it would silently select the most permissive
arm of every profile-conditional rule.

## Where this lives in the repository

- [`backend/app/services/trust_residuals_decision.py`](../../backend/app/services/trust_residuals_decision.py) — the decision implementation (`compute_residuals`, `decide`).
- [`scripts/trust_residuals_formal_table.py`](../../scripts/trust_residuals_formal_table.py) — independent encoding of D0–D15, compared exhaustively against the implementation.
- [`scripts/trust_residuals_evaluation.py`](../../scripts/trust_residuals_evaluation.py) — the conformance harness.
- [Evaluation results](evaluation/trust_residuals_results.v1.md) — corpus conformance, baseline comparison, and ablation coverage.
- [Trust model](TRUST_MODEL.md), [Scanner decision matrix](SCANNER_DECISION_MATRIX.md), and [Scanner UX states](SCANNER_UX_STATES.md) — the surrounding decision model these semantics operationalize.

## Papers

- Paper 1 — [QR Navigation Security Is Not Primarily a Cryptography Problem](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=6577478) (SSRN, DOI 10.2139/ssrn.6577478): the trust-model argument.
- Paper 2 — [Trust Residuals for Navigation QR Codes: Decision Semantics for Issuer, Destination, and Runtime Safety State](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7225699) (SSRN 7225699): the decision semantics this page summarizes.
