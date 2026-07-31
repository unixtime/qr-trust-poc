#!/usr/bin/env sh
set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SCANNER_PACKET="${QRTRUST_SCANNER_FLEET_EVIDENCE_PACKET:-docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json}"
PROVIDER_PACKET="${QRTRUST_IOS_PROVIDER_PROFILE_EVIDENCE_PACKET:-docs/public/network-contracts/examples/ios-provider-profile-evidence-reference.json}"
IPHONE_EVIDENCE_DIR="${IPHONE_EVIDENCE_DIR:-docs/public/evidence/iphone}"

case "$SCANNER_PACKET" in
  /*) SCANNER_PACKET_ABS="$SCANNER_PACKET" ;;
  *) SCANNER_PACKET_ABS="${REPO_ROOT}/${SCANNER_PACKET}" ;;
esac

case "$PROVIDER_PACKET" in
  /*) PROVIDER_PACKET_ABS="$PROVIDER_PACKET" ;;
  *) PROVIDER_PACKET_ABS="${REPO_ROOT}/${PROVIDER_PACKET}" ;;
esac

node - "$REPO_ROOT" "$SCANNER_PACKET_ABS" "$PROVIDER_PACKET_ABS" "$IPHONE_EVIDENCE_DIR" <<'NODE'
const fs = require("node:fs")
const path = require("node:path")
const { execFileSync } = require("node:child_process")

const repoRoot = process.argv[2]
const scannerPacketPath = process.argv[3]
const providerPacketPath = process.argv[4]
const evidenceDir = process.argv[5]

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"))
}

function artifactStatus(refPath) {
  const absolute = path.join(repoRoot, refPath)
  const exists = fs.existsSync(absolute)
  const tracked = exists && isGitTracked(refPath)

  return {
    refPath,
    basename: path.basename(refPath),
    exists,
    tracked,
    present: exists && tracked,
  }
}

function isGitTracked(refPath) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", refPath], {
      cwd: repoRoot,
      stdio: "ignore",
    })
    return true
  } catch {
    return false
  }
}

function countArtifacts(groups) {
  const artifacts = groups.flatMap((group) => group.artifacts)
  const present = artifacts.filter((artifact) => artifact.present).length
  const existing = artifacts.filter((artifact) => artifact.exists).length
  const untracked = artifacts.filter((artifact) => artifact.exists && !artifact.tracked).length
  const missing = artifacts.filter((artifact) => !artifact.exists).length

  return { present, existing, untracked, missing, total: artifacts.length }
}

function scannerGroups(packet) {
  return packet.evidence_rows.map((row) => ({
    type: "scanner",
    fixtureId: row.fixture_id,
    state: row.decision_state,
    color: row.decision_color,
    artifacts: [
      { kind: "screenshot", ...artifactStatus(row.screenshot_ref) },
      { kind: "history", ...artifactStatus(row.history_entry_ref) },
      { kind: "accessibility", ...artifactStatus(row.accessibility_ref) },
    ],
  }))
}

function providerGroups(packet) {
  return packet.evidence_rows.map((row) => ({
    type: "provider",
    fixtureId: row.fixture_id,
    state: row.profile_state,
    color: row.expected_user_signal,
    artifacts: [
      { kind: "screenshot", ...artifactStatus(row.screenshot_ref) },
      { kind: "accessibility", ...artifactStatus(row.accessibility_ref) },
    ],
  }))
}

const scannerHints = {
  orange_stale_verifier_profile: [
    "Export path: open the iOS Settings tab and export the current evidence packet.",
    "The app exporter includes this reviewer-reference scanner fixture so stale profile handling can be regenerated without reinstalling the app.",
    "Evidence note: this is an export-only reviewer artifact; it does not bypass runtime scanner decisions.",
  ],
  red_revoked_verifier_profile: [
    "Export path: open the iOS Settings tab and export the current evidence packet.",
    "The app exporter includes this reviewer-reference scanner fixture so revoked profile handling can be regenerated without reinstalling the app.",
    "Evidence note: this is an export-only reviewer artifact; it does not bypass runtime scanner decisions.",
  ],
}

const providerHints = {
  signed_profile_import_active: [
    "Export path: open the iOS Settings tab and export the current evidence packet.",
    "The app exporter includes this reviewer-reference provider fixture for signed active profile import.",
    "Evidence note: this is an export-only reviewer artifact; runtime profile import still uses app state.",
  ],
  unsigned_nonlocal_profile_rejected: [
    "Export path: open the iOS Settings tab and export the current evidence packet.",
    "The app exporter includes this reviewer-reference provider fixture for unsigned non-local profile rejection.",
    "Evidence note: this is an export-only reviewer artifact; runtime profile import still uses app state.",
  ],
  unsigned_local_reviewer_profile_allowed: [
    "Export path: open the iOS Settings tab and export the current evidence packet.",
    "The app exporter includes this reviewer-reference provider fixture for the unsigned local reviewer exception.",
    "Evidence note: this is an export-only reviewer artifact; runtime profile import still uses app state.",
  ],
}

function printMissingGroup(group) {
  const pending = group.artifacts.filter((artifact) => !artifact.present)
  if (pending.length === 0) {
    return
  }

  console.log(`\n- ${group.fixtureId}`)
  console.log(`  state: ${group.state}`)
  console.log(`  expected color: ${group.color}`)

  const hints = group.type === "scanner" ? scannerHints[group.fixtureId] : providerHints[group.fixtureId]
  if (hints) {
    console.log("  capture plan:")
    for (const hint of hints) {
      console.log(`  - ${hint}`)
    }
  }

  console.log("  pending files:")
  for (const artifact of pending) {
    const state = artifact.exists ? "untracked" : "missing"
    console.log(`  - ${artifact.kind}: ${artifact.refPath} (${state})`)
  }
}

if (!fs.existsSync(scannerPacketPath)) {
  throw new Error(`Missing scanner evidence packet: ${scannerPacketPath}`)
}

if (!fs.existsSync(providerPacketPath)) {
  throw new Error(`Missing provider-profile evidence packet: ${providerPacketPath}`)
}

const scanner = scannerGroups(readJson(scannerPacketPath))
const provider = providerGroups(readJson(providerPacketPath))
const scannerCounts = countArtifacts(scanner)
const providerCounts = countArtifacts(provider)
const scannerMissing = scanner.filter((group) => group.artifacts.some((artifact) => !artifact.present))
const providerMissing = provider.filter((group) => group.artifacts.some((artifact) => !artifact.present))

console.log("Scanner release evidence todo")
console.log(`Tracked evidence folder: ${evidenceDir}`)
console.log(`Scanner artifacts: ${scannerCounts.present}/${scannerCounts.total} tracked, ${scannerCounts.untracked} untracked, ${scannerCounts.missing} missing`)
console.log(`Provider-profile artifacts: ${providerCounts.present}/${providerCounts.total} tracked, ${providerCounts.untracked} untracked, ${providerCounts.missing} missing`)

if (scannerMissing.length === 0 && providerMissing.length === 0) {
  console.log("\nNo missing or untracked scanner/provider-profile evidence artifacts.")
  console.log("\nNext commands:")
  console.log("- make release-readiness-report")
  console.log("- make release-audit-strict")
  process.exit(0)
}

if (scannerMissing.length > 0) {
  console.log("\nPending scanner-fleet artifacts:")
  for (const group of scannerMissing) {
    printMissingGroup(group)
  }
}

if (providerMissing.length > 0) {
  console.log("\nPending provider-profile artifacts:")
  for (const group of providerMissing) {
    printMissingGroup(group)
  }
}

console.log("\nImport commands after capture:")
console.log("- make import-scanner-release-evidence-downloads")
console.log("- make import-scanner-release-evidence-export SCANNER_RELEASE_EVIDENCE_SOURCE_DIR=/path/to/exported-ios-evidence")
console.log("- make import-iphone-evidence IPHONE_EVIDENCE_SOURCE_DIR=local/iphone-evidence-packet/incoming")
console.log("- make import-ios-provider-profile-evidence IOS_PROVIDER_PROFILE_EVIDENCE_SOURCE_DIR=local/ios-provider-profile-evidence-packet/incoming")

const untrackedArtifacts = [...scanner, ...provider]
  .flatMap((group) => group.artifacts)
  .filter((artifact) => artifact.exists && !artifact.tracked)
  .map((artifact) => artifact.refPath)

if (untrackedArtifacts.length > 0) {
  console.log("\nAlready imported but not staged:")
  console.log("- These files exist in the evidence tree but are not tracked by git yet.")
  console.log("- Stage them only when the capture set is ready for release review:")
  console.log(`  git add ${evidenceDir}`)
}

console.log("\nValidation commands:")
console.log("- make scanner-release-evidence-status")
console.log("- make release-readiness-report")
console.log("- make release-audit-strict")
NODE
