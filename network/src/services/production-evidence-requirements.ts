import { assertEvidenceReviewDate } from "./evidence-review.js"
import {
  OPERATOR_EVIDENCE_CONTROL_IDS,
  OPERATOR_EVIDENCE_LAYERS,
  type OperatorEvidenceControlId,
  type OperatorEvidenceLayer,
} from "./operator-evidence-index.js"
import {
  PRODUCTION_EVIDENCE_REVIEW_ROLE_SET,
  PRODUCTION_EVIDENCE_REVIEW_ROLES,
  type ProductionEvidenceReviewRole,
} from "./production-evidence-review-role.js"

export const PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME = "ops://qrtrust/" as const

export { PRODUCTION_EVIDENCE_REVIEW_ROLES, type ProductionEvidenceReviewRole }

export interface ProductionEvidenceScope {
  readonly claim_mode: "production_candidate"
  readonly root_program_id: string
  readonly environment: string
  readonly boundary: string
}

export interface ProductionEvidenceRequirementControl {
  readonly control_id: OperatorEvidenceControlId
  readonly layer: OperatorEvidenceLayer
  readonly title: string
  readonly minimum_refs: number
  readonly required_ref_scheme: typeof PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME
  readonly evidence_owner: string
  readonly minimum_review_role: ProductionEvidenceReviewRole
  readonly retention_policy: string
  readonly why_required: string
  readonly required_artifacts: ReadonlyArray<string>
}

export interface ProductionEvidenceRequirementsGuardrails {
  readonly requirements_are_not_evidence: true
  readonly public_repo_contains_no_operator_secrets: true
  readonly production_claim_requires_ops_refs: true
  readonly operators_own_evidence_storage: true
}

export interface ProductionEvidenceRequirementsReviewer {
  readonly name: string
  readonly role: string
  readonly reviewed_at: string
}

export interface ProductionEvidenceRequirements {
  readonly artifact_type: "production_evidence_requirements"
  readonly requirements_id: string
  readonly generated_at: string
  readonly scope: ProductionEvidenceScope
  readonly controls: ReadonlyArray<ProductionEvidenceRequirementControl>
  readonly guardrails: ProductionEvidenceRequirementsGuardrails
  readonly reviewer: ProductionEvidenceRequirementsReviewer
}

export interface ProductionEvidenceRequirementsConfig {
  readonly requirementsId: string
  readonly generatedAt: string
  readonly scope: ProductionEvidenceScope
  readonly controls: ReadonlyArray<ProductionEvidenceRequirementControl>
  readonly guardrails: ProductionEvidenceRequirementsGuardrails
  readonly reviewer: ProductionEvidenceRequirementsReviewer
}

const OPERATOR_EVIDENCE_CONTROL_ID_SET = new Set<string>(
  OPERATOR_EVIDENCE_CONTROL_IDS,
)
const OPERATOR_EVIDENCE_LAYER_SET = new Set<string>(OPERATOR_EVIDENCE_LAYERS)
const PRIVATE_MATERIAL_RE =
  /BEGIN PRIVATE KEY|END PRIVATE KEY|pem:\/\/|env:\/\/|file:\/\/|private[_-]?key|password|bearer|api[_-]?key/i
const REF_LIKE_TOKEN_RE = /:\/\/|\.\.|docs\/public\/|network\//

export const makeProductionEvidenceRequirements = (
  config: ProductionEvidenceRequirementsConfig,
): ProductionEvidenceRequirements => {
  const requirements: ProductionEvidenceRequirements = {
    artifact_type: "production_evidence_requirements",
    requirements_id: config.requirementsId,
    generated_at: config.generatedAt,
    scope: config.scope,
    controls: config.controls,
    guardrails: config.guardrails,
    reviewer: config.reviewer,
  }

  assertProductionEvidenceRequirements(requirements)

  return requirements
}

export const assertProductionEvidenceRequirements = (
  requirements: ProductionEvidenceRequirements,
): void => {
  if (!isRecord(requirements)) {
    throw new Error("Production evidence requirements must be an object")
  }
  if (requirements.artifact_type !== "production_evidence_requirements") {
    throw new Error(
      "Production evidence requirements artifact_type must be production_evidence_requirements",
    )
  }
  assertNonEmpty(requirements.requirements_id, "requirements_id")
  assertDateTime(
    requirements.generated_at,
    "generated_at",
    requirements.requirements_id,
  )
  assertNoPrivateMaterial(requirements)
  assertScope(requirements)
  assertGuardrails(requirements.guardrails, requirements.requirements_id)
  assertReviewer(requirements.reviewer, requirements.requirements_id)
  assertControls(requirements)
}

export const collectProductionEvidenceRequirementControls = (
  requirements: ProductionEvidenceRequirements,
): ReadonlyArray<OperatorEvidenceControlId> => {
  assertProductionEvidenceRequirements(requirements)

  return requirements.controls.map((control) => control.control_id)
}

const assertScope = (requirements: ProductionEvidenceRequirements): void => {
  const scope = requirements.scope
  if (!isRecord(scope)) {
    throw new Error(
      `Production evidence requirements scope must be an object for ${requirements.requirements_id}`,
    )
  }
  if (scope.claim_mode !== "production_candidate") {
    throw new Error(
      `Production evidence requirements scope.claim_mode must be production_candidate for ${requirements.requirements_id}`,
    )
  }
  assertNonEmpty(scope.root_program_id, "scope.root_program_id")
  assertNonEmpty(scope.environment, "scope.environment")
  assertNonEmpty(scope.boundary, "scope.boundary")
}

const assertControls = (requirements: ProductionEvidenceRequirements): void => {
  if (!Array.isArray(requirements.controls)) {
    throw new Error(
      `Production evidence requirements controls must be an array for ${requirements.requirements_id}`,
    )
  }

  const controlIds = requirements.controls.map((control) =>
    isRecord(control) ? control.control_id : undefined,
  )
  if (
    controlIds.length !== OPERATOR_EVIDENCE_CONTROL_IDS.length ||
    !OPERATOR_EVIDENCE_CONTROL_IDS.every(
      (controlId, index) => controlIds[index] === controlId,
    )
  ) {
    throw new Error(
      `Production evidence requirements controls must use canonical order for ${requirements.requirements_id}`,
    )
  }

  for (const control of requirements.controls) {
    assertControl(requirements, control)
  }
}

const assertControl = (
  requirements: ProductionEvidenceRequirements,
  control: ProductionEvidenceRequirementControl,
): void => {
  if (!isRecord(control)) {
    throw new Error(
      `Production evidence requirements control must be an object for ${requirements.requirements_id}`,
    )
  }
  const controlId = control.control_id
  if (
    typeof controlId !== "string" ||
    !OPERATOR_EVIDENCE_CONTROL_ID_SET.has(controlId)
  ) {
    throw new Error(
      `Production evidence requirements control_id is invalid for ${requirements.requirements_id}`,
    )
  }
  if (
    typeof control.layer !== "string" ||
    !OPERATOR_EVIDENCE_LAYER_SET.has(control.layer)
  ) {
    throw new Error(
      `Production evidence requirements ${controlId} layer is invalid for ${requirements.requirements_id}`,
    )
  }
  assertNonEmpty(control.title, `${controlId}.title`)
  if (!Number.isInteger(control.minimum_refs) || control.minimum_refs < 1) {
    throw new Error(
      `Production evidence requirements ${controlId}.minimum_refs must be at least 1`,
    )
  }
  if (control.required_ref_scheme !== PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME) {
    throw new Error(
      `Production evidence requirements ${controlId}.required_ref_scheme must be ${PRODUCTION_EVIDENCE_REQUIRED_REF_SCHEME}`,
    )
  }
  assertNonEmpty(control.evidence_owner, `${controlId}.evidence_owner`)
  if (
    typeof control.minimum_review_role !== "string" ||
    !PRODUCTION_EVIDENCE_REVIEW_ROLE_SET.has(control.minimum_review_role)
  ) {
    throw new Error(
      `Production evidence requirements ${controlId}.minimum_review_role is invalid`,
    )
  }
  assertNonEmpty(control.retention_policy, `${controlId}.retention_policy`)
  assertNonEmpty(control.why_required, `${controlId}.why_required`)
  assertRequiredArtifacts(requirements, controlId, control.required_artifacts)
}

const assertRequiredArtifacts = (
  requirements: ProductionEvidenceRequirements,
  controlId: string,
  artifacts: unknown,
): void => {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error(
      `Production evidence requirements ${controlId}.required_artifacts must be non-empty for ${requirements.requirements_id}`,
    )
  }
  for (const artifact of artifacts) {
    assertNonEmpty(artifact, `${controlId}.required_artifacts`)
    if (REF_LIKE_TOKEN_RE.test(artifact)) {
      throw new Error(
        `Production evidence requirements ${controlId}.required_artifacts must name artifact classes, not evidence refs`,
      )
    }
  }
}

const assertGuardrails = (
  guardrails: ProductionEvidenceRequirementsGuardrails,
  requirementsId: string,
): void => {
  if (!isRecord(guardrails)) {
    throw new Error(
      `Production evidence requirements guardrails must be an object for ${requirementsId}`,
    )
  }
  for (const field of [
    "requirements_are_not_evidence",
    "public_repo_contains_no_operator_secrets",
    "production_claim_requires_ops_refs",
    "operators_own_evidence_storage",
  ] as const) {
    if (guardrails[field] !== true) {
      throw new Error(
        `Production evidence requirements guardrail ${field} must be true for ${requirementsId}`,
      )
    }
  }
}

const assertReviewer = (
  reviewer: ProductionEvidenceRequirementsReviewer,
  requirementsId: string,
): void => {
  if (!isRecord(reviewer)) {
    throw new Error(
      `Production evidence requirements reviewer must be an object for ${requirementsId}`,
    )
  }
  assertNonEmpty(reviewer.name, "reviewer.name")
  assertNonEmpty(reviewer.role, "reviewer.role")
  assertEvidenceReviewDate(
    reviewer.reviewed_at,
    "Production evidence requirements",
    "reviewer.reviewed_at",
    requirementsId,
  )
}

function assertDateTime(value: unknown, field: string, requirementsId: string): void {
  assertNonEmpty(value, field)
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(
      `Production evidence requirements ${field} must be an ISO timestamp for ${requirementsId}`,
    )
  }
}

function assertNoPrivateMaterial(
  requirements: ProductionEvidenceRequirements,
): void {
  if (PRIVATE_MATERIAL_RE.test(JSON.stringify(requirements))) {
    throw new Error(
      `Production evidence requirements contain private material markers for ${requirements.requirements_id}`,
    )
  }
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Production evidence requirements require ${field}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
