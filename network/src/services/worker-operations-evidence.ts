import { assertEvidenceReviewDate } from "./evidence-review.js"

export const WORKER_OPERATIONS_REQUIRED_COMPONENTS = [
  "artifact_publication_worker",
  "event_outbox_worker",
  "verifier_cache_read_model_worker",
  "scanner_decision_runtime",
] as const

export const WORKER_OPERATIONS_REQUIRED_SIGNALS = [
  "artifact_publication_lag",
  "event_outbox_publish_lag",
  "verifier_cache_staleness",
  "scanner_decision_error_rate",
] as const

export type WorkerOperationsComponentId =
  (typeof WORKER_OPERATIONS_REQUIRED_COMPONENTS)[number]

export type WorkerOperationsSignalId =
  (typeof WORKER_OPERATIONS_REQUIRED_SIGNALS)[number]

export type WorkerOperationsAuthorityBoundary =
  | "postgres_source_of_truth"
  | "nats_propagation_only"
  | "derived_read_model"
  | "scanner_decision_runtime"

export type WorkerOperationsStatus =
  | "reference_ready"
  | "production_ready"
  | "blocked"

export type WorkerOperationsClaimMode =
  | "reference_drill"
  | "production_candidate"

export interface WorkerOperationsComponent {
  readonly component_id: WorkerOperationsComponentId
  readonly runtime: string
  readonly authority_boundary: WorkerOperationsAuthorityBoundary
  readonly input_refs: ReadonlyArray<string>
  readonly output_refs: ReadonlyArray<string>
  readonly runbook_ref: string
  readonly smoke_script: string
  readonly metrics_ref: string
  readonly recovery_ref: string
  readonly operational_status: WorkerOperationsStatus
}

export interface WorkerOperationsReplayRecoveryDrill {
  readonly drill_id: string
  readonly component_id: WorkerOperationsComponentId
  readonly trigger: string
  readonly expected_recovery: string
  readonly evidence_ref: string
}

export interface WorkerOperationsSignalEvidence {
  readonly signal_id: WorkerOperationsSignalId
  readonly component_id: WorkerOperationsComponentId
  readonly threshold: string
  readonly metric_ref: string
  readonly alert_ref: string
  readonly replay_or_recovery_ref: string
  readonly owner: string
}

export interface WorkerOperationsMonitoringSnapshot {
  readonly captured_at: string
  readonly stale_work_items_threshold_seconds: number
  readonly max_publish_lag_seconds: number
  readonly metrics_refs: ReadonlyArray<string>
  readonly signals: ReadonlyArray<WorkerOperationsSignalEvidence>
}

export interface WorkerOperationsGuardrails {
  readonly postgres_authoritative: true
  readonly nats_propagation_only: true
  readonly verifier_cache_derived_only: true
  readonly no_secret_material: true
}

export interface WorkerOperationsReviewer {
  readonly name: string
  readonly role: string
  readonly reviewed_at: string
}

export interface WorkerOperationsEvidencePacket {
  readonly artifact_type: "worker_operations_evidence_packet"
  readonly packet_id: string
  readonly generated_at: string
  readonly claim_mode: WorkerOperationsClaimMode
  readonly components: ReadonlyArray<WorkerOperationsComponent>
  readonly replay_recovery_drills: ReadonlyArray<WorkerOperationsReplayRecoveryDrill>
  readonly monitoring: WorkerOperationsMonitoringSnapshot
  readonly guardrails: WorkerOperationsGuardrails
  readonly reviewer: WorkerOperationsReviewer
}

export interface WorkerOperationsEvidencePacketConfig {
  readonly packetId: string
  readonly generatedAt: string
  readonly claimMode: WorkerOperationsClaimMode
  readonly components: ReadonlyArray<WorkerOperationsComponent>
  readonly replayRecoveryDrills: ReadonlyArray<WorkerOperationsReplayRecoveryDrill>
  readonly monitoring: WorkerOperationsMonitoringSnapshot
  readonly guardrails: WorkerOperationsGuardrails
  readonly reviewer: WorkerOperationsReviewer
}

const EXPECTED_BOUNDARIES: Record<
  WorkerOperationsComponentId,
  WorkerOperationsAuthorityBoundary
> = {
  artifact_publication_worker: "postgres_source_of_truth",
  event_outbox_worker: "nats_propagation_only",
  verifier_cache_read_model_worker: "derived_read_model",
  scanner_decision_runtime: "scanner_decision_runtime",
}

const EXPECTED_SIGNAL_COMPONENTS: Record<
  WorkerOperationsSignalId,
  WorkerOperationsComponentId
> = {
  artifact_publication_lag: "artifact_publication_worker",
  event_outbox_publish_lag: "event_outbox_worker",
  verifier_cache_staleness: "verifier_cache_read_model_worker",
  scanner_decision_error_rate: "scanner_decision_runtime",
}

const PRIVATE_MATERIAL_RE =
  /BEGIN PRIVATE KEY|END PRIVATE KEY|pem:\/\/|env:\/\/|file:\/\/|private[_-]?key|password|bearer|api[_-]?key/i
const DOC_OR_NETWORK_REF_RE = /^(docs\/public\/|network\/)/

export const makeWorkerOperationsEvidencePacket = (
  config: WorkerOperationsEvidencePacketConfig,
): WorkerOperationsEvidencePacket => {
  const packet: WorkerOperationsEvidencePacket = {
    artifact_type: "worker_operations_evidence_packet",
    packet_id: config.packetId,
    generated_at: config.generatedAt,
    claim_mode: config.claimMode,
    components: config.components,
    replay_recovery_drills: config.replayRecoveryDrills,
    monitoring: config.monitoring,
    guardrails: config.guardrails,
    reviewer: config.reviewer,
  }

  assertWorkerOperationsEvidencePacket(packet)

  return packet
}

export const assertWorkerOperationsEvidencePacket = (
  packet: WorkerOperationsEvidencePacket,
): void => {
  if (!isRecord(packet)) {
    throw new Error("Worker operations evidence packet must be an object")
  }
  if (packet.artifact_type !== "worker_operations_evidence_packet") {
    throw new Error(
      "Worker operations evidence artifact_type must be worker_operations_evidence_packet",
    )
  }
  assertNonEmpty(packet.packet_id, "packet_id")
  assertDateTime(packet.generated_at, "generated_at", packet.packet_id)
  if (
    packet.claim_mode !== "reference_drill"
    && packet.claim_mode !== "production_candidate"
  ) {
    throw new Error(
      `Worker operations evidence has invalid claim_mode: ${String(packet.claim_mode)}`,
    )
  }

  assertNoPrivateMaterial(packet)
  assertGuardrails(packet.guardrails, packet.packet_id)
  assertReviewer(packet.reviewer, packet.packet_id)
  assertMonitoring(packet.monitoring, packet.packet_id)
  assertComponents(packet)
  assertReplayRecoveryDrills(packet)
}

export const collectWorkerOperationsEvidenceRefs = (
  packet: WorkerOperationsEvidencePacket,
): ReadonlyArray<string> => {
  assertWorkerOperationsEvidencePacket(packet)

  return [
    ...packet.components.flatMap((component) => [
      component.runbook_ref,
      component.smoke_script,
      component.metrics_ref,
      component.recovery_ref,
    ]),
    ...packet.replay_recovery_drills.map((drill) => drill.evidence_ref),
    ...packet.monitoring.metrics_refs,
    ...packet.monitoring.signals.flatMap((signal) => [
      signal.metric_ref,
      signal.alert_ref,
      signal.replay_or_recovery_ref,
    ]),
  ]
}

const assertComponents = (packet: WorkerOperationsEvidencePacket): void => {
  if (!Array.isArray(packet.components)) {
    throw new Error(
      `Worker operations evidence components must be an array for ${packet.packet_id}`,
    )
  }

  const componentIds = packet.components.map((component) => component.component_id)
  if (
    componentIds.length !== WORKER_OPERATIONS_REQUIRED_COMPONENTS.length
    || !WORKER_OPERATIONS_REQUIRED_COMPONENTS.every(
      (componentId, index) => componentIds[index] === componentId,
    )
  ) {
    throw new Error(
      `Worker operations evidence components must use canonical order for ${packet.packet_id}`,
    )
  }

  for (const component of packet.components) {
    assertComponent(component, packet.claim_mode, packet.packet_id)
  }
}

const assertComponent = (
  component: WorkerOperationsComponent,
  claimMode: WorkerOperationsClaimMode,
  packetId: string,
): void => {
  if (!isRecord(component)) {
    throw new Error(
      `Worker operations evidence component must be an object for ${packetId}`,
    )
  }
  if (!isWorkerOperationsComponentId(component.component_id)) {
    throw new Error(
      `Worker operations evidence has invalid component_id for ${packetId}: ${String(component.component_id)}`,
    )
  }
  assertNonEmpty(component.runtime, `${component.component_id}.runtime`)

  const expectedBoundary = EXPECTED_BOUNDARIES[component.component_id]
  if (component.authority_boundary !== expectedBoundary) {
    throw new Error(
      `Worker operations evidence ${component.component_id} boundary must be ${expectedBoundary}`,
    )
  }

  assertStringList(component.input_refs, `${component.component_id}.input_refs`)
  assertStringList(component.output_refs, `${component.component_id}.output_refs`)
  assertPathRef(component.runbook_ref, `${component.component_id}.runbook_ref`)
  assertSmokeScript(component.smoke_script, component.component_id)
  assertPathRef(component.metrics_ref, `${component.component_id}.metrics_ref`)
  assertPathRef(component.recovery_ref, `${component.component_id}.recovery_ref`)

  if (
    component.operational_status !== "reference_ready"
    && component.operational_status !== "production_ready"
    && component.operational_status !== "blocked"
  ) {
    throw new Error(
      `Worker operations evidence ${component.component_id} has invalid operational_status`,
    )
  }
  if (claimMode === "reference_drill" && component.operational_status === "blocked") {
    throw new Error(
      `Worker operations reference drill cannot include blocked component ${component.component_id}`,
    )
  }
  if (
    claimMode === "production_candidate"
    && component.operational_status !== "production_ready"
  ) {
    throw new Error(
      `Worker operations production candidate requires production_ready component ${component.component_id}`,
    )
  }
}

const assertReplayRecoveryDrills = (
  packet: WorkerOperationsEvidencePacket,
): void => {
  if (!Array.isArray(packet.replay_recovery_drills)) {
    throw new Error(
      `Worker operations evidence replay_recovery_drills must be an array for ${packet.packet_id}`,
    )
  }

  const drillIds = new Set<string>()
  const componentsWithDrills = new Set<WorkerOperationsComponentId>()
  for (const drill of packet.replay_recovery_drills) {
    if (!isRecord(drill)) {
      throw new Error(
        `Worker operations evidence replay drill must be an object for ${packet.packet_id}`,
      )
    }
    assertNonEmpty(drill.drill_id, "replay_recovery_drill.drill_id")
    const drillId = String(drill.drill_id)
    if (drillIds.has(drillId)) {
      throw new Error(
        `Worker operations evidence duplicates drill_id: ${drillId}`,
      )
    }
    drillIds.add(drillId)
    if (!isWorkerOperationsComponentId(drill.component_id)) {
      throw new Error(
        `Worker operations evidence has invalid drill component_id: ${String(drill.component_id)}`,
      )
    }
    componentsWithDrills.add(drill.component_id)
    assertNonEmpty(drill.trigger, `${drillId}.trigger`)
    assertNonEmpty(
      drill.expected_recovery,
      `${drillId}.expected_recovery`,
    )
    assertPathRef(drill.evidence_ref, `${drillId}.evidence_ref`)
  }

  const missingDrills = WORKER_OPERATIONS_REQUIRED_COMPONENTS.filter(
    (componentId) => !componentsWithDrills.has(componentId),
  )
  if (missingDrills.length > 0) {
    throw new Error(
      `Worker operations evidence missing replay/recovery drills for: ${missingDrills.join(", ")}`,
    )
  }
}

const assertMonitoring = (
  monitoring: WorkerOperationsMonitoringSnapshot,
  packetId: string,
): void => {
  if (!isRecord(monitoring)) {
    throw new Error(
      `Worker operations evidence monitoring must be an object for ${packetId}`,
    )
  }
  assertDateTime(monitoring.captured_at, "monitoring.captured_at", packetId)
  assertPositiveInteger(
    monitoring.stale_work_items_threshold_seconds,
    "monitoring.stale_work_items_threshold_seconds",
  )
  assertPositiveInteger(
    monitoring.max_publish_lag_seconds,
    "monitoring.max_publish_lag_seconds",
  )
  assertStringList(monitoring.metrics_refs, "monitoring.metrics_refs")
  for (const metricsRef of monitoring.metrics_refs) {
    assertPathRef(metricsRef, "monitoring.metrics_refs")
  }
  assertSignalEvidence(monitoring.signals, packetId)
}

const assertSignalEvidence = (
  signals: ReadonlyArray<WorkerOperationsSignalEvidence>,
  packetId: string,
): void => {
  if (!Array.isArray(signals)) {
    throw new Error(
      `Worker operations evidence monitoring.signals must be an array for ${packetId}`,
    )
  }

  const signalIds = signals.map((signal) => signal.signal_id)
  if (
    signalIds.length !== WORKER_OPERATIONS_REQUIRED_SIGNALS.length
    || !WORKER_OPERATIONS_REQUIRED_SIGNALS.every(
      (signalId, index) => signalIds[index] === signalId,
    )
  ) {
    throw new Error(
      `Worker operations evidence monitoring.signals must use canonical order for ${packetId}`,
    )
  }

  for (const signal of signals) {
    if (!isRecord(signal)) {
      throw new Error(
        `Worker operations evidence monitoring signal must be an object for ${packetId}`,
      )
    }
    if (!isWorkerOperationsSignalId(signal.signal_id)) {
      throw new Error(
        `Worker operations evidence has invalid monitoring signal_id for ${packetId}: ${String(signal.signal_id)}`,
      )
    }
    const expectedComponentId = EXPECTED_SIGNAL_COMPONENTS[signal.signal_id]
    if (signal.component_id !== expectedComponentId) {
      throw new Error(
        `Worker operations evidence signal ${signal.signal_id} must belong to ${expectedComponentId}`,
      )
    }
    assertNonEmpty(signal.threshold, `${signal.signal_id}.threshold`)
    assertNonEmpty(signal.owner, `${signal.signal_id}.owner`)
    assertPathRef(signal.metric_ref, `${signal.signal_id}.metric_ref`)
    assertPathRef(signal.alert_ref, `${signal.signal_id}.alert_ref`)
    assertPathRef(
      signal.replay_or_recovery_ref,
      `${signal.signal_id}.replay_or_recovery_ref`,
    )
  }
}

const assertGuardrails = (
  guardrails: WorkerOperationsGuardrails,
  packetId: string,
): void => {
  if (!isRecord(guardrails)) {
    throw new Error(
      `Worker operations evidence guardrails must be an object for ${packetId}`,
    )
  }
  const requiredTrue: ReadonlyArray<keyof WorkerOperationsGuardrails> = [
    "postgres_authoritative",
    "nats_propagation_only",
    "verifier_cache_derived_only",
    "no_secret_material",
  ]
  for (const field of requiredTrue) {
    if (guardrails[field] !== true) {
      throw new Error(
        `Worker operations evidence guardrail ${field} must be true for ${packetId}`,
      )
    }
  }
}

const assertReviewer = (
  reviewer: WorkerOperationsReviewer,
  packetId: string,
): void => {
  if (!isRecord(reviewer)) {
    throw new Error(
      `Worker operations evidence reviewer must be an object for ${packetId}`,
    )
  }
  assertNonEmpty(reviewer.name, "reviewer.name")
  assertNonEmpty(reviewer.role, "reviewer.role")
  assertEvidenceReviewDate(
    reviewer.reviewed_at,
    "Worker operations evidence",
    "reviewer.reviewed_at",
    packetId,
  )
}

const assertNoPrivateMaterial = (
  packet: WorkerOperationsEvidencePacket,
): void => {
  const serialized = JSON.stringify(packet)
  if (PRIVATE_MATERIAL_RE.test(serialized)) {
    throw new Error(
      `Worker operations evidence contains private material marker for ${packet.packet_id}`,
    )
  }
}

const assertPathRef = (value: unknown, field: string): void => {
  assertNonEmpty(value, field)
  const ref = String(value)
  if (ref.includes("..") || !DOC_OR_NETWORK_REF_RE.test(ref)) {
    throw new Error(
      `Worker operations evidence ${field} must point under docs/public/ or network/`,
    )
  }
}

const assertSmokeScript = (
  value: unknown,
  componentId: WorkerOperationsComponentId,
): void => {
  assertNonEmpty(value, `${componentId}.smoke_script`)
  const script = String(value)
  if (!script.startsWith("npm run ")) {
    throw new Error(
      `Worker operations evidence ${componentId}.smoke_script must be an npm run command`,
    )
  }
}

const assertStringList = (value: unknown, field: string): void => {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error(`Worker operations evidence ${field} must be non-empty strings`)
  }
}

const assertPositiveInteger = (value: unknown, field: string): void => {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`Worker operations evidence ${field} must be positive`)
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
      `Worker operations evidence ${field} must be a valid timestamp for ${packetId}`,
    )
  }
}

const assertNonEmpty = (value: unknown, field: string): void => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Worker operations evidence ${field} must be a non-empty string`)
  }
}

const isWorkerOperationsComponentId = (
  value: unknown,
): value is WorkerOperationsComponentId =>
  typeof value === "string"
  && WORKER_OPERATIONS_REQUIRED_COMPONENTS.includes(
    value as WorkerOperationsComponentId,
  )

const isWorkerOperationsSignalId = (
  value: unknown,
): value is WorkerOperationsSignalId =>
  typeof value === "string"
  && WORKER_OPERATIONS_REQUIRED_SIGNALS.includes(
    value as WorkerOperationsSignalId,
  )

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
