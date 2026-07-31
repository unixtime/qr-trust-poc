import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { Console, Effect } from "effect"

import {
  makeProductionEvidenceGapReport,
  type OperatorEvidenceIndex,
  type ProductionEvidenceGapControl,
  type ProductionEvidenceGapReport,
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
  new URL("../../../local/production-evidence-gap-report.json", import.meta.url),
)
const DEFAULT_MARKDOWN_OUTPUT = fileURLToPath(
  new URL("../../../local/production-evidence-gap-report.md", import.meta.url),
)

const program = Effect.gen(function* () {
  const requirementsPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_REQUIREMENTS_JSON ??
    DEFAULT_REQUIREMENTS_PATH
  const operatorIndexPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_INDEX_JSON ??
    DEFAULT_OPERATOR_INDEX_PATH
  const jsonOutputPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_GAP_JSON ?? DEFAULT_JSON_OUTPUT
  const markdownOutputPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_GAP_MD ?? DEFAULT_MARKDOWN_OUTPUT

  const requirements = readJson<ProductionEvidenceRequirements>(requirementsPath)
  const operatorEvidenceIndex =
    readJson<OperatorEvidenceIndex>(operatorIndexPath)
  const report = makeProductionEvidenceGapReport({
    generatedAt: new Date().toISOString(),
    requirements,
    operatorEvidenceIndex,
  })

  yield* writeReport(jsonOutputPath, `${JSON.stringify(report, null, 2)}\n`)
  yield* writeReport(
    markdownOutputPath,
    renderMarkdown(report, requirementsPath, operatorIndexPath),
  )

  yield* Console.log(
    JSON.stringify(
      {
        status: report.status,
        requirements_id: report.requirements_id,
        operator_evidence_index_id: report.operator_evidence_index_id,
        eligible_refs_provided: report.summary.refs_provided,
        minimum_refs_required: report.summary.refs_required,
        missing_refs_by_control: report.summary.refs_missing,
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
  report: ProductionEvidenceGapReport,
  requirementsPath: string,
  operatorIndexPath: string,
): string => `# Production Evidence Gap Report

Generated: ${report.generated_at}

Status: \`${report.status}\`

This report compares the production evidence requirements contract against the
operator evidence index. It is a gap report, not proof of production readiness.
The public repository should keep this distinction explicit because production
evidence belongs in operator-owned evidence storage.

## Inputs

- Requirements: \`${repoPath(requirementsPath)}\`
- Operator evidence index: \`${repoPath(operatorIndexPath)}\`
- Required ref scheme: \`${report.required_ref_scheme}\`
- Scope: \`${report.scope.environment}\`
- Boundary: ${report.scope.boundary}

## Summary

- Controls satisfied: ${report.summary.controls_satisfied}/${report.summary.controls_total}
- Controls missing refs: ${report.summary.controls_missing_refs}
- Controls missing from index: ${report.summary.controls_missing_control}
- Blocked controls: ${report.summary.controls_blocked}
- Eligible evidence refs provided: ${report.summary.refs_provided}
- Minimum evidence refs required: ${report.summary.refs_required}
- Evidence refs still missing by control: ${report.summary.refs_missing}

## Control Gaps

${renderControlsTable(report.controls)}

## Guardrails

${report.guardrails.map((guardrail) => `- ${guardrail}`).join("\n")}

## Next Actions

${report.next_actions.map((action) => `- ${action}`).join("\n")}
`

const renderControlsTable = (
  controls: ReadonlyArray<ProductionEvidenceGapControl>,
): string =>
  [
    "| Control | Owner | Reviewer | Refs | Status | Next action |",
    "| --- | --- | --- | --- | --- | --- |",
    ...controls.map(renderControlRow),
  ].join("\n")

const renderControlRow = (control: ProductionEvidenceGapControl): string =>
  `| \`${control.control_id}\` | ${escapeTableCell(control.evidence_owner)} | \`${control.minimum_review_role}\` | ${control.provided_refs}/${control.minimum_refs} | \`${control.status}\` | ${escapeTableCell(control.next_action)} |`

const escapeTableCell = (value: string): string =>
  value.replaceAll("|", "\\|").replaceAll("\n", " ")

const repoPath = (path: string): string => relative(ROOT_DIR, path)

Effect.runPromise(program).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
