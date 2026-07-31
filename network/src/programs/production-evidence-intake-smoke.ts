import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  assertProductionEvidenceIntakeReportMatches,
  makeProductionEvidenceCollectionTemplate,
  makeProductionEvidenceGapReport,
  makeProductionEvidenceIntakeReport,
  type OperatorEvidenceIndex,
  type OperatorEvidenceRef,
  type ProductionEvidenceCollectionTemplate,
  type ProductionEvidenceGapReport,
  type ProductionEvidenceIntakeFindingCode,
  type ProductionEvidenceIntakeReport,
  type ProductionEvidenceRequirements,
  type ProductionEvidenceReviewRole,
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

const GENERATED_AT = "2026-05-22T00:00:00Z"
const REQUIREMENTS = readJson<ProductionEvidenceRequirements>(REQUIREMENTS_PATH)
const PRODUCTION_INDEX = readJson<OperatorEvidenceIndex>(PRODUCTION_INDEX_PATH)
const TEMPLATE = makeProductionEvidenceCollectionTemplate({
  templateId: "production-evidence-collection-template:intake-smoke:2026-05-22",
  generatedAt: GENERATED_AT,
  requirements: REQUIREMENTS,
})

const currentGap = makeGapReport(PRODUCTION_INDEX)
const currentIntake = makeIntakeReport(PRODUCTION_INDEX, TEMPLATE, currentGap)
if (currentIntake.status !== "blocked") {
  throw new Error(
    `Expected current production evidence intake to be blocked, got ${currentIntake.status}`,
  )
}
if (!hasBlocker(currentIntake, "gap_report_incomplete")) {
  throw new Error("Expected incomplete gap report blocker")
}
if (!hasBlocker(currentIntake, "placeholder_ref")) {
  throw new Error("Expected placeholder evidence ref blocker")
}
if (currentIntake.summary.informational_findings !== 0) {
  throw new Error(
    `Expected blocked intake to suppress reviewer-only info findings, got ${currentIntake.summary.informational_findings}`,
  )
}
assertProductionEvidenceIntakeReportMatches(currentIntake, {
  generatedAt: currentIntake.generated_at,
  requirements: REQUIREMENTS,
  operatorEvidenceIndex: PRODUCTION_INDEX,
  collectionTemplate: TEMPLATE,
  gapReport: currentGap,
})

const readyIndex = makeIntakeReadyIndex(PRODUCTION_INDEX)
const readyGap = makeGapReport(readyIndex)
const readyIntake = makeIntakeReport(readyIndex, TEMPLATE, readyGap)
if (readyIntake.status !== "accepted_for_review") {
  throw new Error(
    `Expected synthetic complete production evidence intake, got ${readyIntake.status}`,
  )
}
if (readyIntake.summary.blockers !== 0) {
  throw new Error("Expected synthetic complete intake to have zero blockers")
}
if (readyIntake.summary.informational_findings !== 0) {
  throw new Error("Expected synthetic complete intake to have zero info findings")
}
assertProductionEvidenceIntakeReportMatches(readyIntake, {
  generatedAt: readyIntake.generated_at,
  requirements: REQUIREMENTS,
  operatorEvidenceIndex: readyIndex,
  collectionTemplate: TEMPLATE,
  gapReport: readyGap,
})

const ownerMismatchIndex = withOwnerMismatch(readyIndex)
const ownerMismatchIntake = makeIntakeReport(
  ownerMismatchIndex,
  TEMPLATE,
  makeGapReport(ownerMismatchIndex),
)
if (ownerMismatchIntake.status !== "accepted_for_review") {
  throw new Error("Expected owner mismatch intake to remain reviewable")
}
if (ownerMismatchIntake.summary.informational_findings !== 1) {
  throw new Error("Expected owner mismatch intake to report one info finding")
}
if (!hasInfo(ownerMismatchIntake, "owner_alignment")) {
  throw new Error("Expected owner alignment info finding")
}

const placeholderIndex = withPlaceholderRef(readyIndex)
const placeholderIntake = makeIntakeReport(
  placeholderIndex,
  TEMPLATE,
  makeGapReport(placeholderIndex),
)
if (!hasBlocker(placeholderIntake, "placeholder_ref")) {
  throw new Error("Expected placeholder ref intake blocker")
}

const duplicateIndex = withDuplicateRef(readyIndex)
const duplicateIntake = makeIntakeReport(
  duplicateIndex,
  TEMPLATE,
  makeGapReport(duplicateIndex),
)
if (!hasBlocker(duplicateIntake, "duplicate_ref")) {
  throw new Error("Expected duplicate ref intake blocker")
}

expectInvalidIntake("stale collection template", () =>
  makeIntakeReport(readyIndex, TEMPLATE, currentGap),
)
expectInvalidIntake("stale report comparison", () =>
  assertProductionEvidenceIntakeReportMatches(readyIntake, {
    generatedAt: readyIntake.generated_at,
    requirements: REQUIREMENTS,
    operatorEvidenceIndex: PRODUCTION_INDEX,
    collectionTemplate: TEMPLATE,
    gapReport: currentGap,
  }),
)

console.log(
  JSON.stringify(
    {
      status: "ok",
      requirements_id: REQUIREMENTS.requirements_id,
      current_intake_status: currentIntake.status,
      current_blockers: currentIntake.summary.blockers,
      synthetic_intake_status: readyIntake.status,
      synthetic_blockers: readyIntake.summary.blockers,
    },
    null,
    2,
  ),
)

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function makeGapReport(
  operatorEvidenceIndex: OperatorEvidenceIndex,
): ProductionEvidenceGapReport {
  return makeProductionEvidenceGapReport({
    generatedAt: GENERATED_AT,
    requirements: REQUIREMENTS,
    operatorEvidenceIndex,
  })
}

function makeIntakeReport(
  operatorEvidenceIndex: OperatorEvidenceIndex,
  collectionTemplate: ProductionEvidenceCollectionTemplate,
  gapReport: ProductionEvidenceGapReport,
): ProductionEvidenceIntakeReport {
  return makeProductionEvidenceIntakeReport({
    generatedAt: GENERATED_AT,
    requirements: REQUIREMENTS,
    operatorEvidenceIndex,
    collectionTemplate,
    gapReport,
  })
}

function makeIntakeReadyIndex(index: OperatorEvidenceIndex): OperatorEvidenceIndex {
  const next = structuredClone(index)
  return {
    ...next,
    index_id: "operator-evidence-index:production-candidate:intake-ready",
    generated_at: GENERATED_AT,
    controls: next.controls.map((control) => {
      const requirement = REQUIREMENTS.controls.find(
        (item) => item.control_id === control.control_id,
      )
      if (!requirement) {
        throw new Error(`Missing requirement for ${control.control_id}`)
      }

      return {
        ...control,
        owner: requirement.evidence_owner,
        evidence_refs: Array.from(
          { length: requirement.minimum_refs },
          (_item, index) =>
            makeSyntheticRef(
              control.control_id,
              index + 1,
              requirement.evidence_owner,
              requirement.minimum_review_role,
            ),
        ),
      }
    }),
  }
}

function makeSyntheticRef(
  controlId: string,
  index: number,
  owner: string,
  reviewRole: ProductionEvidenceReviewRole,
): OperatorEvidenceRef {
  return {
    label: `Reviewed ${controlId} evidence ${index}`,
    uri: `ops://qrtrust/intake-ready/${controlId}/${index}`,
    owner,
    review_role: reviewRole,
    reviewed_at: "2026-05-22",
  }
}

function withPlaceholderRef(index: OperatorEvidenceIndex): OperatorEvidenceIndex {
  const next = structuredClone(index)
  return {
    ...next,
    index_id: `${next.index_id}:placeholder`,
    controls: next.controls.map((control, controlIndex) =>
      controlIndex === 0
        ? {
            ...control,
            evidence_refs: control.evidence_refs.map((ref, refIndex) =>
              refIndex === 0
                ? {
                    ...ref,
                    label: "Template placeholder awaiting operator upload",
                    uri: `ops://qrtrust/{environment}/${control.control_id}/artifact-slug/review-date`,
                  }
                : ref,
            ),
          }
        : control,
    ),
  }
}

function withDuplicateRef(index: OperatorEvidenceIndex): OperatorEvidenceIndex {
  const next = structuredClone(index)
  const duplicateUri = next.controls[0]?.evidence_refs[0]?.uri
  if (!duplicateUri) {
    throw new Error("Synthetic intake-ready index has no evidence refs")
  }
  return {
    ...next,
    index_id: `${next.index_id}:duplicate`,
    controls: next.controls.map((control, controlIndex) =>
      controlIndex === 1
        ? {
            ...control,
            evidence_refs: control.evidence_refs.map((ref, refIndex) =>
              refIndex === 0
                ? {
                    ...ref,
                    uri: duplicateUri,
                  }
                : ref,
            ),
          }
        : control,
    ),
  }
}

function withOwnerMismatch(index: OperatorEvidenceIndex): OperatorEvidenceIndex {
  const next = structuredClone(index)
  return {
    ...next,
    index_id: `${next.index_id}:owner-mismatch`,
    controls: next.controls.map((control, controlIndex) =>
      controlIndex === 0
        ? {
            ...control,
            owner: "QR Trust operator",
          }
        : control,
    ),
  }
}

function hasBlocker(
  report: ProductionEvidenceIntakeReport,
  code: ProductionEvidenceIntakeFindingCode,
): boolean {
  return report.findings.some(
    (finding) => finding.severity === "blocker" && finding.code === code,
  )
}

function hasInfo(
  report: ProductionEvidenceIntakeReport,
  code: ProductionEvidenceIntakeFindingCode,
): boolean {
  return report.findings.some(
    (finding) => finding.severity === "info" && finding.code === code,
  )
}

function expectInvalidIntake(label: string, run: () => unknown): void {
  try {
    run()
  } catch {
    return
  }

  throw new Error(`Expected invalid production evidence intake: ${label}`)
}
