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
- replay/policy failure in a controlled environment
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

## Wire Labels

One state, one label. Listed because the same state is spelled differently
across artifacts, and the differences are presentation only.

| State | Wire label | Notes |
|---|---|---|
| 0 Unreadable capture | `unreadable_capture` | corpus spells it `unreadable` |
| 1 Unverified | `unverified` | |
| 2 Signed, unaccepted issuer | `signed_unknown_issuer` | legacy label, retained for compatibility |
| 3 Verified issuer | `verified_issuer` | |
| 4 Destination changed | *(none assigned)* | see Status above |
| 5 Destination risky | `verified_issuer_destination_risky` | |
| 6 Blocked | `blocked` | several distinct causes collapse here |

State 6 is the one place where collapsing is correct: the causes differ, but
the required user action — do not proceed — does not. Every other state earns
its own wording.

## UX Principle

Do not tell users that all unsigned QR codes are malicious.

Tell them:
- whether trust is present
- whether trust is absent
- whether an active failure was detected

That is much more usable.
