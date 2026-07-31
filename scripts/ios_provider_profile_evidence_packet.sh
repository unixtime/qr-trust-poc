#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
OUTPUT_DIR="${IOS_PROVIDER_PROFILE_EVIDENCE_PACKET_DIR:-local/ios-provider-profile-evidence-packet}"
INCOMING_DIR="${OUTPUT_DIR}/incoming"
ACCESSIBILITY_TEMPLATE_DIR="${OUTPUT_DIR}/accessibility-templates"
PACKET_FILE="${OUTPUT_DIR}/README.md"
REQUIRED_ARTIFACTS_FILE="${OUTPUT_DIR}/required-artifacts.tsv"
PACKET_JSON="${QRTRUST_IOS_PROVIDER_PROFILE_EVIDENCE_PACKET:-docs/public/network-contracts/examples/ios-provider-profile-evidence-reference.json}"

case "$PACKET_JSON" in
  /*) PACKET_JSON_ABS="$PACKET_JSON" ;;
  *) PACKET_JSON_ABS="${REPO_ROOT}/${PACKET_JSON}" ;;
esac

if [ ! -f "$PACKET_JSON_ABS" ]; then
  printf "Missing iOS provider-profile evidence packet: %s\n" "$PACKET_JSON_ABS" >&2
  exit 1
fi

mkdir -p "$INCOMING_DIR" "$ACCESSIBILITY_TEMPLATE_DIR"

node -e '
const fs = require("node:fs")
const packet = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))

console.log([
  "fixture_id",
  "profile_state",
  "expected_status",
  "expected_user_signal",
  "kind",
  "path",
  "filename",
  "required_labels",
].join("\t"))

for (const row of packet.evidence_rows) {
  const refs = [
    ["screenshot", row.screenshot_ref],
    ["accessibility", row.accessibility_ref],
  ]

  for (const [kind, refPath] of refs) {
    const filename = refPath.split("/").pop()
    console.log([
      row.fixture_id,
      row.profile_state,
      row.expected_status,
      row.expected_user_signal,
      kind,
      refPath,
      filename,
      row.required_labels.join(" | "),
    ].join("\t"))
  }
}
' "$PACKET_JSON_ABS" > "$REQUIRED_ARTIFACTS_FILE"

node -e '
const fs = require("node:fs")
const path = require("node:path")
const packet = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
const outputDir = process.argv[2]

fs.mkdirSync(outputDir, { recursive: true })

for (const row of packet.evidence_rows) {
  const filename = path.basename(row.accessibility_ref)
  const lines = [
    `fixture_id: ${row.fixture_id}`,
    `profile_state: ${row.profile_state}`,
    `expected_status: ${row.expected_status}`,
    `expected_user_signal: ${row.expected_user_signal}`,
    "title: REPLACE WITH OBSERVED PROVIDER STATUS TITLE",
    "message: REPLACE WITH OBSERVED PROVIDER STATUS MESSAGE",
    "required labels observed:",
    ...row.required_labels.map((label) => `- ${label}`),
    "notes: Replace this line with capture notes.",
  ]

  fs.writeFileSync(path.join(outputDir, filename), `${lines.join("\n")}\n`)
}
' "$PACKET_JSON_ABS" "$ACCESSIBILITY_TEMPLATE_DIR"

cat > "$PACKET_FILE" <<EOF
# iOS Provider Profile Evidence Capture Packet

This local packet is a handoff for native iPhone provider-profile capture. It
is intentionally written under \`local/\` and should not be tracked.

Provider-profile evidence proves the scanner configuration boundary: which
managed verifier profile the iOS app is using before it produces scanner-visible
green, orange, or red decisions.

The expected evidence matrix follows:

\`\`\`text
${PACKET_JSON}
\`\`\`

## Runtime Setup

\`\`\`bash
make smoke-ios
make ios-provider-profile-fixture
make check-ios-provider-profile-fixture
make ios-provider-config
make check-ios-provider-config
make ios-provider-profile-evidence-status
\`\`\`

Open:

\`\`\`text
ios/VerifierLabApp/VerifierLabApp.xcodeproj
\`\`\`

Run the app on a physical iPhone or simulator. Capture the provider-profile
import and Settings states from the native app. Do not substitute browser
screenshots, backend logs, or raw local endpoint dumps for this evidence.

## Required Evidence Matrix

Each fixture needs two artifacts:

- Screenshot: the native provider-profile import or Settings state.
- Accessibility: a short text trace of the user-facing labels VoiceOver or an
  accessibility review exposes for that state.

The exact artifact list is available as TSV at:

\`\`\`text
${REQUIRED_ARTIFACTS_FILE}
\`\`\`

## Put Exports Here

Copy exported screenshots and accessibility traces into:

\`\`\`text
${INCOMING_DIR}
\`\`\`

Use the exact filenames listed in \`required-artifacts.tsv\`.

Accessibility templates are generated at:

\`\`\`text
${ACCESSIBILITY_TEMPLATE_DIR}
\`\`\`

Copy each template into \`${INCOMING_DIR}\` only after replacing every
\`REPLACE ...\` placeholder with observed app labels. The strict evidence check
rejects placeholder text, missing fixture metadata, missing status metadata, and
PNG files that are too small or not valid PNGs.

## Validate

After copying the files into \`${INCOMING_DIR}\`, import them into the tracked
evidence folder with:

\`\`\`bash
make import-ios-provider-profile-evidence IOS_PROVIDER_PROFILE_EVIDENCE_SOURCE_DIR=${INCOMING_DIR}
\`\`\`

Then run:

\`\`\`bash
make ios-provider-profile-evidence-status
make check-ios-provider-profile-evidence
\`\`\`

The strict check should pass only after every referenced screenshot and
accessibility trace is tracked under \`docs/public/evidence/iphone/\`.
EOF

printf "iOS provider-profile evidence packet written to %s\n" "$PACKET_FILE"
printf "Required artifact list written to %s\n" "$REQUIRED_ARTIFACTS_FILE"
printf "Accessibility trace templates written to %s\n" "$ACCESSIBILITY_TEMPLATE_DIR"
printf "Copy exported provider-profile screenshots and traces into %s\n" "$INCOMING_DIR"
