import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  assertProductionEvidenceGapReportMatches,
  makeProductionEvidenceGapReport,
  type OperatorEvidenceIndex,
  type OperatorEvidenceRef,
  type ProductionEvidenceGapReport,
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
const REFERENCE_INDEX_PATH = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/operator-evidence-index-reference.json",
    import.meta.url,
  ),
)

const REQUIREMENTS = readJson<ProductionEvidenceRequirements>(REQUIREMENTS_PATH)
const PRODUCTION_INDEX = readJson<OperatorEvidenceIndex>(PRODUCTION_INDEX_PATH)
const REFERENCE_INDEX = readJson<OperatorEvidenceIndex>(REFERENCE_INDEX_PATH)

const currentReport = makeReport(PRODUCTION_INDEX)
if (currentReport.status !== "incomplete") {
  throw new Error(
    `Expected current production evidence gap report to be incomplete, got ${currentReport.status}`,
  )
}
if (currentReport.summary.refs_missing < 1) {
  throw new Error("Expected current production evidence gap report to miss refs")
}
assertProductionEvidenceGapReportMatches(
  currentReport,
  REQUIREMENTS,
  PRODUCTION_INDEX,
)

const completeReport = makeReport(makeCompleteIndex(PRODUCTION_INDEX))
if (completeReport.status !== "complete") {
  throw new Error(
    `Expected synthetic complete production evidence gap report, got ${completeReport.status}`,
  )
}
if (completeReport.summary.refs_missing !== 0) {
  throw new Error("Expected synthetic complete report to have zero missing refs")
}

const wrongRoleReport = makeReport(withWrongReviewRole(makeCompleteIndex(PRODUCTION_INDEX)))
if (wrongRoleReport.status !== "incomplete") {
  throw new Error(
    `Expected wrong-role production evidence refs to leave the report incomplete, got ${wrongRoleReport.status}`,
  )
}
if (wrongRoleReport.summary.refs_missing < 1) {
  throw new Error("Expected wrong-role production evidence refs to be missing")
}

expectInvalidReport("reference drill index cannot support production gap report", () =>
  makeReport(REFERENCE_INDEX),
)
expectInvalidReport("production ref missing review role", () =>
  makeReport(withMissingReviewRole(PRODUCTION_INDEX)),
)
expectInvalidReport("requirements id mismatch", () =>
  assertProductionEvidenceGapReportMatches(
    { ...currentReport, requirements_id: "production-evidence-requirements:wrong" },
    REQUIREMENTS,
    PRODUCTION_INDEX,
  ),
)
expectInvalidReport("operator evidence index mismatch", () =>
  assertProductionEvidenceGapReportMatches(
    currentReport,
    REQUIREMENTS,
    {
      ...PRODUCTION_INDEX,
      index_id: "operator-evidence-index:production-candidate:wrong",
    },
  ),
)

console.log(
  JSON.stringify(
    {
      status: "ok",
      requirements_id: REQUIREMENTS.requirements_id,
      production_index_id: PRODUCTION_INDEX.index_id,
      current_status: currentReport.status,
      missing_refs: currentReport.summary.refs_missing,
      synthetic_complete_status: completeReport.status,
    },
    null,
    2,
  ),
)

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T
}

function makeReport(
  operatorEvidenceIndex: OperatorEvidenceIndex,
): ProductionEvidenceGapReport {
  return makeProductionEvidenceGapReport({
    generatedAt: "2026-05-22T00:00:00Z",
    requirements: REQUIREMENTS,
    operatorEvidenceIndex,
  })
}

function makeCompleteIndex(index: OperatorEvidenceIndex): OperatorEvidenceIndex {
  const next = structuredClone(index)
  return {
    ...next,
    controls: next.controls.map((control) => {
      const requirement = REQUIREMENTS.controls.find(
        (item) => item.control_id === control.control_id,
      )
      if (!requirement) {
        throw new Error(`Missing requirement for ${control.control_id}`)
      }

      const evidenceRefs = [...control.evidence_refs]
      while (evidenceRefs.length < requirement.minimum_refs) {
        evidenceRefs.push(
          makeSyntheticRef(
            control.control_id,
            evidenceRefs.length + 1,
            requirement.minimum_review_role,
          ),
        )
      }

      return {
        ...control,
        evidence_refs: evidenceRefs,
      }
    }),
  }
}

function makeSyntheticRef(
  controlId: string,
  index: number,
  reviewRole: ProductionEvidenceReviewRole,
): OperatorEvidenceRef {
  return {
    label: `Synthetic operator evidence ${index}`,
    uri: `ops://qrtrust/synthetic/${controlId}/${index}`,
    owner: "QR Trust operator",
    review_role: reviewRole,
    reviewed_at: "2026-05-22",
  }
}

function withWrongReviewRole(index: OperatorEvidenceIndex): OperatorEvidenceIndex {
  const next = structuredClone(index)
  return {
    ...next,
    controls: next.controls.map((control) =>
      control.control_id === "postgres_source_of_truth"
        ? {
            ...control,
            evidence_refs: control.evidence_refs.map((ref) => ({
              ...ref,
              review_role: "security_reviewer",
            })),
          }
        : control,
    ),
  }
}

function withMissingReviewRole(index: OperatorEvidenceIndex): OperatorEvidenceIndex {
  const next = structuredClone(index)
  return {
    ...next,
    controls: next.controls.map((control) =>
      control.control_id === "postgres_source_of_truth"
        ? {
            ...control,
            evidence_refs: control.evidence_refs.map((ref) => {
              const { review_role: _reviewRole, ...rest } = ref
              return rest
            }),
          }
        : control,
    ),
  }
}

function expectInvalidReport(label: string, run: () => unknown): void {
  try {
    run()
  } catch {
    return
  }

  throw new Error(`Expected invalid production evidence gap report: ${label}`)
}
