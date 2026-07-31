import { assertEvidenceReviewDate } from "./evidence-review.js"

export const PACKAGED_DEPLOYMENT_REQUIRED_GATES = [
  "artifact_fingerprinted",
  "contract_smoke_passed",
  "operator_approval_recorded",
  "rollback_plan_accepted",
] as const

export const PACKAGED_DEPLOYMENT_REQUIRED_APPROVAL_ROLES = [
  "release_owner",
  "security_reviewer",
  "operations_reviewer",
] as const

export type PackagedDeploymentGateId =
  (typeof PACKAGED_DEPLOYMENT_REQUIRED_GATES)[number]

export type PackagedDeploymentApprovalRole =
  (typeof PACKAGED_DEPLOYMENT_REQUIRED_APPROVAL_ROLES)[number]

export type PackagedDeploymentClaimMode =
  | "reference_drill"
  | "production_candidate"

export type PackagedDeploymentStage =
  | "reference_lab"
  | "staging_candidate"
  | "production_candidate"

export type PackagedDeploymentGateStatus = "passed" | "failed" | "blocked"

export type PackagedDeploymentApprovalDecision =
  | "approved"
  | "rejected"
  | "deferred"

export interface PackagedDeploymentArtifact {
  readonly artifact_id: string
  readonly version: string
  readonly artifact_ref: string
  readonly sha256: string
  readonly created_at: string
}

export interface PackagedDeploymentEnvironment {
  readonly environment_id: string
  readonly stage: PackagedDeploymentStage
  readonly owner: string
  readonly boundary_ref: string
}

export interface PackagedDeploymentGate {
  readonly gate_id: PackagedDeploymentGateId
  readonly status: PackagedDeploymentGateStatus
  readonly evidence_ref: string
  readonly checked_at: string
  readonly summary: string
}

export interface PackagedDeploymentApproval {
  readonly role: PackagedDeploymentApprovalRole
  readonly approver: string
  readonly decision: PackagedDeploymentApprovalDecision
  readonly approval_ref: string
  readonly approved_at: string
  readonly scope: string
}

export interface PackagedDeploymentRollbackPlan {
  readonly plan_ref: string
  readonly rehearsal_ref: string
  readonly owner: string
  readonly accepted_at: string
}

export interface PackagedDeploymentApprovalGuardrails {
  readonly public_repo_contains_no_secrets: true
  readonly operator_controls_remain_external: true
  readonly rollback_plan_required: true
  readonly production_approval_requires_ops_refs: true
}

export interface PackagedDeploymentApprovalReviewer {
  readonly name: string
  readonly role: string
  readonly reviewed_at: string
}

export interface PackagedDeploymentApprovalEvidencePacket {
  readonly artifact_type: "packaged_deployment_approval_evidence_packet"
  readonly packet_id: string
  readonly generated_at: string
  readonly claim_mode: PackagedDeploymentClaimMode
  readonly deployment_artifact: PackagedDeploymentArtifact
  readonly environment: PackagedDeploymentEnvironment
  readonly gates: ReadonlyArray<PackagedDeploymentGate>
  readonly approvals: ReadonlyArray<PackagedDeploymentApproval>
  readonly rollback_plan: PackagedDeploymentRollbackPlan
  readonly guardrails: PackagedDeploymentApprovalGuardrails
  readonly reviewer: PackagedDeploymentApprovalReviewer
}

export interface PackagedDeploymentApprovalEvidencePacketConfig {
  readonly packetId: string
  readonly generatedAt: string
  readonly claimMode: PackagedDeploymentClaimMode
  readonly deploymentArtifact: PackagedDeploymentArtifact
  readonly environment: PackagedDeploymentEnvironment
  readonly gates: ReadonlyArray<PackagedDeploymentGate>
  readonly approvals: ReadonlyArray<PackagedDeploymentApproval>
  readonly rollbackPlan: PackagedDeploymentRollbackPlan
  readonly guardrails: PackagedDeploymentApprovalGuardrails
  readonly reviewer: PackagedDeploymentApprovalReviewer
}

const SHA256_RE = /^[a-f0-9]{64}$/
const SAFE_REF_RE = /^(docs\/public\/|network\/|ops:\/\/qrtrust\/)/
const PRIVATE_MATERIAL_RE =
  /BEGIN PRIVATE KEY|END PRIVATE KEY|pem:\/\/|env:\/\/|file:\/\/|private[_-]?key|password|bearer|api[_-]?key/i

export const makePackagedDeploymentApprovalEvidencePacket = (
  config: PackagedDeploymentApprovalEvidencePacketConfig,
): PackagedDeploymentApprovalEvidencePacket => {
  const packet: PackagedDeploymentApprovalEvidencePacket = {
    artifact_type: "packaged_deployment_approval_evidence_packet",
    packet_id: config.packetId,
    generated_at: config.generatedAt,
    claim_mode: config.claimMode,
    deployment_artifact: config.deploymentArtifact,
    environment: config.environment,
    gates: config.gates,
    approvals: config.approvals,
    rollback_plan: config.rollbackPlan,
    guardrails: config.guardrails,
    reviewer: config.reviewer,
  }

  assertPackagedDeploymentApprovalEvidencePacket(packet)

  return packet
}

export const assertPackagedDeploymentApprovalEvidencePacket = (
  packet: PackagedDeploymentApprovalEvidencePacket,
): void => {
  if (!isRecord(packet)) {
    throw new Error("Packaged deployment approval evidence packet must be an object")
  }
  if (packet.artifact_type !== "packaged_deployment_approval_evidence_packet") {
    throw new Error(
      "Packaged deployment approval evidence artifact_type must be packaged_deployment_approval_evidence_packet",
    )
  }
  assertNonEmpty(packet.packet_id, "packet_id")
  assertDateTime(packet.generated_at, "generated_at", packet.packet_id)
  if (
    packet.claim_mode !== "reference_drill" &&
    packet.claim_mode !== "production_candidate"
  ) {
    throw new Error(
      `Packaged deployment approval evidence has invalid claim_mode: ${String(packet.claim_mode)}`,
    )
  }

  assertNoPrivateMaterial(packet)
  assertGuardrails(packet.guardrails, packet.packet_id)
  assertReviewer(packet.reviewer, packet.packet_id)
  assertDeploymentArtifact(packet)
  assertEnvironment(packet)
  assertGates(packet)
  assertApprovals(packet)
  assertRollbackPlan(packet)
}

export const collectPackagedDeploymentApprovalEvidenceRefs = (
  packet: PackagedDeploymentApprovalEvidencePacket,
): ReadonlyArray<string> => {
  assertPackagedDeploymentApprovalEvidencePacket(packet)

  return [
    packet.deployment_artifact.artifact_ref,
    packet.environment.boundary_ref,
    ...packet.gates.map((gate) => gate.evidence_ref),
    ...packet.approvals.map((approval) => approval.approval_ref),
    packet.rollback_plan.plan_ref,
    packet.rollback_plan.rehearsal_ref,
  ]
}

const assertDeploymentArtifact = (
  packet: PackagedDeploymentApprovalEvidencePacket,
): void => {
  const artifact = packet.deployment_artifact
  if (!isRecord(artifact)) {
    throw new Error(
      `Packaged deployment approval evidence deployment_artifact must be an object for ${packet.packet_id}`,
    )
  }
  assertNonEmpty(artifact.artifact_id, "deployment_artifact.artifact_id")
  assertNonEmpty(artifact.version, "deployment_artifact.version")
  assertPathRef(
    artifact.artifact_ref,
    "deployment_artifact.artifact_ref",
    packet.claim_mode,
  )
  if (typeof artifact.sha256 !== "string" || !SHA256_RE.test(artifact.sha256)) {
    throw new Error(
      `Packaged deployment approval evidence deployment_artifact.sha256 must be a lowercase sha256 for ${packet.packet_id}`,
    )
  }
  assertDateTime(
    artifact.created_at,
    "deployment_artifact.created_at",
    packet.packet_id,
  )
}

const assertEnvironment = (
  packet: PackagedDeploymentApprovalEvidencePacket,
): void => {
  const environment = packet.environment
  if (!isRecord(environment)) {
    throw new Error(
      `Packaged deployment approval evidence environment must be an object for ${packet.packet_id}`,
    )
  }
  assertNonEmpty(environment.environment_id, "environment.environment_id")
  assertNonEmpty(environment.owner, "environment.owner")
  if (
    environment.stage !== "reference_lab" &&
    environment.stage !== "staging_candidate" &&
    environment.stage !== "production_candidate"
  ) {
    throw new Error(
      `Packaged deployment approval evidence environment.stage is invalid for ${packet.packet_id}`,
    )
  }
  if (
    packet.claim_mode === "production_candidate" &&
    environment.stage !== "production_candidate"
  ) {
    throw new Error(
      `Packaged deployment approval evidence production candidates must target production_candidate stage for ${packet.packet_id}`,
    )
  }
  assertPathRef(environment.boundary_ref, "environment.boundary_ref", packet.claim_mode)
}

const assertGates = (
  packet: PackagedDeploymentApprovalEvidencePacket,
): void => {
  if (!Array.isArray(packet.gates)) {
    throw new Error(
      `Packaged deployment approval evidence gates must be an array for ${packet.packet_id}`,
    )
  }

  const gateIds = packet.gates.map((gate) => gate.gate_id)
  if (
    gateIds.length !== PACKAGED_DEPLOYMENT_REQUIRED_GATES.length ||
    !PACKAGED_DEPLOYMENT_REQUIRED_GATES.every(
      (gateId, index) => gateIds[index] === gateId,
    )
  ) {
    throw new Error(
      `Packaged deployment approval evidence gates must use canonical order for ${packet.packet_id}`,
    )
  }

  for (const gate of packet.gates) {
    if (!isRecord(gate)) {
      throw new Error(
        `Packaged deployment approval evidence gate must be an object for ${packet.packet_id}`,
      )
    }
    if (gate.status !== "passed") {
      throw new Error(
        `Packaged deployment approval evidence gate ${String(gate.gate_id)} must pass for ${packet.packet_id}`,
      )
    }
    assertPathRef(gate.evidence_ref, `${gate.gate_id}.evidence_ref`, packet.claim_mode)
    assertDateTime(gate.checked_at, `${gate.gate_id}.checked_at`, packet.packet_id)
    assertNonEmpty(gate.summary, `${gate.gate_id}.summary`)
  }
}

const assertApprovals = (
  packet: PackagedDeploymentApprovalEvidencePacket,
): void => {
  if (!Array.isArray(packet.approvals)) {
    throw new Error(
      `Packaged deployment approval evidence approvals must be an array for ${packet.packet_id}`,
    )
  }

  const roles = packet.approvals.map((approval) => approval.role)
  if (
    roles.length !== PACKAGED_DEPLOYMENT_REQUIRED_APPROVAL_ROLES.length ||
    !PACKAGED_DEPLOYMENT_REQUIRED_APPROVAL_ROLES.every(
      (role, index) => roles[index] === role,
    )
  ) {
    throw new Error(
      `Packaged deployment approval evidence approvals must use canonical role order for ${packet.packet_id}`,
    )
  }

  for (const approval of packet.approvals) {
    if (!isRecord(approval)) {
      throw new Error(
        `Packaged deployment approval evidence approval must be an object for ${packet.packet_id}`,
      )
    }
    assertNonEmpty(approval.approver, `${approval.role}.approver`)
    if (approval.decision !== "approved") {
      throw new Error(
        `Packaged deployment approval evidence approval ${String(approval.role)} must be approved for ${packet.packet_id}`,
      )
    }
    assertPathRef(
      approval.approval_ref,
      `${approval.role}.approval_ref`,
      packet.claim_mode,
    )
    assertDateTime(
      approval.approved_at,
      `${approval.role}.approved_at`,
      packet.packet_id,
    )
    assertNonEmpty(approval.scope, `${approval.role}.scope`)
  }
}

const assertRollbackPlan = (
  packet: PackagedDeploymentApprovalEvidencePacket,
): void => {
  const rollbackPlan = packet.rollback_plan
  if (!isRecord(rollbackPlan)) {
    throw new Error(
      `Packaged deployment approval evidence rollback_plan must be an object for ${packet.packet_id}`,
    )
  }
  assertPathRef(rollbackPlan.plan_ref, "rollback_plan.plan_ref", packet.claim_mode)
  assertPathRef(
    rollbackPlan.rehearsal_ref,
    "rollback_plan.rehearsal_ref",
    packet.claim_mode,
  )
  assertNonEmpty(rollbackPlan.owner, "rollback_plan.owner")
  assertDateTime(
    rollbackPlan.accepted_at,
    "rollback_plan.accepted_at",
    packet.packet_id,
  )
}

const assertGuardrails = (
  guardrails: PackagedDeploymentApprovalGuardrails,
  packetId: string,
): void => {
  if (!isRecord(guardrails)) {
    throw new Error(
      `Packaged deployment approval evidence guardrails must be an object for ${packetId}`,
    )
  }
  for (const field of [
    "public_repo_contains_no_secrets",
    "operator_controls_remain_external",
    "rollback_plan_required",
    "production_approval_requires_ops_refs",
  ] as const) {
    if (guardrails[field] !== true) {
      throw new Error(
        `Packaged deployment approval evidence guardrail ${field} must be true for ${packetId}`,
      )
    }
  }
}

const assertReviewer = (
  reviewer: PackagedDeploymentApprovalReviewer,
  packetId: string,
): void => {
  if (!isRecord(reviewer)) {
    throw new Error(
      `Packaged deployment approval evidence reviewer must be an object for ${packetId}`,
    )
  }
  assertNonEmpty(reviewer.name, "reviewer.name")
  assertNonEmpty(reviewer.role, "reviewer.role")
  assertEvidenceReviewDate(
    reviewer.reviewed_at,
    "Packaged deployment approval evidence",
    "reviewer.reviewed_at",
    packetId,
  )
}

function assertPathRef(
  ref: unknown,
  field: string,
  claimMode: PackagedDeploymentClaimMode,
): void {
  assertNonEmpty(ref, field)
  if (ref.includes("..")) {
    throw new Error(`Packaged deployment approval evidence ${field} must not escape`)
  }
  if (!SAFE_REF_RE.test(ref)) {
    throw new Error(
      `Packaged deployment approval evidence ${field} must stay under docs/public/, network/, or ops://qrtrust/`,
    )
  }
  if (claimMode === "production_candidate" && !ref.startsWith("ops://qrtrust/")) {
    throw new Error(
      `Packaged deployment approval evidence production candidate ${field} must use ops://qrtrust/`,
    )
  }
}

function assertDateTime(value: unknown, field: string, packetId: string): void {
  assertNonEmpty(value, field)
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(
      `Packaged deployment approval evidence ${field} must be an ISO timestamp for ${packetId}`,
    )
  }
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Packaged deployment approval evidence requires ${field}`)
  }
}

function assertNoPrivateMaterial(
  packet: PackagedDeploymentApprovalEvidencePacket,
): void {
  if (PRIVATE_MATERIAL_RE.test(JSON.stringify(packet))) {
    throw new Error(
      `Packaged deployment approval evidence contains private material markers for ${packet.packet_id}`,
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
