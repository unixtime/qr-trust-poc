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

## State 1: Unverified

Meaning:
- no trusted issuer enrollment
- no recognized trust signal

Suggested UX:
- neutral or caution state
- show normalized destination
- do not imply malware unless there is evidence

## State 2: Signed, Unknown Issuer

Meaning:
- signature present and valid
- issuer not in trusted program

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

## UX Principle

Do not tell users that all unsigned QR codes are malicious.

Tell them:
- whether trust is present
- whether trust is absent
- whether an active failure was detected

That is much more usable.
