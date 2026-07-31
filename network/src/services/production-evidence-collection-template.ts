import {
  OPERATOR_EVIDENCE_CONTROL_IDS,
  OPERATOR_EVIDENCE_LAYERS,
  type OperatorEvidenceControlId,
  type OperatorEvidenceLayer,
} from "./operator-evidence-index.js"
import {
  PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME,
  type ProductionEvidenceRequirementControl,
  type ProductionEvidenceRequirements,
  type ProductionEvidenceReviewRole,
  type ProductionEvidenceScope,
  assertProductionEvidenceRequirements,
} from "./production-evidence-requirements.js"

export interface ProductionEvidenceCollectionTemplateConfig {
  readonly templateId: string
  readonly generatedAt: string
  readonly requirements: ProductionEvidenceRequirements
}

export interface ProductionEvidenceCollectionSlot {
  readonly slot_id: string
  readonly artifact_class: string
  readonly placeholder_uri_pattern: string
  readonly required_owner: string
  readonly minimum_review_role: ProductionEvidenceReviewRole
  readonly reviewed_at_placeholder: "YYYY-MM-DD"
  readonly operator_prompt: string
}

export interface ProductionEvidenceCollectionControl {
  readonly control_id: OperatorEvidenceControlId
  readonly layer: OperatorEvidenceLayer
  readonly title: string
  readonly evidence_owner: string
  readonly minimum_review_role: ProductionEvidenceReviewRole
  readonly minimum_refs: number
  readonly required_artifacts: ReadonlyArray<string>
  readonly evidence_slots: ReadonlyArray<ProductionEvidenceCollectionSlot>
  readonly why_required: string
  readonly retention_policy: string
  readonly operator_instruction: string
}

export interface ProductionEvidenceCollectionTemplateSummary {
  readonly controls_total: number
  readonly evidence_slots_total: number
  readonly minimum_refs_required: number
  readonly unique_evidence_owners: ReadonlyArray<string>
}

export interface ProductionEvidenceCollectionTemplateGuardrails {
  readonly template_contains_no_evidence: true
  readonly placeholder_refs_are_not_proof: true
  readonly production_refs_must_use_ops_scheme: true
  readonly operator_storage_remains_external: true
}

export interface ProductionEvidenceCollectionTemplate {
  readonly artifact_type: "production_evidence_collection_template"
  readonly template_id: string
  readonly generated_at: string
  readonly requirements_id: string
  readonly scope: ProductionEvidenceScope
  readonly required_ref_scheme: typeof PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME
  readonly summary: ProductionEvidenceCollectionTemplateSummary
  readonly controls: ReadonlyArray<ProductionEvidenceCollectionControl>
  readonly guardrails: ProductionEvidenceCollectionTemplateGuardrails
  readonly reviewer_note: string
}

const OPERATOR_EVIDENCE_CONTROL_ID_SET = new Set<string>(
  OPERATOR_EVIDENCE_CONTROL_IDS,
)
const OPERATOR_EVIDENCE_LAYER_SET = new Set<string>(OPERATOR_EVIDENCE_LAYERS)
const PRIVATE_MATERIAL_RE =
  /BEGIN PRIVATE KEY|END PRIVATE KEY|pem:\/\/|env:\/\/|file:\/\/|private[_-]?key|password|bearer|api[_-]?key/i

export const makeProductionEvidenceCollectionTemplate = (
  config: ProductionEvidenceCollectionTemplateConfig,
): ProductionEvidenceCollectionTemplate => {
  assertProductionEvidenceRequirements(config.requirements)
  assertNonEmpty(config.templateId, "template_id")
  assertDateTime(config.generatedAt, "generated_at")

  const controls = config.requirements.controls.map((control) =>
    makeCollectionControl(control, config.requirements.scope.environment),
  )
  const template: ProductionEvidenceCollectionTemplate = {
    artifact_type: "production_evidence_collection_template",
    template_id: config.templateId,
    generated_at: config.generatedAt,
    requirements_id: config.requirements.requirements_id,
    scope: config.requirements.scope,
    required_ref_scheme: PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME,
    summary: summarizeControls(controls),
    controls,
    guardrails: {
      template_contains_no_evidence: true,
      placeholder_refs_are_not_proof: true,
      production_refs_must_use_ops_scheme: true,
      operator_storage_remains_external: true,
    },
    reviewer_note:
      "This template tells operators what evidence refs to collect; it is not evidence and must not be used as a production pass claim.",
  }

  assertProductionEvidenceCollectionTemplate(template)

  return template
}

export const assertProductionEvidenceCollectionTemplate = (
  template: ProductionEvidenceCollectionTemplate,
): void => {
  if (!isRecord(template)) {
    throw new Error("Production evidence collection template must be an object")
  }
  if (template.artifact_type !== "production_evidence_collection_template") {
    throw new Error(
      "Production evidence collection template artifact_type must be production_evidence_collection_template",
    )
  }
  assertNoPrivateMaterial(template)
  assertNonEmpty(template.template_id, "template_id")
  assertDateTime(template.generated_at, "generated_at")
  assertNonEmpty(template.requirements_id, "requirements_id")
  assertScope(template.scope)
  if (template.required_ref_scheme !== PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME) {
    throw new Error(
      `Production evidence collection template required_ref_scheme must be ${PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME}`,
    )
  }
  assertSummary(template.summary)
  assertControls(template.controls)
  assertGuardrails(template.guardrails)
  assertNonEmpty(template.reviewer_note, "reviewer_note")
}

export const assertProductionEvidenceCollectionTemplateMatches = (
  template: ProductionEvidenceCollectionTemplate,
  requirements: ProductionEvidenceRequirements,
): void => {
  assertProductionEvidenceCollectionTemplate(template)
  assertProductionEvidenceRequirements(requirements)

  if (template.requirements_id !== requirements.requirements_id) {
    throw new Error(
      `Production evidence collection template requirements_id ${template.requirements_id} does not match ${requirements.requirements_id}`,
    )
  }
  if (JSON.stringify(template.scope) !== JSON.stringify(requirements.scope)) {
    throw new Error(
      "Production evidence collection template scope does not match requirements scope",
    )
  }

  const expected = makeProductionEvidenceCollectionTemplate({
    templateId: template.template_id,
    generatedAt: template.generated_at,
    requirements,
  })
  if (JSON.stringify(template) !== JSON.stringify(expected)) {
    throw new Error(
      "Production evidence collection template is stale or does not match the requirements contract",
    )
  }
}

const makeCollectionControl = (
  control: ProductionEvidenceRequirementControl,
  environment: string,
): ProductionEvidenceCollectionControl => ({
  control_id: control.control_id,
  layer: control.layer,
  title: control.title,
  evidence_owner: control.evidence_owner,
  minimum_review_role: control.minimum_review_role,
  minimum_refs: control.minimum_refs,
  required_artifacts: control.required_artifacts,
  evidence_slots: control.required_artifacts.map((artifact, index) =>
    makeCollectionSlot(control, environment, artifact, index),
  ),
  why_required: control.why_required,
  retention_policy: control.retention_policy,
  operator_instruction: `Collect at least ${control.minimum_refs} reviewed ${PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME} evidence ref(s) for ${control.control_id}. Do not place the evidence body or secrets in the public repo.`,
})

const makeCollectionSlot = (
  control: ProductionEvidenceRequirementControl,
  environment: string,
  artifact: string,
  index: number,
): ProductionEvidenceCollectionSlot => ({
  slot_id: `${control.control_id}:${index + 1}`,
  artifact_class: artifact,
  placeholder_uri_pattern: `${PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME}{environment}/${control.control_id}/${slugify(artifact)}/{review-date}`,
  required_owner: control.evidence_owner,
  minimum_review_role: control.minimum_review_role,
  reviewed_at_placeholder: "YYYY-MM-DD",
  operator_prompt: `Provide the operator-owned ${artifact} ref for ${environment}.`,
})

const summarizeControls = (
  controls: ReadonlyArray<ProductionEvidenceCollectionControl>,
): ProductionEvidenceCollectionTemplateSummary => ({
  controls_total: controls.length,
  evidence_slots_total: controls.reduce(
    (total, control) => total + control.evidence_slots.length,
    0,
  ),
  minimum_refs_required: controls.reduce(
    (total, control) => total + control.minimum_refs,
    0,
  ),
  unique_evidence_owners: Array.from(
    new Set(controls.map((control) => control.evidence_owner)),
  ).sort(),
})

const assertScope = (scope: unknown): void => {
  if (!isRecord(scope)) {
    throw new Error("Production evidence collection template scope must be an object")
  }
  if (scope.claim_mode !== "production_candidate") {
    throw new Error(
      "Production evidence collection template scope.claim_mode must be production_candidate",
    )
  }
  assertNonEmpty(scope.root_program_id, "scope.root_program_id")
  assertNonEmpty(scope.environment, "scope.environment")
  assertNonEmpty(scope.boundary, "scope.boundary")
}

const assertSummary = (summary: unknown): void => {
  if (!isRecord(summary)) {
    throw new Error("Production evidence collection template summary must be an object")
  }
  for (const field of [
    "controls_total",
    "evidence_slots_total",
    "minimum_refs_required",
  ]) {
    if (!Number.isInteger(summary[field]) || Number(summary[field]) < 1) {
      throw new Error(
        `Production evidence collection template summary.${field} must be a positive integer`,
      )
    }
  }
  if (!Array.isArray(summary.unique_evidence_owners)) {
    throw new Error(
      "Production evidence collection template summary.unique_evidence_owners must be an array",
    )
  }
  for (const owner of summary.unique_evidence_owners) {
    assertNonEmpty(owner, "summary.unique_evidence_owners")
  }
}

function assertControls(
  controls: unknown,
): asserts controls is ReadonlyArray<ProductionEvidenceCollectionControl> {
  if (!Array.isArray(controls)) {
    throw new Error("Production evidence collection template controls must be an array")
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
      "Production evidence collection template controls must use canonical order",
    )
  }

  for (const control of controls) {
    assertControl(control)
  }
}

const assertControl = (control: unknown): void => {
  if (!isRecord(control)) {
    throw new Error("Production evidence collection template control must be an object")
  }
  const controlId = control.control_id
  if (
    typeof controlId !== "string" ||
    !OPERATOR_EVIDENCE_CONTROL_ID_SET.has(controlId)
  ) {
    throw new Error(
      "Production evidence collection template control_id is invalid",
    )
  }
  if (
    typeof control.layer !== "string" ||
    !OPERATOR_EVIDENCE_LAYER_SET.has(control.layer)
  ) {
    throw new Error(
      `Production evidence collection template ${controlId}.layer is invalid`,
    )
  }
  assertNonEmpty(control.title, `${controlId}.title`)
  assertNonEmpty(control.evidence_owner, `${controlId}.evidence_owner`)
  assertNonEmpty(control.minimum_review_role, `${controlId}.minimum_review_role`)
  if (!Number.isInteger(control.minimum_refs) || Number(control.minimum_refs) < 1) {
    throw new Error(
      `Production evidence collection template ${controlId}.minimum_refs must be at least 1`,
    )
  }
  const minimumRefs = Number(control.minimum_refs)
  assertStringArray(control.required_artifacts, `${controlId}.required_artifacts`)
  if (
    !Array.isArray(control.evidence_slots) ||
    control.evidence_slots.length < minimumRefs
  ) {
    throw new Error(
      `Production evidence collection template ${controlId}.evidence_slots must cover minimum refs`,
    )
  }
  for (const slot of control.evidence_slots) {
    assertSlot(controlId, slot)
  }
  assertNonEmpty(control.why_required, `${controlId}.why_required`)
  assertNonEmpty(control.retention_policy, `${controlId}.retention_policy`)
  assertNonEmpty(control.operator_instruction, `${controlId}.operator_instruction`)
}

const assertSlot = (controlId: string, slot: unknown): void => {
  if (!isRecord(slot)) {
    throw new Error(
      `Production evidence collection template ${controlId}.slot must be an object`,
    )
  }
  assertNonEmpty(slot.slot_id, `${controlId}.slot_id`)
  assertNonEmpty(slot.artifact_class, `${controlId}.artifact_class`)
  assertNonEmpty(
    slot.placeholder_uri_pattern,
    `${controlId}.placeholder_uri_pattern`,
  )
  if (
    !String(slot.placeholder_uri_pattern).startsWith(
      PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME,
    ) ||
    !String(slot.placeholder_uri_pattern).includes("{")
  ) {
    throw new Error(
      `Production evidence collection template ${controlId}.placeholder_uri_pattern must be a placeholder ${PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME} pattern`,
    )
  }
  assertNonEmpty(slot.required_owner, `${controlId}.required_owner`)
  assertNonEmpty(slot.minimum_review_role, `${controlId}.minimum_review_role`)
  if (slot.reviewed_at_placeholder !== "YYYY-MM-DD") {
    throw new Error(
      `Production evidence collection template ${controlId}.reviewed_at_placeholder must be YYYY-MM-DD`,
    )
  }
  assertNonEmpty(slot.operator_prompt, `${controlId}.operator_prompt`)
}

const assertGuardrails = (
  guardrails: ProductionEvidenceCollectionTemplateGuardrails,
): void => {
  if (!isRecord(guardrails)) {
    throw new Error(
      "Production evidence collection template guardrails must be an object",
    )
  }
  for (const field of [
    "template_contains_no_evidence",
    "placeholder_refs_are_not_proof",
    "production_refs_must_use_ops_scheme",
    "operator_storage_remains_external",
  ]) {
    if (guardrails[field as keyof ProductionEvidenceCollectionTemplateGuardrails] !== true) {
      throw new Error(
        `Production evidence collection template guardrail ${field} must be true`,
      )
    }
  }
}

const assertStringArray = (value: unknown, field: string): void => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Production evidence collection template ${field} must be non-empty`)
  }
  for (const item of value) {
    assertNonEmpty(item, field)
  }
}

const assertNoPrivateMaterial = (value: unknown): void => {
  if (typeof value === "string") {
    if (PRIVATE_MATERIAL_RE.test(value)) {
      throw new Error(
        "Production evidence collection template must not contain private material",
      )
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach(assertNoPrivateMaterial)
    return
  }
  if (isRecord(value)) {
    Object.values(value).forEach(assertNoPrivateMaterial)
  }
}

const assertDateTime = (value: unknown, field: string): void => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(
      `Production evidence collection template ${field} must be an ISO date-time`,
    )
  }
}

const assertNonEmpty = (value: unknown, field: string): void => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Production evidence collection template ${field} must be non-empty`,
    )
  }
}

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
