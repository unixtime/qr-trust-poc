import { assertEvidenceReviewDate } from "./evidence-review.js"

export const RESTORE_AUTOMATION_REQUIRED_DRILLS = [
  "scheduled_backup_created",
  "scratch_restore_completed",
  "migration_rollback_rehearsed",
  "operator_failover_handoff",
] as const

export type RestoreAutomationDrillId =
  (typeof RESTORE_AUTOMATION_REQUIRED_DRILLS)[number]

export type RestoreAutomationClaimMode =
  | "reference_drill"
  | "production_candidate"

export type RestoreAutomationDrillStatus = "passed" | "failed" | "blocked"

export interface RestoreAutomationEvidenceRef {
  readonly label: string
  readonly uri: string
  readonly owner: string
  readonly reviewed_at: string
}

export interface RestoreAutomationBackupArtifact {
  readonly artifact_id: string
  readonly storage_ref: string
  readonly sha256: string
  readonly created_at: string
  readonly retention_policy: string
  readonly encryption_mode: string
}

export interface RestoreAutomationRecoveryObjective {
  readonly rpo_minutes: number
  readonly rto_minutes: number
  readonly owner: string
  readonly escalation_ref: string
}

export interface RestoreAutomationDrill {
  readonly drill_id: RestoreAutomationDrillId
  readonly objective: string
  readonly command_ref: string
  readonly started_at: string
  readonly completed_at: string
  readonly status: RestoreAutomationDrillStatus
  readonly evidence_refs: ReadonlyArray<RestoreAutomationEvidenceRef>
}

export interface RestoreAutomationGuardrails {
  readonly postgres_authoritative: true
  readonly restore_targets_scratch_only: true
  readonly no_secret_material: true
  readonly destructive_restore_requires_operator_approval: true
}

export interface RestoreAutomationReviewer {
  readonly name: string
  readonly role: string
  readonly reviewed_at: string
}

export interface RestoreAutomationEvidencePacket {
  readonly artifact_type: "restore_automation_evidence_packet"
  readonly packet_id: string
  readonly generated_at: string
  readonly claim_mode: RestoreAutomationClaimMode
  readonly backup_artifact: RestoreAutomationBackupArtifact
  readonly recovery_objective: RestoreAutomationRecoveryObjective
  readonly drills: ReadonlyArray<RestoreAutomationDrill>
  readonly guardrails: RestoreAutomationGuardrails
  readonly reviewer: RestoreAutomationReviewer
}

export interface RestoreAutomationEvidencePacketConfig {
  readonly packetId: string
  readonly generatedAt: string
  readonly claimMode: RestoreAutomationClaimMode
  readonly backupArtifact: RestoreAutomationBackupArtifact
  readonly recoveryObjective: RestoreAutomationRecoveryObjective
  readonly drills: ReadonlyArray<RestoreAutomationDrill>
  readonly guardrails: RestoreAutomationGuardrails
  readonly reviewer: RestoreAutomationReviewer
}

const SAFE_REF_RE = /^(docs\/public\/|network\/|ops:\/\/qrtrust\/)/
const OPS_REF_RE = /^ops:\/\/qrtrust\//
const SHA256_RE = /^[a-f0-9]{64}$/
const PRIVATE_MATERIAL_RE =
  /BEGIN PRIVATE KEY|END PRIVATE KEY|pem:\/\/|env:\/\/|file:\/\/|private[_-]?key|password|bearer|api[_-]?key/i

export const makeRestoreAutomationEvidencePacket = (
  config: RestoreAutomationEvidencePacketConfig,
): RestoreAutomationEvidencePacket => {
  const packet: RestoreAutomationEvidencePacket = {
    artifact_type: "restore_automation_evidence_packet",
    packet_id: config.packetId,
    generated_at: config.generatedAt,
    claim_mode: config.claimMode,
    backup_artifact: config.backupArtifact,
    recovery_objective: config.recoveryObjective,
    drills: config.drills,
    guardrails: config.guardrails,
    reviewer: config.reviewer,
  }

  assertRestoreAutomationEvidencePacket(packet)

  return packet
}

export const assertRestoreAutomationEvidencePacket = (
  packet: RestoreAutomationEvidencePacket,
): void => {
  if (!isRecord(packet)) {
    throw new Error("Restore automation evidence packet must be an object")
  }
  if (packet.artifact_type !== "restore_automation_evidence_packet") {
    throw new Error(
      "Restore automation evidence artifact_type must be restore_automation_evidence_packet",
    )
  }
  assertNonEmpty(packet.packet_id, "packet_id")
  assertDateTime(packet.generated_at, "generated_at", packet.packet_id)
  if (
    packet.claim_mode !== "reference_drill"
    && packet.claim_mode !== "production_candidate"
  ) {
    throw new Error(
      `Restore automation evidence has invalid claim_mode: ${String(packet.claim_mode)}`,
    )
  }

  assertNoPrivateMaterial(packet)
  assertBackupArtifact(packet.backup_artifact, packet.claim_mode, packet.packet_id)
  assertRecoveryObjective(
    packet.recovery_objective,
    packet.claim_mode,
    packet.packet_id,
  )
  assertGuardrails(packet.guardrails, packet.packet_id)
  assertReviewer(packet.reviewer, packet.packet_id)
  assertDrills(packet)
}

export const collectRestoreAutomationEvidenceRefs = (
  packet: RestoreAutomationEvidencePacket,
): ReadonlyArray<string> => {
  assertRestoreAutomationEvidencePacket(packet)

  return [
    packet.backup_artifact.storage_ref,
    packet.recovery_objective.escalation_ref,
    ...packet.drills.flatMap((drill) => [
      drill.command_ref,
      ...drill.evidence_refs.map((ref) => ref.uri),
    ]),
  ]
}

const assertBackupArtifact = (
  artifact: RestoreAutomationBackupArtifact,
  claimMode: RestoreAutomationClaimMode,
  packetId: string,
): void => {
  if (!isRecord(artifact)) {
    throw new Error(
      `Restore automation evidence backup_artifact must be an object for ${packetId}`,
    )
  }
  assertNonEmpty(artifact.artifact_id, "backup_artifact.artifact_id")
  assertSafeRef(artifact.storage_ref, "backup_artifact.storage_ref")
  assertDateTime(artifact.created_at, "backup_artifact.created_at", packetId)
  assertNonEmpty(artifact.retention_policy, "backup_artifact.retention_policy")
  assertNonEmpty(artifact.encryption_mode, "backup_artifact.encryption_mode")
  if (!SHA256_RE.test(String(artifact.sha256))) {
    throw new Error(
      `Restore automation evidence backup_artifact.sha256 must be lowercase sha256 for ${packetId}`,
    )
  }
  if (claimMode === "production_candidate") {
    assertOpsRef(artifact.storage_ref, "backup_artifact.storage_ref")
  }
}

const assertRecoveryObjective = (
  objective: RestoreAutomationRecoveryObjective,
  claimMode: RestoreAutomationClaimMode,
  packetId: string,
): void => {
  if (!isRecord(objective)) {
    throw new Error(
      `Restore automation evidence recovery_objective must be an object for ${packetId}`,
    )
  }
  assertPositiveInteger(objective.rpo_minutes, "recovery_objective.rpo_minutes")
  assertPositiveInteger(objective.rto_minutes, "recovery_objective.rto_minutes")
  assertNonEmpty(objective.owner, "recovery_objective.owner")
  assertSafeRef(objective.escalation_ref, "recovery_objective.escalation_ref")
  if (claimMode === "production_candidate") {
    assertOpsRef(objective.escalation_ref, "recovery_objective.escalation_ref")
  }
}

const assertDrills = (packet: RestoreAutomationEvidencePacket): void => {
  if (!Array.isArray(packet.drills)) {
    throw new Error(
      `Restore automation evidence drills must be an array for ${packet.packet_id}`,
    )
  }

  const drillIds = packet.drills.map((drill) => drill.drill_id)
  if (
    drillIds.length !== RESTORE_AUTOMATION_REQUIRED_DRILLS.length
    || !RESTORE_AUTOMATION_REQUIRED_DRILLS.every(
      (drillId, index) => drillIds[index] === drillId,
    )
  ) {
    throw new Error(
      `Restore automation evidence drills must use canonical order for ${packet.packet_id}`,
    )
  }

  for (const drill of packet.drills) {
    assertDrill(drill, packet.claim_mode, packet.packet_id)
  }
}

const assertDrill = (
  drill: RestoreAutomationDrill,
  claimMode: RestoreAutomationClaimMode,
  packetId: string,
): void => {
  if (!isRecord(drill)) {
    throw new Error(`Restore automation evidence drill must be an object for ${packetId}`)
  }
  if (!isRestoreAutomationDrillId(drill.drill_id)) {
    throw new Error(
      `Restore automation evidence has invalid drill_id for ${packetId}: ${String(drill.drill_id)}`,
    )
  }
  assertNonEmpty(drill.objective, `${drill.drill_id}.objective`)
  assertSafeRef(drill.command_ref, `${drill.drill_id}.command_ref`)
  assertDateTime(drill.started_at, `${drill.drill_id}.started_at`, packetId)
  assertDateTime(drill.completed_at, `${drill.drill_id}.completed_at`, packetId)
  if (Date.parse(drill.completed_at) < Date.parse(drill.started_at)) {
    throw new Error(
      `Restore automation evidence ${drill.drill_id}.completed_at must not be before started_at`,
    )
  }
  if (
    drill.status !== "passed"
    && drill.status !== "failed"
    && drill.status !== "blocked"
  ) {
    throw new Error(
      `Restore automation evidence ${drill.drill_id}.status is invalid`,
    )
  }
  if (drill.status !== "passed") {
    throw new Error(
      `Restore automation evidence ${claimMode} requires passed drill ${drill.drill_id}`,
    )
  }
  assertEvidenceRefs(drill.evidence_refs, drill.drill_id, claimMode, packetId)
}

const assertEvidenceRefs = (
  refs: ReadonlyArray<RestoreAutomationEvidenceRef>,
  drillId: RestoreAutomationDrillId,
  claimMode: RestoreAutomationClaimMode,
  packetId: string,
): void => {
  if (!Array.isArray(refs) || refs.length === 0) {
    throw new Error(
      `Restore automation evidence ${drillId}.evidence_refs must be non-empty`,
    )
  }
  for (const [index, ref] of refs.entries()) {
    if (!isRecord(ref)) {
      throw new Error(
        `Restore automation evidence ${drillId}.evidence_refs[${index}] must be an object`,
      )
    }
    assertNonEmpty(ref.label, `${drillId}.evidence_refs[${index}].label`)
    assertSafeRef(ref.uri, `${drillId}.evidence_refs[${index}].uri`)
    assertNonEmpty(ref.owner, `${drillId}.evidence_refs[${index}].owner`)
    assertEvidenceReviewDate(
      ref.reviewed_at,
      "Restore automation evidence",
      `${drillId}.evidence_refs[${index}].reviewed_at`,
      packetId,
    )
    if (claimMode === "production_candidate") {
      assertOpsRef(ref.uri, `${drillId}.evidence_refs[${index}].uri`)
    }
  }
}

const assertGuardrails = (
  guardrails: RestoreAutomationGuardrails,
  packetId: string,
): void => {
  if (!isRecord(guardrails)) {
    throw new Error(
      `Restore automation evidence guardrails must be an object for ${packetId}`,
    )
  }
  const requiredTrue: ReadonlyArray<keyof RestoreAutomationGuardrails> = [
    "postgres_authoritative",
    "restore_targets_scratch_only",
    "no_secret_material",
    "destructive_restore_requires_operator_approval",
  ]
  for (const field of requiredTrue) {
    if (guardrails[field] !== true) {
      throw new Error(
        `Restore automation evidence guardrail ${field} must be true for ${packetId}`,
      )
    }
  }
}

const assertReviewer = (
  reviewer: RestoreAutomationReviewer,
  packetId: string,
): void => {
  if (!isRecord(reviewer)) {
    throw new Error(
      `Restore automation evidence reviewer must be an object for ${packetId}`,
    )
  }
  assertNonEmpty(reviewer.name, "reviewer.name")
  assertNonEmpty(reviewer.role, "reviewer.role")
  assertEvidenceReviewDate(
    reviewer.reviewed_at,
    "Restore automation evidence",
    "reviewer.reviewed_at",
    packetId,
  )
}

const assertNoPrivateMaterial = (
  packet: RestoreAutomationEvidencePacket,
): void => {
  const serialized = JSON.stringify(packet)
  if (PRIVATE_MATERIAL_RE.test(serialized)) {
    throw new Error(
      `Restore automation evidence contains private material marker for ${packet.packet_id}`,
    )
  }
}

const assertSafeRef = (value: unknown, field: string): void => {
  assertNonEmpty(value, field)
  const ref = String(value)
  if (ref.includes("..") || !SAFE_REF_RE.test(ref)) {
    throw new Error(
      `Restore automation evidence ${field} must point under docs/public/, network/, or ops://qrtrust/`,
    )
  }
}

const assertOpsRef = (value: unknown, field: string): void => {
  assertNonEmpty(value, field)
  if (!OPS_REF_RE.test(String(value))) {
    throw new Error(
      `Restore automation production candidate ${field} must point to ops://qrtrust/ evidence`,
    )
  }
}

const assertPositiveInteger = (value: unknown, field: string): void => {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`Restore automation evidence ${field} must be positive`)
  }
}

const assertDateTime = (
  value: unknown,
  field: string,
  packetId: string,
): void => {
  assertNonEmpty(value, field)
  const timestamp = Date.parse(String(value))
  if (Number.isNaN(timestamp)) {
    throw new Error(
      `Restore automation evidence ${field} must be a valid timestamp for ${packetId}`,
    )
  }
}

const assertNonEmpty = (value: unknown, field: string): void => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Restore automation evidence ${field} must be a non-empty string`)
  }
}

const isRestoreAutomationDrillId = (
  value: unknown,
): value is RestoreAutomationDrillId =>
  typeof value === "string"
  && RESTORE_AUTOMATION_REQUIRED_DRILLS.includes(
    value as RestoreAutomationDrillId,
  )

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
