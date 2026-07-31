import {
  type OperatorEvidenceControlId,
  type OperatorEvidenceLayer,
} from "./operator-evidence-index.js"
import {
  type ProductionEvidenceCollectionTemplate,
  assertProductionEvidenceCollectionTemplateMatches,
} from "./production-evidence-collection-template.js"
import {
  PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME,
  type ProductionEvidenceRequirementControl,
  type ProductionEvidenceRequirements,
  type ProductionEvidenceReviewRole,
  assertProductionEvidenceRequirements,
} from "./production-evidence-requirements.js"
import {
  type ProductionEvidenceGapControl,
  type ProductionEvidenceGapReport,
  assertProductionEvidenceGapReport,
} from "./production-evidence-gap-report.js"
import {
  type ProductionEvidenceIntakeReport,
  assertProductionEvidenceIntakeReport,
} from "./production-evidence-intake.js"

export type ProductionEvidenceClosureBundleStatus =
  | "blocked_until_operator_refs_complete"
  | "ready_for_human_review"

export interface ProductionEvidenceClosureBundleConfig {
  readonly generatedAt: string
  readonly requirements: ProductionEvidenceRequirements
  readonly collectionTemplate: ProductionEvidenceCollectionTemplate
  readonly gapReport: ProductionEvidenceGapReport
  readonly intakeReport: ProductionEvidenceIntakeReport
}

export interface ProductionEvidenceClosureItem {
  readonly control_id: OperatorEvidenceControlId
  readonly layer: OperatorEvidenceLayer
  readonly title: string
  readonly evidence_owner: string
  readonly minimum_review_role: ProductionEvidenceReviewRole
  readonly missing_refs: number
  readonly required_artifacts: ReadonlyArray<string>
  readonly collection_slots: ReadonlyArray<string>
  readonly next_action: string
}

export interface ProductionEvidenceClosureBundleSummary {
  readonly controls_total: number
  readonly controls_satisfied: number
  readonly controls_needing_operator_refs: number
  readonly refs_missing: number
  readonly intake_blockers: number
  readonly ready_for_review: boolean
}

export interface ProductionEvidenceClosureBundle {
  readonly artifact_type: "production_evidence_closure_bundle"
  readonly generated_at: string
  readonly status: ProductionEvidenceClosureBundleStatus
  readonly requirements_id: string
  readonly collection_template_id: string
  readonly gap_report_status: ProductionEvidenceGapReport["status"]
  readonly intake_report_status: ProductionEvidenceIntakeReport["status"]
  readonly summary: ProductionEvidenceClosureBundleSummary
  readonly closure_items: ReadonlyArray<ProductionEvidenceClosureItem>
  readonly guardrails: ReadonlyArray<string>
  readonly operator_next_actions: ReadonlyArray<string>
}

export const makeProductionEvidenceClosureBundle = (
  config: ProductionEvidenceClosureBundleConfig,
): ProductionEvidenceClosureBundle => {
  assertGeneratedAt(config.generatedAt)
  assertProductionEvidenceRequirements(config.requirements)
  assertProductionEvidenceCollectionTemplateMatches(
    config.collectionTemplate,
    config.requirements,
  )
  assertProductionEvidenceGapReport(config.gapReport)
  assertProductionEvidenceIntakeReport(config.intakeReport)
  assertInputIdsMatch(config)

  const closureItems = config.gapReport.controls
    .filter((control) => control.missing_refs > 0)
    .map((control) =>
      makeClosureItem(control, config.requirements, config.collectionTemplate),
    )
  const readyForReview =
    config.gapReport.status === "complete" &&
    config.intakeReport.status === "accepted_for_review"
  const status: ProductionEvidenceClosureBundleStatus = readyForReview
    ? "ready_for_human_review"
    : "blocked_until_operator_refs_complete"
  const summary = {
    controls_total: config.gapReport.summary.controls_total,
    controls_satisfied: config.gapReport.summary.controls_satisfied,
    controls_needing_operator_refs: closureItems.length,
    refs_missing: config.gapReport.summary.refs_missing,
    intake_blockers: config.intakeReport.summary.blockers,
    ready_for_review: readyForReview,
  }

  const bundle: ProductionEvidenceClosureBundle = {
    artifact_type: "production_evidence_closure_bundle",
    generated_at: config.generatedAt,
    status,
    requirements_id: config.requirements.requirements_id,
    collection_template_id: config.collectionTemplate.template_id,
    gap_report_status: config.gapReport.status,
    intake_report_status: config.intakeReport.status,
    summary,
    closure_items: closureItems,
    guardrails: [
      "This bundle closes the public-reference workflow; it does not contain production evidence.",
      "Production evidence refs stay in operator-owned storage under ops://qrtrust/.",
      "Vendor KMS, HSM, broker, restore, and release-approval proof remains outside this repository.",
      "A ready bundle still requires human production evidence review before any production-ready claim.",
    ],
    operator_next_actions: makeOperatorNextActions(summary),
  }

  assertProductionEvidenceClosureBundle(bundle)

  return bundle
}

export const assertProductionEvidenceClosureBundle = (
  bundle: ProductionEvidenceClosureBundle,
): void => {
  if (!isRecord(bundle)) {
    throw new Error("Production evidence closure bundle must be an object")
  }
  if (bundle.artifact_type !== "production_evidence_closure_bundle") {
    throw new Error(
      "Production evidence closure bundle artifact_type must be production_evidence_closure_bundle",
    )
  }
  assertGeneratedAt(bundle.generated_at)
  assertOneOf(
    bundle.status,
    new Set(["blocked_until_operator_refs_complete", "ready_for_human_review"]),
    "status",
  )
  assertNonEmpty(bundle.requirements_id, "requirements_id")
  assertNonEmpty(bundle.collection_template_id, "collection_template_id")
  assertNonEmpty(bundle.gap_report_status, "gap_report_status")
  assertNonEmpty(bundle.intake_report_status, "intake_report_status")
  assertSummary(bundle.summary)
  assertClosureItems(bundle.closure_items)
  assertStringArray(bundle.guardrails, "guardrails")
  assertStringArray(bundle.operator_next_actions, "operator_next_actions")
  if (bundle.summary.ready_for_review !== (bundle.status === "ready_for_human_review")) {
    throw new Error(
      "Production evidence closure bundle ready_for_review does not match status",
    )
  }
  if (
    bundle.summary.controls_needing_operator_refs !== bundle.closure_items.length
  ) {
    throw new Error(
      "Production evidence closure bundle controls_needing_operator_refs is stale",
    )
  }
}

export const assertProductionEvidenceClosureBundleMatches = (
  bundle: ProductionEvidenceClosureBundle,
  config: ProductionEvidenceClosureBundleConfig,
): void => {
  assertProductionEvidenceClosureBundle(bundle)
  const expected = makeProductionEvidenceClosureBundle({
    ...config,
    generatedAt: bundle.generated_at,
  })

  if (JSON.stringify(bundle) !== JSON.stringify(expected)) {
    throw new Error(
      "Production evidence closure bundle is stale or does not match its inputs",
    )
  }
}

const assertInputIdsMatch = (
  config: ProductionEvidenceClosureBundleConfig,
): void => {
  if (config.gapReport.requirements_id !== config.requirements.requirements_id) {
    throw new Error("Closure bundle gap report requirements_id is stale")
  }
  if (
    config.intakeReport.requirements_id !== config.requirements.requirements_id
  ) {
    throw new Error("Closure bundle intake report requirements_id is stale")
  }
  if (
    config.intakeReport.collection_template_id !==
    config.collectionTemplate.template_id
  ) {
    throw new Error("Closure bundle intake report collection template is stale")
  }
  if (config.intakeReport.gap_report_status !== config.gapReport.status) {
    throw new Error("Closure bundle intake report gap status is stale")
  }
}

const makeClosureItem = (
  control: ProductionEvidenceGapControl,
  requirements: ProductionEvidenceRequirements,
  collectionTemplate: ProductionEvidenceCollectionTemplate,
): ProductionEvidenceClosureItem => {
  const requirement = findRequirement(requirements, control.control_id)
  const templateControl = collectionTemplate.controls.find(
    (candidate) => candidate.control_id === control.control_id,
  )

  return {
    control_id: control.control_id,
    layer: control.layer,
    title: control.title,
    evidence_owner: control.evidence_owner,
    minimum_review_role: control.minimum_review_role,
    missing_refs: control.missing_refs,
    required_artifacts: requirement.required_artifacts,
    collection_slots:
      templateControl?.evidence_slots.map((slot) => slot.placeholder_uri_pattern) ??
      [],
    next_action: control.next_action,
  }
}

const findRequirement = (
  requirements: ProductionEvidenceRequirements,
  controlId: OperatorEvidenceControlId,
): ProductionEvidenceRequirementControl => {
  const requirement = requirements.controls.find(
    (candidate) => candidate.control_id === controlId,
  )
  if (!requirement) {
    throw new Error(`Missing production evidence requirement for ${controlId}`)
  }
  return requirement
}

const makeOperatorNextActions = (
  summary: ProductionEvidenceClosureBundleSummary,
): ReadonlyArray<string> => {
  if (summary.ready_for_review) {
    return [
      "Route the complete operator evidence packet to the human production reviewer.",
      "Keep production approval, evidence storage, and retention outside the public repository.",
    ]
  }

  const actions: string[] = []
  if (summary.refs_missing > 0) {
    actions.push(
      `Collect ${summary.refs_missing} remaining ${PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME} evidence refs in the operator-owned evidence store.`,
    )
  }
  if (summary.intake_blockers > 0) {
    actions.push(
      `Resolve ${summary.intake_blockers} production evidence intake blocker(s).`,
    )
  }
  actions.push(
    "Update the production-candidate operator evidence index with each ref, owner, review_role, and reviewed_at date.",
    "Regenerate the gap, intake, and closure bundle before making a production-ready claim.",
  )

  return actions
}

const assertSummary = (
  summary: ProductionEvidenceClosureBundleSummary,
): void => {
  if (!isRecord(summary)) {
    throw new Error("Production evidence closure bundle summary must be an object")
  }
  for (const field of [
    "controls_total",
    "controls_satisfied",
    "controls_needing_operator_refs",
    "refs_missing",
    "intake_blockers",
  ] as const) {
    if (!Number.isInteger(summary[field]) || summary[field] < 0) {
      throw new Error(
        `Production evidence closure bundle summary.${field} must be a non-negative integer`,
      )
    }
  }
  if (typeof summary.ready_for_review !== "boolean") {
    throw new Error(
      "Production evidence closure bundle summary.ready_for_review must be boolean",
    )
  }
}

const assertClosureItems = (
  items: ReadonlyArray<ProductionEvidenceClosureItem>,
): void => {
  if (!Array.isArray(items)) {
    throw new Error("Production evidence closure bundle closure_items must be an array")
  }
  for (const item of items) {
    if (!isRecord(item)) {
      throw new Error("Production evidence closure item must be an object")
    }
    const candidate = item as unknown as ProductionEvidenceClosureItem
    assertNonEmpty(candidate.control_id, "closure_item.control_id")
    assertNonEmpty(candidate.layer, "closure_item.layer")
    assertNonEmpty(candidate.title, "closure_item.title")
    assertNonEmpty(candidate.evidence_owner, "closure_item.evidence_owner")
    assertNonEmpty(candidate.minimum_review_role, "closure_item.minimum_review_role")
    if (
      !Number.isInteger(candidate.missing_refs) ||
      candidate.missing_refs < 1
    ) {
      throw new Error(
        "Production evidence closure item missing_refs must be a positive integer",
      )
    }
    assertStringArray(candidate.required_artifacts, "closure_item.required_artifacts")
    assertStringArray(candidate.collection_slots, "closure_item.collection_slots")
    for (const slot of candidate.collection_slots) {
      if (!slot.startsWith(PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME)) {
        throw new Error(
          `Production evidence closure item collection slots must use ${PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME}`,
        )
      }
    }
    assertNonEmpty(candidate.next_action, "closure_item.next_action")
  }
}

const assertStringArray = (
  values: ReadonlyArray<string>,
  field: string,
): void => {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    !values.every((value) => typeof value === "string" && value.trim().length > 0)
  ) {
    throw new Error(`Production evidence closure bundle ${field} must be strings`)
  }
}

const assertGeneratedAt = (value: string): void => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(
      "Production evidence closure bundle generatedAt must be an ISO timestamp",
    )
  }
}

function assertOneOf(
  value: unknown,
  allowed: ReadonlySet<string>,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`Production evidence closure bundle ${field} is invalid`)
  }
}

function assertNonEmpty(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Production evidence closure bundle requires ${field}`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
