import { assertEvidenceReviewDate } from "./evidence-review.js"

export type ReferenceNetworkAdoptionClaimMode =
  | "reference_only"
  | "production_candidate"

export type ReferenceNetworkAdoptionStage = 0 | 1 | 2 | 3

export type ReferenceNetworkAdoptionStageName =
  | "local_proof"
  | "single_operator_pilot"
  | "multi_authority_reference"
  | "ecosystem_candidate"

export type ReferenceNetworkAdoptionStatus =
  | "ready_for_stage_0_reference"
  | "ready_for_stage_1_reference"
  | "ready_for_stage_2_reference"
  | "ready_for_stage_3_reference"
  | "blocked_for_stage_claim"
  | "ready_for_production_candidate"
  | "blocked_for_production_candidate"

export type ReferenceNetworkAdoptionBoundaryStatus =
  | "pass"
  | "warn"
  | "block"

export type ReferenceNetworkAdoptionEvidenceTier =
  | "reference_backed"
  | "operator_backed"
  | "unattached"

export type ReferenceNetworkAdoptionBoundaryId =
  | "postgres_source_of_truth"
  | "authority_publication"
  | "nats_propagation"
  | "verifier_cache_read_model"
  | "scanner_decision_runtime"
  | "scanner_fleet_evidence"
  | "cross_surface_qr_evidence"
  | "worker_operations_evidence"
  | "signing_custody_audit_export"
  | "signing_custody"
  | "runtime_safety_provider"
  | "operator_runbooks"
  | "backup_restore"
  | "external_governance_audit"

export const REFERENCE_NETWORK_ADOPTION_BOUNDARY_IDS = [
  "postgres_source_of_truth",
  "authority_publication",
  "nats_propagation",
  "verifier_cache_read_model",
  "scanner_decision_runtime",
  "scanner_fleet_evidence",
  "cross_surface_qr_evidence",
  "worker_operations_evidence",
  "signing_custody_audit_export",
  "signing_custody",
  "runtime_safety_provider",
  "operator_runbooks",
  "backup_restore",
  "external_governance_audit",
] as const satisfies ReadonlyArray<ReferenceNetworkAdoptionBoundaryId>

export const REFERENCE_NETWORK_ADOPTION_STAGE_NAMES = {
  0: "local_proof",
  1: "single_operator_pilot",
  2: "multi_authority_reference",
  3: "ecosystem_candidate",
} as const satisfies Record<
  ReferenceNetworkAdoptionStage,
  ReferenceNetworkAdoptionStageName
>

export const REFERENCE_NETWORK_ADOPTION_STAGE_REQUIREMENTS = {
  0: [
    "scanner_decision_runtime",
    "scanner_fleet_evidence",
    "cross_surface_qr_evidence",
  ],
  1: [
    "postgres_source_of_truth",
    "authority_publication",
    "verifier_cache_read_model",
    "scanner_decision_runtime",
    "scanner_fleet_evidence",
    "cross_surface_qr_evidence",
    "worker_operations_evidence",
    "signing_custody_audit_export",
    "operator_runbooks",
    "backup_restore",
  ],
  2: [
    "postgres_source_of_truth",
    "authority_publication",
    "nats_propagation",
    "verifier_cache_read_model",
    "scanner_decision_runtime",
    "scanner_fleet_evidence",
    "cross_surface_qr_evidence",
    "worker_operations_evidence",
    "signing_custody_audit_export",
    "operator_runbooks",
    "backup_restore",
  ],
  3: REFERENCE_NETWORK_ADOPTION_BOUNDARY_IDS,
} as const satisfies Record<
  ReferenceNetworkAdoptionStage,
  ReadonlyArray<ReferenceNetworkAdoptionBoundaryId>
>

export interface ReferenceNetworkAdoptionEvidenceRef {
  readonly label: string
  readonly uri: string
  readonly owner: string
  readonly reviewed_at: string
}

export interface ReferenceNetworkAdoptionBoundary {
  readonly id: ReferenceNetworkAdoptionBoundaryId
  readonly layer: string
  readonly title: string
  readonly status: ReferenceNetworkAdoptionBoundaryStatus
  readonly evidence_tier: ReferenceNetworkAdoptionEvidenceTier
  readonly evidence: string
  readonly remediation?: string
  readonly evidence_refs?: ReadonlyArray<ReferenceNetworkAdoptionEvidenceRef>
  readonly smoke_scripts?: ReadonlyArray<string>
}

export interface ReferenceNetworkAdoptionStageGate {
  readonly artifact_type: "reference_network_adoption_stage_gate"
  readonly schema_version: "2026-05-21"
  readonly generated_at: string
  readonly stage: ReferenceNetworkAdoptionStage
  readonly stage_name: ReferenceNetworkAdoptionStageName
  readonly claim_mode: ReferenceNetworkAdoptionClaimMode
  readonly status: ReferenceNetworkAdoptionStatus
  readonly blocking_boundaries: ReadonlyArray<ReferenceNetworkAdoptionBoundaryId>
  readonly warning_boundaries: ReadonlyArray<ReferenceNetworkAdoptionBoundaryId>
  readonly boundaries: ReadonlyArray<ReferenceNetworkAdoptionBoundary>
  readonly review_notes: ReadonlyArray<string>
}

export interface ReferenceNetworkAdoptionStageGateConfig {
  readonly stage: ReferenceNetworkAdoptionStage
  readonly claimMode: ReferenceNetworkAdoptionClaimMode
  readonly generatedAt: string
  readonly postgresSourceOfTruthReady?: boolean
  readonly authorityPublicationReady?: boolean
  readonly natsPropagationReady?: boolean
  readonly verifierCacheReadModelReady?: boolean
  readonly scannerDecisionRuntimeReady?: boolean
  readonly scannerFleetEvidenceReady?: boolean
  readonly crossSurfaceQrEvidenceReady?: boolean
  readonly workerOperationsEvidenceReady?: boolean
  readonly signingCustodyAuditExportReady?: boolean
  readonly signingCustodyReady?: boolean
  readonly runtimeSafetyProviderReady?: boolean
  readonly operatorRunbooksReady?: boolean
  readonly backupRestoreReady?: boolean
  readonly externalGovernanceAuditReady?: boolean
  readonly evidenceRefs?: Partial<
    Record<
      ReferenceNetworkAdoptionBoundaryId,
      ReadonlyArray<ReferenceNetworkAdoptionEvidenceRef>
    >
  >
}

interface BoundaryDefinition {
  readonly id: ReferenceNetworkAdoptionBoundaryId
  readonly layer: string
  readonly title: string
  readonly present: (config: ReferenceNetworkAdoptionStageGateConfig) => boolean
  readonly referenceEvidence: string
  readonly presentEvidence: string
  readonly remediation: string
  readonly smokeScripts?: ReadonlyArray<string>
}

const BOUNDARY_DEFINITIONS: ReadonlyArray<BoundaryDefinition> = [
  {
    id: "postgres_source_of_truth",
    layer: "Source of truth",
    title: "Postgres trust-state authority",
    present: (config) => Boolean(config.postgresSourceOfTruthReady),
    referenceEvidence:
      "Durable root, authority, issuer, destination, cache, and decision records are not yet required for local proof.",
    presentEvidence:
      "Postgres is the source-of-truth store for network trust state.",
    remediation:
      "Apply the reference schema and keep trust-state writes in the dedicated QR Trust database.",
    smokeScripts: ["make check-network-migrations"],
  },
  {
    id: "authority_publication",
    layer: "Governance publication",
    title: "Authority artifact publication",
    present: (config) => Boolean(config.authorityPublicationReady),
    referenceEvidence:
      "Local proof can use fixtures before a source-to-publication facade exists.",
    presentEvidence:
      "Authority rows can be projected into ordered signed-artifact publication inputs.",
    remediation:
      "Wire active root, delegated authority, issuer, and destination-policy rows into the guarded publication service.",
    smokeScripts: ["npm run authority:publication-service-smoke"],
  },
  {
    id: "nats_propagation",
    layer: "State propagation",
    title: "NATS JetStream propagation",
    present: (config) => Boolean(config.natsPropagationReady),
    referenceEvidence:
      "Single-operator pilots may validate event subjects without a live multi-node broker.",
    presentEvidence:
      "NATS JetStream propagates durable Postgres-backed artifact events to subscribers.",
    remediation:
      "Enable NATS propagation after Postgres persistence and publication workers are durable.",
    smokeScripts: ["npm run nats:propagation-smoke"],
  },
  {
    id: "verifier_cache_read_model",
    layer: "Verifier cache",
    title: "Verifier cache read model",
    present: (config) => Boolean(config.verifierCacheReadModelReady),
    referenceEvidence:
      "Local proof can compute decisions directly from fixtures.",
    presentEvidence:
      "Verifier cache materialization converts published trust state into scan-time lookup rows.",
    remediation:
      "Materialize verifier cache entries from publication events before scanner decisions depend on shared state.",
    smokeScripts: ["npm run verifier-cache:read-model-worker-smoke"],
  },
  {
    id: "scanner_decision_runtime",
    layer: "Scanner decision",
    title: "Scanner-visible decision runtime",
    present: (config) => Boolean(config.scannerDecisionRuntimeReady),
    referenceEvidence:
      "A stage claim cannot rely only on artifact generation; scanner-visible outcomes must be executable.",
    presentEvidence:
      "The runtime emits scanner-visible green, orange, and red decisions.",
    remediation:
      "Expose scanner decision HTTP/runtime behavior and keep it aligned with browser and iOS scanner clients.",
    smokeScripts: ["npm run scanner-decision:http-runtime-smoke"],
  },
  {
    id: "scanner_fleet_evidence",
    layer: "Scanner fleet",
    title: "Scanner-fleet evidence packet",
    present: (config) => Boolean(config.scannerFleetEvidenceReady),
    referenceEvidence:
      "A stage claim needs browser and native scanner evidence, not only backend tests.",
    presentEvidence:
      "The scanner-fleet evidence packet covers minimum green, orange, and red scanner outcomes.",
    remediation:
      "Keep the browser and native scanner fixture matrix current, including hold-to-open behavior.",
    smokeScripts: ["npm run scanner-fleet:evidence-smoke"],
  },
  {
    id: "cross_surface_qr_evidence",
    layer: "Same-QR evidence",
    title: "Cross-surface QR evidence packet",
    present: (config) => Boolean(config.crossSurfaceQrEvidenceReady),
    referenceEvidence:
      "The same QR artifact must be traced across fixture, worker, web, backend, and iOS surfaces.",
    presentEvidence:
      "Cross-surface evidence proves one QR artifact produces the same final scanner-visible decision across surfaces.",
    remediation:
      "Capture and validate same-QR evidence across contract fixture, worker drill, web lab, backend scanner decision, and iOS scanner.",
    smokeScripts: ["npm run cross-surface:evidence-smoke"],
  },
  {
    id: "worker_operations_evidence",
    layer: "Operations",
    title: "Worker operations evidence packet",
    present: (config) => Boolean(config.workerOperationsEvidenceReady),
    referenceEvidence:
      "Local proof can run deterministic worker smokes before claiming operated workers.",
    presentEvidence:
      "Worker evidence covers artifact publication, event outbox propagation, verifier-cache materialization, scanner decision runtime, monitoring thresholds, and replay/recovery drills.",
    remediation:
      "Attach the worker operations evidence packet before claiming a pilot or production candidate.",
    smokeScripts: ["npm run worker-operations:evidence-smoke"],
  },
  {
    id: "signing_custody_audit_export",
    layer: "Signing custody",
    title: "Publication custody audit export",
    present: (config) => Boolean(config.signingCustodyAuditExportReady),
    referenceEvidence:
      "Stage claims need public-safe publication evidence before custody is treated as operational.",
    presentEvidence:
      "Publication-worker reports are converted into public-safe signing custody audit exports with published and failed rows preserved.",
    remediation:
      "Export publication-worker custody evidence, including failed publication reason codes, before claiming a pilot.",
    smokeScripts: ["npm run signing-custody:publication-audit-smoke"],
  },
  {
    id: "signing_custody",
    layer: "Signing custody",
    title: "Managed signing custody",
    present: (config) => Boolean(config.signingCustodyReady),
    referenceEvidence:
      "Reference deployments may use deterministic signing fixtures while preserving the custody boundary.",
    presentEvidence:
      "Artifact signing is backed by managed custody and auditable key references.",
    remediation:
      "Move signing into KMS, HSM, or equivalent managed custody before production issuance.",
    smokeScripts: ["npm run signing-custody:smoke"],
  },
  {
    id: "runtime_safety_provider",
    layer: "Runtime safety",
    title: "Live runtime-safety provider",
    present: (config) => Boolean(config.runtimeSafetyProviderReady),
    referenceEvidence:
      "Reference deployments may use deterministic runtime safety fixtures.",
    presentEvidence:
      "A scan-time runtime-safety provider is available for current destination posture.",
    remediation:
      "Connect a live safe-browsing, reputation, redirect, or TLS-safety provider with privacy boundaries.",
    smokeScripts: ["npm run runtime:safety-smoke"],
  },
  {
    id: "operator_runbooks",
    layer: "Operations",
    title: "Operator runbooks",
    present: (config) => Boolean(config.operatorRunbooksReady),
    referenceEvidence:
      "Local proof should still document the intended operator boundary before pilots.",
    presentEvidence:
      "Operator handoff, failure, rotation, restore, and rollback responsibilities are documented.",
    remediation:
      "Document outage handling, publication rollback, cache refresh, signer recovery, and scanner evidence capture.",
  },
  {
    id: "backup_restore",
    layer: "Operations",
    title: "Backup and restore drill",
    present: (config) => Boolean(config.backupRestoreReady),
    referenceEvidence:
      "Local proof can run without restore automation, but pilots need restore evidence.",
    presentEvidence:
      "Source-of-truth restore procedure is documented and drillable.",
    remediation:
      "Add backup execution, restore verification, and migration rollback evidence before claiming a pilot.",
  },
  {
    id: "external_governance_audit",
    layer: "Governance assurance",
    title: "External governance audit",
    present: (config) => Boolean(config.externalGovernanceAuditReady),
    referenceEvidence:
      "External governance review is a future ecosystem-candidate obligation, not local proof.",
    presentEvidence:
      "An external reviewer has audited governance scope, delegation, custody, and scanner decision semantics.",
    remediation:
      "Obtain independent governance review before claiming ecosystem-candidate readiness.",
  },
]

export const makeReferenceNetworkAdoptionStageGate = (
  config: ReferenceNetworkAdoptionStageGateConfig,
): ReferenceNetworkAdoptionStageGate => {
  const required = new Set(
    REFERENCE_NETWORK_ADOPTION_STAGE_REQUIREMENTS[config.stage],
  )
  const productionCandidate = config.claimMode === "production_candidate"
  const boundaries = BOUNDARY_DEFINITIONS.map((definition) =>
    makeBoundary({
      definition,
      config,
      required: required.has(definition.id),
      productionCandidate,
    })
  )
  const blockingBoundaries = boundaries
    .filter((boundary) => boundary.status === "block")
    .map((boundary) => boundary.id)
  const warningBoundaries = boundaries
    .filter((boundary) => boundary.status === "warn")
    .map((boundary) => boundary.id)

  const gate: ReferenceNetworkAdoptionStageGate = {
    artifact_type: "reference_network_adoption_stage_gate",
    schema_version: "2026-05-21",
    generated_at: config.generatedAt,
    stage: config.stage,
    stage_name: REFERENCE_NETWORK_ADOPTION_STAGE_NAMES[config.stage],
    claim_mode: config.claimMode,
    status: statusFor(config, blockingBoundaries),
    blocking_boundaries: blockingBoundaries,
    warning_boundaries: warningBoundaries,
    boundaries,
    review_notes: reviewNotesFor(
      config,
      blockingBoundaries,
      warningBoundaries,
      boundaries,
    ),
  }

  assertReferenceNetworkAdoptionStageGate(gate)

  return gate
}

export const assertReferenceNetworkAdoptionStageGate = (
  gate: ReferenceNetworkAdoptionStageGate,
): void => {
  if (!isRecord(gate)) {
    throw new Error("Reference network adoption stage gate must be an object")
  }
  if (gate.artifact_type !== "reference_network_adoption_stage_gate") {
    throw new Error(
      "Reference network adoption stage gate artifact_type must be reference_network_adoption_stage_gate",
    )
  }
  if (gate.schema_version !== "2026-05-21") {
    throw new Error("Reference network adoption stage gate schema_version is unsupported")
  }
  if (!isReferenceNetworkAdoptionStage(gate.stage)) {
    throw new Error(`Reference network adoption stage is invalid: ${String(gate.stage)}`)
  }
  if (gate.stage_name !== REFERENCE_NETWORK_ADOPTION_STAGE_NAMES[gate.stage]) {
    throw new Error("Reference network adoption stage_name does not match stage")
  }
  if (
    gate.claim_mode !== "reference_only"
    && gate.claim_mode !== "production_candidate"
  ) {
    throw new Error(
      `Reference network adoption claim_mode is invalid: ${String(gate.claim_mode)}`,
    )
  }
  assertCanonicalBoundaryOrder(gate)
  assertBoundarySummaries(gate)
  assertStageStatus(gate)
}

export const collectReferenceNetworkAdoptionEvidenceRefs = (
  gate: ReferenceNetworkAdoptionStageGate,
): ReadonlyArray<string> => {
  assertReferenceNetworkAdoptionStageGate(gate)

  return [...new Set(gate.boundaries.flatMap((boundary) =>
    (boundary.evidence_refs ?? []).map((ref) => ref.uri),
  ))]
}

export const assertReferenceNetworkAdoptionEvidenceCoverage = (
  gate: ReferenceNetworkAdoptionStageGate,
  coveredRefs: ReadonlyArray<string>,
  coverageSource: string,
): void => {
  assertReferenceNetworkAdoptionStageGate(gate)

  if (gate.claim_mode !== "production_candidate") {
    return
  }

  const covered = new Set(coveredRefs)
  const missingRefs = collectReferenceNetworkAdoptionEvidenceRefs(gate)
    .filter((ref) => !covered.has(ref))

  if (missingRefs.length > 0) {
    throw new Error(
      `Reference network adoption production evidence refs missing from ${coverageSource}: ${missingRefs.join(", ")}`,
    )
  }
}

const makeBoundary = (input: {
  readonly definition: BoundaryDefinition
  readonly config: ReferenceNetworkAdoptionStageGateConfig
  readonly required: boolean
  readonly productionCandidate: boolean
}): ReferenceNetworkAdoptionBoundary => {
  const present = input.definition.present(input.config)
  const evidenceRefs = input.config.evidenceRefs?.[input.definition.id] ?? []
  const status = present
    ? "pass"
    : input.required || input.productionCandidate
      ? "block"
      : "warn"
  const attachedEvidenceRefs = status === "pass" ? evidenceRefs : []

  return {
    id: input.definition.id,
    layer: input.definition.layer,
    title: input.definition.title,
    status,
    evidence_tier: evidenceTierFor(attachedEvidenceRefs),
    evidence: present
      ? input.definition.presentEvidence
      : input.definition.referenceEvidence,
    ...(attachedEvidenceRefs.length > 0
      ? { evidence_refs: attachedEvidenceRefs }
      : {}),
    ...(status === "pass" ? {} : { remediation: input.definition.remediation }),
    ...(input.definition.smokeScripts
      ? { smoke_scripts: input.definition.smokeScripts }
      : {}),
  }
}

const statusFor = (
  config: ReferenceNetworkAdoptionStageGateConfig,
  blockingBoundaries: ReadonlyArray<ReferenceNetworkAdoptionBoundaryId>,
): ReferenceNetworkAdoptionStatus => {
  if (config.claimMode === "production_candidate") {
    return blockingBoundaries.length > 0
      ? "blocked_for_production_candidate"
      : "ready_for_production_candidate"
  }

  if (blockingBoundaries.length > 0) {
    return "blocked_for_stage_claim"
  }

  return `ready_for_stage_${config.stage}_reference` as ReferenceNetworkAdoptionStatus
}

const reviewNotesFor = (
  config: ReferenceNetworkAdoptionStageGateConfig,
  blockingBoundaries: ReadonlyArray<ReferenceNetworkAdoptionBoundaryId>,
  warningBoundaries: ReadonlyArray<ReferenceNetworkAdoptionBoundaryId>,
  boundaries: ReadonlyArray<ReferenceNetworkAdoptionBoundary>,
): ReadonlyArray<string> => {
  const evidenceTiers = evidenceTierCountsFor(boundaries)
  const notes = [
    `Stage ${config.stage} (${REFERENCE_NETWORK_ADOPTION_STAGE_NAMES[config.stage]}) is evaluated as ${config.claimMode}.`,
    `Evidence tiers: ${evidenceTiers.operator_backed} operator-backed, ${evidenceTiers.reference_backed} reference-backed, ${evidenceTiers.unattached} unattached.`,
  ]
  if (blockingBoundaries.length > 0) {
    notes.push(
      `The stage claim is blocked by: ${blockingBoundaries.join(", ")}.`,
    )
  }
  if (warningBoundaries.length > 0) {
    notes.push(
      `Future-stage or production-only warnings remain: ${warningBoundaries.join(", ")}.`,
    )
  }
  if (
    config.claimMode === "reference_only"
    && evidenceTiers.reference_backed > 0
  ) {
    notes.push(
      "Reference-backed evidence is acceptable for a reference claim, but production-candidate claims must replace it with operator-owned evidence.",
    )
  }
  return notes
}

const assertCanonicalBoundaryOrder = (
  gate: ReferenceNetworkAdoptionStageGate,
): void => {
  if (!Array.isArray(gate.boundaries)) {
    throw new Error("Reference network adoption boundaries must be an array")
  }
  const ids = gate.boundaries.map((boundary) => boundary.id)
  if (ids.length !== REFERENCE_NETWORK_ADOPTION_BOUNDARY_IDS.length) {
    throw new Error(
      `Reference network adoption gate must include exactly ${REFERENCE_NETWORK_ADOPTION_BOUNDARY_IDS.length} boundaries`,
    )
  }
  if (
    !REFERENCE_NETWORK_ADOPTION_BOUNDARY_IDS.every(
      (id, index) => ids[index] === id,
    )
  ) {
    throw new Error(
      "Reference network adoption boundaries must use the canonical review order",
    )
  }
}

const assertBoundarySummaries = (
  gate: ReferenceNetworkAdoptionStageGate,
): void => {
  const calculatedBlockers = gate.boundaries
    .filter((boundary) => boundary.status === "block")
    .map((boundary) => boundary.id)
  const calculatedWarnings = gate.boundaries
    .filter((boundary) => boundary.status === "warn")
    .map((boundary) => boundary.id)

  if (!sameStringArray(gate.blocking_boundaries, calculatedBlockers)) {
    throw new Error(
      "Reference network adoption blocking_boundaries do not match block statuses",
    )
  }
  if (!sameStringArray(gate.warning_boundaries, calculatedWarnings)) {
    throw new Error(
      "Reference network adoption warning_boundaries do not match warn statuses",
    )
  }

  for (const boundary of gate.boundaries) {
    assertBoundary(boundary, gate)
  }
}

const assertBoundary = (
  boundary: ReferenceNetworkAdoptionBoundary,
  gate: ReferenceNetworkAdoptionStageGate,
): void => {
  if (!isRecord(boundary)) {
    throw new Error("Reference network adoption boundary must be an object")
  }
  if (!isReferenceNetworkAdoptionBoundaryId(boundary.id)) {
    throw new Error(
      `Reference network adoption boundary id is invalid: ${String(boundary.id)}`,
    )
  }
  if (!["pass", "warn", "block"].includes(boundary.status)) {
    throw new Error(
      `Reference network adoption boundary status is invalid for ${boundary.id}`,
    )
  }
  assertNonEmpty(boundary.layer, `${boundary.id}.layer`)
  assertNonEmpty(boundary.title, `${boundary.id}.title`)
  assertNonEmpty(boundary.evidence, `${boundary.id}.evidence`)
  if (!isReferenceNetworkAdoptionEvidenceTier(boundary.evidence_tier)) {
    throw new Error(
      `Reference network adoption evidence_tier is invalid for ${boundary.id}`,
    )
  }
  if (boundary.status !== "pass") {
    assertNonEmpty(boundary.remediation, `${boundary.id}.remediation`)
    if (boundary.evidence_tier !== "unattached") {
      throw new Error(
        `Reference network adoption non-pass boundary must be unattached: ${boundary.id}`,
      )
    }
  }
  assertEvidenceTierMatchesRefs(boundary)
  if (gate.claim_mode === "production_candidate" && boundary.status === "pass") {
    if (!boundary.evidence_refs || boundary.evidence_refs.length === 0) {
      throw new Error(
        `Reference network adoption production pass boundary needs evidence_refs: ${boundary.id}`,
      )
    }
    if (boundary.evidence_tier !== "operator_backed") {
      throw new Error(
        `Reference network adoption production pass boundary must be operator_backed: ${boundary.id}`,
      )
    }
  }
  for (const ref of boundary.evidence_refs ?? []) {
    assertEvidenceRef(ref, boundary.id)
  }
}

const evidenceTierFor = (
  evidenceRefs: ReadonlyArray<ReferenceNetworkAdoptionEvidenceRef>,
): ReferenceNetworkAdoptionEvidenceTier => {
  if (evidenceRefs.length === 0) {
    return "unattached"
  }

  return evidenceRefs.every(isOperatorOwnedEvidenceRef)
    ? "operator_backed"
    : "reference_backed"
}

const evidenceTierCountsFor = (
  boundaries: ReadonlyArray<ReferenceNetworkAdoptionBoundary>,
): Record<ReferenceNetworkAdoptionEvidenceTier, number> => ({
  operator_backed: boundaries.filter(
    (boundary) => boundary.evidence_tier === "operator_backed",
  ).length,
  reference_backed: boundaries.filter(
    (boundary) => boundary.evidence_tier === "reference_backed",
  ).length,
  unattached: boundaries.filter(
    (boundary) => boundary.evidence_tier === "unattached",
  ).length,
})

const assertEvidenceTierMatchesRefs = (
  boundary: ReferenceNetworkAdoptionBoundary,
): void => {
  const evidenceRefs = boundary.evidence_refs ?? []
  if (boundary.evidence_tier === "unattached") {
    if (evidenceRefs.length > 0) {
      throw new Error(
        `Reference network adoption unattached boundary cannot cite evidence_refs: ${boundary.id}`,
      )
    }
    return
  }

  if (evidenceRefs.length === 0) {
    throw new Error(
      `Reference network adoption ${boundary.evidence_tier} boundary needs evidence_refs: ${boundary.id}`,
    )
  }

  if (
    boundary.evidence_tier === "operator_backed"
    && !evidenceRefs.every(isOperatorOwnedEvidenceRef)
  ) {
    throw new Error(
      `Reference network adoption operator_backed boundary needs ops://qrtrust evidence_refs: ${boundary.id}`,
    )
  }
}

const isOperatorOwnedEvidenceRef = (
  ref: ReferenceNetworkAdoptionEvidenceRef,
): boolean => ref.uri.startsWith("ops://qrtrust/")

const assertStageStatus = (gate: ReferenceNetworkAdoptionStageGate): void => {
  const required = REFERENCE_NETWORK_ADOPTION_STAGE_REQUIREMENTS[gate.stage]
  const boundaryById = Object.fromEntries(
    gate.boundaries.map((boundary) => [boundary.id, boundary]),
  ) as Record<ReferenceNetworkAdoptionBoundaryId, ReferenceNetworkAdoptionBoundary>

  for (const boundaryId of required) {
    const status = boundaryById[boundaryId].status
    if (status === "warn") {
      throw new Error(
        `Reference network adoption stage ${gate.stage} cannot warn on required boundary: ${boundaryId}`,
      )
    }
  }

  if (gate.claim_mode === "production_candidate") {
    if (gate.warning_boundaries.length > 0) {
      throw new Error(
        "Reference network adoption production candidates cannot carry warnings",
      )
    }
    const expectedStatus = gate.blocking_boundaries.length > 0
      ? "blocked_for_production_candidate"
      : "ready_for_production_candidate"
    if (gate.status !== expectedStatus) {
      throw new Error(
        `Reference network adoption production status must be ${expectedStatus}`,
      )
    }
    return
  }

  const expectedStatus = gate.blocking_boundaries.length > 0
    ? "blocked_for_stage_claim"
    : `ready_for_stage_${gate.stage}_reference`
  if (gate.status !== expectedStatus) {
    throw new Error(
      `Reference network adoption reference status must be ${expectedStatus}`,
    )
  }
}

const assertEvidenceRef = (
  ref: ReferenceNetworkAdoptionEvidenceRef,
  boundaryId: ReferenceNetworkAdoptionBoundaryId,
): void => {
  if (!isRecord(ref)) {
    throw new Error(
      `Reference network adoption evidence ref for ${boundaryId} must be an object`,
    )
  }
  assertNonEmpty(ref.label, `${boundaryId}.evidence_ref.label`)
  assertNonEmpty(ref.uri, `${boundaryId}.evidence_ref.uri`)
  assertNonEmpty(ref.owner, `${boundaryId}.evidence_ref.owner`)
  assertEvidenceReviewDate(
    ref.reviewed_at,
    "Reference network adoption",
    `${boundaryId}.evidence_ref.reviewed_at`,
    boundaryId,
  )
}

const isReferenceNetworkAdoptionStage = (
  value: unknown,
): value is ReferenceNetworkAdoptionStage =>
  value === 0 || value === 1 || value === 2 || value === 3

const isReferenceNetworkAdoptionBoundaryId = (
  value: unknown,
): value is ReferenceNetworkAdoptionBoundaryId =>
  typeof value === "string"
  && REFERENCE_NETWORK_ADOPTION_BOUNDARY_IDS.includes(
    value as ReferenceNetworkAdoptionBoundaryId,
  )

const isReferenceNetworkAdoptionEvidenceTier = (
  value: unknown,
): value is ReferenceNetworkAdoptionEvidenceTier =>
  value === "reference_backed"
  || value === "operator_backed"
  || value === "unattached"

const sameStringArray = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

const assertNonEmpty = (value: unknown, label: string): void => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Reference network adoption ${label} must be non-empty`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
