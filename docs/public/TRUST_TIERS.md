# Trust Tiers

Date: 2026-04-12

Purpose:
- define how trust should be expressed to ordinary users without forcing one identity model for everyone
- support privacy-sensitive cases while still enabling useful trust UX

## Design Goal

Do not force every QR owner to publicly expose full legal identity.

Instead, separate:
- what the platform knows
- what the public scanner shows

## Tier 0: Raw QR

Definition:
- no issuer enrollment
- no trusted signature
- no managed trust state

User-facing result:
- `Unverified QR`

Use cases:
- personal flyers
- one-off event posters
- random web links

## Tier 1: Signed But Unknown Issuer

Definition:
- QR carries a valid signature
- issuer is not in a trusted program recognized by the scanner

User-facing result:
- `Signed, issuer not trusted`

Use cases:
- private ecosystems
- early adopters
- self-issued trust domains

## Tier 2: Verified Individual

Definition:
- issuer is a verified person in an enrollment program
- scanner recognizes the issuer tier
- public display may or may not show the full identity

User-facing result:
- `Verified individual`

Examples:
- tutor
- musician
- freelancer
- event organizer

Privacy model:
- platform may know full identity
- public scanner may show only a verified badge, alias, or limited attestation

## Tier 3: Verified Business

Definition:
- issuer is a verified business or merchant
- destination set is bound to that business

User-facing result:
- `Verified business`

Examples:
- restaurant
- retail store
- clinic
- service business

## Tier 4: Verified Institution

Definition:
- issuer is a high-assurance institution with stronger onboarding and policy

User-facing result:
- `Verified institution`

Examples:
- government
- university
- bank
- healthcare provider

## Tier 5: Blocked

Definition:
- issuer revoked
- destination mismatch
- policy failure
- runtime danger signal

User-facing result:
- `Blocked`

## Key Principle

Trust tiers should reflect:
- assurance level
- enrollment level
- policy status

They should not automatically reveal:
- more personal identity than necessary

## Product Consequence

The system does not need to forbid non-technical users from creating QR codes.

It only needs to reserve trusted UX for users or organizations that enroll.

That is a workable compromise between:
- usability
- privacy
- platform safety
