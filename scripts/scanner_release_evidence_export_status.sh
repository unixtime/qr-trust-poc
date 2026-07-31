#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SOURCE_DIR="${1:-${SCANNER_RELEASE_EVIDENCE_SOURCE_DIR:-}}"
SCANNER_PACKET="${QRTRUST_SCANNER_FLEET_EVIDENCE_PACKET:-docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json}"
PROVIDER_PACKET="${QRTRUST_IOS_PROVIDER_PROFILE_EVIDENCE_PACKET:-docs/public/network-contracts/examples/ios-provider-profile-evidence-reference.json}"

usage() {
  cat <<'EOF'
Usage:
  sh scripts/scanner_release_evidence_export_status.sh /path/to/exported-ios-evidence
  make scanner-release-evidence-downloads-status

This checks whether a native iOS evidence export folder contains artifacts that
match the scanner-fleet and provider-profile reference packets. It does not copy
or modify evidence files.
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

case "$SCANNER_PACKET" in
  /*) SCANNER_PACKET_ABS="$SCANNER_PACKET" ;;
  *) SCANNER_PACKET_ABS="${REPO_ROOT}/${SCANNER_PACKET}" ;;
esac

case "$PROVIDER_PACKET" in
  /*) PROVIDER_PACKET_ABS="$PROVIDER_PACKET" ;;
  *) PROVIDER_PACKET_ABS="${REPO_ROOT}/${PROVIDER_PACKET}" ;;
esac

node - "$SOURCE_DIR" "$SCANNER_PACKET_ABS" "$PROVIDER_PACKET_ABS" <<'NODE'
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

function expectedScannerArtifacts(packet) {
  return packet.evidence_rows.flatMap((row) => [
    { fixture: row.fixture_id, kind: "screenshot", filename: path.basename(row.screenshot_ref) },
    { fixture: row.fixture_id, kind: "history", filename: path.basename(row.history_entry_ref) },
    { fixture: row.fixture_id, kind: "accessibility", filename: path.basename(row.accessibility_ref) },
  ])
}

function expectedProviderArtifacts(packet) {
  return packet.evidence_rows.flatMap((row) => [
    { fixture: row.fixture_id, kind: "screenshot", filename: path.basename(row.screenshot_ref) },
    { fixture: row.fixture_id, kind: "accessibility", filename: path.basename(row.accessibility_ref) },
  ])
}

function matchingFiles(filename) {
  const parsed = path.parse(filename)
  const pattern = new RegExp(`^${escapeRegExp(parsed.name)}(?:[ ]\\d+|[ ]\\(\\d+\\))?${escapeRegExp(parsed.ext)}$`)

  return fs.readdirSync(sourceDir)
    .filter((entry) => pattern.test(entry))
    .map((entry) => {
      const fullPath = path.join(sourceDir, entry)
      return { entry, mtimeMs: fs.statSync(fullPath).mtimeMs }
    })
    .sort((left, right) => {
      if (right.mtimeMs !== left.mtimeMs) {
        return right.mtimeMs - left.mtimeMs
      }
      return right.entry.localeCompare(left.entry)
    })
}

function newestManifest() {
  return fs.readdirSync(sourceDir)
    .filter((entry) => /^qrtrust-evidence-manifest(?:[ ]\d+|[ ]\(\d+\))?\.json$/.test(entry))
    .map((entry) => ({ entry, mtimeMs: fs.statSync(path.join(sourceDir, entry)).mtimeMs }))
    .sort((left, right) => {
      if (right.mtimeMs !== left.mtimeMs) {
        return right.mtimeMs - left.mtimeMs
      }
      return right.entry.localeCompare(left.entry)
    })[0]
}

function readManifestEntries(manifest) {
  if (!manifest) {
    return []
  }

  try {
    const parsed = readJson(path.join(sourceDir, manifest.entry))
    return Array.isArray(parsed.entries) ? parsed.entries : []
  } catch {
    return []
  }
}

function requiredFixtureIds(packetPath) {
  return readJson(packetPath).evidence_rows.map((row) => row.fixture_id)
}

const expected = [
  ...expectedScannerArtifacts(readJson(scannerPacketPath)).map((artifact) => ({ group: "scanner", ...artifact })),
  ...expectedProviderArtifacts(readJson(providerPacketPath)).map((artifact) => ({ group: "provider", ...artifact })),
]

const matches = expected.map((artifact) => ({
  ...artifact,
  matches: matchingFiles(artifact.filename),
}))
const present = matches.filter((artifact) => artifact.matches.length > 0)
const missing = matches.filter((artifact) => artifact.matches.length === 0)
const manifest = newestManifest()
const manifestEntries = readManifestEntries(manifest)
const manifestFixtureIds = new Set(manifestEntries.map((entry) => entry.fixture_id).filter(Boolean))
const requiredReviewerFixtures = [
  "orange_stale_verifier_profile",
  "red_revoked_verifier_profile",
  "signed_profile_import_active",
  "unsigned_nonlocal_profile_rejected",
  "unsigned_local_reviewer_profile_allowed",
]
const missingReviewerFixtures = requiredReviewerFixtures.filter((fixture) => !manifestFixtureIds.has(fixture))
const requiredFixtures = [
  ...requiredFixtureIds(scannerPacketPath).map((fixture) => ({ group: "scanner", fixture })),
  ...requiredFixtureIds(providerPacketPath).map((fixture) => ({ group: "provider", fixture })),
]
const missingManifestFixtures = manifest
  ? requiredFixtures.filter((required) => !manifestFixtureIds.has(required.fixture))
  : []

console.log("Scanner release evidence export status")
console.log(`Source folder: ${sourceDir}`)
console.log(`Newest manifest: ${manifest ? manifest.entry : "not found"}`)
console.log(`Manifest fixtures: ${manifestEntries.length > 0 ? manifestFixtureIds.size : "not available"}/${requiredFixtures.length}`)
console.log(`Matching artifacts: ${present.length}/${expected.length}`)

if (!manifest && present.length === 0) {
  console.log("\nNo export detected:")
  console.log("- The selected folder does not contain a QR Trust evidence manifest or any expected artifact filenames.")
  console.log("- If the iPhone saved an evidence folder, rerun this command with that folder instead of its parent.")
  console.log("- Example: make scanner-release-evidence-export-status SCANNER_RELEASE_EVIDENCE_SOURCE_DIR=/path/to/QRTrustEvidence")
}

if (manifest && missingReviewerFixtures.length > 0) {
  console.log("\nExport compatibility warning:")
  console.log("- The newest manifest is missing reviewer-reference fixtures required by the current release gate.")
  console.log("- This usually means the iOS app was exported from an older build.")
  for (const fixture of missingReviewerFixtures) {
    console.log(`  - ${fixture}`)
  }
  console.log("- Rebuild and run the latest iOS app, open Settings, export the evidence packet again, then rerun this command.")
}

if (manifest && missingManifestFixtures.length > 0 && missingReviewerFixtures.length === 0) {
  console.log("\nManifest coverage note:")
  console.log("- The newest manifest does not list every release-reference fixture. This is acceptable for incremental exports, but the missing files below still block strict release readiness.")
}

if (present.length > 0) {
  console.log("\nReady to import:")
  for (const artifact of present) {
    console.log(`- ${artifact.group}/${artifact.fixture}/${artifact.kind}: ${artifact.matches[0].entry}`)
  }
}

if (missing.length > 0) {
  console.log("\nStill missing from source folder:")
  for (const artifact of missing) {
    console.log(`- ${artifact.group}/${artifact.fixture}/${artifact.kind}: ${artifact.filename}`)
  }
}

console.log("\nNext commands:")
if (present.length > 0) {
  console.log("- make import-scanner-release-evidence-downloads")
  console.log("- make scanner-release-evidence-todo")
} else {
  console.log("- Export evidence from the iOS Settings tab, or point SCANNER_RELEASE_EVIDENCE_SOURCE_DIR at the exported evidence folder, then rerun this status command.")
}
NODE
