import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { Console, Effect } from "effect"

import {
  makeProductionEvidencePrivateIndexTemplate,
  type OperatorEvidenceIndex,
  type ProductionEvidencePrivateIndexTemplate,
  type ProductionEvidencePrivateIndexTemplateControl,
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
    "../../../local/production-evidence-private-template.json",
    import.meta.url,
  ),
)
const DEFAULT_MARKDOWN_OUTPUT = fileURLToPath(
  new URL(
    "../../../local/production-evidence-private-template.md",
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
    process.env.QRTRUST_PRODUCTION_EVIDENCE_PRIVATE_TEMPLATE_JSON ??
    DEFAULT_JSON_OUTPUT
  const markdownOutputPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_PRIVATE_TEMPLATE_MD ??
    DEFAULT_MARKDOWN_OUTPUT

  const requirements = readJson<ProductionEvidenceRequirements>(requirementsPath)
  const operatorEvidenceIndex =
    readJson<OperatorEvidenceIndex>(operatorIndexPath)
  const template = makeProductionEvidencePrivateIndexTemplate({
    generatedAt: new Date().toISOString(),
    requirements,
    operatorEvidenceIndex,
  })

  yield* writeReport(jsonOutputPath, `${JSON.stringify(template, null, 2)}\n`)
  yield* writeReport(markdownOutputPath, renderMarkdown(template))

  yield* Console.log(
    JSON.stringify(
      {
        status: template.status,
        controls: template.controls.length,
        refs_missing: template.summary.refs_missing,
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
  template: ProductionEvidencePrivateIndexTemplate,
): string => `# Production Evidence Private Template

Generated: ${template.generated_at}

Status: \`${template.status}\`

This local-only template tells an operator which private evidence refs are
needed before a production-candidate operator evidence index can enter human
review. It does not contain production evidence.

## Summary

- Controls satisfied: ${template.summary.controls_satisfied}/${template.summary.controls_total}
- Controls needing private refs: ${template.summary.controls_needing_refs}
- Required refs: ${template.summary.refs_required}
- Current eligible refs: ${template.summary.refs_provided}
- Missing refs: ${template.summary.refs_missing}

## Controls

${template.controls.map(renderControl).join("\n\n")}

## Guardrails

${template.guardrails.map((guardrail) => `- ${guardrail}`).join("\n")}

## Next Actions

${template.next_actions.map((action) => `- ${action}`).join("\n")}
`

const renderControl = (
  control: ProductionEvidencePrivateIndexTemplateControl,
): string => `### ${control.title}

- Control: \`${control.control_id}\`
- Evidence owner: ${control.evidence_owner}
- Review role: \`${control.minimum_review_role}\`
- Required refs: ${control.required_ref_count}
- Current eligible refs: ${control.current_eligible_ref_count}
- Missing refs: ${control.missing_ref_count}
- Instruction: ${control.private_index_instruction}

| Artifact class | Private ref slot |
| --- | --- |
${control.collection_slots
  .map(
    (slot) =>
      `| ${escapeTableCell(slot.artifact_class)} | \`${slot.placeholder_uri_pattern}\` |`,
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
