# Trust Layers

Date: 2026-04-12

Purpose:
- separate the different security questions that people casually call "valid QR"
- prevent architectural confusion between issuer trust, destination correctness, and runtime safety

## The Problem

A QR can be:
- well-formed
- signed correctly
- issued by the expected party
- still unsafe to open

That means the system needs layered answers, not one green checkmark.

## Layer 1: QR Decoding Integrity

Question:
- did the scanner decode the QR content correctly?

What this layer covers:
- QR readability
- payload extraction
- parsing

What it does not cover:
- issuer legitimacy
- destination approval
- runtime website safety

## Layer 2: Cryptographic Integrity

Question:
- was the payload signed correctly and bound to the expected signed claims?

What this layer covers:
- signature validation
- canonical field rules
- metadata conflict rejection

What it does not cover:
- whether the issuer is trusted
- whether the destination is still approved
- whether the destination is malicious right now

## Layer 3: Issuer Trust

Question:
- is the issuer enrolled in a trust program that the scanner recognizes?

What this layer covers:
- issuer identity or eligibility
- trust tier
- enrollment status
- revocation status

What it does not cover:
- destination compromise after issuance
- redirect abuse
- injected malicious content

## Layer 4: Destination Binding

Question:
- does the QR still point to a destination currently approved for that issuer?

What this layer covers:
- exact host match
- issuer-approved destination list
- policy rules like subdomains
- changes to the encoded URL or its authorization policy after issuance

What it does not cover:
- whether the page at that destination is currently safe
- DNS, hosting-account, or server ownership continuity behind the same URL
- response-byte or page-content integrity
- client-side redirects or navigation after the scanner opens the URL

An authorized URL is not an attestation about the resource currently served at
that URL. A same-URL infrastructure or content change leaves destination
binding unchanged and belongs to runtime-safety or a separately specified
resource-integrity mechanism.

## Layer 5: Runtime Destination Safety

Question:
- is opening this destination safe right now?

What this layer may cover:
- redirects
- reputation
- known malicious hosting
- phishing indicators
- malicious third-party resource loading
- exploit delivery heuristics

What it does not prove:
- who issued the QR
- whether the issuer is trusted

## Why This Separation Matters

Without this separation, teams make bad assumptions such as:
- "signed means safe"
- "HTTPS means trusted"
- "known issuer means uncompromised site"

Those are all wrong.

## Recommended Combined Outcome Model

The scanner should ideally compute all three high-level answers:

1. issuer trust
2. destination binding
3. runtime safety

Then present a final user state based on the combination.

## Example

A restaurant menu QR might be:
- issued by a verified restaurant
- still bound to the approved menu URL
- but the menu site has been compromised

Correct scanner outcome:
- verified issuer
- approved destination
- risky destination right now

That is materially different from:
- verified issuer
- approved destination
- safe to open
