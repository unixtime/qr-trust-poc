#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
OUTPUT_DIR="${SCANNER_RELEASE_EVIDENCE_PACKET_DIR:-local/scanner-release-evidence-packet}"
PACKET_FILE="${OUTPUT_DIR}/README.md"

mkdir -p "$OUTPUT_DIR"

sh "${REPO_ROOT}/scripts/iphone_evidence_packet.sh"
sh "${REPO_ROOT}/scripts/ios_provider_profile_evidence_packet.sh"

(
  cd "$REPO_ROOT/network"
  npm run scanner-fleet:capture-drill
  npm run verifier-profile:distribution-report
  npm run deployed-scanner:readiness-report
)

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

cat > "$PACKET_FILE" <<EOF
# Scanner Release Evidence Packet

Generated: ${timestamp}

This local packet is the single handoff for release-side scanner evidence. It
does not replace the detailed native capture packets. It points reviewers and
operators to the exact drill, import, status, and final audit commands needed
to move from the current evidence gap to a strict public-release pass.

## Generated Local Artifacts

- \`local/iphone-evidence-packet/README.md\`: physical iPhone scanner capture packet.
- \`local/ios-provider-profile-evidence-packet/README.md\`: native provider-profile capture packet.
- \`local/scanner-fleet-capture-drill.md\`: fixture-by-fixture lab URLs and capture order.
- \`local/verifier-profile-distribution-report.md\`: active scanner profile and policy gate report.
- \`local/verifier-profile-distribution-report.json\`: machine-readable verifier-profile distribution report.
- \`local/deployed-scanner-readiness-report.md\`: combined verifier-profile, scanner-fleet, and provider-profile readiness verdict.
- \`local/deployed-scanner-readiness-report.json\`: machine-readable deployed scanner readiness report.

For a short remaining-artifact checklist at any point, run:

\`\`\`bash
make scanner-release-evidence-todo
\`\`\`

## Setup Sequence

Run this before native capture:

\`\`\`bash
make smoke-ios
make up-https-admin-shared-infra
make ios-provider-config
make check-ios-provider-config
make iphone-evidence-preflight
make scanner-release-evidence-packet
make scanner-release-evidence-status
\`\`\`

Use the generated iPhone packet for scanner outcomes:

\`\`\`text
local/iphone-evidence-packet/README.md
\`\`\`

Use the generated provider-profile packet for configuration-state outcomes:

\`\`\`text
local/ios-provider-profile-evidence-packet/README.md
\`\`\`

Use the generated scanner-fleet drill to avoid consuming one-time QR state from
the wrong surface:

\`\`\`text
local/scanner-fleet-capture-drill.md
\`\`\`

## Capture Rule

For one-time QR cases, scan with the native iPhone app before running browser
or curl checks against the same artifact. Browser preview checks can consume
one-time state and produce misleading replay evidence.

For reusable public QR cases, repeat scans are expected to stay reusable while
the issuer, destination-binding, and runtime-safety layers remain valid.

## Import Sequence

After copying exported screenshots, recordings, and accessibility traces into
the two packet \`incoming/\` folders, run:

\`\`\`bash
make scanner-release-evidence-downloads-status
make import-scanner-release-evidence-downloads
make import-scanner-release-evidence-export SCANNER_RELEASE_EVIDENCE_SOURCE_DIR=/path/to/exported-ios-evidence
make import-iphone-evidence IPHONE_EVIDENCE_SOURCE_DIR=local/iphone-evidence-packet/incoming
make import-ios-provider-profile-evidence IOS_PROVIDER_PROFILE_EVIDENCE_SOURCE_DIR=local/ios-provider-profile-evidence-packet/incoming
make scanner-release-evidence-todo
make scanner-release-evidence-status
make release-readiness-report
make release-audit
make release-audit-strict
\`\`\`

The combined importer is the easiest path for iPhone app exports: it accepts a
single folder, imports any scanner-fleet or provider-profile artifacts present,
skips already imported files, accepts macOS duplicate-export filenames such as
\`accepted-reusable-public 2.png\`, and prints the remaining capture list.
The Downloads status command is read-only and should be run first when you need
to confirm whether the latest iOS export has synced to this Mac.

## Readiness Meaning

- \`make release-audit\` should pass before public handoff, but may warn while
  native evidence is missing.
- \`make release-audit-strict\` must fail until all native scanner and
  provider-profile artifacts are tracked and validated.
- \`make network-deployed-scanner-readiness-report\` should report
  \`native_evidence_incomplete\` until both evidence sets are complete.
- A public release should not claim production readiness, standards status, or
  completed deployed-scanner evidence until the strict audit passes.

## Final Review Commands

\`\`\`bash
make scanner-release-evidence-status
make network-verifier-profile-distribution-report
make network-deployed-scanner-readiness-report
make release-readiness-report
make release-audit
make release-audit-strict
\`\`\`
EOF

printf "Scanner release evidence packet written to %s\n" "$PACKET_FILE"
