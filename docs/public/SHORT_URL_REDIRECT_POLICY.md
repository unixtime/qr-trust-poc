# Short URL Redirect Policy for Trusted QR

Purpose:
- define how short URLs should be handled in a trusted QR system
- separate analytics-driven resolver use from destination binding and trust decisions

## Core position

Short URLs are compatible with trusted QR only if they are treated as controlled resolver steps rather than as the destination itself.

The trust object must be the redirect flow, not just the first URL seen by the scanner.

## Why this matters

Shorteners are frequently used in abuse chains because they can:
- hide the final destination from users
- evade simplistic filtering
- create a trusted-looking first hop
- enable multi-stage redirect chains
- collect click analytics that introduce privacy leakage

This means a verifier that accepts a short URL without resolving and validating the chain is not doing meaningful destination binding.

## Trusted-mode policy

### 1. Resolver classes

Allow in trusted mode:
- issuer-controlled short domains
- trust-program-controlled resolver domains

Do not allow in trusted mode:
- generic public shorteners
- uncontrolled third-party marketing shorteners
- nested shorteners unless explicitly approved

Examples:
- allowed: `https://go.restaurant.example/m1`
- allowed: `https://trust.example/r/abc123`
- not allowed: `https://bit.ly/abc123`

### 2. Signed claims

The signed claims should distinguish:
- `resolver_url`
- `expected_final_url`
- `allowed_redirect_hosts`
- `max_redirect_hops`
- `campaign_id` or `analytics_tag` if needed
- normal trust fields such as issuer, status window, and nonce

### 3. Verification flow

Verifier steps:
1. verify issuer and signature
2. verify issuer status
3. verify that the resolver domain is itself approved
4. resolve the redirect chain in a controlled verifier context
5. compare the final destination with the expected final URL or approved destination policy
6. enforce scheme, host, and hop rules
7. reject nested shorteners unless explicitly permitted
8. optionally run runtime safety checks on the final destination

## Scanner UX implications

The scanner should show:
- resolver domain
- final destination
- trust state

It should not show only the short URL as if that were the final trusted destination.

Recommended user-facing states:
- `Verified issuer; final destination confirmed`
- `Verified issuer; redirect policy violation`
- `Verified issuer; final destination mismatch`
- `Verified issuer; final destination risky`
- `Unverified short URL`

## Analytics guidance

Analytics are legitimate for:
- campaign measurement
- coarse source tracking
- QR operational metrics

But they should be minimized in a trust system.

Prefer:
- event counts
- campaign tokens
- coarse referral classification

Avoid:
- invasive fingerprinting
- broad cross-site profiling
- opaque analytics collection that undermines the credibility of the trust layer

## Design recommendation

Best pattern:
- QR points to an issuer-controlled resolver
- resolver logs minimal analytics
- resolver performs a strict, policy-bound redirect
- verifier binds resolver and final destination together

Example:
- QR contains `https://go.music-teacher.example/l1`
- signed claims bind:
  - expected final destination: `https://music-teacher.example/lessons`
  - allowed hosts: `go.music-teacher.example`, `music-teacher.example`
  - max redirect hops: `1`

## Bottom line

Short URLs are not the problem by themselves.

Uncontrolled redirect flows are.

A trusted QR system should therefore treat redirect validation as a first-class part of destination binding, not as an optional follow-up check.
