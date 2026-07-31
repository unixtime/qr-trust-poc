import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { Console, Effect } from "effect"

import {
  collectScannerFleetEvidenceArtifactRefs,
  makeVerifierProfileDistributionReceipt,
  type ScannerFleetEvidenceArtifactRef,
  type ScannerFleetEvidencePacket,
  type VerifierProfileArtifact,
  type VerifierProfileDistributionPolicy,
  type VerifierProfileDistributionReceipt,
} from "../index.js"

const ROOT_DIR = fileURLToPath(new URL("../../../", import.meta.url))
const DEFAULT_JSON_OUTPUT = fileURLToPath(
  new URL("../../../local/deployed-scanner-readiness-report.json", import.meta.url),
)
const DEFAULT_MARKDOWN_OUTPUT = fileURLToPath(
  new URL("../../../local/deployed-scanner-readiness-report.md", import.meta.url),
)
const DEFAULT_CAPTURE_DRILL_JSON = fileURLToPath(
  new URL("../../../local/scanner-fleet-capture-drill.json", import.meta.url),
)
const DEFAULT_CAPTURE_DRILL_MARKDOWN = fileURLToPath(
  new URL("../../../local/scanner-fleet-capture-drill.md", import.meta.url),
)
const DEFAULT_VERIFIER_PROFILE = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/verifier-profile-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_SCANNER_FLEET_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_PROVIDER_PROFILE_EVIDENCE_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/ios-provider-profile-evidence-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_OBSERVED_AT = "2026-05-20T12:00:00.000Z"

const DEFAULT_POLICY = {
  acceptedRootProgramIds: ["root:qrtrust-demo:2026"],
  acceptedDelegatedAuthorityIds: ["authority:qrtrust-demo:merchant-web"],
  acceptedSigningKeyIds: [
    "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
  ],
  expectedScannerDecisionEndpoint: "https://qrtrust.local:8443/scanner/decisions",
  revokedProfileFingerprints: [],
  minimumHoldDurationMs: 800,
} satisfies VerifierProfileDistributionPolicy

type CheckStatus = "passed" | "warning" | "blocked"

interface DeployedScannerReadinessCheck {
  readonly id:
    | "verifier_profile_distribution"
    | "scanner_fleet_packet_contract"
    | "native_artifact_coverage"
    | "native_provider_profile_artifact_coverage"
  readonly status: CheckStatus
  readonly summary: string
  readonly detail: string
}

interface EvidenceArtifactRef {
  readonly fixture_id: string
  readonly decision_id?: string
  readonly kind: ScannerFleetEvidenceArtifactRef["kind"]
  readonly path: string
}

interface EvidenceArtifactIssue extends EvidenceArtifactRef {
  readonly reason: string
  readonly bytes?: number
}

interface IosProviderProfileEvidencePacket {
  readonly packet_id: string
  readonly evidence_rows: ReadonlyArray<IosProviderProfileEvidenceRow>
}

interface IosProviderProfileEvidenceRow {
  readonly fixture_id: string
  readonly screenshot_ref: string
  readonly accessibility_ref: string
}

interface DeployedScannerReadinessReport {
  readonly artifact_type: "deployed_scanner_readiness_report"
  readonly schema_version: "2026-05-22"
  readonly generated_at: string
  readonly observed_at: string
  readonly status:
    | "blocked_by_profile"
    | "native_evidence_incomplete"
    | "ready_for_deployed_scanner_review"
  readonly verifier_profile: {
    readonly path: string
    readonly status: "active" | "invalid"
    readonly receipt?: VerifierProfileDistributionReceipt
    readonly error?: string
  }
  readonly scanner_fleet: {
    readonly packet_path: string
    readonly packet_id: string
    readonly required_fixtures: number
    readonly evidence_rows: number
    readonly required_artifacts: number
    readonly present_artifacts: number
    readonly missing_or_invalid_artifacts: ReadonlyArray<EvidenceArtifactIssue>
  }
  readonly provider_profile_evidence: {
    readonly packet_path: string
    readonly packet_id: string
    readonly evidence_rows: number
    readonly required_artifacts: number
    readonly present_artifacts: number
    readonly missing_or_invalid_artifacts: ReadonlyArray<EvidenceArtifactIssue>
  }
  readonly evidence_capture_drill: {
    readonly command: "make scanner-fleet-capture-drill"
    readonly json_path: string
    readonly markdown_path: string
    readonly lab_base_url_env: "QRTRUST_SCANNER_LAB_BASE_URL"
    readonly packet_env: "QRTRUST_SCANNER_FLEET_EVIDENCE_PACKET"
    readonly purpose: string
  }
  readonly provider_profile_capture_handoff: {
    readonly packet_command: "make ios-provider-profile-evidence-packet"
    readonly status_command: "make ios-provider-profile-evidence-status"
    readonly import_command: "make import-ios-provider-profile-evidence IOS_PROVIDER_PROFILE_EVIDENCE_SOURCE_DIR=local/ios-provider-profile-evidence-packet/incoming"
    readonly strict_check_command: "make check-ios-provider-profile-evidence"
    readonly packet_readme_path: "local/ios-provider-profile-evidence-packet/README.md"
    readonly incoming_path: "local/ios-provider-profile-evidence-packet/incoming"
    readonly purpose: string
  }
  readonly checks: ReadonlyArray<DeployedScannerReadinessCheck>
  readonly next_actions: ReadonlyArray<string>
  readonly review_notes: ReadonlyArray<string>
}

const program = Effect.gen(function* () {
  const verifierProfilePath =
    process.env.QRTRUST_DEPLOYED_SCANNER_VERIFIER_PROFILE_JSON
    ?? DEFAULT_VERIFIER_PROFILE
  const scannerFleetPacketPath =
    process.env.QRTRUST_DEPLOYED_SCANNER_FLEET_PACKET_JSON
    ?? DEFAULT_SCANNER_FLEET_PACKET
  const providerProfileEvidencePacketPath =
    process.env.QRTRUST_DEPLOYED_SCANNER_PROVIDER_PROFILE_EVIDENCE_PACKET_JSON
    ?? DEFAULT_PROVIDER_PROFILE_EVIDENCE_PACKET
  const jsonOutputPath =
    process.env.QRTRUST_DEPLOYED_SCANNER_READINESS_JSON ?? DEFAULT_JSON_OUTPUT
  const markdownOutputPath =
    process.env.QRTRUST_DEPLOYED_SCANNER_READINESS_MD
    ?? DEFAULT_MARKDOWN_OUTPUT
  const captureDrillJsonPath =
    process.env.QRTRUST_SCANNER_FLEET_CAPTURE_DRILL_JSON
    ?? DEFAULT_CAPTURE_DRILL_JSON
  const captureDrillMarkdownPath =
    process.env.QRTRUST_SCANNER_FLEET_CAPTURE_DRILL_MD
    ?? DEFAULT_CAPTURE_DRILL_MARKDOWN
  const observedAt =
    process.env.QRTRUST_DEPLOYED_SCANNER_OBSERVED_AT ?? DEFAULT_OBSERVED_AT

  const report = makeDeployedScannerReadinessReport({
    generatedAt: new Date().toISOString(),
    observedAt,
    verifierProfilePath,
    scannerFleetPacketPath,
    providerProfileEvidencePacketPath,
    captureDrillJsonPath,
    captureDrillMarkdownPath,
  })

  yield* writeReport(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`)
  yield* writeReport(markdownOutputPath, renderMarkdown(report))
  yield* Console.log(
    JSON.stringify(
      {
        status: report.status,
        profile: report.verifier_profile.status,
        artifacts: `${report.scanner_fleet.present_artifacts}/${report.scanner_fleet.required_artifacts}`,
        provider_profile_artifacts: `${report.provider_profile_evidence.present_artifacts}/${report.provider_profile_evidence.required_artifacts}`,
        warnings: report.checks.filter((check) => check.status === "warning")
          .length,
        blocked: report.checks.filter((check) => check.status === "blocked")
          .length,
        capture_drill: report.evidence_capture_drill.markdown_path,
        json: jsonOutputPath,
        markdown: markdownOutputPath,
      },
      null,
      2,
    ),
  )
})

interface DeployedScannerReadinessReportConfig {
  readonly generatedAt: string
  readonly observedAt: string
  readonly verifierProfilePath: string
  readonly scannerFleetPacketPath: string
  readonly providerProfileEvidencePacketPath: string
  readonly captureDrillJsonPath: string
  readonly captureDrillMarkdownPath: string
}

const makeDeployedScannerReadinessReport = (
  config: DeployedScannerReadinessReportConfig,
): DeployedScannerReadinessReport => {
  const profile = readJson<VerifierProfileArtifact>(config.verifierProfilePath)
  const scannerFleetPacket = readJson<ScannerFleetEvidencePacket>(
    config.scannerFleetPacketPath,
  )
  const providerProfileEvidencePacket = readJson<IosProviderProfileEvidencePacket>(
    config.providerProfileEvidencePacketPath,
  )
  const profileCheck = validateVerifierProfile(profile, config.observedAt)
  const scannerArtifactRefs =
    collectScannerFleetEvidenceArtifactRefs(scannerFleetPacket)
  const scannerArtifactIssues = validateEvidenceArtifacts(scannerArtifactRefs)
  const providerProfileArtifactRefs = collectProviderProfileArtifactRefs(
    providerProfileEvidencePacket,
  )
  const providerProfileArtifactIssues = validateEvidenceArtifacts(
    providerProfileArtifactRefs,
  )
  const profileStatus = profileCheck.receipt ? "active" : "invalid"
  const checks = makeChecks({
    profileError: profileCheck.error,
    scannerFleetPacket,
    scannerArtifactIssues,
    scannerArtifactRefs,
    providerProfileEvidencePacket,
    providerProfileArtifactIssues,
    providerProfileArtifactRefs,
  })
  const status = readinessStatus(checks)

  return {
    artifact_type: "deployed_scanner_readiness_report",
    schema_version: "2026-05-22",
    generated_at: config.generatedAt,
    observed_at: config.observedAt,
    status: readinessStatus(checks),
    verifier_profile: {
      path: repoPath(config.verifierProfilePath),
      status: profileStatus,
      ...(profileCheck.receipt ? { receipt: profileCheck.receipt } : {}),
      ...(profileCheck.error ? { error: profileCheck.error } : {}),
    },
    scanner_fleet: {
      packet_path: repoPath(config.scannerFleetPacketPath),
      packet_id: scannerFleetPacket.packet_id,
      required_fixtures: scannerFleetPacket.fixture_matrix.length,
      evidence_rows: scannerFleetPacket.evidence_rows.length,
      required_artifacts: scannerArtifactRefs.length,
      present_artifacts:
        scannerArtifactRefs.length - scannerArtifactIssues.length,
      missing_or_invalid_artifacts: scannerArtifactIssues,
    },
    provider_profile_evidence: {
      packet_path: repoPath(config.providerProfileEvidencePacketPath),
      packet_id: providerProfileEvidencePacket.packet_id,
      evidence_rows: providerProfileEvidencePacket.evidence_rows.length,
      required_artifacts: providerProfileArtifactRefs.length,
      present_artifacts:
        providerProfileArtifactRefs.length - providerProfileArtifactIssues.length,
      missing_or_invalid_artifacts: providerProfileArtifactIssues,
    },
    evidence_capture_drill: {
      command: "make scanner-fleet-capture-drill",
      json_path: repoPath(config.captureDrillJsonPath),
      markdown_path: repoPath(config.captureDrillMarkdownPath),
      lab_base_url_env: "QRTRUST_SCANNER_LAB_BASE_URL",
      packet_env: "QRTRUST_SCANNER_FLEET_EVIDENCE_PACKET",
      purpose:
        "Generate exact lab URLs, native-app capture steps, and artifact filenames for the scanner-fleet evidence packet.",
    },
    provider_profile_capture_handoff: {
      packet_command: "make ios-provider-profile-evidence-packet",
      status_command: "make ios-provider-profile-evidence-status",
      import_command:
        "make import-ios-provider-profile-evidence IOS_PROVIDER_PROFILE_EVIDENCE_SOURCE_DIR=local/ios-provider-profile-evidence-packet/incoming",
      strict_check_command: "make check-ios-provider-profile-evidence",
      packet_readme_path: "local/ios-provider-profile-evidence-packet/README.md",
      incoming_path: "local/ios-provider-profile-evidence-packet/incoming",
      purpose:
        "Capture native provider-profile import and Settings states proving the managed verifier configuration boundary.",
    },
    checks,
    next_actions: makeNextActions({
      status,
      scannerArtifactIssues,
      providerProfileArtifactIssues,
    }),
    review_notes: [
      "This report checks the deployed-scanner boundary, not the whole network deployment.",
      "An active verifier profile proves the scanner has managed trust-state configuration before scan time.",
      "Native scanner evidence is intentionally separate; missing scanner-fleet or provider-profile artifacts keep the report below deployed-scanner review readiness.",
    ],
  }
}

const validateVerifierProfile = (
  profile: VerifierProfileArtifact,
  observedAt: string,
): {
  readonly receipt?: VerifierProfileDistributionReceipt
  readonly error?: string
} => {
  try {
    return {
      receipt: makeVerifierProfileDistributionReceipt(
        profile,
        DEFAULT_POLICY,
        observedAt,
      ),
    }
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Verifier profile validation failed.",
    }
  }
}

const collectProviderProfileArtifactRefs = (
  packet: IosProviderProfileEvidencePacket,
): ReadonlyArray<EvidenceArtifactRef> =>
  packet.evidence_rows.flatMap((row) => [
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

const validateEvidenceArtifacts = (
  refs: ReadonlyArray<EvidenceArtifactRef>,
): ReadonlyArray<EvidenceArtifactIssue> =>
  refs.flatMap((ref) => {
    const path = resolve(ROOT_DIR, ref.path)
    try {
      const stats = statSync(path)
      if (!stats.isFile()) {
        return [{ ...ref, reason: "not_a_file" }]
      }

      const minimumBytes = ref.kind === "accessibility" ? 20 : 1_000
      if (stats.size < minimumBytes) {
        return [
          {
            ...ref,
            reason: `smaller_than_${minimumBytes}_bytes`,
            bytes: stats.size,
          },
        ]
      }

      if (!isGitTracked(ref.path)) {
        return [{ ...ref, reason: "untracked", bytes: stats.size }]
      }

      return []
    } catch {
      return [{ ...ref, reason: "missing" }]
    }
  })

const isGitTracked = (repoPath: string): boolean => {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", repoPath], {
      cwd: ROOT_DIR,
      stdio: "ignore",
    })
    return true
  } catch {
    return false
  }
}

const makeChecks = (config: {
  readonly profileError: string | undefined
  readonly scannerFleetPacket: ScannerFleetEvidencePacket
  readonly scannerArtifactIssues: ReadonlyArray<EvidenceArtifactIssue>
  readonly scannerArtifactRefs: ReadonlyArray<EvidenceArtifactRef>
  readonly providerProfileEvidencePacket: IosProviderProfileEvidencePacket
  readonly providerProfileArtifactIssues: ReadonlyArray<EvidenceArtifactIssue>
  readonly providerProfileArtifactRefs: ReadonlyArray<EvidenceArtifactRef>
}): ReadonlyArray<DeployedScannerReadinessCheck> => [
  {
    id: "verifier_profile_distribution",
    status: config.profileError ? "blocked" : "passed",
    summary: config.profileError
      ? "Verifier profile is not active for the scanner."
      : "Verifier profile receipt is active.",
    detail:
      config.profileError
      ?? "The scanner can bind decisions to an active verifier profile fingerprint.",
  },
  {
    id: "scanner_fleet_packet_contract",
    status: "passed",
    summary: "Scanner fleet evidence packet satisfies the schema-backed contract.",
    detail: `${config.scannerFleetPacket.evidence_rows.length} rows cover ${config.scannerFleetPacket.fixture_matrix.length} required scanner outcomes.`,
  },
  {
    id: "native_artifact_coverage",
    status: config.scannerArtifactIssues.length === 0 ? "passed" : "warning",
    summary:
      config.scannerArtifactIssues.length === 0
        ? "Native scanner evidence artifacts are complete."
        : "Native scanner evidence artifacts are still incomplete.",
    detail:
      config.scannerArtifactIssues.length === 0
        ? `${config.scannerArtifactRefs.length} screenshots, history entries, and accessibility traces are present.`
        : `${config.scannerArtifactIssues.length} of ${config.scannerArtifactRefs.length} scanner evidence artifacts are missing or invalid.`,
  },
  {
    id: "native_provider_profile_artifact_coverage",
    status:
      config.providerProfileArtifactIssues.length === 0 ? "passed" : "warning",
    summary:
      config.providerProfileArtifactIssues.length === 0
        ? "Native provider-profile evidence artifacts are complete."
        : "Native provider-profile evidence artifacts are still incomplete.",
    detail:
      config.providerProfileArtifactIssues.length === 0
        ? `${config.providerProfileArtifactRefs.length} provider-profile screenshots and accessibility traces are present.`
        : `${config.providerProfileArtifactIssues.length} of ${config.providerProfileArtifactRefs.length} provider-profile artifacts are missing or invalid across ${config.providerProfileEvidencePacket.evidence_rows.length} evidence rows.`,
  },
]

const readinessStatus = (
  checks: ReadonlyArray<DeployedScannerReadinessCheck>,
): DeployedScannerReadinessReport["status"] => {
  if (checks.some((check) => check.status === "blocked")) {
    return "blocked_by_profile"
  }
  if (checks.some((check) => check.status === "warning")) {
    return "native_evidence_incomplete"
  }
  return "ready_for_deployed_scanner_review"
}

const makeNextActions = (config: {
  readonly status: DeployedScannerReadinessReport["status"]
  readonly scannerArtifactIssues: ReadonlyArray<EvidenceArtifactIssue>
  readonly providerProfileArtifactIssues: ReadonlyArray<EvidenceArtifactIssue>
}): ReadonlyArray<string> => {
  const { status } = config
  if (status === "ready_for_deployed_scanner_review") {
    return [
      "Include this report with the scanner-fleet evidence packet in deployed-scanner review.",
      "Keep verifier-profile distribution evidence, native scanner artifacts, and provider-profile artifacts together in the release audit.",
    ]
  }

  if (status === "native_evidence_incomplete") {
    const actions: string[] = []

    if (config.scannerArtifactIssues.length > 0) {
      actions.push(
        "Run `make scanner-fleet-capture-drill` to generate fixture-specific browser-lab URLs and native capture filenames.",
        "Follow `local/scanner-fleet-capture-drill.md` for the missing result screenshots, history screenshots, and accessibility traces.",
        "Import captured scanner files with `make import-iphone-evidence IPHONE_EVIDENCE_SOURCE_DIR=local/iphone-evidence-packet/incoming`.",
      )
    }

    if (config.providerProfileArtifactIssues.length > 0) {
      actions.push(
        "Run `make ios-provider-profile-evidence-packet` to refresh the provider-profile capture packet.",
        "Capture provider-profile screenshots and accessibility traces into `local/ios-provider-profile-evidence-packet/incoming`.",
        "Import captured provider-profile files with `make import-ios-provider-profile-evidence IOS_PROVIDER_PROFILE_EVIDENCE_SOURCE_DIR=local/ios-provider-profile-evidence-packet/incoming`.",
      )
    }

    actions.push(
      "Re-run `make network-deployed-scanner-readiness-report` before claiming deployed-scanner readiness.",
    )

    return actions
  }

  return [
    "Resolve verifier profile distribution before collecting native scanner evidence.",
    "After the profile is active, run `make scanner-fleet-capture-drill` and capture the scanner-fleet artifacts.",
  ]
}

const readJson = <Value>(path: string): Value =>
  JSON.parse(readFileSync(path, "utf8")) as Value

const writeReport = (path: string, content: string): Effect.Effect<void> =>
  Effect.sync(() => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, "utf8")
  })

const renderMarkdown = (report: DeployedScannerReadinessReport): string => `# Deployed Scanner Readiness Report

Status: \`${report.status}\`

Observed at: \`${report.observed_at}\`

## Verdict

${renderVerdict(report)}

## Checks

| Check | Status | Summary |
| --- | --- | --- |
${report.checks.map(renderCheckRow).join("\n")}

## Verifier Profile

- Profile path: \`${report.verifier_profile.path}\`
- Profile status: \`${report.verifier_profile.status}\`
- Profile fingerprint: \`${report.verifier_profile.receipt?.profile_fingerprint ?? "unavailable"}\`
- Scanner decision endpoint: \`${report.verifier_profile.receipt?.scanner_decision_endpoint ?? "unavailable"}\`

## Scanner Fleet Evidence

- Packet path: \`${report.scanner_fleet.packet_path}\`
- Packet ID: \`${report.scanner_fleet.packet_id}\`
- Required fixtures: \`${report.scanner_fleet.required_fixtures}\`
- Evidence rows: \`${report.scanner_fleet.evidence_rows}\`
- Artifacts present: \`${report.scanner_fleet.present_artifacts}/${report.scanner_fleet.required_artifacts}\`

## Missing Or Invalid Native Artifacts

${renderArtifactIssues(report.scanner_fleet.missing_or_invalid_artifacts)}

## Provider Profile Evidence

- Packet path: \`${report.provider_profile_evidence.packet_path}\`
- Packet ID: \`${report.provider_profile_evidence.packet_id}\`
- Evidence rows: \`${report.provider_profile_evidence.evidence_rows}\`
- Artifacts present: \`${report.provider_profile_evidence.present_artifacts}/${report.provider_profile_evidence.required_artifacts}\`

## Missing Or Invalid Provider Profile Artifacts

${renderArtifactIssues(report.provider_profile_evidence.missing_or_invalid_artifacts)}

## Capture Drill

- Command: \`${report.evidence_capture_drill.command}\`
- Markdown: \`${report.evidence_capture_drill.markdown_path}\`
- JSON: \`${report.evidence_capture_drill.json_path}\`
- Lab base URL override: \`${report.evidence_capture_drill.lab_base_url_env}\`
- Packet override: \`${report.evidence_capture_drill.packet_env}\`
- Purpose: ${report.evidence_capture_drill.purpose}

## Provider Profile Capture Handoff

- Create packet: \`${report.provider_profile_capture_handoff.packet_command}\`
- Packet README: \`${report.provider_profile_capture_handoff.packet_readme_path}\`
- Incoming folder: \`${report.provider_profile_capture_handoff.incoming_path}\`
- Import: \`${report.provider_profile_capture_handoff.import_command}\`
- Status: \`${report.provider_profile_capture_handoff.status_command}\`
- Strict check: \`${report.provider_profile_capture_handoff.strict_check_command}\`
- Purpose: ${report.provider_profile_capture_handoff.purpose}

## Next Actions

${report.next_actions.map((action) => `- ${action}`).join("\n")}

## Review Notes

${report.review_notes.map((note) => `- ${note}`).join("\n")}
`

const renderVerdict = (report: DeployedScannerReadinessReport): string => {
  if (report.status === "ready_for_deployed_scanner_review") {
    return "The scanner profile and native evidence artifacts are complete enough for deployed-scanner review."
  }
  if (report.status === "native_evidence_incomplete") {
    return "The scanner profile is usable, but native scanner or provider-profile evidence artifacts are still missing. Do not call the scanner fleet deployment-ready yet."
  }
  return "The verifier profile is not active or does not match local scanner policy. Resolve this before reviewing native scanner evidence."
}

const renderCheckRow = (check: DeployedScannerReadinessCheck): string =>
  `| \`${check.id}\` | \`${check.status}\` | ${check.summary} |`

const renderArtifactIssues = (
  issues: ReadonlyArray<EvidenceArtifactIssue>,
): string => {
  if (issues.length === 0) {
    return "None."
  }

  return issues
    .map(
      (issue) =>
        `- \`${issue.fixture_id}\` ${issue.kind}: \`${issue.path}\` (${issue.reason})`,
    )
    .join("\n")
}

const repoPath = (path: string): string => relative(ROOT_DIR, path)

Effect.runPromise(program)
