import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { Console, Effect } from "effect"

import {
  makeProductionEvidencePrivateIndexValidationReport,
  type OperatorEvidenceIndex,
  type ProductionEvidencePrivateIndexValidationFinding,
  type ProductionEvidencePrivateIndexValidationReport,
  type ProductionEvidenceRequirements,
} from "../index.js"

const ROOT_DIR = fileURLToPath(new URL("../../../", import.meta.url))
const DEFAULT_REQUIREMENTS_PATH = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/production-evidence-requirements-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_OPERATOR_INDEX_PATH = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/operator-evidence-index-production-candidate.json",
    import.meta.url,
  ),
)
const DEFAULT_JSON_OUTPUT = fileURLToPath(
  new URL(
    "../../../local/production-evidence-private-index-validation.json",
    import.meta.url,
  ),
)
const DEFAULT_MARKDOWN_OUTPUT = fileURLToPath(
  new URL(
    "../../../local/production-evidence-private-index-validation.md",
    import.meta.url,
  ),
)

const program = Effect.gen(function* () {
  const requirementsPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_REQUIREMENTS_JSON ??
    DEFAULT_REQUIREMENTS_PATH
  const operatorIndexPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_INDEX_JSON ??
    DEFAULT_OPERATOR_INDEX_PATH
  const jsonOutputPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_PRIVATE_INDEX_CHECK_JSON ??
    DEFAULT_JSON_OUTPUT
  const markdownOutputPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_PRIVATE_INDEX_CHECK_MD ??
    DEFAULT_MARKDOWN_OUTPUT

  const requirements = readJson<ProductionEvidenceRequirements>(requirementsPath)
  const operatorEvidenceIndex = readPrivateIndex(operatorIndexPath)
  const report = makeProductionEvidencePrivateIndexValidationReport({
    generatedAt: new Date().toISOString(),
    requirements,
    operatorEvidenceIndex,
  })

  yield* writeReport(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`)
  yield* writeReport(markdownOutputPath, renderMarkdown(report))

  yield* Console.log(
    JSON.stringify(
      {
        status: report.status,
        controls_satisfied: report.summary.controls_satisfied,
        refs_missing: report.summary.refs_missing,
        blockers: report.summary.blockers,
        ready_for_human_review: report.summary.ready_for_human_review,
        json: repoPath(jsonOutputPath),
        markdown: repoPath(markdownOutputPath),
      },
      null,
      2,
    ),
  )
})

const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T

const readPrivateIndex = (path: string): OperatorEvidenceIndex => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as OperatorEvidenceIndex
  } catch {
    throw new Error("Could not read configured private operator evidence index")
  }
}

const writeReport = (
  path: string,
  contents: string,
): Effect.Effect<void> =>
  Effect.sync(() => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents)
  })

const renderMarkdown = (
  report: ProductionEvidencePrivateIndexValidationReport,
): string => `# Production Evidence Private Index Validation

Generated: ${report.generated_at}

Status: \`${report.status}\`

This local-only validation report intentionally omits evidence ref URIs and
evidence bodies. It is safe to share as a summary, but the underlying private
operator evidence index remains operator-owned.

## Summary

- Controls satisfied: ${report.summary.controls_satisfied}/${report.summary.controls_total}
- Required refs: ${report.summary.refs_required}
- Current eligible refs: ${report.summary.refs_provided}
- Missing refs: ${report.summary.refs_missing}
- Blockers: ${report.summary.blockers}
- Ready for human review: ${report.summary.ready_for_human_review}

## Findings

${renderFindings(report.findings)}

## Guardrails

${report.guardrails.map((guardrail) => `- ${guardrail}`).join("\n")}

## Next Actions

${report.next_actions.map((action) => `- ${action}`).join("\n")}
`

const renderFindings = (
  findings: ReadonlyArray<ProductionEvidencePrivateIndexValidationFinding>,
): string => {
  if (findings.length === 0) {
    return "No findings."
  }

  return `| Severity | Code | Control | Message |
| --- | --- | --- | --- |
${findings
  .map(
    (finding) =>
      `| \`${finding.severity}\` | \`${finding.code}\` | ${finding.control_id ? `\`${finding.control_id}\`` : "-"} | ${escapeTableCell(finding.message)} |`,
  )
  .join("\n")}`
}

const escapeTableCell = (value: string): string =>
  value.replaceAll("|", "\\|").replaceAll("\n", " ")

const repoPath = (path: string): string => relative(ROOT_DIR, path)

Effect.runPromise(program).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
