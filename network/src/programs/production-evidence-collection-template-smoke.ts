import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  assertProductionEvidenceCollectionTemplate,
  assertProductionEvidenceCollectionTemplateMatches,
  makeProductionEvidenceCollectionTemplate,
  type ProductionEvidenceCollectionTemplate,
  type ProductionEvidenceRequirements,
} from "../index.js"

const REQUIREMENTS_PATH = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/production-evidence-requirements-reference.json",
    import.meta.url,
  ),
)

const REQUIREMENTS = readJson<ProductionEvidenceRequirements>(REQUIREMENTS_PATH)
const template = makeTemplate()
const requiredArtifactCount = REQUIREMENTS.controls.reduce(
  (total, control) => total + control.required_artifacts.length,
  0,
)
const minimumRefCount = REQUIREMENTS.controls.reduce(
  (total, control) => total + control.minimum_refs,
  0,
)

if (template.summary.evidence_slots_total !== requiredArtifactCount) {
  throw new Error(
    `Expected ${requiredArtifactCount} evidence collection slots, got ${template.summary.evidence_slots_total}`,
  )
}
if (template.summary.minimum_refs_required !== minimumRefCount) {
  throw new Error(
    `Expected ${minimumRefCount} minimum refs, got ${template.summary.minimum_refs_required}`,
  )
}
assertProductionEvidenceCollectionTemplateMatches(template, REQUIREMENTS)

expectInvalidTemplate("stale required artifact slot", () =>
  assertProductionEvidenceCollectionTemplateMatches(
    {
      ...template,
      controls: template.controls.map((control, index) =>
        index === 0
          ? {
              ...control,
              evidence_slots: control.evidence_slots.slice(1),
            }
          : control,
      ),
    },
    REQUIREMENTS,
  ),
)
expectInvalidTemplate("private material must be rejected", () =>
  assertProductionEvidenceCollectionTemplate({
    ...template,
    reviewer_note: "BEGIN PRIVATE KEY",
  }),
)
expectInvalidTemplate("concrete refs cannot be used as placeholders", () =>
  assertProductionEvidenceCollectionTemplate({
    ...template,
    controls: template.controls.map((control, index) =>
      index === 0
        ? {
            ...control,
            evidence_slots: control.evidence_slots.map((slot, slotIndex) =>
              slotIndex === 0
                ? {
                    ...slot,
                    placeholder_uri_pattern:
                      "ops://qrtrust/prod/postgres_source_of_truth/schema",
                  }
                : slot,
            ),
          }
        : control,
    ),
  }),
)

console.log(
  JSON.stringify(
    {
      status: "ok",
      template_id: template.template_id,
      requirements_id: template.requirements_id,
      controls: template.summary.controls_total,
      evidence_slots: template.summary.evidence_slots_total,
      minimum_refs_required: template.summary.minimum_refs_required,
    },
    null,
    2,
  ),
)

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function makeTemplate(): ProductionEvidenceCollectionTemplate {
  return makeProductionEvidenceCollectionTemplate({
    templateId: "production-evidence-collection-template:smoke:2026-05-22",
    generatedAt: "2026-05-22T00:00:00Z",
    requirements: REQUIREMENTS,
  })
}

function expectInvalidTemplate(label: string, run: () => unknown): void {
  try {
    run()
  } catch {
    return
  }

  throw new Error(`Expected invalid production evidence collection template: ${label}`)
}
