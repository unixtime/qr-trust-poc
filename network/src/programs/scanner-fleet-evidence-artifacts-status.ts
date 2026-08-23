import { execFileSync } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  collectScannerFleetEvidenceArtifactRefs,
  type ScannerFleetEvidenceArtifactRef,
  type ScannerFleetEvidencePacket,
  type ScannerFleetEvidenceRow,
} from "../index.js"

interface MissingArtifact extends ScannerFleetEvidenceArtifactRef {}

interface InvalidArtifact extends ScannerFleetEvidenceArtifactRef {
  readonly reason: string
  readonly bytes?: number
}

interface ArtifactStatusReport {
  readonly status: "complete" | "incomplete"
  readonly packet_id: string
  readonly packet_path: string
  readonly required_artifacts: number
  readonly present_artifacts: number
  readonly missing_artifacts: ReadonlyArray<MissingArtifact>
  readonly invalid_artifacts: ReadonlyArray<InvalidArtifact>
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const DEFAULT_PACKET_PATH = resolve(
  REPO_ROOT,
  "docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json",
)

const strict = process.argv.includes("--strict")
const textOutput =
  process.argv.includes("--text") || process.argv.includes("--format=text")
const packetPath = process.env.QRTRUST_SCANNER_FLEET_EVIDENCE_PACKET
  ? resolve(process.cwd(), process.env.QRTRUST_SCANNER_FLEET_EVIDENCE_PACKET)
  : DEFAULT_PACKET_PATH

const packet = JSON.parse(
  await readFile(packetPath, "utf8"),
) as unknown as ScannerFleetEvidencePacket
const artifactRefs = collectScannerFleetEvidenceArtifactRefs(packet)
const rowsByArtifactPath = rowsByEvidenceArtifactPath(packet.evidence_rows)
const missingArtifacts: MissingArtifact[] = []
const invalidArtifacts: InvalidArtifact[] = []
let presentArtifacts = 0

for (const ref of artifactRefs) {
  const artifactPath = resolve(REPO_ROOT, ref.path)

  try {
    const artifactStat = await stat(artifactPath)
    if (!artifactStat.isFile()) {
      invalidArtifacts.push({
        ...ref,
        reason: "artifact path is not a file",
      })
      continue
    }

    const minimumBytes = minimumBytesFor(ref)
    if (artifactStat.size < minimumBytes) {
      invalidArtifacts.push({
        ...ref,
        reason: `artifact is smaller than ${minimumBytes} bytes`,
        bytes: artifactStat.size,
      })
      continue
    }

    const contentReason = await validateArtifactContent(
      ref,
      artifactPath,
      rowsByArtifactPath.get(ref.path),
    )
    if (contentReason !== undefined) {
      invalidArtifacts.push({
        ...ref,
        reason: contentReason,
        bytes: artifactStat.size,
      })
      continue
    }

    if (!isGitTracked(ref.path)) {
      invalidArtifacts.push({
        ...ref,
        reason: "artifact exists locally but is not tracked by git",
        bytes: artifactStat.size,
      })
      continue
    }

    presentArtifacts += 1
  } catch {
    missingArtifacts.push(ref)
  }
}

const report: ArtifactStatusReport = {
  status:
    missingArtifacts.length === 0 && invalidArtifacts.length === 0
      ? "complete"
      : "incomplete",
  packet_id: packet.packet_id,
  packet_path: packetPath,
  required_artifacts: artifactRefs.length,
  present_artifacts: presentArtifacts,
  missing_artifacts: missingArtifacts,
  invalid_artifacts: invalidArtifacts,
}

if (textOutput) {
  printTextReport(report)
} else {
  console.log(JSON.stringify(report, null, 2))
}

if (strict && report.status !== "complete") {
  process.exitCode = 1
}

function minimumBytesFor(ref: ScannerFleetEvidenceArtifactRef): number {
  if (ref.kind === "accessibility") {
    return 20
  }
  return 1_000
}

function isGitTracked(repoPath: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", repoPath], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    })
    return true
  } catch {
    return false
  }
}

function rowsByEvidenceArtifactPath(
  rows: ReadonlyArray<ScannerFleetEvidenceRow>,
): Map<string, ScannerFleetEvidenceRow> {
  const indexed = new Map<string, ScannerFleetEvidenceRow>()

  for (const row of rows) {
    indexed.set(row.screenshot_ref, row)
    indexed.set(row.history_entry_ref, row)
    indexed.set(row.accessibility_ref, row)
  }

  return indexed
}

async function validateArtifactContent(
  ref: ScannerFleetEvidenceArtifactRef,
  artifactPath: string,
  row: ScannerFleetEvidenceRow | undefined,
): Promise<string | undefined> {
  if (row === undefined) {
    return "artifact is not linked to scanner-fleet row metadata"
  }

  if (ref.kind === "accessibility") {
    return validateAccessibilityTrace(await readFile(artifactPath, "utf8"), row)
  }

  const artifactBytes = await readFile(artifactPath)
  if (!hasPngSignature(artifactBytes)) {
    return "artifact is not a PNG file"
  }

  return undefined
}

function hasPngSignature(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (bytes.length < signature.length) {
    return false
  }

  return signature.every((byte, index) => bytes[index] === byte)
}

function validateAccessibilityTrace(
  text: string,
  row: ScannerFleetEvidenceRow,
): string | undefined {
  if (/\b(TODO|PLACEHOLDER|REPLACE (THIS|WITH))\b|\.\.\./i.test(text)) {
    return "accessibility trace still contains placeholder text"
  }

  if (!fieldEquals(text, "fixture_id", row.fixture_id)) {
    return `accessibility trace must include fixture_id: ${row.fixture_id}`
  }

  if (!fieldEquals(text, "decision_state", row.decision_state)) {
    return `accessibility trace must include decision_state: ${row.decision_state}`
  }

  if (
    !fieldEquals(text, "decision_color", row.decision_color) &&
    !statusMentionsColor(text, row.decision_color)
  ) {
    return `accessibility trace must include decision_color: ${row.decision_color}`
  }

  if (!fieldExists(text, "title")) {
    return "accessibility trace must include a title field"
  }

  if (!fieldExists(text, "message")) {
    return "accessibility trace must include a message field"
  }

  return undefined
}

function fieldExists(text: string, fieldName: string): boolean {
  return fieldValue(text, fieldName) !== undefined
}

function fieldEquals(text: string, fieldName: string, expected: string): boolean {
  const actual = fieldValue(text, fieldName)
  if (actual === undefined) {
    return false
  }

  return normalizeTraceValue(actual) === normalizeTraceValue(expected)
}

function statusMentionsColor(
  text: string,
  expectedColor: ScannerFleetEvidenceRow["decision_color"],
): boolean {
  const status = fieldValue(text, "status")
  if (status === undefined) {
    return false
  }

  return normalizeTraceValue(status).includes(normalizeTraceValue(expectedColor))
}

function fieldValue(text: string, fieldName: string): string | undefined {
  // detect-non-literal-regexp wants a literal pattern. The only interpolated
  // value is fieldName, and it passes through escapeRegExp first -- the
  // mitigation the rule exists to demand is inside the flagged expression.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  const fieldPattern = new RegExp(
    `^\\s*${escapeRegExp(fieldName)}\\s*:\\s*(.+?)\\s*$`,
    "im",
  )
  return text.match(fieldPattern)?.[1]?.trim()
}

function normalizeTraceValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function printTextReport(report: ArtifactStatusReport): void {
  console.log("Native scanner-fleet evidence status")
  console.log(`Packet: ${report.packet_path}`)
  console.log(`Packet ID: ${report.packet_id}`)
  console.log(`Status: ${report.status}`)
  console.log(
    `Artifacts: ${report.present_artifacts}/${report.required_artifacts} present`,
  )

  if (report.missing_artifacts.length > 0) {
    console.log("")
    console.log("Missing artifacts:")
    for (const artifact of report.missing_artifacts) {
      console.log(
        `- ${artifact.fixture_id} / ${artifact.kind}: ${artifact.path}`,
      )
    }
  }

  if (report.invalid_artifacts.length > 0) {
    console.log("")
    console.log("Invalid artifacts:")
    for (const artifact of report.invalid_artifacts) {
      const bytes = artifact.bytes === undefined ? "" : ` (${artifact.bytes} bytes)`
      console.log(
        `- ${artifact.fixture_id} / ${artifact.kind}: ${artifact.path} - ${artifact.reason}${bytes}`,
      )
    }
  }

  if (report.status === "complete") {
    console.log("")
    console.log("Next action: run make check-iphone-evidence and include the artifacts in the release audit.")
  } else {
    console.log("")
    console.log("Next action: capture or import the missing native iPhone files listed above.")
  }
}
