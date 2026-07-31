# Enrollment And Consent Model

Date: 2026-04-12

Purpose:
- define how issuers enter the trust program
- define where consent is obtained for destination monitoring
- separate QR generation from enrollment and monitoring authority

## Core Rule

Consent should attach to issuer enrollment, not to every individual QR.

Per-QR consent is too brittle and does not scale.

## Enrollment Flow

### Step 1: Issuer applies

The issuer requests trusted status from an enrollment authority.

Possible issuer categories:
- individual
- business
- institution
- enterprise-managed

### Step 2: Proof is supplied

Possible proofs:
- account ownership
- domain control
- business registration
- payment processor verification
- Apple/Google/business profile verification
- enterprise directory identity

### Step 3: Allowed destination scope is registered

The issuer declares:
- approved domains
- approved subdomains
- optional path restrictions
- optional category restrictions

### Step 4: Monitoring consent is granted

The issuer agrees that trusted destinations may be monitored within defined scope.

### Step 5: Issuer credential is issued

The authority issues:
- trust status
- issuer metadata
- revocation channel
- signing or trust-binding material

## Monitoring Scope Levels

### Level A: Public passive checks

Examples:
- redirects
- TLS state
- final destination comparison
- public reputation or blocklist checks

Consent impact:
- low

### Level B: Public active rendering checks

Examples:
- render public page
- inspect third-party resource loading
- detect suspicious redirects or phishing patterns

Consent impact:
- medium

Recommended treatment:
- require issuer agreement as part of trust enrollment

### Level C: Authenticated or deep security testing

Examples:
- authenticated crawling
- private-content inspection
- invasive security tests

Consent impact:
- high

Recommended treatment:
- outside the baseline QR trust model
- requires explicit separate agreement

## QR Generation Model

Trusted QR generation does not have to happen inside the platform scanner vendor.

Generation may happen:
- anywhere

What matters is that the generated QR:
- binds to an enrolled issuer
- binds to approved destinations
- can be verified by the scanner

## Non-Enrolled Issuers

Non-enrolled issuers still exist.

That means:
- their QR codes still decode
- their QR codes still open if the user chooses
- they simply do not receive trusted UX

Expected scanner state:
- `Unverified QR`

## Privacy Handling

The enrollment authority may know more than the public scanner reveals.

This allows:
- private proofing
- limited public disclosure
- tiered trust display

Examples:
- verified individual without public legal name
- verified business with public business name

## Why Apple Or Google Do Not Need To Generate The QR

The platform’s role is:
- trust root distribution
- policy enforcement
- scanner UX

It does not have to be:
- QR content publisher

This makes adoption more realistic.
