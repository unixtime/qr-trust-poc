#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
OUTPUT_DIR="${IPHONE_EVIDENCE_PACKET_DIR:-local/iphone-evidence-packet}"
INCOMING_DIR="${OUTPUT_DIR}/incoming"
ACCESSIBILITY_TEMPLATE_DIR="${OUTPUT_DIR}/accessibility-templates"
PACKET_FILE="${OUTPUT_DIR}/README.md"
REQUIRED_ARTIFACTS_FILE="${OUTPUT_DIR}/required-artifacts.tsv"
PACKET_JSON="${QRTRUST_SCANNER_FLEET_EVIDENCE_PACKET:-docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json}"

case "$PACKET_JSON" in
  /*) PACKET_JSON_ABS="$PACKET_JSON" ;;
  *) PACKET_JSON_ABS="${REPO_ROOT}/${PACKET_JSON}" ;;
esac

detect_lan_ip() {
  if command -v networksetup >/dev/null 2>&1; then
    networksetup -getinfo Wi-Fi 2>/dev/null \
      | awk -F': ' '/^IP address: / && $2 != "" && $2 != "none" { print $2; exit }'
  fi

  for iface in en0 en1; do
    ifconfig "$iface" 2>/dev/null \
      | awk '/[[:space:]]inet[[:space:]]/ && $2 != "127.0.0.1" { print $2; exit }'
  done
}

write_required_artifacts_tsv() {
  node -e '
const fs = require("node:fs")
const packet = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))

console.log(["fixture_id", "decision_color", "decision_state", "kind", "path"].join("\t"))
for (const row of packet.evidence_rows) {
  const refs = [
    ["screenshot", row.screenshot_ref],
    ["history_entry", row.history_entry_ref],
    ["accessibility", row.accessibility_ref],
  ]

  for (const [kind, refPath] of refs) {
    console.log([row.fixture_id, row.decision_color, row.decision_state, kind, refPath].join("\t"))
  }
}
' "$PACKET_JSON_ABS"
}

write_required_artifacts_markdown() {
  node -e '
const fs = require("node:fs")
const packet = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))

console.log("| Fixture | Expected color | Expected state | Artifact | Filename |")
console.log("| --- | --- | --- | --- | --- |")
for (const row of packet.evidence_rows) {
  const refs = [
    ["Screenshot", row.screenshot_ref],
    ["History", row.history_entry_ref],
    ["Accessibility", row.accessibility_ref],
  ]

  for (const [kind, refPath] of refs) {
    console.log(`| \`${row.fixture_id}\` | ${row.decision_color} | \`${row.decision_state}\` | ${kind} | \`${refPath.split("/").pop()}\` |`)
  }
}
' "$PACKET_JSON_ABS"
}

write_accessibility_templates() {
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
    `decision_state: ${row.decision_state}`,
    `decision_color: ${row.decision_color}`,
    "screen: Scan result",
    `status: ${row.decision_color} status`,
    "title: REPLACE WITH OBSERVED RESULT TITLE",
    "message: REPLACE WITH OBSERVED RESULT MESSAGE",
    "destination: REPLACE WITH OBSERVED DESTINATION OR none",
    "actions:",
    "- REPLACE WITH OBSERVED PRIMARY ACTION",
    "- REPLACE WITH OBSERVED SECONDARY ACTION OR none",
    "notes: Replace this line with capture notes.",
  ]

  fs.writeFileSync(path.join(outputDir, filename), `${lines.join("\n")}\n`)
}
' "$PACKET_JSON_ABS" "$ACCESSIBILITY_TEMPLATE_DIR"
}

if [ ! -f "$PACKET_JSON_ABS" ]; then
  printf "Missing scanner-fleet evidence packet: %s\n" "$PACKET_JSON_ABS" >&2
  exit 1
fi

LAN_IP="${IPHONE_LAN_IP:-$(detect_lan_ip | head -n 1 || true)}"
if [ -n "$LAN_IP" ]; then
  LAB_URL="https://${LAN_IP}:5174/lab"
else
  LAB_URL="https://<your-mac-lan-ip>:5174/lab"
fi

mkdir -p "$INCOMING_DIR" "$ACCESSIBILITY_TEMPLATE_DIR"
write_required_artifacts_tsv > "$REQUIRED_ARTIFACTS_FILE"
write_accessibility_templates

cat > "$PACKET_FILE" <<EOF
# Native iPhone Evidence Capture Packet

This local packet is a handoff for physical iPhone capture. It is intentionally
written under \`local/\` and should not be tracked.

The expected evidence matrix now follows the scanner-fleet packet:

\`\`\`text
${PACKET_JSON}
\`\`\`

## Runtime Setup

\`\`\`bash
make smoke-ios
make up-https-admin-shared-infra FRONTEND_PUBLISH_PORT=5174
make iphone-evidence-preflight
make scanner-fleet-capture-drill
make iphone-evidence-status
\`\`\`

Open:

\`\`\`text
ios/VerifierLabApp/VerifierLabApp.xcodeproj
\`\`\`

Run the app on a physical iPhone connected to the same Wi-Fi as this Mac.
If preflight reports Developer Mode as disabled, enable it on the phone before
running the app from Xcode.

For local physical-device testing, generate the ignored Xcode provider profile
before rebuilding the app:

\`\`\`bash
make ios-provider-config
make check-ios-provider-config
\`\`\`

The provider profile embeds the local HTTPS verifier candidates into the build.
This is a developer-side local lab setting, not an end-user app field.

## App And Browser Setup

The current iOS app is an end-user scanner. It does not expose verifier URLs,
admin tokens, API keys, or scenario controls to the user.

Use the browser lab on the laptop to generate the QR artifacts:

\`\`\`text
${LAB_URL}
\`\`\`

Use the iPhone app only to scan the laptop QR and show the user-facing result.
Do not click the browser lab's \`Check scanner decision\` action before the
phone scan, because scanner-preview checks can consume one-time QR state.

For fixture-by-fixture lab URLs, special setup, and capture order, generate:

\`\`\`bash
QRTRUST_SCANNER_LAB_BASE_URL=${LAB_URL} make scanner-fleet-capture-drill
\`\`\`

Then open:

\`\`\`text
local/scanner-fleet-capture-drill.md
\`\`\`

## Required Evidence Matrix

Each fixture needs three artifacts:

- Screenshot: the native result screen.
- History: the matching History tab entry.
- Accessibility: a short text trace of the user-facing labels VoiceOver or
  accessibility review exposes for the result.

EOF

write_required_artifacts_markdown >> "$PACKET_FILE"

cat >> "$PACKET_FILE" <<EOF

The same list is available as TSV at:

\`\`\`text
${REQUIRED_ARTIFACTS_FILE}
\`\`\`

## Put Exports Here

Copy the exported files into:

\`\`\`text
${INCOMING_DIR}
\`\`\`

Use the exact filenames listed above. The importer copies those files into the
public evidence folder using the paths declared by the scanner-fleet packet.

Accessibility templates are generated at:

\`\`\`text
${ACCESSIBILITY_TEMPLATE_DIR}
\`\`\`

Copy each template into \`${INCOMING_DIR}\` only after replacing every
\`REPLACE ...\` placeholder with observed app labels. The importer and strict
status checker reject placeholder text, missing fixture metadata, and
accessibility traces whose decision color or state does not match the packet.

## Import And Validate

From the repository root:

\`\`\`bash
make import-iphone-evidence IPHONE_EVIDENCE_SOURCE_DIR=${INCOMING_DIR}
git add docs/public/evidence/iphone
make iphone-evidence-status
make check-iphone-evidence
make release-audit
make release-audit-strict
\`\`\`

Strict audit should pass only after every referenced screenshot, history image,
and accessibility text trace is tracked.
EOF

printf "Native iPhone evidence packet written to %s\n" "$PACKET_FILE"
printf "Required artifact list written to %s\n" "$REQUIRED_ARTIFACTS_FILE"
printf "Accessibility trace templates written to %s\n" "$ACCESSIBILITY_TEMPLATE_DIR"
printf "Copy exported screenshots, history entries, and accessibility traces into %s\n" "$INCOMING_DIR"
