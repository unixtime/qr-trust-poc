import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  assertProductionEvidenceClosureBundleMatches,
  makeProductionEvidenceClosureBundle,
  makeProductionEvidenceCollectionTemplate,
  makeProductionEvidenceGapReport,
  makeProductionEvidenceIntakeReport,
  type OperatorEvidenceIndex,
  type ProductionEvidenceClosureBundle,
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
const COLLECTION_TEMPLATE = makeProductionEvidenceCollectionTemplate({
  templateId: "production-evidence-collection-template:closure-smoke:2026-05-26",
  generatedAt: GENERATED_AT,
  requirements: REQUIREMENTS,
})
const GAP_REPORT = makeProductionEvidenceGapReport({
  generatedAt: GENERATED_AT,
  requirements: REQUIREMENTS,
  operatorEvidenceIndex: PRODUCTION_INDEX,
})
const INTAKE_REPORT = makeProductionEvidenceIntakeReport({
  generatedAt: GENERATED_AT,
  requirements: REQUIREMENTS,
  operatorEvidenceIndex: PRODUCTION_INDEX,
  collectionTemplate: COLLECTION_TEMPLATE,
  gapReport: GAP_REPORT,
})

const bundle = makeProductionEvidenceClosureBundle({
  generatedAt: GENERATED_AT,
  requirements: REQUIREMENTS,
  collectionTemplate: COLLECTION_TEMPLATE,
  gapReport: GAP_REPORT,
  intakeReport: INTAKE_REPORT,
})

if (bundle.status !== "blocked_until_operator_refs_complete") {
  throw new Error(`Expected blocked closure bundle, got ${bundle.status}`)
}
if (bundle.summary.refs_missing !== 13) {
  throw new Error(`Expected 13 missing refs, got ${bundle.summary.refs_missing}`)
}
if (bundle.closure_items.length !== 10) {
  throw new Error(
    `Expected 10 control closure items, got ${bundle.closure_items.length}`,
  )
}
if (bundle.operator_next_actions[0] !== "Collect 13 remaining ops://qrtrust/ evidence refs in the operator-owned evidence store.") {
  throw new Error("Expected operator next action to lead with missing-ref count")
}
if (
  bundle.closure_items.some((item) =>
    item.collection_slots.some((slot) => !slot.startsWith("ops://qrtrust/")),
  )
) {
  throw new Error("Expected every closure slot to use ops://qrtrust/")
}
assertProductionEvidenceClosureBundleMatches(bundle, {
  generatedAt: bundle.generated_at,
  requirements: REQUIREMENTS,
  collectionTemplate: COLLECTION_TEMPLATE,
  gapReport: GAP_REPORT,
  intakeReport: INTAKE_REPORT,
})

console.log(
  JSON.stringify(
    {
      status: "ok",
      bundle_status: bundle.status,
      refs_missing: bundle.summary.refs_missing,
      closure_items: bundle.closure_items.length,
      intake_blockers: bundle.summary.intake_blockers,
    },
    null,
    2,
  ),
)

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}
