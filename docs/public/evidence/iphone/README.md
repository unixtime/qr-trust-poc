# Native iPhone Evidence

Status: scanner-fleet packet complete (24/24 artifacts tracked). One fixture,
`green_verified_issuer`, is a live-scan export from the native app captured on
2026-09-02; the remaining artifacts are deterministic ios-reference reviewer
exports.

Most scanner-fleet and provider-profile artifacts tracked in this folder are
deterministic reviewer-reference exports written by the native app's evidence
exporter. They document the app's user-facing decision surfaces, but they do
not constitute physical-device capture evidence. The exception is the
`green_verified_issuer` set (`accepted.png`, `history-accepted.png`,
`accessibility-accepted.txt`): the native app exported it after a live scan
against the demo verifier, and the trace records the verifier envelope id and
check time (`2026-09-02T11:00:15Z`). The exporter renders the decision card
from the scan result rather than grabbing the raw screen, so read it as an
app-rendered export of a live scan, not as a screen recording.

This folder is reserved for real iPhone screenshots, history-entry screenshots,
and accessibility text traces from the native end-user scanner.

The required evidence matrix is no longer the older three-outcome smoke set.
It is now derived from:

```text
docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json
```

That packet covers green, orange, and red scanner-visible states across
accepted, expiry, destination mismatch, resolver mismatch, plain URL,
verifier-unavailable, stale profile, and revoked profile cases.

The scope-honesty pass collapsed the pre-pass presentation-mode fixtures into a
single accepted fixture (`green_verified_issuer`), because the verifier keeps no
per-presentation state and every presentation of one envelope is evaluated the
same way. The pre-pass captures it replaces were retired rather than re-shot;
the merged fixture was exported from a live native-app scan on 2026-09-02 and
is the set described in the status note above.

Seven accessibility traces still tracked here also predate that pass:
`accessibility-expired.txt`, `accessibility-payload-mismatch.txt`,
`accessibility-plain-url-unrecognized.txt`, `accessibility-profile-revoked.txt`,
`accessibility-profile-stale.txt`,
`accessibility-resolver-final-target-mismatch.txt` and
`accessibility-verifier-unavailable-visible-destination.txt`. Each still prints
a `usage_policy:` line that `EvidenceExport.swift` no longer emits. Read those
lines as an artifact of the older build, not as current app behavior. They are
not edited or regenerated in place: they are replaced by the physical recapture
and `make import-iphone-evidence` step described below.

The `resolver-final-target-mismatch` set also predates the redirect-observer
boundary correction. It records the old deterministic fixture presentation,
where query-carried `final` and `hops` values were rendered as though observed.
It is not evidence of a live redirect walk and must not support that claim. A
current recapture should retain the legacy filenames for packet compatibility
but show red `unknown`, binding `redirect_unobserved`, cause
`resolution-unavailable`, and no observed final URL or hop count.

Before recording physical-device evidence, run:

```bash
make smoke-ios
make ios-provider-config
make check-ios-provider-config
make iphone-evidence-preflight
make scanner-release-evidence-packet
make iphone-evidence-packet
make iphone-evidence-status
```

The provider-config targets write and validate the ignored local Xcode provider
profile. The preflight target checks the live HTTPS endpoint, prints the primary
local verifier candidate, detects a paired physical iPhone, and reports whether
Developer Mode is enabled. The scanner release packet links both native evidence
packets, the scanner-fleet capture drill, and the deployed-scanner readiness
report. The iPhone packet creates an ignored local handoff under
`local/iphone-evidence-packet/` with the exact expected filenames.

## Artifact Types

Each scanner-fleet fixture requires three files:

- Result screenshot: the native app's user-facing decision surface.
- History screenshot: the corresponding History tab row after the scan.
- Accessibility trace: a short `.txt` capture of the user-facing labels exposed
  by VoiceOver or an accessibility review.

Use the exact filenames listed by:

```bash
make iphone-evidence-status
make scanner-release-evidence-todo
```

or in the local capture packet:

```text
local/iphone-evidence-packet/required-artifacts.tsv
```

## Provider Profile Evidence

Provider-profile evidence is separate from scanner-fleet evidence. It captures
native Settings and import screens proving active, stale, revoked, rejected, and
local-reviewer provider-profile states before scan decisions are produced.

Create the local capture packet first:

```bash
make ios-provider-profile-evidence-packet
```

Use the non-strict progress target while capture is pending:

```bash
make ios-provider-profile-evidence-status
make scanner-release-evidence-todo
```

The status output reports both local incoming artifacts under
`local/ios-provider-profile-evidence-packet/incoming/` and tracked artifacts
under `docs/public/evidence/iphone/`.

`make scanner-release-evidence-todo` combines scanner-fleet and
provider-profile evidence into one short handoff. Use it after each import to
see only the remaining capture cases, expected outcome colors, and exact
filenames that still block strict release readiness.

Evidence status is intentionally public-repo aware: a screenshot or
accessibility trace that exists locally but is not tracked by git is reported as
invalid rather than present. After importing physical-device evidence, stage and
commit the artifacts before relying on release-readiness counts.

Use the strict target only after the referenced screenshots and accessibility
traces are exported and tracked:

```bash
make check-ios-provider-profile-evidence
```

The provider-profile packet is declared at:

```text
docs/public/network-contracts/examples/ios-provider-profile-evidence-reference.json
```

The local packet writes the exact screenshot and accessibility-trace checklist
to:

```text
local/ios-provider-profile-evidence-packet/required-artifacts.tsv
```

Export pending native screenshots and accessibility traces into:

```text
local/ios-provider-profile-evidence-packet/incoming/
```

Then import them into the tracked evidence tree:

```bash
make import-ios-provider-profile-evidence IOS_PROVIDER_PROFILE_EVIDENCE_SOURCE_DIR=local/ios-provider-profile-evidence-packet/incoming
```

The importer validates PNG signatures, minimum evidence size, exact fixture
metadata, expected provider-profile state, expected status, user signal, and all
required accessibility labels before copying files into
`docs/public/evidence/iphone/`.

## Capture Rules

Use the iPhone app only to scan the laptop QR and show the user-facing result.
Do not use the iPhone Camera app, because it bypasses verifier logic.

Do not click the browser lab's `Check scanner decision` action before the phone
scan. That action posts to `/scanner/decisions`, so it records a lab-originated
scanner decision against the same envelope and spends part of that envelope's
scan budget before the device capture.

Use [IPHONE_TEST_PLAN.md](../../IPHONE_TEST_PLAN.md) for the manual device
drill.

## Import And Validate

If the iPhone app exports a mixed evidence folder containing scanner and
provider-profile artifacts, import any matching files with:

```bash
make import-scanner-release-evidence-export SCANNER_RELEASE_EVIDENCE_SOURCE_DIR=/path/to/exported-ios-evidence
```

If the export lands in the macOS Downloads folder, use the shortcut:

```bash
make scanner-release-evidence-downloads-status
make import-scanner-release-evidence-downloads
```

This incremental importer is the recommended workflow for physical-device
capture. It validates and copies files that match the reference packets, skips
missing files, skips already imported files, and then prints the remaining
scanner/provider evidence todo list.

The Downloads status command is read-only. Use it first when macOS has created
duplicate export names and you want to confirm which newest matching files will
be importable before copying anything into `docs/public/evidence/iphone`.
It also reads the newest `qrtrust-evidence-manifest.json` and warns when the
export appears to come from an older iOS build that does not include the
reviewer-reference fixtures required by the current release gate. If that
warning appears, rebuild and run the latest iOS app, open Settings, export the
evidence packet again, and rerun the status command before importing.
If the status command reports that no export was detected, it is checking the
wrong folder. Point `SCANNER_RELEASE_EVIDENCE_SOURCE_DIR` at the actual exported
QR Trust evidence folder rather than a parent such as `Downloads`, then run
`make scanner-release-evidence-export-status`.
The combined importer uses the same preflight check and stops before running
partial imports when the selected folder is not an exported QR Trust evidence
folder.

The importer also accepts macOS/iCloud duplicate-export filenames such as
`accepted 2.png` and `provider-profile-settings-active 3.png`,
so the exported folder does not need to be manually renamed before import. The
combined scanner-release importer prefers the newest matching file when those
duplicates are present in `~/Downloads`.

The native app exporter also writes deterministic reviewer-reference artifacts
for profile and provider states that should not require deleting/reinstalling
the app during evidence capture:

- stale verifier profile scanner outcome
- revoked verifier profile scanner outcome
- signed active provider-profile import
- unsigned non-local provider-profile rejection
- unsigned local reviewer-profile exception

These files are evidence-only reviewer fixtures. They document how the app
surfaces profile-state decisions, but they do not bypass the runtime scanner or
provider-profile state machine.

If scanner-fleet files are exported to a temporary folder first, import them
with:

```bash
make import-iphone-evidence IPHONE_EVIDENCE_SOURCE_DIR=/path/to/exported-iphone-evidence
```

The source folder must contain files with the exact basenames declared by the
scanner-fleet reference packet. Examples:

- `accepted.png`
- `history-accepted.png`
- `accessibility-accepted.txt`

Set `IPHONE_EVIDENCE_OVERWRITE=true` only when intentionally replacing existing
local evidence files.

After adding the artifacts, validate them with:

```bash
make iphone-evidence-status
make check-iphone-evidence
make release-readiness-report
make release-audit
make release-audit-strict
```

The strict evidence checker requires every referenced artifact to exist and be
larger than a trivial placeholder. It also validates PNG file signatures and
requires accessibility traces to name the expected fixture, decision color,
decision state, title, and message without placeholder text. It intentionally
fails until the full native scanner-fleet evidence packet has been captured and
tracked.
