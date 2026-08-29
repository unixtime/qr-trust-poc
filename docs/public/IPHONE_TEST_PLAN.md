# iPhone Scanner-Fleet Test Plan

Use this plan when capturing deterministic physical iPhone evidence for the
QR Trust scanner experience. The plan follows the scanner-fleet evidence packet
in `docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json`.

The goal is not to prove that the backend verifier works in isolation. The goal
is to prove that the deployed scanner app turns issuer legitimacy, destination
binding, runtime safety, and scanner-visible decision state into a clear
green/orange/red user experience.

## Preconditions

Run the native scanner smoke gate:

```bash
make smoke-ios
```

This verifies the iOS scanner contract and simulator build. It does not replace
the physical-device evidence capture below.

Start the local stack with HTTPS and admin mode. If the repo-owned Postgres or
Redis ports are already occupied, use the shared-infra target:

```bash
make up-https-admin-shared-infra
```

If this repo owns its own local ports, this is also valid:

```bash
make up-https-admin
```

Before opening Xcode, generate and validate the local iOS provider profile:

```bash
make ios-provider-config
make check-ios-provider-config
make iphone-evidence-preflight
```

The provider profile is a local lab build setting. End users do not paste
verifier endpoints, API keys, or admin tokens into the iOS app.

If the Mac's Wi-Fi IP changes and Bonjour is blocked on the network, regenerate
the local certificate and provider config before rebuilding the app:

```bash
scripts/create_local_https_certs.sh <new-mac-lan-ip>
make ios-provider-config
make check-ios-provider-config
docker compose restart api frontend
```

Then run the app on a physical iPhone from:

```text
ios/VerifierLabApp/VerifierLabApp.xcodeproj
```

The Mac and iPhone must be on the same Wi-Fi. The iPhone must trust the local
`mkcert` root CA when the provider profile points at local HTTPS.

For verifier-profile fixtures, run the provider with the desired state, then
refresh the provider profile from the iPhone Settings tab:

```bash
VERIFIER_PROVIDER_PROFILE_STATE=stale docker compose up -d --build api
VERIFIER_PROVIDER_PROFILE_STATE=revoked docker compose up -d --build api
```

This preserves the paper boundary because the state comes from the scanner-side
provider profile, not from the QR payload. It also matches the production
expectation: stale or revoked provider state must be refreshed or removed through
app state, not by deleting and reinstalling the app.

## Capture Packet

Create the ignored local handoff packet:

```bash
make iphone-evidence-packet
```

This writes:

- `local/iphone-evidence-packet/README.md`
- `local/iphone-evidence-packet/required-artifacts.tsv`
- `local/iphone-evidence-packet/accessibility-templates/`
- `local/iphone-evidence-packet/incoming/`

Use the packet README as the operator checklist while holding the phone. During
capture, check progress with:

```bash
make iphone-evidence-status
```

Strict evidence checks are expected to fail until every referenced screenshot,
history image, and accessibility text trace has been captured. The checks also
reject non-PNG image files, placeholder accessibility text, and accessibility
traces whose fixture, decision color, or decision state does not match the
scanner-fleet packet.

## App And Browser Setup

Use the browser lab on the laptop to generate QR artifacts:

```text
https://<mac-lan-ip-or-bonjour-name>:8443/
```

Use the iPhone app only to scan those QR codes and display the user-facing
result. Do not use the old developer iOS harness for this evidence packet.

Important capture rules:

- Generate one QR at a time. The lab's demo trust store holds a single slot, so
  generating a second QR before the phone scan invalidates the first.
- For repeat-scan evidence, scan the same generated QR twice without
  regenerating it; both scans stay green while the envelope is inside its
  validity window. Every presentation of one envelope is evaluated the same
  way; the verifier keeps no per-presentation state.
- For expired-envelope evidence, use Scenario `expired` and confirm the
  residual card shows `freshness` = `block` with cause `object-expired`.
- For orange and red outcomes, capture the result screen and history entry
  before opening any destination.
- Red outcomes must not be opened.
- Orange outcomes may expose an open-with-caution path, but evidence should
  show that the scanner did not silently open the destination.

## Fixture Matrix

Each fixture requires three artifacts:

- result screenshot
- matching History tab screenshot
- accessibility text trace for the result screen

Use the exact filenames below. The importer copies them into
`docs/public/evidence/iphone/` according to the scanner-fleet packet.

| Fixture | Browser lab setup | Expected iPhone result | Required artifact basenames |
| --- | --- | --- | --- |
| `green_verified_issuer` | Scenario `valid`; scan the same QR twice without regenerating it | Green `verified_issuer`; the repeat scan stays green while the envelope is inside its validity window | `accepted.png`, `history-accepted.png`, `accessibility-accepted.txt` |
| `red_expired_qr` | Scenario `expired` | Red; the residual card shows `freshness` = `block`, cause `object-expired` | `expired.png`, `history-expired.png`, `accessibility-expired.txt` |
| `red_destination_mismatch` | Scenario `payload-mismatch` | Red `destination_policy_mismatch` | `payload-mismatch.png`, `history-payload-mismatch.png`, `accessibility-payload-mismatch.txt` |
| `red_resolver_final_target_mismatch` | Scenario `redirect-final-mismatch` | Red `resolver_final_target_mismatch` | `resolver-final-target-mismatch.png`, `history-resolver-final-target-mismatch.png`, `accessibility-resolver-final-target-mismatch.txt` |
| `orange_plain_url_unrecognized` | Scan a normal public URL QR that was not generated by QR Trust, for example a Wikipedia URL | Orange `plain_url_unrecognized` | `plain-url-unrecognized.png`, `history-plain-url-unrecognized.png`, `accessibility-plain-url-unrecognized.txt` |
| `orange_verifier_unavailable_visible_destination` | Generate Scenario `valid`, then make the provider unreachable before the phone scan | Orange `verifier_unavailable_visible_destination`; visible destination, no positive trust claim | `verifier-unavailable-visible-destination.png`, `history-verifier-unavailable-visible-destination.png`, `accessibility-verifier-unavailable-visible-destination.txt` |
| `orange_stale_verifier_profile` | Run the provider with `VERIFIER_PROVIDER_PROFILE_STATE=stale`, open iOS Settings, tap `Refresh provider profile`, then scan a QR Trust URL-bearing fixture. Do not substitute the browser lab `stale-cache` scenario unless the artifact is explicitly marked as a cache-staleness implementation gap. | Orange `profile_stale` | `profile-stale.png`, `history-profile-stale.png`, `accessibility-profile-stale.txt` |
| `red_revoked_verifier_profile` | Run the provider with `VERIFIER_PROVIDER_PROFILE_STATE=revoked`, open iOS Settings, tap `Refresh provider profile`, then scan a QR Trust URL-bearing fixture. Do not substitute the browser lab `revoked` scenario; that is issuer-certificate revocation, not verifier-profile revocation. | Red `profile_revoked` | `profile-revoked.png`, `history-profile-revoked.png`, `accessibility-profile-revoked.txt` |

If a fixture cannot be produced from the current app or lab controls, record it
as an implementation gap. Do not substitute a different screenshot under the
required filename.

## Accessibility Trace

The accessibility file is plain text. It should include the user-facing labels
that a reviewer or VoiceOver pass would encounter on the result screen.

Minimal format:

```text
fixture_id: red_destination_mismatch
decision_state: destination_policy_mismatch
decision_color: red
screen: Scan result
status: Red status
title: Do not open
message: The destination changed or is outside the issuer-approved policy.
destination: evi...ple.example
actions:
- View decision path
- Scan another QR
notes: Red outcome does not expose a silent open path.
```

Do not include API keys, admin tokens, signing keys, or raw secrets.
The capture packet generates one starter accessibility template per fixture.
Copy a template into the incoming folder only after replacing every `REPLACE`
placeholder with observed app labels.

## Import And Validate

Copy the exported files into:

```text
local/iphone-evidence-packet/incoming/
```

Then import and validate:

```bash
make import-iphone-evidence IPHONE_EVIDENCE_SOURCE_DIR=local/iphone-evidence-packet/incoming
git add docs/public/evidence/iphone
make iphone-evidence-status
make check-iphone-evidence
make release-audit
make release-audit-strict
```

Set `IPHONE_EVIDENCE_OVERWRITE=true` only when intentionally replacing an
existing captured artifact:

```bash
IPHONE_EVIDENCE_OVERWRITE=true make import-iphone-evidence IPHONE_EVIDENCE_SOURCE_DIR=local/iphone-evidence-packet/incoming
```

## Acceptance Criteria

The evidence package is complete when:

- every fixture in the scanner-fleet evidence packet has result, history, and
  accessibility artifacts
- a repeat scan of one envelope stays green while it is inside its validity
  window
- an expired envelope shows `freshness` = `block`, cause `object-expired`, in
  the residual card
- plain non-QR-Trust URLs are orange, not red, unless another risk reason
  applies
- verifier-unavailable scans do not become green
- red decisions do not open
- orange and red decisions show user friction and reason codes
- `make check-iphone-evidence` passes
- `make release-audit-strict` passes

This evidence proves the scanner UX consumed managed trust state correctly at
scan time. It does not prove that the root program, delegated authority, issuer
enrollment, or destination policy is production-governed.
