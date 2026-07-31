import {
  type OperatorEvidenceControlId,
  type OperatorEvidenceIndex,
  assertOperatorEvidenceIndex,
} from "./operator-evidence-index.js"
import {
  makeProductionEvidenceCollectionTemplate,
  type ProductionEvidenceCollectionControl,
  type ProductionEvidenceCollectionSlot,
} from "./production-evidence-collection-template.js"
import {
  makeProductionEvidenceGapReport,
  type ProductionEvidenceGapControl,
} from "./production-evidence-gap-report.js"
import {
  makeProductionEvidenceIntakeReport,
  type ProductionEvidenceIntakeFinding,
} from "./production-evidence-intake.js"
import {
  type ProductionEvidenceRequirements,
  type ProductionEvidenceReviewRole,
  assertProductionEvidenceRequirements,
} from "./production-evidence-requirements.js"

export type ProductionEvidencePrivateIndexTemplateStatus =
  | "needs_private_refs"
  | "ready_template"

export type ProductionEvidencePrivateIndexValidationStatus =
  | "blocked"
  | "ready_for_human_review"

export interface ProductionEvidencePrivateIndexConfig {
  readonly generatedAt: string
  readonly requirements: ProductionEvidenceRequirements
  readonly operatorEvidenceIndex: OperatorEvidenceIndex
}

export interface ProductionEvidencePrivateIndexTemplateSummary {
  readonly controls_total: number
  readonly controls_satisfied: number
  readonly controls_needing_refs: number
  readonly refs_required: number
  readonly refs_provided: number
  readonly refs_missing: number
}

export interface ProductionEvidencePrivateIndexTemplateControl {
  readonly control_id: OperatorEvidenceControlId
  readonly title: string
  readonly evidence_owner: string
  readonly minimum_review_role: ProductionEvidenceReviewRole
  readonly required_ref_count: number
  readonly current_eligible_ref_count: number
  readonly missing_ref_count: number
  readonly required_artifacts: ReadonlyArray<string>
  readonly collection_slots: ReadonlyArray<ProductionEvidenceCollectionSlot>
  readonly private_index_instruction: string
}

export interface ProductionEvidencePrivateIndexTemplate {
  readonly artifact_type: "production_evidence_private_index_template"
  readonly generated_at: string
  readonly status: ProductionEvidencePrivateIndexTemplateStatus
  readonly requirements_id: string
  readonly source_operator_evidence_index_id: string
  readonly collection_template_id: string
  readonly summary: ProductionEvidencePrivateIndexTemplateSummary
  readonly controls: ReadonlyArray<ProductionEvidencePrivateIndexTemplateControl>
  readonly guardrails: ReadonlyArray<string>
  readonly next_actions: ReadonlyArray<string>
}

export interface ProductionEvidencePrivateIndexValidationFinding {
  readonly severity: "info" | "blocker"
  readonly code: ProductionEvidenceIntakeFinding["code"]
  readonly control_id?: OperatorEvidenceControlId
  readonly message: string
}

export interface ProductionEvidencePrivateIndexValidationSummary {
  readonly controls_total: number
  readonly controls_satisfied: number
  readonly refs_required: number
  readonly refs_provided: number
  readonly refs_missing: number
  readonly blockers: number
  readonly ready_for_human_review: boolean
}

export interface ProductionEvidencePrivateIndexValidationReport {
  readonly artifact_type: "production_evidence_private_index_validation_report"
  readonly generated_at: string
  readonly status: ProductionEvidencePrivateIndexValidationStatus
  readonly requirements_id: string
  readonly operator_evidence_index_id: string
  readonly summary: ProductionEvidencePrivateIndexValidationSummary
  readonly findings: ReadonlyArray<ProductionEvidencePrivateIndexValidationFinding>
  readonly guardrails: ReadonlyArray<string>
  readonly next_actions: ReadonlyArray<string>
}

export const makeProductionEvidencePrivateIndexTemplate = (
  config: ProductionEvidencePrivateIndexConfig,
): ProductionEvidencePrivateIndexTemplate => {
  assertInputs(config)

  const collectionTemplate = makeCollectionTemplate(config)
  const gapReport = makeProductionEvidenceGapReport({
    generatedAt: config.generatedAt,
    requirements: config.requirements,
    operatorEvidenceIndex: config.operatorEvidenceIndex,
  })
  const controls = gapReport.controls.map((control) =>
    makeTemplateControl(control, collectionTemplate.controls),
  )
  const status: ProductionEvidencePrivateIndexTemplateStatus =
    gapReport.summary.refs_missing > 0 ? "needs_private_refs" : "ready_template"

  return {
    artifact_type: "production_evidence_private_index_template",
    generated_at: config.generatedAt,
    status,
    requirements_id: config.requirements.requirements_id,
    source_operator_evidence_index_id: config.operatorEvidenceIndex.index_id,
    collection_template_id: collectionTemplate.template_id,
    summary: {
      controls_total: gapReport.summary.controls_total,
      controls_satisfied: gapReport.summary.controls_satisfied,
      controls_needing_refs: gapReport.summary.controls_missing_refs,
      refs_required: gapReport.summary.refs_required,
      refs_provided: gapReport.summary.refs_provided,
      refs_missing: gapReport.summary.refs_missing,
    },
    controls,
    guardrails: [
      "This template contains collection slots only; it does not contain production evidence.",
      "Do not commit the filled private operator evidence index to the public repository.",
      "Do not paste secrets, key material, bearer tokens, or private evidence bodies into refs.",
      "Each private evidence ref must be reviewed by the required operational role.",
    ],
    next_actions: makeTemplateNextActions(gapReport.summary.refs_missing),
  }
}

export const makeProductionEvidencePrivateIndexValidationReport = (
  config: ProductionEvidencePrivateIndexConfig,
): ProductionEvidencePrivateIndexValidationReport => {
  assertInputs(config)

  const collectionTemplate = makeCollectionTemplate(config)
  const gapReport = makeProductionEvidenceGapReport({
    generatedAt: config.generatedAt,
    requirements: config.requirements,
    operatorEvidenceIndex: config.operatorEvidenceIndex,
  })
  const intakeReport = makeProductionEvidenceIntakeReport({
    generatedAt: config.generatedAt,
    requirements: config.requirements,
    operatorEvidenceIndex: config.operatorEvidenceIndex,
    collectionTemplate,
    gapReport,
  })
  const ready =
    gapReport.status === "complete" &&
    intakeReport.status === "accepted_for_review"
  const status: ProductionEvidencePrivateIndexValidationStatus = ready
    ? "ready_for_human_review"
    : "blocked"

  return {
    artifact_type: "production_evidence_private_index_validation_report",
    generated_at: config.generatedAt,
    status,
    requirements_id: config.requirements.requirements_id,
    operator_evidence_index_id: config.operatorEvidenceIndex.index_id,
    summary: {
      controls_total: gapReport.summary.controls_total,
      controls_satisfied: gapReport.summary.controls_satisfied,
      refs_required: gapReport.summary.refs_required,
      refs_provided: gapReport.summary.refs_provided,
      refs_missing: gapReport.summary.refs_missing,
      blockers: intakeReport.summary.blockers,
      ready_for_human_review: ready,
    },
    findings: intakeReport.findings.map(sanitizeFinding),
    guardrails: [
      "This validation report intentionally omits evidence ref URIs and evidence bodies.",
      "A ready result only means the private packet can proceed to human operational review.",
      "Production approval, evidence retention, and evidence access control remain operator-owned.",
    ],
    next_actions: makeValidationNextActions(status, gapReport.summary.refs_missing),
  }
}

const makeCollectionTemplate = (config: ProductionEvidencePrivateIndexConfig) =>
  makeProductionEvidenceCollectionTemplate({
    templateId: "production-evidence-private-index-template:reference",
    generatedAt: config.generatedAt,
    requirements: config.requirements,
  })

const makeTemplateControl = (
  control: ProductionEvidenceGapControl,
  templateControls: ReadonlyArray<ProductionEvidenceCollectionControl>,
): ProductionEvidencePrivateIndexTemplateControl => {
  const templateControl = templateControls.find(
    (candidate) => candidate.control_id === control.control_id,
  )
  if (!templateControl) {
    throw new Error(`Missing private evidence template control ${control.control_id}`)
  }

  return {
    control_id: control.control_id,
    title: control.title,
    evidence_owner: control.evidence_owner,
    minimum_review_role: control.minimum_review_role,
    required_ref_count: control.minimum_refs,
    current_eligible_ref_count: control.provided_refs,
    missing_ref_count: control.missing_refs,
    required_artifacts: control.required_artifacts,
    collection_slots: templateControl.evidence_slots,
    private_index_instruction:
      control.missing_refs > 0
        ? `Add ${control.missing_refs} reviewed private evidence ref(s) for ${control.control_id}.`
        : `Keep ${control.control_id} refs current and reviewed.`,
  }
}

const sanitizeFinding = (
  finding: ProductionEvidenceIntakeFinding,
): ProductionEvidencePrivateIndexValidationFinding => {
  const sanitized = {
    severity: finding.severity,
    code: finding.code,
    message:
      finding.severity === "blocker"
        ? "Resolve this private evidence finding before reviewer handoff."
        : "Review this private evidence finding before reviewer handoff.",
  }

  if (!finding.control_id) {
    return sanitized
  }

  return {
    ...sanitized,
    control_id: finding.control_id,
  }
}

const makeTemplateNextActions = (
  refsMissing: number,
): ReadonlyArray<string> => {
  if (refsMissing === 0) {
    return [
      "Validate the private operator evidence index and route it to human review.",
    ]
  }

  return [
    `Collect ${refsMissing} additional private evidence ref(s).`,
    "Write the filled operator evidence index outside this public repository.",
    "Run the private index check before requesting human production review.",
  ]
}

const makeValidationNextActions = (
  status: ProductionEvidencePrivateIndexValidationStatus,
  refsMissing: number,
): ReadonlyArray<string> => {
  if (status === "ready_for_human_review") {
    return [
      "Route the private operator evidence packet to human production review.",
      "Keep the evidence bodies, reviewer notes, and retention policy outside the public repository.",
    ]
  }

  return [
    `Resolve ${refsMissing} missing private evidence ref(s).`,
    "Fix any private packet blockers, then rerun the private index check.",
  ]
}

const assertInputs = (config: ProductionEvidencePrivateIndexConfig): void => {
  assertGeneratedAt(config.generatedAt)
  assertProductionEvidenceRequirements(config.requirements)
  assertOperatorEvidenceIndex(config.operatorEvidenceIndex)
}

const assertGeneratedAt = (value: string): void => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(
      "Production evidence private index generatedAt must be an ISO timestamp",
    )
  }
}
