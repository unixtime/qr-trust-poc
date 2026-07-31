import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { Console, Effect } from "effect"

import {
  makeVerifierProfileDistributionReport,
  type VerifierProfileArtifact,
  type VerifierProfileDistributionControlCheck,
  type VerifierProfileDistributionPolicy,
  type VerifierProfileDistributionReport,
} from "../index.js"

const ROOT_DIR = fileURLToPath(new URL("../../../", import.meta.url))
const DEFAULT_PROFILE = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/verifier-profile-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_JSON_OUTPUT = fileURLToPath(
  new URL("../../../local/verifier-profile-distribution-report.json", import.meta.url),
)
const DEFAULT_MARKDOWN_OUTPUT = fileURLToPath(
  new URL("../../../local/verifier-profile-distribution-report.md", import.meta.url),
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

const program = Effect.gen(function* () {
  const profilePath =
    process.env.QRTRUST_VERIFIER_PROFILE_JSON ?? DEFAULT_PROFILE
  const jsonOutputPath =
    process.env.QRTRUST_VERIFIER_PROFILE_REPORT_JSON ?? DEFAULT_JSON_OUTPUT
  const markdownOutputPath =
    process.env.QRTRUST_VERIFIER_PROFILE_REPORT_MD ?? DEFAULT_MARKDOWN_OUTPUT
  const observedAt =
    process.env.QRTRUST_VERIFIER_PROFILE_OBSERVED_AT ?? DEFAULT_OBSERVED_AT

  const profile = readProfile(profilePath)
  const report = makeVerifierProfileDistributionReport({
    generatedAt: new Date().toISOString(),
    observedAt,
    profile,
    policy: DEFAULT_POLICY,
  })

  yield* writeReport(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`)
  yield* writeReport(markdownOutputPath, renderMarkdown(report, profilePath))

  const passedChecks = report.checks.filter(
    (check) => check.status === "passed",
  ).length

  yield* Console.log(
    JSON.stringify(
      {
        status: report.status,
        profile_id: report.profile.profile_id,
        profile_fingerprint: report.profile.profile_fingerprint,
        checks: `${passedChecks}/${report.checks.length}`,
        json: repoPath(jsonOutputPath),
        markdown: repoPath(markdownOutputPath),
      },
      null,
      2,
    ),
  )
})

const readProfile = (path: string): VerifierProfileArtifact =>
  JSON.parse(readFileSync(path, "utf8")) as VerifierProfileArtifact

const writeReport = (
  path: string,
  contents: string,
): Effect.Effect<void> =>
  Effect.sync(() => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents)
  })

const renderMarkdown = (
  report: VerifierProfileDistributionReport,
  profilePath: string,
): string => {
  const passedChecks = report.checks.filter(
    (check) => check.status === "passed",
  ).length

  return `# Verifier Profile Distribution Report

Generated: ${report.generated_at}

Status: \`${report.status}\`

This report isolates the scanner-side verifier profile boundary. It lets a
reviewer inspect the managed profile, local policy gates, and distribution
receipt before combining the profile with native scanner evidence.

## Profile Summary

- Profile: \`${report.profile.profile_id}\` v${report.profile.profile_version}
- Profile source: \`${repoPath(profilePath)}\`
- Fingerprint: \`${report.profile.profile_fingerprint}\`
- Root program: \`${report.profile.root_program_id}\`
- Delegated authorities: ${renderInlineList(report.profile.accepted_delegated_authority_ids)}
- Verifier: \`${report.profile.verifier_id}\`
- Scanner decision endpoint: \`${report.profile.scanner_decision_endpoint}\`
- Runtime safety policy: \`${report.profile.runtime_safety_policy_id}\`
- Distribution channel: \`${report.profile.distribution_channel}\`

## Policy Gates

- Accepted roots: ${renderInlineList(report.policy.accepted_root_program_ids)}
- Accepted delegated authorities: ${renderInlineList(report.policy.accepted_delegated_authority_ids)}
- Accepted signing keys: ${renderInlineList(report.policy.accepted_signing_key_ids)}
- Expected endpoint: \`${report.policy.expected_scanner_decision_endpoint ?? "not pinned"}\`
- Minimum hold-to-open duration: ${report.policy.minimum_hold_duration_ms}ms

## Control Checks

${renderChecksTable(report.checks)}

Checks passed: ${passedChecks}/${report.checks.length}

## Scanner Receipt

${renderReceipt(report)}

## Next Actions

${report.next_actions.map((action) => `- ${action}`).join("\n")}

## Review Notes

${report.review_notes.map((note) => `- ${note}`).join("\n")}
`
}

const renderChecksTable = (
  checks: ReadonlyArray<VerifierProfileDistributionControlCheck>,
): string =>
  [
    "| Control | Status | Summary | Detail |",
    "| --- | --- | --- | --- |",
    ...checks.map(renderCheckRow),
  ].join("\n")

const renderCheckRow = (
  check: VerifierProfileDistributionControlCheck,
): string =>
  `| \`${check.id}\` | \`${check.status}\` | ${check.summary} | ${escapeTableCell(check.detail)} |`

const renderReceipt = (report: VerifierProfileDistributionReport): string => {
  if (!report.receipt) {
    return `Receipt unavailable: \`${report.error ?? "unknown verifier profile failure"}\``
  }

  return [
    `- Receipt status: \`${report.receipt.status}\``,
    `- Received at: \`${report.receipt.received_at}\``,
    `- Profile fingerprint: \`${report.receipt.profile_fingerprint}\``,
    `- Signing key: \`${report.receipt.signing_key_id}\``,
    `- Cache budget: ${report.receipt.cache_freshness_budget_seconds}s`,
    `- Reviewer notes: ${report.receipt.reviewer_notes.join(" ")}`,
  ].join("\n")
}

const renderInlineList = (items: ReadonlyArray<string>): string =>
  items.length > 0
    ? items.map((item) => `\`${item}\``).join(", ")
    : "`none`"

const escapeTableCell = (value: string): string =>
  value.replaceAll("|", "\\|")

const repoPath = (path: string): string => relative(ROOT_DIR, path)

Effect.runPromise(program)
