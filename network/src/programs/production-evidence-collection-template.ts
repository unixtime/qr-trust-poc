import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { Console, Effect } from "effect"

import {
  makeProductionEvidenceCollectionTemplate,
  type ProductionEvidenceCollectionControl,
  type ProductionEvidenceCollectionTemplate,
  type ProductionEvidenceRequirements,
} from "../index.js"

const ROOT_DIR = fileURLToPath(new URL("../../../", import.meta.url))
const DEFAULT_REQUIREMENTS_PATH = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/production-evidence-requirements-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_JSON_OUTPUT = fileURLToPath(
  new URL(
    "../../../local/production-evidence-collection-template.json",
    import.meta.url,
  ),
)
const DEFAULT_MARKDOWN_OUTPUT = fileURLToPath(
  new URL(
    "../../../local/production-evidence-collection-template.md",
    import.meta.url,
  ),
)

const program = Effect.gen(function* () {
  const requirementsPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_REQUIREMENTS_JSON ??
    DEFAULT_REQUIREMENTS_PATH
  const jsonOutputPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_JSON ??
    DEFAULT_JSON_OUTPUT
  const markdownOutputPath =
    process.env.QRTRUST_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_MD ??
    DEFAULT_MARKDOWN_OUTPUT

  const requirements = readJson<ProductionEvidenceRequirements>(requirementsPath)
  const template = makeProductionEvidenceCollectionTemplate({
    templateId:
      process.env.QRTRUST_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_ID ??
      "production-evidence-collection-template:reference:2026-05-22",
    generatedAt:
      process.env.QRTRUST_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_GENERATED_AT ??
      new Date().toISOString(),
    requirements,
  })

  yield* writeReport(jsonOutputPath, `${JSON.stringify(template, null, 2)}\n`)
  yield* writeReport(
    markdownOutputPath,
    renderMarkdown(template, requirementsPath),
  )

  yield* Console.log(
    JSON.stringify(
      {
        status: "template_written",
        template_id: template.template_id,
        requirements_id: template.requirements_id,
        controls: template.summary.controls_total,
        evidence_slots: template.summary.evidence_slots_total,
        minimum_refs_required: template.summary.minimum_refs_required,
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
  template: ProductionEvidenceCollectionTemplate,
  requirementsPath: string,
): string => `# Production Evidence Collection Template

Generated: ${template.generated_at}

Template: \`${template.template_id}\`

Requirements: \`${repoPath(requirementsPath)}\`

This is the operator-facing collection checklist for production-candidate
evidence refs. It does not contain evidence. Operators should replace each
placeholder pattern with a reviewed \`${template.required_ref_scheme}\` URI in
their private evidence store, then update the production-candidate operator
evidence index.

## Summary

- Controls: ${template.summary.controls_total}
- Evidence artifact slots: ${template.summary.evidence_slots_total}
- Minimum refs required for current gap report: ${template.summary.minimum_refs_required}
- Evidence owners: ${template.summary.unique_evidence_owners.join(", ")}

## Guardrails

- Template contains no evidence: ${template.guardrails.template_contains_no_evidence}
- Placeholder refs are not proof: ${template.guardrails.placeholder_refs_are_not_proof}
- Production refs must use \`${template.required_ref_scheme}\`: ${template.guardrails.production_refs_must_use_ops_scheme}
- Operator storage remains external: ${template.guardrails.operator_storage_remains_external}

## Collection Checklist

${template.controls.map(renderControl).join("\n\n")}
`

const renderControl = (
  control: ProductionEvidenceCollectionControl,
): string => `### ${control.title}

- Control: \`${control.control_id}\`
- Layer: \`${control.layer}\`
- Owner: ${control.evidence_owner}
- Minimum review role: \`${control.minimum_review_role}\`
- Minimum refs: ${control.minimum_refs}
- Why required: ${control.why_required}
- Retention: ${control.retention_policy}

| Slot | Artifact class | Placeholder pattern | Prompt |
| --- | --- | --- | --- |
${control.evidence_slots
  .map(
    (slot) =>
      `| \`${slot.slot_id}\` | ${escapeTableCell(slot.artifact_class)} | \`${slot.placeholder_uri_pattern}\` | ${escapeTableCell(slot.operator_prompt)} |`,
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
