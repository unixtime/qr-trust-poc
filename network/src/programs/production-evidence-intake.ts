import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { Console, Effect } from "effect"

import {
  makeProductionEvidenceIntakeReport,
  type OperatorEvidenceIndex,
  type ProductionEvidenceCollectionTemplate,
  type ProductionEvidenceGapReport,
  type ProductionEvidenceIntakeFinding,
  type ProductionEvidenceIntakeReport,
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
const DEFAULT_COLLECTION_TEMPLATE_PATH = fileURLToPath(
  new URL(
    "../../../local/production-evidence-collection-template.json",
    import.meta.url,
  ),
)
const DEFAULT_GAP_REPORT_PATH = fileURLToPath(
  new URL("../../../local/production-evidence-gap-report.json", import.meta.url),
)
const DEFAULT_JSON_OUTPUT = fileURLToPath(
  new URL("../../../local/production-evidence-intake-report.json", import.meta.url),
)
const DEFAULT_MARKDOWN_OUTPUT = fileURLToPath(
  new URL("../../../local/production-evidence-intake-report.md", import.meta.url),
)

const program = Effect.gen(function* () {
  const requirementsPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_REQUIREMENTS_JSON ??
    DEFAULT_REQUIREMENTS_PATH
  const operatorIndexPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_INDEX_JSON ??
    DEFAULT_OPERATOR_INDEX_PATH
  const collectionTemplatePath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_JSON ??
    DEFAULT_COLLECTION_TEMPLATE_PATH
  const gapReportPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_GAP_JSON ?? DEFAULT_GAP_REPORT_PATH
  const jsonOutputPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_INTAKE_JSON ?? DEFAULT_JSON_OUTPUT
  const markdownOutputPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_INTAKE_MD ??
    DEFAULT_MARKDOWN_OUTPUT

  const requirements = readJson<ProductionEvidenceRequirements>(requirementsPath)
  const operatorEvidenceIndex =
    readJson<OperatorEvidenceIndex>(operatorIndexPath)
  const collectionTemplate =
    readJson<ProductionEvidenceCollectionTemplate>(collectionTemplatePath)
  const gapReport = readJson<ProductionEvidenceGapReport>(gapReportPath)
  const generatedAt = new Date().toISOString()
  const intakeReport = makeProductionEvidenceIntakeReport({
    generatedAt,
    requirements,
    operatorEvidenceIndex,
    collectionTemplate,
    gapReport,
  })

  yield* writeReport(
    jsonOutputPath,
    `${JSON.stringify(intakeReport, null, 2)}\n`,
  )
  yield* writeReport(
    markdownOutputPath,
    renderMarkdown(
      intakeReport,
      requirementsPath,
      operatorIndexPath,
      collectionTemplatePath,
      gapReportPath,
    ),
  )

  yield* Console.log(
    JSON.stringify(
      {
        status: intakeReport.status,
        requirements_id: intakeReport.requirements_id,
        operator_evidence_index_id: intakeReport.operator_evidence_index_id,
        blockers: intakeReport.summary.blockers,
        informational_findings: intakeReport.summary.informational_findings,
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

const writeReport = (
  path: string,
  contents: string,
): Effect.Effect<void> =>
  Effect.sync(() => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents)
  })

const renderMarkdown = (
  report: ProductionEvidenceIntakeReport,
  requirementsPath: string,
  operatorIndexPath: string,
  collectionTemplatePath: string,
  gapReportPath: string,
): string => `# Production Evidence Intake Report

Generated: ${report.generated_at}

Status: \`${report.status}\`

This report validates whether an operator evidence packet is ready for human
production-evidence review. It is not production approval and does not prove
that production controls exist.

## Inputs

- Requirements: \`${repoPath(requirementsPath)}\`
- Operator evidence index: \`${repoPath(operatorIndexPath)}\`
- Collection template: \`${repoPath(collectionTemplatePath)}\`
- Collection template id: \`${report.collection_template_id}\`
- Gap report: \`${repoPath(gapReportPath)}\`
- Gap report status: \`${report.gap_report_status}\`

## Summary

- Controls satisfied: ${report.summary.controls_satisfied}/${report.summary.controls_total}
- Eligible evidence refs provided: ${report.summary.refs_provided}
- Minimum evidence refs required: ${report.summary.refs_required}
- Blocker findings: ${report.summary.blockers}
- Informational findings: ${report.summary.informational_findings}

## Findings

${renderFindingsTable(report.findings)}

## Guardrails

${report.guardrails.map((guardrail) => `- ${guardrail}`).join("\n")}

## Next Actions

${report.next_actions.map((action) => `- ${action}`).join("\n")}
`

const renderFindingsTable = (
  findings: ReadonlyArray<ProductionEvidenceIntakeFinding>,
): string => {
  if (findings.length === 0) {
    return "No findings. The packet is accepted for human review."
  }

  return [
    "| Severity | Code | Control | Ref | Message |",
    "| --- | --- | --- | --- | --- |",
    ...findings.map(renderFindingRow),
  ].join("\n")
}

const renderFindingRow = (finding: ProductionEvidenceIntakeFinding): string =>
  `| \`${finding.severity}\` | \`${finding.code}\` | ${formatOptional(finding.control_id)} | ${formatOptional(finding.ref_uri)} | ${escapeTableCell(finding.message)} |`

const formatOptional = (value: string | undefined): string =>
  value === undefined ? "-" : `\`${escapeTableCell(value)}\``

const escapeTableCell = (value: string): string =>
  value.replaceAll("|", "\\|").replaceAll("\n", " ")

const repoPath = (path: string): string => relative(ROOT_DIR, path)

Effect.runPromise(program).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
