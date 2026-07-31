import {
  OPERATOR_EVIDENCE_CONTROL_IDS,
  OPERATOR_EVIDENCE_LAYERS,
  type OperatorEvidenceControl,
  type OperatorEvidenceControlId,
  type OperatorEvidenceIndex,
  type OperatorEvidenceLayer,
  type OperatorEvidenceRef,
  type OperatorEvidenceStatus,
  assertOperatorEvidenceIndex,
} from "./operator-evidence-index.js"
import {
  PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME,
  PRODUCTION_EVIDENCE_REVIEW_ROLES,
  type ProductionEvidenceRequirementControl,
  type ProductionEvidenceRequirements,
  type ProductionEvidenceReviewRole,
  type ProductionEvidenceScope,
  assertProductionEvidenceRequirements,
} from "./production-evidence-requirements.js"

export type ProductionEvidenceGapReportStatus =
  | "complete"
  | "incomplete"
  | "blocked"

export type ProductionEvidenceGapControlStatus =
  | "satisfied"
  | "missing_refs"
  | "missing_control"
  | "blocked"

const PRODUCTION_EVIDENCE_GAP_REPORT_STATUSES = [
  "complete",
  "incomplete",
  "blocked",
] as const

const PRODUCTION_EVIDENCE_GAP_CONTROL_STATUSES = [
  "satisfied",
  "missing_refs",
  "missing_control",
  "blocked",
] as const

const OPERATOR_EVIDENCE_CONTROL_ID_SET = new Set<string>(
  OPERATOR_EVIDENCE_CONTROL_IDS,
)
const OPERATOR_EVIDENCE_LAYER_SET = new Set<string>(OPERATOR_EVIDENCE_LAYERS)
const PRODUCTION_EVIDENCE_REVIEW_ROLE_SET = new Set<string>(
  PRODUCTION_EVIDENCE_REVIEW_ROLES,
)
const PRODUCTION_EVIDENCE_GAP_REPORT_STATUS_SET = new Set<string>(
  PRODUCTION_EVIDENCE_GAP_REPORT_STATUSES,
)
const PRODUCTION_EVIDENCE_GAP_CONTROL_STATUS_SET = new Set<string>(
  PRODUCTION_EVIDENCE_GAP_CONTROL_STATUSES,
)

export interface ProductionEvidenceGapReportConfig {
  readonly generatedAt: string
  readonly requirements: ProductionEvidenceRequirements
  readonly operatorEvidenceIndex: OperatorEvidenceIndex
}

export interface ProductionEvidenceGapControl {
  readonly control_id: OperatorEvidenceControlId
  readonly layer: OperatorEvidenceLayer
  readonly title: string
  readonly status: ProductionEvidenceGapControlStatus
  readonly evidence_owner: string
  readonly minimum_review_role: ProductionEvidenceReviewRole
  readonly minimum_refs: number
  readonly provided_refs: number
  readonly missing_refs: number
  readonly required_artifacts: ReadonlyArray<string>
  readonly evidence_refs: ReadonlyArray<OperatorEvidenceRef>
  readonly operator_status?: OperatorEvidenceStatus
  readonly operator_summary?: string
  readonly next_action: string
}

export interface ProductionEvidenceGapSummary {
  readonly controls_total: number
  readonly controls_satisfied: number
  readonly controls_missing_refs: number
  readonly controls_missing_control: number
  readonly controls_blocked: number
  readonly refs_required: number
  readonly refs_provided: number
  readonly refs_missing: number
}

export interface ProductionEvidenceGapReport {
  readonly artifact_type: "production_evidence_gap_report"
  readonly generated_at: string
  readonly status: ProductionEvidenceGapReportStatus
  readonly requirements_id: string
  readonly operator_evidence_index_id: string
  readonly scope: ProductionEvidenceScope
  readonly required_ref_scheme: typeof PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME
  readonly summary: ProductionEvidenceGapSummary
  readonly controls: ReadonlyArray<ProductionEvidenceGapControl>
  readonly guardrails: ReadonlyArray<string>
  readonly next_actions: ReadonlyArray<string>
}

export const makeProductionEvidenceGapReport = (
  config: ProductionEvidenceGapReportConfig,
): ProductionEvidenceGapReport => {
  assertProductionEvidenceRequirements(config.requirements)
  assertOperatorEvidenceIndex(config.operatorEvidenceIndex)
  assertGeneratedAt(config.generatedAt)

  if (config.operatorEvidenceIndex.claim_mode !== "production_candidate") {
    throw new Error(
      "Production evidence gap report requires a production_candidate operator evidence index",
    )
  }

  const controls = config.requirements.controls.map((requirement) =>
    makeGapControl(requirement, config.operatorEvidenceIndex),
  )
  const summary = summarizeControls(controls)
  const status = summarizeStatus(summary)

  return {
    artifact_type: "production_evidence_gap_report",
    generated_at: config.generatedAt,
    status,
    requirements_id: config.requirements.requirements_id,
    operator_evidence_index_id: config.operatorEvidenceIndex.index_id,
    scope: config.requirements.scope,
    required_ref_scheme: PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME,
    summary,
    controls,
    guardrails: [
      "This report compares requirements to operator evidence refs; it is not production evidence itself.",
      "Public artifacts must not contain operator secrets, private keys, or credential material.",
      "A production-ready claim requires operator-owned ops://qrtrust/ refs reviewed by the required operational role for every control.",
      "The operator, not the public reference repository, owns evidence storage and review retention.",
    ],
    next_actions: makeReportNextActions(status, summary),
  }
}

export const assertProductionEvidenceGapReport = (
  report: ProductionEvidenceGapReport,
): void => {
  if (!isRecord(report)) {
    throw new Error("Production evidence gap report must be an object")
  }
  if (report.artifact_type !== "production_evidence_gap_report") {
    throw new Error(
      "Production evidence gap report artifact_type must be production_evidence_gap_report",
    )
  }
  assertGeneratedAt(report.generated_at)
  if (
    typeof report.status !== "string" ||
    !PRODUCTION_EVIDENCE_GAP_REPORT_STATUS_SET.has(report.status)
  ) {
    throw new Error("Production evidence gap report status is invalid")
  }
  assertNonEmpty(report.requirements_id, "requirements_id")
  assertNonEmpty(report.operator_evidence_index_id, "operator_evidence_index_id")
  assertScope(report.scope)
  if (report.required_ref_scheme !== PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME) {
    throw new Error(
      `Production evidence gap report required_ref_scheme must be ${PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME}`,
    )
  }
  assertSummary(report.summary)
  assertControls(report.controls)
  assertStringArray(report.guardrails, "guardrails")
  assertStringArray(report.next_actions, "next_actions")
  assertStatusMatchesSummary(report.status, report.summary)
}

export const assertProductionEvidenceGapReportMatches = (
  report: ProductionEvidenceGapReport,
  requirements: ProductionEvidenceRequirements,
  operatorEvidenceIndex: OperatorEvidenceIndex,
): void => {
  assertProductionEvidenceGapReport(report)
  assertProductionEvidenceRequirements(requirements)
  assertOperatorEvidenceIndex(operatorEvidenceIndex)

  if (report.requirements_id !== requirements.requirements_id) {
    throw new Error(
      `Production evidence gap report requirements_id ${report.requirements_id} does not match ${requirements.requirements_id}`,
    )
  }
  if (report.operator_evidence_index_id !== operatorEvidenceIndex.index_id) {
    throw new Error(
      `Production evidence gap report operator_evidence_index_id ${report.operator_evidence_index_id} does not match ${operatorEvidenceIndex.index_id}`,
    )
  }
  if (JSON.stringify(report.scope) !== JSON.stringify(requirements.scope)) {
    throw new Error(
      "Production evidence gap report scope does not match requirements scope",
    )
  }

  const expected = makeProductionEvidenceGapReport({
    generatedAt: report.generated_at,
    requirements,
    operatorEvidenceIndex,
  })
  if (
    JSON.stringify(toComparableGapReport(report)) !==
    JSON.stringify(toComparableGapReport(expected))
  ) {
    throw new Error(
      "Production evidence gap report is stale or does not match its requirements and operator index inputs",
    )
  }
}

const makeGapControl = (
  requirement: ProductionEvidenceRequirementControl,
  index: OperatorEvidenceIndex,
): ProductionEvidenceGapControl => {
  const operatorControl = findOperatorControl(index, requirement.control_id)

  if (!operatorControl) {
    return {
      control_id: requirement.control_id,
      layer: requirement.layer,
      title: requirement.title,
      status: "missing_control",
      evidence_owner: requirement.evidence_owner,
      minimum_review_role: requirement.minimum_review_role,
      minimum_refs: requirement.minimum_refs,
      provided_refs: 0,
      missing_refs: requirement.minimum_refs,
      required_artifacts: requirement.required_artifacts,
      evidence_refs: [],
      next_action: `Add the canonical ${requirement.control_id} control to the operator evidence index.`,
    }
  }

  const providedRefs = operatorControl.evidence_refs.filter((ref) =>
    isQualifiedEvidenceRef(ref, requirement.minimum_review_role),
  )
  const missingRefs = Math.max(0, requirement.minimum_refs - providedRefs.length)
  const status = makeControlStatus(operatorControl, missingRefs)

  return {
    control_id: requirement.control_id,
    layer: requirement.layer,
    title: requirement.title,
    status,
    evidence_owner: requirement.evidence_owner,
    minimum_review_role: requirement.minimum_review_role,
    minimum_refs: requirement.minimum_refs,
    provided_refs: providedRefs.length,
    missing_refs: missingRefs,
    required_artifacts: requirement.required_artifacts,
    evidence_refs: providedRefs,
    operator_status: operatorControl.status,
    operator_summary: operatorControl.summary,
    next_action: makeControlNextAction(requirement, missingRefs, status),
  }
}

const isQualifiedEvidenceRef = (
  ref: OperatorEvidenceRef,
  minimumReviewRole: ProductionEvidenceReviewRole,
): boolean =>
  ref.uri.startsWith(PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME) &&
  ref.review_role === minimumReviewRole

const findOperatorControl = (
  index: OperatorEvidenceIndex,
  controlId: OperatorEvidenceControlId,
): OperatorEvidenceControl | undefined =>
  index.controls.find((control) => control.control_id === controlId)

const makeControlStatus = (
  control: OperatorEvidenceControl,
  missingRefs: number,
): ProductionEvidenceGapControlStatus => {
  if (control.status === "blocked") {
    return "blocked"
  }
  if (missingRefs > 0) {
    return "missing_refs"
  }
  return "satisfied"
}

const makeControlNextAction = (
  requirement: ProductionEvidenceRequirementControl,
  missingRefs: number,
  status: ProductionEvidenceGapControlStatus,
): string => {
  if (status === "satisfied") {
    return "Keep the evidence refs current and retain the operator review record."
  }
  if (status === "blocked") {
    return `Resolve the blocked operator control before claiming ${requirement.title} readiness.`
  }

  const missingText =
    missingRefs === 1 ? "1 additional ref" : `${missingRefs} additional refs`
  return `Attach ${missingText} under ${PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME} reviewed by ${requirement.minimum_review_role} covering: ${requirement.required_artifacts.join(", ")}.`
}

const summarizeControls = (
  controls: ReadonlyArray<ProductionEvidenceGapControl>,
): ProductionEvidenceGapSummary => ({
  controls_total: controls.length,
  controls_satisfied: controls.filter((control) => control.status === "satisfied")
    .length,
  controls_missing_refs: controls.filter(
    (control) => control.status === "missing_refs",
  ).length,
  controls_missing_control: controls.filter(
    (control) => control.status === "missing_control",
  ).length,
  controls_blocked: controls.filter((control) => control.status === "blocked")
    .length,
  refs_required: controls.reduce(
    (sum, control) => sum + control.minimum_refs,
    0,
  ),
  refs_provided: controls.reduce(
    (sum, control) => sum + control.provided_refs,
    0,
  ),
  refs_missing: controls.reduce(
    (sum, control) => sum + control.missing_refs,
    0,
  ),
})

const summarizeStatus = (
  summary: ProductionEvidenceGapSummary,
): ProductionEvidenceGapReportStatus => {
  if (summary.controls_blocked > 0 || summary.controls_missing_control > 0) {
    return "blocked"
  }
  if (summary.refs_missing > 0) {
    return "incomplete"
  }
  return "complete"
}

const makeReportNextActions = (
  status: ProductionEvidenceGapReportStatus,
  summary: ProductionEvidenceGapSummary,
): ReadonlyArray<string> => {
  if (status === "complete") {
    return [
      "Run a human production evidence review before converting this reference report into an operational approval.",
      "Keep public documentation explicit that the operator evidence store remains outside this repository.",
    ]
  }

  const missingText =
    summary.refs_missing === 1
      ? "1 operator evidence ref"
      : `${summary.refs_missing} operator evidence refs`
  return [
    `Attach ${missingText} before making a production-ready claim.`,
    "Keep each evidence ref under ops://qrtrust/, outside the public repository, and tagged with the required reviewer role.",
    "Re-run this report after the operator evidence index is updated.",
  ]
}

const assertGeneratedAt = (value: string): void => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(
      "Production evidence gap report generatedAt must be an ISO timestamp",
    )
  }
}

const assertScope = (scope: ProductionEvidenceScope): void => {
  if (!isRecord(scope)) {
    throw new Error("Production evidence gap report scope must be an object")
  }
  if (scope.claim_mode !== "production_candidate") {
    throw new Error(
      "Production evidence gap report scope.claim_mode must be production_candidate",
    )
  }
  assertNonEmpty(scope.root_program_id, "scope.root_program_id")
  assertNonEmpty(scope.environment, "scope.environment")
  assertNonEmpty(scope.boundary, "scope.boundary")
}

const assertSummary = (summary: ProductionEvidenceGapSummary): void => {
  if (!isRecord(summary)) {
    throw new Error("Production evidence gap report summary must be an object")
  }
  for (const field of [
    "controls_total",
    "controls_satisfied",
    "controls_missing_refs",
    "controls_missing_control",
    "controls_blocked",
    "refs_required",
    "refs_provided",
    "refs_missing",
  ] as const) {
    const value = summary[field]
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `Production evidence gap report summary.${field} must be a non-negative integer`,
      )
    }
  }
}

const assertControls = (
  controls: ReadonlyArray<ProductionEvidenceGapControl>,
): void => {
  if (!Array.isArray(controls)) {
    throw new Error("Production evidence gap report controls must be an array")
  }
  const controlIds = controls.map((control) =>
    isRecord(control) ? control.control_id : undefined,
  )
  if (
    controlIds.length !== OPERATOR_EVIDENCE_CONTROL_IDS.length ||
    !OPERATOR_EVIDENCE_CONTROL_IDS.every(
      (controlId, index) => controlIds[index] === controlId,
    )
  ) {
    throw new Error(
      "Production evidence gap report controls must use canonical order",
    )
  }

  for (const control of controls) {
    assertControl(control)
  }
}

const assertControl = (control: ProductionEvidenceGapControl): void => {
  if (!isRecord(control)) {
    throw new Error("Production evidence gap report control must be an object")
  }
  const controlId = control.control_id
  if (
    typeof controlId !== "string" ||
    !OPERATOR_EVIDENCE_CONTROL_ID_SET.has(controlId)
  ) {
    throw new Error("Production evidence gap report control_id is invalid")
  }
  if (
    typeof control.layer !== "string" ||
    !OPERATOR_EVIDENCE_LAYER_SET.has(control.layer)
  ) {
    throw new Error(
      `Production evidence gap report ${controlId} layer is invalid`,
    )
  }
  if (
    typeof control.status !== "string" ||
    !PRODUCTION_EVIDENCE_GAP_CONTROL_STATUS_SET.has(control.status)
  ) {
    throw new Error(
      `Production evidence gap report ${controlId} status is invalid`,
    )
  }
  assertNonEmpty(control.title, `${controlId}.title`)
  assertNonEmpty(control.evidence_owner, `${controlId}.evidence_owner`)
  if (
    typeof control.minimum_review_role !== "string" ||
    !PRODUCTION_EVIDENCE_REVIEW_ROLE_SET.has(control.minimum_review_role)
  ) {
    throw new Error(
      `Production evidence gap report ${controlId}.minimum_review_role is invalid`,
    )
  }
  if (!Number.isInteger(control.minimum_refs) || control.minimum_refs < 1) {
    throw new Error(
      `Production evidence gap report ${controlId}.minimum_refs must be at least 1`,
    )
  }
  if (!Number.isInteger(control.provided_refs) || control.provided_refs < 0) {
    throw new Error(
      `Production evidence gap report ${controlId}.provided_refs must be non-negative`,
    )
  }
  if (!Number.isInteger(control.missing_refs) || control.missing_refs < 0) {
    throw new Error(
      `Production evidence gap report ${controlId}.missing_refs must be non-negative`,
    )
  }
  if (
    control.missing_refs !==
    Math.max(0, control.minimum_refs - control.provided_refs)
  ) {
    throw new Error(
      `Production evidence gap report ${controlId}.missing_refs does not match refs`,
    )
  }
  assertStringArray(control.required_artifacts, `${controlId}.required_artifacts`)
  if (!Array.isArray(control.evidence_refs)) {
    throw new Error(
      `Production evidence gap report ${controlId}.evidence_refs must be an array`,
    )
  }
  if (control.evidence_refs.length !== control.provided_refs) {
    throw new Error(
      `Production evidence gap report ${controlId}.provided_refs does not match evidence_refs`,
    )
  }
  for (const ref of control.evidence_refs) {
    if (!isRecord(ref) || typeof ref.uri !== "string") {
      throw new Error(
        `Production evidence gap report ${controlId}.evidence_refs must contain refs with uri`,
      )
    }
    if (!ref.uri.startsWith(PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME)) {
      throw new Error(
        `Production evidence gap report ${controlId}.evidence_refs must use ${PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME}`,
      )
    }
    if (ref.review_role !== control.minimum_review_role) {
      throw new Error(
        `Production evidence gap report ${controlId}.evidence_refs must be reviewed by ${control.minimum_review_role}`,
      )
    }
  }
  assertNonEmpty(control.next_action, `${controlId}.next_action`)
}

const assertStatusMatchesSummary = (
  status: ProductionEvidenceGapReportStatus,
  summary: ProductionEvidenceGapSummary,
): void => {
  const expected = summarizeStatus(summary)
  if (status !== expected) {
    throw new Error(
      `Production evidence gap report status must be ${expected} for its summary`,
    )
  }
}

const assertStringArray = (
  value: ReadonlyArray<string>,
  field: string,
): void => {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((item) => typeof item === "string" && item.trim().length > 0)
  ) {
    throw new Error(`Production evidence gap report ${field} must be strings`)
  }
}

const assertNonEmpty = (value: unknown, field: string): void => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Production evidence gap report ${field} must be non-empty`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const toComparableGapReport = (report: ProductionEvidenceGapReport) => ({
  status: report.status,
  requirements_id: report.requirements_id,
  operator_evidence_index_id: report.operator_evidence_index_id,
  scope: report.scope,
  required_ref_scheme: report.required_ref_scheme,
  summary: report.summary,
  controls: report.controls,
  guardrails: report.guardrails,
  next_actions: report.next_actions,
})
