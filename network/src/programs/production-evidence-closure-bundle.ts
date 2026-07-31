import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { Console, Effect } from "effect"

import {
  makeProductionEvidenceClosureBundle,
  type ProductionEvidenceClosureBundle,
  type ProductionEvidenceClosureItem,
  type ProductionEvidenceCollectionTemplate,
  type ProductionEvidenceGapReport,
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
const DEFAULT_COLLECTION_TEMPLATE_PATH = fileURLToPath(
  new URL(
    "../../../local/production-evidence-collection-template.json",
    import.meta.url,
  ),
)
const DEFAULT_GAP_REPORT_PATH = fileURLToPath(
  new URL("../../../local/production-evidence-gap-report.json", import.meta.url),
)
const DEFAULT_INTAKE_REPORT_PATH = fileURLToPath(
  new URL(
    "../../../local/production-evidence-intake-report.json",
    import.meta.url,
  ),
)
const DEFAULT_JSON_OUTPUT = fileURLToPath(
  new URL(
    "../../../local/production-evidence-closure-bundle.json",
    import.meta.url,
  ),
)
const DEFAULT_MARKDOWN_OUTPUT = fileURLToPath(
  new URL(
    "../../../local/production-evidence-closure-bundle.md",
    import.meta.url,
  ),
)

const program = Effect.gen(function* () {
  const requirementsPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_REQUIREMENTS_JSON ??
    DEFAULT_REQUIREMENTS_PATH
  const collectionTemplatePath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_JSON ??
    DEFAULT_COLLECTION_TEMPLATE_PATH
  const gapReportPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_GAP_JSON ?? DEFAULT_GAP_REPORT_PATH
  const intakeReportPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_INTAKE_JSON ??
    DEFAULT_INTAKE_REPORT_PATH
  const jsonOutputPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_CLOSURE_JSON ??
    DEFAULT_JSON_OUTPUT
  const markdownOutputPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_CLOSURE_MD ??
    DEFAULT_MARKDOWN_OUTPUT

  const requirements = readJson<ProductionEvidenceRequirements>(requirementsPath)
  const collectionTemplate =
    readJson<ProductionEvidenceCollectionTemplate>(collectionTemplatePath)
  const gapReport = readJson<ProductionEvidenceGapReport>(gapReportPath)
  const intakeReport =
    readJson<ProductionEvidenceIntakeReport>(intakeReportPath)
  const closureBundle = makeProductionEvidenceClosureBundle({
    generatedAt: new Date().toISOString(),
    requirements,
    collectionTemplate,
    gapReport,
    intakeReport,
  })

  yield* writeReport(
    jsonOutputPath,
    `${JSON.stringify(closureBundle, null, 2)}\n`,
  )
  yield* writeReport(
    markdownOutputPath,
    renderMarkdown(
      closureBundle,
      requirementsPath,
      collectionTemplatePath,
      gapReportPath,
      intakeReportPath,
    ),
  )

  yield* Console.log(
    JSON.stringify(
      {
        status: closureBundle.status,
        requirements_id: closureBundle.requirements_id,
        refs_missing: closureBundle.summary.refs_missing,
        closure_items: closureBundle.closure_items.length,
        intake_blockers: closureBundle.summary.intake_blockers,
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
  bundle: ProductionEvidenceClosureBundle,
  requirementsPath: string,
  collectionTemplatePath: string,
  gapReportPath: string,
  intakeReportPath: string,
): string => `# Production Evidence Closure Bundle

Generated: ${bundle.generated_at}

Status: \`${bundle.status}\`

This bundle is the operator handoff for the remaining production-reference
obligations. It does not contain production evidence. It tells the operator
which private \`ops://qrtrust/\` refs are still needed before the intake packet
can be accepted for human review.

## Inputs

- Requirements: \`${repoPath(requirementsPath)}\`
- Collection template: \`${repoPath(collectionTemplatePath)}\`
- Collection template id: \`${bundle.collection_template_id}\`
- Gap report: \`${repoPath(gapReportPath)}\`
- Gap report status: \`${bundle.gap_report_status}\`
- Intake report: \`${repoPath(intakeReportPath)}\`
- Intake report status: \`${bundle.intake_report_status}\`

## Summary

- Controls satisfied: ${bundle.summary.controls_satisfied}/${bundle.summary.controls_total}
- Controls needing operator refs: ${bundle.summary.controls_needing_operator_refs}
- Remaining refs: ${bundle.summary.refs_missing}
- Intake blockers: ${bundle.summary.intake_blockers}
- Ready for human review: ${bundle.summary.ready_for_review}

## Closure Items

${renderClosureItems(bundle.closure_items)}

## Guardrails

${bundle.guardrails.map((guardrail) => `- ${guardrail}`).join("\n")}

## Operator Next Actions

${bundle.operator_next_actions.map((action) => `- ${action}`).join("\n")}
`

const renderClosureItems = (
  items: ReadonlyArray<ProductionEvidenceClosureItem>,
): string => {
  if (items.length === 0) {
    return "No closure items. Route the packet for human production evidence review."
  }

  return items.map(renderClosureItem).join("\n\n")
}

const renderClosureItem = (item: ProductionEvidenceClosureItem): string => `### ${item.title}

- Control: \`${item.control_id}\`
- Layer: \`${item.layer}\`
- Evidence owner: ${item.evidence_owner}
- Review role: \`${item.minimum_review_role}\`
- Missing refs: ${item.missing_refs}
- Next action: ${item.next_action}

| Required artifact class | Collection slot |
| --- | --- |
${item.required_artifacts
  .map(
    (artifact, index) =>
      `| ${escapeTableCell(artifact)} | \`${item.collection_slots[index] ?? "missing-template-slot"}\` |`,
  )
  .join("\n")}
`

const escapeTableCell = (value: string): string =>
  value.replaceAll("|", "\\|").replaceAll("\n", " ")

const repoPath = (path: string): string => relative(ROOT_DIR, path)

Effect.runPromise(program).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
