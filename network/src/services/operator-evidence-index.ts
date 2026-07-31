import { assertEvidenceReviewDate } from "./evidence-review.js"
import {
  PRODUCTION_EVIDENCE_REVIEW_ROLE_SET,
  type ProductionEvidenceReviewRole,
} from "./production-evidence-review-role.js"

export const OPERATOR_EVIDENCE_CONTROL_IDS = [
  "postgres_source_of_truth",
  "migration_ledger",
  "restore_automation",
  "packaged_deployment_ownership",
  "nats_propagation",
  "managed_key_material",
  "managed_signing_custody",
  "custody_audit_export",
  "runtime_safety_provider",
  "scanner_decision_persistence",
  "worker_operations_evidence",
  "operator_runbooks",
] as const

export const OPERATOR_EVIDENCE_LAYERS = [
  "source_of_truth",
  "propagation",
  "custody",
  "runtime",
  "scanner",
  "operator_readiness",
] as const

export type OperatorEvidenceControlId =
  (typeof OPERATOR_EVIDENCE_CONTROL_IDS)[number]

export type OperatorEvidenceLayer = (typeof OPERATOR_EVIDENCE_LAYERS)[number]

export type OperatorEvidenceClaimMode =
  | "reference_drill"
  | "production_candidate"

export type OperatorEvidenceStatus =
  | "reference_backed"
  | "operator_backed"
  | "blocked"

export interface OperatorEvidenceRef {
  readonly label: string
  readonly uri: string
  readonly owner: string
  readonly review_role?: ProductionEvidenceReviewRole
  readonly reviewed_at: string
}

export interface OperatorEvidenceControl {
  readonly control_id: OperatorEvidenceControlId
  readonly layer: OperatorEvidenceLayer
  readonly status: OperatorEvidenceStatus
  readonly owner: string
  readonly summary: string
  readonly evidence_refs: ReadonlyArray<OperatorEvidenceRef>
}

export interface OperatorEvidenceGuardrails {
  readonly public_repo_contains_no_secrets: true
  readonly evidence_refs_required_for_pass: true
  readonly production_requires_ops_refs: true
  readonly operator_controls_remain_external: true
}

export interface OperatorEvidenceReviewer {
  readonly name: string
  readonly role: string
  readonly reviewed_at: string
}

export interface OperatorEvidenceIndex {
  readonly artifact_type: "operator_evidence_index"
  readonly index_id: string
  readonly generated_at: string
  readonly claim_mode: OperatorEvidenceClaimMode
  readonly controls: ReadonlyArray<OperatorEvidenceControl>
  readonly guardrails: OperatorEvidenceGuardrails
  readonly reviewer: OperatorEvidenceReviewer
}

export interface OperatorEvidenceIndexConfig {
  readonly indexId: string
  readonly generatedAt: string
  readonly claimMode: OperatorEvidenceClaimMode
  readonly controls: ReadonlyArray<OperatorEvidenceControl>
  readonly guardrails: OperatorEvidenceGuardrails
  readonly reviewer: OperatorEvidenceReviewer
}

const OPERATOR_EVIDENCE_CONTROL_ID_SET = new Set<string>(
  OPERATOR_EVIDENCE_CONTROL_IDS,
)
const OPERATOR_EVIDENCE_LAYER_SET = new Set<string>(OPERATOR_EVIDENCE_LAYERS)
const OPERATOR_EVIDENCE_STATUS_SET = new Set<string>([
  "reference_backed",
  "operator_backed",
  "blocked",
])

const SAFE_REF_RE = /^(docs\/public\/|network\/|ops:\/\/qrtrust\/)/
const PRIVATE_MATERIAL_RE =
  /BEGIN PRIVATE KEY|END PRIVATE KEY|pem:\/\/|env:\/\/|file:\/\/|private[_-]?key|password|bearer|api[_-]?key/i

export const makeOperatorEvidenceIndex = (
  config: OperatorEvidenceIndexConfig,
): OperatorEvidenceIndex => {
  const index: OperatorEvidenceIndex = {
    artifact_type: "operator_evidence_index",
    index_id: config.indexId,
    generated_at: config.generatedAt,
    claim_mode: config.claimMode,
    controls: config.controls,
    guardrails: config.guardrails,
    reviewer: config.reviewer,
  }

  assertOperatorEvidenceIndex(index)

  return index
}

export const assertOperatorEvidenceIndex = (
  index: OperatorEvidenceIndex,
): void => {
  if (!isRecord(index)) {
    throw new Error("Operator evidence index must be an object")
  }
  if (index.artifact_type !== "operator_evidence_index") {
    throw new Error(
      "Operator evidence index artifact_type must be operator_evidence_index",
    )
  }
  assertNonEmpty(index.index_id, "index_id")
  assertDateTime(index.generated_at, "generated_at", index.index_id)
  if (
    index.claim_mode !== "reference_drill" &&
    index.claim_mode !== "production_candidate"
  ) {
    throw new Error(
      `Operator evidence index has invalid claim_mode: ${String(index.claim_mode)}`,
    )
  }

  assertNoPrivateMaterial(index)
  assertGuardrails(index.guardrails, index.index_id)
  assertReviewer(index.reviewer, index.index_id)
  assertControls(index)
}

export const collectOperatorEvidenceRefs = (
  index: OperatorEvidenceIndex,
): ReadonlyArray<string> => {
  assertOperatorEvidenceIndex(index)

  return index.controls.flatMap((control) =>
    control.evidence_refs.map((ref) => ref.uri),
  )
}

const assertControls = (index: OperatorEvidenceIndex): void => {
  if (!Array.isArray(index.controls)) {
    throw new Error(
      `Operator evidence index controls must be an array for ${index.index_id}`,
    )
  }

  const controls = index.controls as ReadonlyArray<unknown>
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
      `Operator evidence index controls must use canonical order for ${index.index_id}`,
    )
  }

  for (const control of controls) {
    if (!isRecord(control)) {
      throw new Error(
        `Operator evidence index control must be an object for ${index.index_id}`,
      )
    }
    const controlId = control.control_id
    const layer = control.layer
    const status = control.status

    if (
      typeof controlId !== "string" ||
      !OPERATOR_EVIDENCE_CONTROL_ID_SET.has(controlId)
    ) {
      throw new Error(
        `Operator evidence index control_id is invalid for ${index.index_id}`,
      )
    }
    if (
      typeof layer !== "string" ||
      !OPERATOR_EVIDENCE_LAYER_SET.has(layer)
    ) {
      throw new Error(
        `Operator evidence index ${controlId} layer is invalid for ${index.index_id}`,
      )
    }
    if (
      typeof status !== "string" ||
      !OPERATOR_EVIDENCE_STATUS_SET.has(status)
    ) {
      throw new Error(
        `Operator evidence index ${controlId} status is invalid for ${index.index_id}`,
      )
    }
    if (
      index.claim_mode === "production_candidate" &&
      status !== "operator_backed"
    ) {
      throw new Error(
        `Operator evidence index production candidate control ${controlId} must be operator_backed`,
      )
    }
    assertNonEmpty(control.owner, `${controlId}.owner`)
    assertNonEmpty(control.summary, `${controlId}.summary`)
    assertEvidenceRefs(index, controlId, control.evidence_refs)
  }
}

const assertEvidenceRefs = (
  index: OperatorEvidenceIndex,
  controlId: string,
  evidenceRefs: unknown,
): void => {
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    throw new Error(
      `Operator evidence index control ${controlId} requires evidence_refs`,
    )
  }

  for (const ref of evidenceRefs) {
    if (!isRecord(ref)) {
      throw new Error(
        `Operator evidence index control ${controlId} evidence_ref must be an object`,
      )
    }
    assertNonEmpty(ref.label, `${controlId}.evidence_ref.label`)
    assertPathRef(
      ref.uri,
      `${controlId}.evidence_ref.uri`,
      index.claim_mode,
    )
    assertNonEmpty(ref.owner, `${controlId}.evidence_ref.owner`)
    assertReviewRole(
      ref.review_role,
      `${controlId}.evidence_ref.review_role`,
      index.claim_mode,
    )
    assertEvidenceReviewDate(
      ref.reviewed_at,
      "Operator evidence index",
      `${controlId}.evidence_ref.reviewed_at`,
      index.index_id,
    )
  }
}

const assertReviewRole = (
  role: unknown,
  field: string,
  claimMode: OperatorEvidenceClaimMode,
): void => {
  if (role === undefined && claimMode !== "production_candidate") {
    return
  }
  assertNonEmpty(role, field)
  if (!PRODUCTION_EVIDENCE_REVIEW_ROLE_SET.has(role)) {
    throw new Error(
      `Operator evidence index ${field} must be a recognized production evidence review role`,
    )
  }
}

const assertGuardrails = (
  guardrails: OperatorEvidenceGuardrails,
  indexId: string,
): void => {
  if (!isRecord(guardrails)) {
    throw new Error(`Operator evidence index guardrails must be an object for ${indexId}`)
  }
  for (const field of [
    "public_repo_contains_no_secrets",
    "evidence_refs_required_for_pass",
    "production_requires_ops_refs",
    "operator_controls_remain_external",
  ] as const) {
    if (guardrails[field] !== true) {
      throw new Error(
        `Operator evidence index guardrail ${field} must be true for ${indexId}`,
      )
    }
  }
}

const assertReviewer = (
  reviewer: OperatorEvidenceReviewer,
  indexId: string,
): void => {
  if (!isRecord(reviewer)) {
    throw new Error(`Operator evidence index reviewer must be an object for ${indexId}`)
  }
  assertNonEmpty(reviewer.name, "reviewer.name")
  assertNonEmpty(reviewer.role, "reviewer.role")
  assertEvidenceReviewDate(
    reviewer.reviewed_at,
    "Operator evidence index",
    "reviewer.reviewed_at",
    indexId,
  )
}

function assertPathRef(
  ref: unknown,
  field: string,
  claimMode: OperatorEvidenceClaimMode,
): void {
  assertNonEmpty(ref, field)
  if (ref.includes("..")) {
    throw new Error(`Operator evidence index ${field} must not escape`)
  }
  if (!SAFE_REF_RE.test(ref)) {
    throw new Error(
      `Operator evidence index ${field} must stay under docs/public/, network/, or ops://qrtrust/`,
    )
  }
  if (claimMode === "production_candidate" && !ref.startsWith("ops://qrtrust/")) {
    throw new Error(
      `Operator evidence index production candidate ${field} must use ops://qrtrust/`,
    )
  }
}

function assertDateTime(value: unknown, field: string, indexId: string): void {
  assertNonEmpty(value, field)
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(
      `Operator evidence index ${field} must be an ISO timestamp for ${indexId}`,
    )
  }
}

function assertNoPrivateMaterial(index: OperatorEvidenceIndex): void {
  if (PRIVATE_MATERIAL_RE.test(JSON.stringify(index))) {
    throw new Error(
      `Operator evidence index contains private material markers for ${index.index_id}`,
    )
  }
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Operator evidence index requires ${field}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
