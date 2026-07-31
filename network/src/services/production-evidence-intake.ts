import {
  OPERATOR_EVIDENCE_CONTROL_IDS,
  type OperatorEvidenceControl,
  type OperatorEvidenceControlId,
  type OperatorEvidenceIndex,
  assertOperatorEvidenceIndex,
} from "./operator-evidence-index.js"
import {
  type ProductionEvidenceCollectionTemplate,
  assertProductionEvidenceCollectionTemplateMatches,
} from "./production-evidence-collection-template.js"
import {
  type ProductionEvidenceGapReport,
  type ProductionEvidenceGapReportStatus,
  assertProductionEvidenceGapReportMatches,
} from "./production-evidence-gap-report.js"
import {
  type ProductionEvidenceRequirementControl,
  type ProductionEvidenceRequirements,
  assertProductionEvidenceRequirements,
} from "./production-evidence-requirements.js"

export type ProductionEvidenceIntakeStatus =
  | "accepted_for_review"
  | "blocked"

export type ProductionEvidenceIntakeFindingSeverity =
  | "info"
  | "blocker"

export type ProductionEvidenceIntakeFindingCode =
  | "gap_report_incomplete"
  | "control_not_satisfied"
  | "placeholder_ref"
  | "duplicate_ref"
  | "owner_alignment"

export interface ProductionEvidenceIntakeConfig {
  readonly generatedAt: string
  readonly requirements: ProductionEvidenceRequirements
  readonly operatorEvidenceIndex: OperatorEvidenceIndex
  readonly collectionTemplate: ProductionEvidenceCollectionTemplate
  readonly gapReport: ProductionEvidenceGapReport
}

export interface ProductionEvidenceIntakeFinding {
  readonly severity: ProductionEvidenceIntakeFindingSeverity
  readonly code: ProductionEvidenceIntakeFindingCode
  readonly message: string
  readonly control_id?: OperatorEvidenceControlId
  readonly ref_uri?: string
}

export interface ProductionEvidenceIntakeSummary {
  readonly controls_total: number
  readonly controls_satisfied: number
  readonly refs_required: number
  readonly refs_provided: number
  readonly blockers: number
  readonly informational_findings: number
}

export interface ProductionEvidenceIntakeReport {
  readonly artifact_type: "production_evidence_intake_report"
  readonly generated_at: string
  readonly status: ProductionEvidenceIntakeStatus
  readonly requirements_id: string
  readonly operator_evidence_index_id: string
  readonly collection_template_id: string
  readonly gap_report_status: ProductionEvidenceGapReportStatus
  readonly summary: ProductionEvidenceIntakeSummary
  readonly findings: ReadonlyArray<ProductionEvidenceIntakeFinding>
  readonly guardrails: ReadonlyArray<string>
  readonly next_actions: ReadonlyArray<string>
}

const INTAKE_STATUSES = new Set<string>(["accepted_for_review", "blocked"])
const FINDING_SEVERITIES = new Set<string>(["info", "blocker"])
const FINDING_CODES = new Set<string>([
  "gap_report_incomplete",
  "control_not_satisfied",
  "placeholder_ref",
  "duplicate_ref",
  "owner_alignment",
])
const OPERATOR_EVIDENCE_CONTROL_ID_SET = new Set<string>(
  OPERATOR_EVIDENCE_CONTROL_IDS,
)
const PLACEHOLDER_REF_RE = /[{}]|review-date|artifact-slug/i
const PLACEHOLDER_LABEL_RE = /\bplaceholder\b/i

export const makeProductionEvidenceIntakeReport = (
  config: ProductionEvidenceIntakeConfig,
): ProductionEvidenceIntakeReport => {
  assertGeneratedAt(config.generatedAt)
  assertProductionEvidenceRequirements(config.requirements)
  assertOperatorEvidenceIndex(config.operatorEvidenceIndex)
  assertProductionEvidenceCollectionTemplateMatches(
    config.collectionTemplate,
    config.requirements,
  )
  assertProductionEvidenceGapReportMatches(
    config.gapReport,
    config.requirements,
    config.operatorEvidenceIndex,
  )

  if (config.operatorEvidenceIndex.claim_mode !== "production_candidate") {
    throw new Error(
      "Production evidence intake requires a production_candidate operator evidence index",
    )
  }

  const findings = makeFindings(config)
  const blockers = findings.filter((finding) => finding.severity === "blocker")
    .length
  const status: ProductionEvidenceIntakeStatus =
    blockers === 0 ? "accepted_for_review" : "blocked"

  return {
    artifact_type: "production_evidence_intake_report",
    generated_at: config.generatedAt,
    status,
    requirements_id: config.requirements.requirements_id,
    operator_evidence_index_id: config.operatorEvidenceIndex.index_id,
    collection_template_id: config.collectionTemplate.template_id,
    gap_report_status: config.gapReport.status,
    summary: {
      controls_total: config.gapReport.summary.controls_total,
      controls_satisfied: config.gapReport.summary.controls_satisfied,
      refs_required: config.gapReport.summary.refs_required,
      refs_provided: config.gapReport.summary.refs_provided,
      blockers,
      informational_findings: findings.length - blockers,
    },
    findings,
    guardrails: [
      "This intake report validates an operator evidence packet; it is not a production approval.",
      "Collection-template placeholders must never be promoted into operator evidence refs.",
      "A complete gap report is required before reviewer intake can be accepted.",
      "Human release approval, evidence storage, and retention remain operator-owned.",
    ],
    next_actions: makeNextActions(status, findings),
  }
}

export const assertProductionEvidenceIntakeReport = (
  report: ProductionEvidenceIntakeReport,
): void => {
  if (!isRecord(report)) {
    throw new Error("Production evidence intake report must be an object")
  }
  if (report.artifact_type !== "production_evidence_intake_report") {
    throw new Error(
      "Production evidence intake report artifact_type must be production_evidence_intake_report",
    )
  }
  assertGeneratedAt(report.generated_at)
  assertOneOf(report.status, INTAKE_STATUSES, "status")
  assertNonEmpty(report.requirements_id, "requirements_id")
  assertNonEmpty(report.operator_evidence_index_id, "operator_evidence_index_id")
  assertNonEmpty(report.collection_template_id, "collection_template_id")
  assertNonEmpty(report.gap_report_status, "gap_report_status")
  assertSummary(report.summary)
  assertFindings(report.findings)
  assertStringArray(report.guardrails, "guardrails")
  assertStringArray(report.next_actions, "next_actions")

  const blockers = report.findings.filter(
    (finding) => finding.severity === "blocker",
  ).length
  if (report.summary.blockers !== blockers) {
    throw new Error("Production evidence intake summary.blockers is stale")
  }
  if (report.status === "accepted_for_review" && blockers > 0) {
    throw new Error(
      "Production evidence intake cannot be accepted with blocker findings",
    )
  }
  if (report.status === "blocked" && blockers === 0) {
    throw new Error(
      "Production evidence intake blocked status requires blocker findings",
    )
  }
}

export const assertProductionEvidenceIntakeReportMatches = (
  report: ProductionEvidenceIntakeReport,
  config: ProductionEvidenceIntakeConfig,
): void => {
  assertProductionEvidenceIntakeReport(report)
  const expected = makeProductionEvidenceIntakeReport({
    ...config,
    generatedAt: report.generated_at,
  })

  if (JSON.stringify(report) !== JSON.stringify(expected)) {
    throw new Error(
      "Production evidence intake report is stale or does not match its inputs",
    )
  }
}

const makeFindings = (
  config: ProductionEvidenceIntakeConfig,
): ReadonlyArray<ProductionEvidenceIntakeFinding> => {
  const blockers = [
    ...makeGapFindings(config.gapReport),
    ...makePlaceholderFindings(config.operatorEvidenceIndex),
    ...makeDuplicateFindings(config.operatorEvidenceIndex),
  ]

  if (blockers.length > 0) {
    return blockers
  }

  return [...blockers, ...makeOwnerAlignmentFindings(config)]
}

const makeGapFindings = (
  gapReport: ProductionEvidenceGapReport,
): ReadonlyArray<ProductionEvidenceIntakeFinding> => {
  const findings: ProductionEvidenceIntakeFinding[] = []

  if (gapReport.status !== "complete") {
    findings.push({
      severity: "blocker",
      code: "gap_report_incomplete",
      message:
        "The production evidence gap report is not complete; reviewer intake cannot proceed.",
    })
  }

  for (const control of gapReport.controls) {
    if (control.status !== "satisfied") {
      findings.push({
        severity: "blocker",
        code: "control_not_satisfied",
        control_id: control.control_id,
        message: `${control.title} is ${control.status}; ${control.next_action}`,
      })
    }
  }

  return findings
}

const makePlaceholderFindings = (
  index: OperatorEvidenceIndex,
): ReadonlyArray<ProductionEvidenceIntakeFinding> => {
  const findings: ProductionEvidenceIntakeFinding[] = []

  for (const control of index.controls) {
    for (const ref of control.evidence_refs) {
      if (
        PLACEHOLDER_REF_RE.test(ref.uri) ||
        PLACEHOLDER_LABEL_RE.test(ref.label)
      ) {
        findings.push({
          severity: "blocker",
          code: "placeholder_ref",
          control_id: control.control_id,
          ref_uri: ref.uri,
          message:
            "Operator evidence refs must point to reviewed evidence, not collection-template placeholders.",
        })
      }
    }
  }

  return findings
}

const makeDuplicateFindings = (
  index: OperatorEvidenceIndex,
): ReadonlyArray<ProductionEvidenceIntakeFinding> => {
  const seen = new Map<string, OperatorEvidenceControlId>()
  const duplicates: ProductionEvidenceIntakeFinding[] = []

  for (const control of index.controls) {
    for (const ref of control.evidence_refs) {
      const previousControl = seen.get(ref.uri)
      if (previousControl !== undefined) {
        duplicates.push({
          severity: "blocker",
          code: "duplicate_ref",
          control_id: control.control_id,
          ref_uri: ref.uri,
          message: `Evidence ref is reused by ${previousControl} and ${control.control_id}; production intake requires distinct refs per counted control.`,
        })
      } else {
        seen.set(ref.uri, control.control_id)
      }
    }
  }

  return duplicates
}

const makeOwnerAlignmentFindings = (
  config: ProductionEvidenceIntakeConfig,
): ReadonlyArray<ProductionEvidenceIntakeFinding> => {
  const findings: ProductionEvidenceIntakeFinding[] = []

  for (const requirement of config.requirements.controls) {
    const control = findControl(
      config.operatorEvidenceIndex,
      requirement.control_id,
    )
    if (control === undefined) {
      continue
    }
    const controlOwnerDiffers =
      normalizeOwner(control.owner) !== normalizeOwner(requirement.evidence_owner)
    const refOwnerMismatchCount = control.evidence_refs.filter(
      (ref) => normalizeOwner(ref.owner) !== normalizeOwner(requirement.evidence_owner),
    ).length
    if (controlOwnerDiffers || refOwnerMismatchCount > 0) {
      findings.push(
        makeOwnerFinding(requirement, control, refOwnerMismatchCount),
      )
    }
  }

  return findings
}

const findControl = (
  index: OperatorEvidenceIndex,
  controlId: OperatorEvidenceControlId,
): OperatorEvidenceControl | undefined =>
  index.controls.find((control) => control.control_id === controlId)

const makeOwnerFinding = (
  requirement: ProductionEvidenceRequirementControl,
  control: OperatorEvidenceControl,
  refOwnerMismatchCount: number,
): ProductionEvidenceIntakeFinding => ({
  severity: "info",
  code: "owner_alignment",
  control_id: requirement.control_id,
  message: [
    `Required evidence owner is "${requirement.evidence_owner}".`,
    `Control owner is "${control.owner}".`,
    `${refOwnerMismatchCount}/${control.evidence_refs.length} evidence ref owner(s) differ from the required owner.`,
    "Reviewer should confirm responsibility mapping.",
  ].join(" "),
})

const makeNextActions = (
  status: ProductionEvidenceIntakeStatus,
  findings: ReadonlyArray<ProductionEvidenceIntakeFinding>,
): ReadonlyArray<string> => {
  if (status === "accepted_for_review") {
    return [
      "Route this intake report to the human production evidence reviewer.",
      "Keep approval, evidence storage, and retention records outside the public repository.",
    ]
  }

  return [
    "Resolve blocker findings before claiming production evidence is ready for review.",
    "Replace placeholder refs with reviewed ops://qrtrust/ evidence refs.",
    `Current blockers: ${findings.filter((finding) => finding.severity === "blocker").length}.`,
  ]
}

const normalizeOwner = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ")

const assertSummary = (summary: ProductionEvidenceIntakeSummary): void => {
  if (!isRecord(summary)) {
    throw new Error("Production evidence intake summary must be an object")
  }
  for (const field of [
    "controls_total",
    "controls_satisfied",
    "refs_required",
    "refs_provided",
    "blockers",
    "informational_findings",
  ] as const) {
    if (!Number.isInteger(summary[field]) || summary[field] < 0) {
      throw new Error(
        `Production evidence intake summary.${field} must be a non-negative integer`,
      )
    }
  }
}

const assertFindings = (
  findings: ReadonlyArray<ProductionEvidenceIntakeFinding>,
): void => {
  if (!Array.isArray(findings)) {
    throw new Error("Production evidence intake findings must be an array")
  }
  for (const finding of findings) {
    if (!isRecord(finding)) {
      throw new Error("Production evidence intake finding must be an object")
    }
    assertOneOf(finding.severity, FINDING_SEVERITIES, "finding.severity")
    assertOneOf(finding.code, FINDING_CODES, "finding.code")
    assertNonEmpty(finding.message, "finding.message")
    const controlId = finding.control_id
    if (controlId !== undefined) {
      assertOneOf(
        controlId,
        OPERATOR_EVIDENCE_CONTROL_ID_SET,
        "finding.control_id",
      )
    }
    const refUri = finding.ref_uri
    if (refUri !== undefined) {
      assertNonEmpty(refUri, "finding.ref_uri")
    }
  }
}

const assertStringArray = (
  values: ReadonlyArray<string>,
  field: string,
): void => {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Production evidence intake ${field} must be a non-empty array`)
  }
  for (const value of values) {
    assertNonEmpty(value, field)
  }
}

const assertGeneratedAt = (value: string): void => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(
      "Production evidence intake generatedAt must be an ISO timestamp",
    )
  }
}

function assertOneOf(
  value: unknown,
  allowed: ReadonlySet<string>,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`Production evidence intake ${field} is invalid`)
  }
}

function assertNonEmpty(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Production evidence intake requires ${field}`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
