import { execFileSync } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

interface IosProviderProfileEvidencePacket {
  readonly packet_id: string
  readonly evidence_rows: ReadonlyArray<IosProviderProfileEvidenceRow>
}

interface IosProviderProfileEvidenceRow {
  readonly fixture_id: string
  readonly profile_state: string
  readonly expected_status: string
  readonly expected_user_signal: string
  readonly screenshot_ref: string
  readonly accessibility_ref: string
  readonly required_labels: ReadonlyArray<string>
}

interface ArtifactRef {
  readonly fixture_id: string
  readonly kind: "screenshot" | "accessibility"
  readonly path: string
}

interface InvalidArtifact extends ArtifactRef {
  readonly reason: string
  readonly bytes?: number
}

interface EvidenceCaptureHandoff {
  readonly packet_command: string
  readonly status_command: string
  readonly import_command: string
  readonly strict_check_command: string
  readonly packet_readme_path: string
  readonly required_artifacts_path: string
  readonly accessibility_templates_path: string
  readonly incoming_path: string
  readonly tracked_evidence_path: string
}

interface ArtifactStatusReport {
  readonly status: "complete" | "incomplete"
  readonly packet_id: string
  readonly packet_path: string
  readonly required_artifacts: number
  readonly present_artifacts: number
  readonly missing_artifacts: ReadonlyArray<ArtifactRef>
  readonly invalid_artifacts: ReadonlyArray<InvalidArtifact>
  readonly evidence_capture_handoff: EvidenceCaptureHandoff
  readonly next_actions: ReadonlyArray<string>
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const DEFAULT_CAPTURE_PACKET_DIR = "local/ios-provider-profile-evidence-packet"
const TRACKED_EVIDENCE_DIR = "docs/public/evidence/iphone"
const DEFAULT_PACKET_PATH = resolve(
  REPO_ROOT,
  "docs/public/network-contracts/examples/ios-provider-profile-evidence-reference.json",
)

const strict = process.argv.includes("--strict")
const textOutput =
  process.argv.includes("--text") || process.argv.includes("--format=text")
const packetPath = process.env.QRTRUST_IOS_PROVIDER_PROFILE_EVIDENCE_PACKET
  ? resolve(
      process.cwd(),
      process.env.QRTRUST_IOS_PROVIDER_PROFILE_EVIDENCE_PACKET,
    )
  : DEFAULT_PACKET_PATH
const capturePacketDir =
  process.env.IOS_PROVIDER_PROFILE_EVIDENCE_PACKET_DIR ??
  DEFAULT_CAPTURE_PACKET_DIR

const packet = JSON.parse(
  await readFile(packetPath, "utf8"),
) as unknown as IosProviderProfileEvidencePacket
const artifactRefs = collectArtifactRefs(packet)
const rowsByArtifactPath = rowsByEvidenceArtifactPath(packet.evidence_rows)
const missingArtifacts: ArtifactRef[] = []
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

const status =
  missingArtifacts.length === 0 && invalidArtifacts.length === 0
    ? "complete"
    : "incomplete"
const evidenceCaptureHandoff = buildEvidenceCaptureHandoff(capturePacketDir)
const report: ArtifactStatusReport = {
  status,
  packet_id: packet.packet_id,
  packet_path: packetPath,
  required_artifacts: artifactRefs.length,
  present_artifacts: presentArtifacts,
  missing_artifacts: missingArtifacts,
  invalid_artifacts: invalidArtifacts,
  evidence_capture_handoff: evidenceCaptureHandoff,
  next_actions: nextActionsFor(status, evidenceCaptureHandoff),
}

if (textOutput) {
  printTextReport(report)
} else {
  console.log(JSON.stringify(report, null, 2))
}

if (strict && report.status !== "complete") {
  process.exitCode = 1
}

function collectArtifactRefs(
  packet: IosProviderProfileEvidencePacket,
): ReadonlyArray<ArtifactRef> {
  return packet.evidence_rows.flatMap((row) => [
    {
      fixture_id: row.fixture_id,
      kind: "screenshot" as const,
      path: row.screenshot_ref,
    },
    {
      fixture_id: row.fixture_id,
      kind: "accessibility" as const,
      path: row.accessibility_ref,
    },
  ])
}

function minimumBytesFor(ref: ArtifactRef): number {
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
  rows: ReadonlyArray<IosProviderProfileEvidenceRow>,
): Map<string, IosProviderProfileEvidenceRow> {
  const indexed = new Map<string, IosProviderProfileEvidenceRow>()

  for (const row of rows) {
    indexed.set(row.screenshot_ref, row)
    indexed.set(row.accessibility_ref, row)
  }

  return indexed
}

async function validateArtifactContent(
  ref: ArtifactRef,
  artifactPath: string,
  row: IosProviderProfileEvidenceRow | undefined,
): Promise<string | undefined> {
  if (row === undefined) {
    return "artifact is not linked to provider-profile evidence metadata"
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
  row: IosProviderProfileEvidenceRow,
): string | undefined {
  if (/\b(TODO|PLACEHOLDER|REPLACE (THIS|WITH))\b|\.\.\./i.test(text)) {
    return "accessibility trace still contains placeholder text"
  }

  const requiredFields = [
    ["fixture_id", row.fixture_id],
    ["profile_state", row.profile_state],
    ["expected_status", row.expected_status],
  ] as const

  for (const [fieldName, expected] of requiredFields) {
    if (!fieldEquals(text, fieldName, expected)) {
      return `accessibility trace must include ${fieldName}: ${expected}`
    }
  }

  if (!fieldExists(text, "title")) {
    return "accessibility trace must include a title field"
  }

  if (!fieldExists(text, "message")) {
    return "accessibility trace must include a message field"
  }

  const normalizedTrace = normalizeTraceValue(text)
  for (const label of row.required_labels) {
    if (!normalizedTrace.includes(normalizeTraceValue(label))) {
      return `accessibility trace must include label: ${label}`
    }
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

function buildEvidenceCaptureHandoff(
  packetDir: string,
): EvidenceCaptureHandoff {
  const incomingPath = `${packetDir}/incoming`

  return {
    packet_command: "make ios-provider-profile-evidence-packet",
    status_command: "make ios-provider-profile-evidence-status",
    import_command: `make import-ios-provider-profile-evidence IOS_PROVIDER_PROFILE_EVIDENCE_SOURCE_DIR=${incomingPath}`,
    strict_check_command: "make check-ios-provider-profile-evidence",
    packet_readme_path: `${packetDir}/README.md`,
    required_artifacts_path: `${packetDir}/required-artifacts.tsv`,
    accessibility_templates_path: `${packetDir}/accessibility-templates`,
    incoming_path: incomingPath,
    tracked_evidence_path: TRACKED_EVIDENCE_DIR,
  }
}

function nextActionsFor(
  status: ArtifactStatusReport["status"],
  handoff: EvidenceCaptureHandoff,
): ReadonlyArray<string> {
  if (status === "complete") {
    return [
      `Run ${handoff.strict_check_command} before release audit.`,
      "Include the tracked provider-profile screenshots and accessibility traces in the native evidence bundle.",
    ]
  }

  return [
    `Run ${handoff.packet_command} to refresh the local capture packet.`,
    `Capture the listed native provider-profile screenshots and accessibility traces into ${handoff.incoming_path}.`,
    `Run ${handoff.import_command}, then rerun ${handoff.status_command}.`,
  ]
}

function printTextReport(report: ArtifactStatusReport): void {
  console.log("Native iOS provider-profile evidence status")
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

  console.log("")
  console.log("Capture handoff:")
  console.log(`- Create packet: ${report.evidence_capture_handoff.packet_command}`)
  console.log(
    `- Packet README: ${report.evidence_capture_handoff.packet_readme_path}`,
  )
  console.log(
    `- Required artifacts: ${report.evidence_capture_handoff.required_artifacts_path}`,
  )
  console.log(
    `- Accessibility templates: ${report.evidence_capture_handoff.accessibility_templates_path}`,
  )
  console.log(`- Incoming folder: ${report.evidence_capture_handoff.incoming_path}`)
  console.log(`- Import: ${report.evidence_capture_handoff.import_command}`)
  console.log(`- Status: ${report.evidence_capture_handoff.status_command}`)
  console.log(`- Strict check: ${report.evidence_capture_handoff.strict_check_command}`)

  console.log("")
  console.log("Next actions:")
  for (const action of report.next_actions) {
    console.log(`- ${action}`)
  }
}
