# iOS Provider Profile Evidence

Status: draft reference contract.

This contract covers the native app provider-profile boundary. It is separate
from scanner-fleet evidence because it answers a different review question:
whether the iOS app can prove which verifier provider profile it is using
before it produces scanner-visible decisions.

The paper's scanner decision state depends on issuer legitimacy, destination
binding, runtime destination safety, and local scanner policy. A provider
profile is the scanner's pointer to the managed verifier service that supplies
those decisions. It should therefore be reviewable as scanner configuration,
not hidden as a developer-only build setting.

## Evidence Packet

`ios-provider-profile-evidence.schema.json` defines the packet shape.
`examples/ios-provider-profile-evidence-reference.json` declares the current
native capture matrix.

Each evidence row has:

- A fixture ID for the provider-profile condition being demonstrated.
- A profile state: active, stale, revoked, rejected, or local reviewer
  exception.
- The expected user-visible status.
- The expected color signal.
- A result screenshot path.
- An accessibility trace path.
- Required user-facing labels that should appear in the trace.

The reference packet currently requires evidence for:

- importing the signed demo provider profile
- showing an active provider profile in Settings
- showing stale-provider warning behavior
- showing revoked-provider block behavior
- rejecting unsigned non-local provider profiles
- allowing the constrained unsigned local reviewer exception

## Capture Rules

Use the native iOS app Settings and import surfaces. Do not substitute browser
screenshots or backend logs for this evidence. Backend logs can support the
review, but this packet is about what the iPhone user can see.

Do not commit raw verifier API keys, local IP addresses, personal device names,
or long-lived endpoint secrets. Screenshots should be cropped or redacted when
they contain local-only details. Accessibility traces should contain labels,
not secrets.

## Status And Strict Check

Use the non-strict status target while evidence is still pending:

```bash
make ios-provider-profile-evidence-status
```

Use the strict target only when native provider-profile screenshots and
accessibility traces are expected to be present:

```bash
make check-ios-provider-profile-evidence
```

The strict check validates that every referenced screenshot exists, has a PNG
signature, and is larger than a trivial placeholder. It also validates that
each accessibility trace names the fixture ID, profile state, expected status,
title, and message, and does not contain placeholder text.

This check intentionally remains separate from `make check-iphone-evidence`.
Scanner-fleet evidence proves green/orange/red scan outcomes. Provider-profile
evidence proves the native app's managed verifier configuration boundary.
