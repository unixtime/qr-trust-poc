import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  makeProductionEvidencePrivateIndexTemplate,
  makeProductionEvidencePrivateIndexValidationReport,
  type OperatorEvidenceIndex,
  type OperatorEvidenceRef,
  type ProductionEvidencePrivateIndexTemplate,
  type ProductionEvidenceRequirements,
} from "../index.js"

const REQUIREMENTS_PATH = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/production-evidence-requirements-reference.json",
    import.meta.url,
  ),
)
const PRODUCTION_INDEX_PATH = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/operator-evidence-index-production-candidate.json",
    import.meta.url,
  ),
)
const GENERATED_AT = "2026-05-26T00:00:00Z"

const REQUIREMENTS = readJson<ProductionEvidenceRequirements>(REQUIREMENTS_PATH)
const PRODUCTION_INDEX = readJson<OperatorEvidenceIndex>(PRODUCTION_INDEX_PATH)

const template = makeProductionEvidencePrivateIndexTemplate({
  generatedAt: GENERATED_AT,
  requirements: REQUIREMENTS,
  operatorEvidenceIndex: PRODUCTION_INDEX,
})

assertTemplateShape(template)
assertDoesNotLeakActualRefs(template)

const blockedReport = makeProductionEvidencePrivateIndexValidationReport({
  generatedAt: GENERATED_AT,
  requirements: REQUIREMENTS,
  operatorEvidenceIndex: PRODUCTION_INDEX,
})

if (blockedReport.status !== "blocked") {
  throw new Error(`Expected blocked private index report, got ${blockedReport.status}`)
}
if (blockedReport.summary.refs_missing !== 13) {
  throw new Error(
    `Expected 13 missing refs, got ${blockedReport.summary.refs_missing}`,
  )
}
assertNoRefsInValidationReport(blockedReport)

const readyIndex = fillMissingRefs(PRODUCTION_INDEX, template)
const readyReport = makeProductionEvidencePrivateIndexValidationReport({
  generatedAt: GENERATED_AT,
  requirements: REQUIREMENTS,
  operatorEvidenceIndex: readyIndex,
})

if (readyReport.status !== "ready_for_human_review") {
  throw new Error(`Expected ready private index report, got ${readyReport.status}`)
}
if (readyReport.summary.refs_missing !== 0 || readyReport.summary.blockers !== 0) {
  throw new Error("Expected complete private index report to have no blockers")
}
assertNoRefsInValidationReport(readyReport)

console.log(
  JSON.stringify(
    {
      status: "ok",
      template_status: template.status,
      blocked_status: blockedReport.status,
      ready_status: readyReport.status,
      controls: template.controls.length,
      missing_refs: blockedReport.summary.refs_missing,
    },
    null,
    2,
  ),
)

function assertTemplateShape(
  template: ProductionEvidencePrivateIndexTemplate,
): void {
  if (template.artifact_type !== "production_evidence_private_index_template") {
    throw new Error("Unexpected private evidence template artifact_type")
  }
  if (template.summary.refs_missing !== 13) {
    throw new Error(`Expected template to expose 13 missing refs`)
  }
  if (template.controls.length !== 12) {
    throw new Error(`Expected 12 controls in private evidence template`)
  }
}

function assertDoesNotLeakActualRefs(
  template: ProductionEvidencePrivateIndexTemplate,
): void {
  const serialized = JSON.stringify(template)
  for (const uri of PRODUCTION_INDEX.controls.flatMap((control) =>
    control.evidence_refs.map((ref) => ref.uri),
  )) {
    if (serialized.includes(uri)) {
      throw new Error(`Private evidence template leaked existing ref ${uri}`)
    }
  }
}

function assertNoRefsInValidationReport(report: unknown): void {
  const serialized = JSON.stringify(report)
  if (serialized.includes("ops://qrtrust/")) {
    throw new Error("Private index validation report leaked evidence ref URIs")
  }
  if (serialized.includes("evidence_refs")) {
    throw new Error("Private index validation report leaked evidence_refs")
  }
}

function fillMissingRefs(
  index: OperatorEvidenceIndex,
  template: ProductionEvidencePrivateIndexTemplate,
): OperatorEvidenceIndex {
  return {
    ...index,
    index_id: "operator-evidence-index:production-candidate-ready:smoke",
    controls: index.controls.map((control) => {
      const templateControl = template.controls.find(
        (candidate) => candidate.control_id === control.control_id,
      )
      if (!templateControl) {
        throw new Error(`Missing template control for ${control.control_id}`)
      }
      const retainedRefs = control.evidence_refs.filter(
        (ref) => ref.uri !== "ops://qrtrust/governance-audit/2026-05-21",
      )
      const nextRefs: OperatorEvidenceRef[] = [...retainedRefs]
      for (
        let index = retainedRefs.length;
        index < templateControl.required_ref_count;
        index += 1
      ) {
        nextRefs.push({
          label: `Private ${control.control_id} evidence ${index + 1}`,
          uri: `ops://qrtrust/private-smoke/${control.control_id}/${index + 1}`,
          owner: templateControl.evidence_owner,
          review_role: templateControl.minimum_review_role,
          reviewed_at: "2026-05-26",
        })
      }
      return {
        ...control,
        evidence_refs: nextRefs,
      }
    }),
    reviewer: {
      name: "Private evidence reviewer",
      role: "production operator",
      reviewed_at: "2026-05-26",
    },
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}
