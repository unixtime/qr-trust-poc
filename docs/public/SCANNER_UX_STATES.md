# Scanner UX States

Date: 2026-04-12

Purpose:
- define what a scanner should tell the user
- avoid overloading all non-green outcomes into one generic warning

## Design Goal

Users need to distinguish between:
- no trust signal
- trusted issuer but current problem
- actively blocked destination

## State 0: Unreadable Capture

Meaning:
- the camera or image never yielded a decodable payload
- no trust evaluation happened at all

Suggested UX:
- neutral state, not a warning
- say the code could not be read, and why if known (blur, glare, crop)
- offer retry; never imply the code was inspected and found wanting

This is a capture failure, not a trust verdict. It is listed first because it
is the only state reachable before evaluation begins.

## State 1: Unverified

Meaning:
- no trusted issuer enrollment
- no recognized trust signal

Suggested UX:
- neutral or caution state
- show normalized destination
- do not imply malware unless there is evidence

## State 2: Signed, Unaccepted Issuer

Meaning:
- signature present and valid
- issuer not accepted by the active trust policy

Note:
- this state was previously named `signed, unknown issuer`; the wire label `signed_unknown_issuer` is retained for compatibility

Suggested UX:
- caution state
- explain that the QR was signed but not by a recognized issuer

## State 3: Verified Issuer

Meaning:
- issuer enrolled
- signature valid
- destination bound correctly
- no current runtime safety issue

Suggested UX:
- positive trust badge
- issuer tier label
- destination summary

## State 4: Verified Issuer, Destination Changed

Meaning:
- issuer is trusted
- current destination does not match issuer-approved state
- "changed" means a URL or policy mismatch observed by the verifier, not a
  claim that DNS, hosting, or page content changed behind the same URL

Status:
- specified here, not yet emitted by the reference implementation
- no wire label is assigned yet; do not infer one

Suggested UX:
- strong warning
- explain that this QR no longer points where the issuer approved

## State 5: Verified Issuer, Destination Risky

Meaning:
- issuer and destination binding are valid
- runtime safety engine has current risk concerns

Suggested UX:
- caution or block depending on severity
- explain that the issuer is known, but the site appears risky now

## State 6: Blocked

Meaning:
- revoked issuer
- malformed signed state
- unsupported claims version
- expired envelope (the `freshness` family blocks past `expires_at`)
- known malicious destination

Suggested UX:
- red block state
- strong instruction not to proceed

## State and Severity Are Two Channels

State answers *what happened*. Severity answers *how bad it is*. They are
carried separately and must stay separate in the UI.

- state: one of the labels below, decided by the trust evaluation
- severity: a score, surfaced as green / amber / red

Severity is a ladder, so two unrelated states can land on the same rung. A
scanner that derives its user-facing label from severity therefore prints the
same word for unrelated outcomes — which is the failure this page exists to
prevent. Colour may come from severity. **Wording must come from state.**

Concretely: "no trust signal present", "signed by an unaccepted issuer", and
"trusted issuer, destination risky right now" can all score amber. If the UI
says only "amber", the user cannot tell a missing signature from a live threat.

## Conformance Field and Product Labels

`model_decision.primary_state` is the protocol/conformance field. Its closed
values are the lowercase kebab-case Delta tokens: `unverified`,
`signed-unaccepted-issuer`, `verified-issuer`,
`verified-issuer-destination-risky`, and `blocked`. The accompanying
`attention_level` and annotations are part of that interpretation; an annotated
`verified-issuer` is not a plain positive result.

Top-level `decision_state` is a scanner-product label. It controls wording and
may be stricter than the model result, but it is not evidence of conformance and
must never demand less attention than `model_decision`. The Python scanner
enforces that inequality before constructing its UX contract.

The product labels currently emitted by the Python scanner are:

| State | Wire label | Notes |
|---|---|---|
| 0 Unreadable capture | `unreadable_capture` | capture/UI result; no `model_decision` is constructed because the trust-decision path begins only after decode |
| 1 Unverified | `unverified` | |
| 2 Signed, unaccepted issuer | `signed_unknown_issuer` | legacy label, retained for compatibility |
| 3 Verified issuer | `verified_issuer` | |
| 5 Destination risky | `verified_issuer_destination_risky` | |
| 6 Blocked | `blocked` | several distinct causes collapse here |
| Stale trust state | `stale_trust_state` | amber; rendered "Stale trust state" — signed by a recognized issuer, but the verifier's governance cache is stale |
| Trust state unavailable | `unknown` | red; the verifier cannot confirm issuer/key status, opening is disabled, and the scanner renders "Do not open" |
| Verifier profile stale | `profile_stale` | amber; this scanner's verifier profile is past its refresh window |
| Verifier profile revoked | `profile_revoked` | red; this scanner's verifier profile has been revoked |

State 4 has no wire label yet and therefore no row; see its Status above.

State 6 is the one place where collapsing is correct: the causes differ, but
the required user action — do not proceed — does not. Every other state earns
its own wording.

### Python product-to-model mapping

The model value in each individual response is authoritative. A product label
can aggregate several model outcomes only when the response still carries the
exact model result and the product treatment is at least as strict.

| Python `decision_state` | Current `model_decision.primary_state` | Product attention |
|---|---|---|
| `unverified` | `unverified` | neutral or caution |
| `signed_unknown_issuer` | `signed-unaccepted-issuer` | warning |
| `verified_issuer` | `verified-issuer` | model attention, including annotations |
| `verified_issuer_destination_risky` | `verified-issuer-destination-risky`; `verified-issuer` + limited-visibility annotation; or `unverified` + incomplete-verification annotation | warning |
| `stale_trust_state` | `unverified` + incomplete-verification annotation | warning |
| `profile_stale` | `unverified` + incomplete-verification annotation | warning |
| `profile_revoked` | `unverified` + incomplete-verification annotation | block |
| `unknown` | `blocked` in the current projection-outage adapter | block |
| `blocked` | `blocked` on current emitted paths | block |

### TypeScript network mapping and conformance boundary

The TypeScript network scanner does **not** currently emit
`model_decision.primary_state`; it is therefore outside the Internet-Draft -00
conformance claim. Its closed, compile-time mapping is an implementation bridge,
not a substitute for the absent field:

| Network `decision_state` | Intended model result | Attention |
|---|---|---|
| `verified_issuer` | `verified-issuer` | positive |
| `verified_issuer_destination_risky` | `verified-issuer-destination-risky` | warning |
| `verified_issuer_runtime_unavailable` | `verified-issuer` + limited-runtime-safety-visibility | warning |
| `verified_issuer_runtime_blocked` | `blocked` | block |
| `verified_issuer_cache_stale` | `unverified` + incomplete-verification-warning | warning |
| `verified_issuer_cache_expired` | `unverified` + incomplete-verification-warning | warning |
| `verified_issuer_cache_unavailable` | `unverified` + incomplete-verification-warning | warning |
| `plain_url_unrecognized` | `unverified` | neutral |
| `destination_policy_mismatch` | `blocked` | block |

The public contract fixture `check_unavailable_destination_visible` is another
example-only product label mapping to annotated `unverified`; it is not emitted
by the TypeScript network service.

## Residual Vector

Every scanner decision carries a `residual_vector`: six families, always in
this order.

`issuer_chain, destination_policy, redirect_flow, runtime_safety, freshness,
artifact_integrity`

Each entry is `{tier, cause}`. The UI marks the family with the
highest-ranked tier as the deciding one; ties go to the first family in that
order. Tiers are ranked on the evidence lattice
`pass < unknown < stale < warn < fail < block` (see
[Trust-residual decision semantics](TRUST_RESIDUALS_DECISION_SEMANTICS.md),
*The residual vector*), so the deciding family is the one whose tier sits
furthest to the right. Alongside it the response carries `model_decision`,
which the UI reads for `primary_state`, `attention_level` and its
annotations.

## UX Principle

Do not tell users that all unsigned QR codes are malicious.

Tell them:
- whether trust is present
- whether trust is absent
- whether an active failure was detected

That is much more usable.
