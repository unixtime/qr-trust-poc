#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SOURCE_DIR="${1:-${SCANNER_RELEASE_EVIDENCE_SOURCE_DIR:-}}"

usage() {
  cat <<'EOF'
Usage:
  sh scripts/import_scanner_release_evidence_export.sh /path/to/exported-ios-evidence
  make import-scanner-release-evidence-downloads

This imports any matching native iOS evidence artifacts from one exported folder
into both scanner-fleet and provider-profile evidence destinations. Missing
artifacts are skipped so evidence can be captured across multiple phone runs.
If duplicate macOS export names exist in the source folder, the newest matching
artifact is selected.

Set SCANNER_RELEASE_EVIDENCE_OVERWRITE=true to replace existing destination
artifacts.
EOF
}

if [ -z "$SOURCE_DIR" ]; then
  usage
  exit 2
fi

if [ ! -d "$SOURCE_DIR" ]; then
  printf "FAIL: source directory does not exist: %s\n" "$SOURCE_DIR"
  usage
  exit 1
fi

case "${SCANNER_RELEASE_EVIDENCE_OVERWRITE:-false}" in
  true) overwrite=true ;;
  *) overwrite=false ;;
esac

printf "Importing scanner release evidence export from %s\n" "$SOURCE_DIR"

node - "$SOURCE_DIR" \
  "$REPO_ROOT/docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json" \
  "$REPO_ROOT/docs/public/network-contracts/examples/ios-provider-profile-evidence-reference.json" <<'NODE'
const fs = require("node:fs")
const path = require("node:path")

const sourceDir = process.argv[2]
const scannerPacketPath = process.argv[3]
const providerPacketPath = process.argv[4]

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function expectedFilenames(packetPath, fields) {
  return readJson(packetPath).evidence_rows.flatMap((row) =>
    fields.map((field) => path.basename(row[field]))
  )
}

function matchesExpectedFilename(entry, expectedFilename) {
  const parsed = path.parse(expectedFilename)
  const pattern = new RegExp(`^${escapeRegExp(parsed.name)}(?:[ ]\\d+|[ ]\\(\\d+\\))?${escapeRegExp(parsed.ext)}$`)
  return pattern.test(entry)
}

const entries = fs.readdirSync(sourceDir)
const manifestFound = entries.some((entry) => /^qrtrust-evidence-manifest(?:[ ]\d+|[ ]\(\d+\))?\.json$/.test(entry))
const expected = [
  ...expectedFilenames(scannerPacketPath, ["screenshot_ref", "history_entry_ref", "accessibility_ref"]),
  ...expectedFilenames(providerPacketPath, ["screenshot_ref", "accessibility_ref"]),
]
const matchingArtifacts = entries.filter((entry) =>
  expected.some((expectedFilename) => matchesExpectedFilename(entry, expectedFilename))
)

if (!manifestFound && matchingArtifacts.length === 0) {
  console.log("")
  console.log("FAIL: no QR Trust evidence export detected in source folder.")
  console.log("The selected folder does not contain a manifest or any expected release evidence filenames.")
  console.log("Point SCANNER_RELEASE_EVIDENCE_SOURCE_DIR at the exported QR Trust evidence folder, then rerun:")
  console.log("  make scanner-release-evidence-export-status SCANNER_RELEASE_EVIDENCE_SOURCE_DIR=/path/to/exported-ios-evidence")
  process.exit(1)
}
NODE

printf "\n--- Scanner-fleet artifacts ---\n"
IPHONE_EVIDENCE_ALLOW_PARTIAL=true \
IPHONE_EVIDENCE_SKIP_EXISTING=true \
IPHONE_EVIDENCE_OVERWRITE="$overwrite" \
QRTRUST_EVIDENCE_IMPORT_PREFER_NEWEST=true \
  sh "$REPO_ROOT/scripts/import_iphone_evidence.sh" "$SOURCE_DIR"

printf "\n--- Provider-profile artifacts ---\n"
IOS_PROVIDER_PROFILE_EVIDENCE_ALLOW_PARTIAL=true \
IOS_PROVIDER_PROFILE_EVIDENCE_SKIP_EXISTING=true \
IOS_PROVIDER_PROFILE_EVIDENCE_OVERWRITE="$overwrite" \
QRTRUST_EVIDENCE_IMPORT_PREFER_NEWEST=true \
  sh "$REPO_ROOT/scripts/import_ios_provider_profile_evidence.sh" "$SOURCE_DIR"

printf "\n--- Remaining evidence todo ---\n"
sh "$REPO_ROOT/scripts/scanner_release_evidence_todo.sh"
