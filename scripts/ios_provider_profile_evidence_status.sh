#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PACKET_DIR="${IOS_PROVIDER_PROFILE_EVIDENCE_PACKET_DIR:-local/ios-provider-profile-evidence-packet}"
INCOMING_DIR="${PACKET_DIR}/incoming"
PACKET_PATH="${QRTRUST_IOS_PROVIDER_PROFILE_EVIDENCE_PACKET:-docs/public/network-contracts/examples/ios-provider-profile-evidence-reference.json}"

case "$PACKET_PATH" in
  /*) PACKET_ABS="$PACKET_PATH" ;;
  *) PACKET_ABS="${REPO_ROOT}/${PACKET_PATH}" ;;
esac

printf "Native iOS provider-profile evidence status\n"
printf "Repository: %s\n" "${REPO_ROOT}"
printf "Packet: %s\n" "$PACKET_DIR"
printf "Incoming: %s\n\n" "$INCOMING_DIR"

if [ -f "${REPO_ROOT}/${PACKET_DIR}/README.md" ]; then
  printf "PASS: local provider-profile capture packet exists\n"
else
  printf "TODO: local provider-profile capture packet is missing; run make ios-provider-profile-evidence-packet\n"
fi

if [ -d "${REPO_ROOT}/${INCOMING_DIR}" ]; then
  printf "PASS: provider-profile incoming folder exists\n"
else
  printf "TODO: provider-profile incoming folder is missing; run make ios-provider-profile-evidence-packet\n"
fi

printf "\nIncoming capture status:\n"
if [ -f "$PACKET_ABS" ]; then
  node - "$PACKET_ABS" "${REPO_ROOT}/${INCOMING_DIR}" <<'NODE'
const fs = require("node:fs")
const path = require("node:path")
const packet = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
const incomingDir = process.argv[3]

const rows = packet.evidence_rows.flatMap((row) => [
  {
    fixtureId: row.fixture_id,
    kind: "screenshot",
    refPath: row.screenshot_ref,
  },
  {
    fixtureId: row.fixture_id,
    kind: "accessibility",
    refPath: row.accessibility_ref,
  },
])

let present = 0
const missing = []

for (const row of rows) {
  const incomingPath = path.join(incomingDir, path.basename(row.refPath))
  if (fs.existsSync(incomingPath)) {
    present += 1
    const size = fs.statSync(incomingPath).size
    console.log(`- ${row.fixtureId} / ${row.kind}: present (${size} bytes)`)
  } else {
    missing.push(row)
  }
}

console.log(`\nLocal incoming artifacts: ${present}/${rows.length} present`)

if (missing.length > 0) {
  console.log("\nMissing incoming artifacts:")
  for (const row of missing) {
    console.log(`- ${row.fixtureId} / ${row.kind}: ${path.basename(row.refPath)}`)
  }
}
NODE
else
  printf "TODO: provider-profile evidence packet is missing: %s\n" "$PACKET_ABS"
fi

printf "\nTracked evidence status:\n"
(
  cd "${REPO_ROOT}/network"
  npm run ios-provider-profile:evidence-artifacts-status -- --text
)

printf "\nImport note:\n"
printf "  Copy exported provider-profile screenshots and traces into %s, then run:\n" "$INCOMING_DIR"
printf "  make import-ios-provider-profile-evidence IOS_PROVIDER_PROFILE_EVIDENCE_SOURCE_DIR=%s\n" "$INCOMING_DIR"
