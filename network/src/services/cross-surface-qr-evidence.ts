import type { DecisionColor } from "../contracts.js"
import { assertEvidenceReviewDate } from "./evidence-review.js"
import {
  isSha256Fingerprint,
  validateCompactDomainFingerprint,
} from "./fingerprint-validation.js"

export const CROSS_SURFACE_QR_EVIDENCE_SURFACES = [
  "contract_fixture",
  "worker_drill",
  "web_lab",
  "backend_scanner_decision",
  "ios_scanner",
] as const

export type CrossSurfaceQrEvidenceSurface =
  (typeof CROSS_SURFACE_QR_EVIDENCE_SURFACES)[number]

export interface CrossSurfaceQrArtifactReference {
  readonly artifact_ref: string
  readonly payload_hash: string
  readonly usage_policy: "one_time" | "reusable_public"
  readonly destination_fingerprint: string
}

export interface CrossSurfaceQrDecision {
  readonly decision_color: DecisionColor
  readonly decision_state: string
  readonly reason_codes: ReadonlyArray<string>
}

export interface CrossSurfaceQrEvidenceRow {
  readonly surface: CrossSurfaceQrEvidenceSurface
  readonly artifact_ref: string
  readonly proof_ref: string
  readonly decision_color: DecisionColor
  readonly decision_state: string
  readonly reason_codes: ReadonlyArray<string>
  readonly observed_at: string
  readonly notes?: string
}

export interface CrossSurfaceQrEvidenceReviewer {
  readonly name: string
  readonly role: string
  readonly reviewed_at: string
}

export interface CrossSurfaceQrEvidencePrivacy {
  readonly raw_urls_redacted: boolean
  readonly secrets_included: false
  readonly notes?: string
}

export interface CrossSurfaceQrEvidencePacket {
  readonly artifact_type: "cross_surface_qr_evidence_packet"
  readonly bundle_id: string
  readonly generated_at: string
  readonly scenario_id: string
  readonly qr_artifact: CrossSurfaceQrArtifactReference
  readonly final_decision: CrossSurfaceQrDecision
  readonly surface_evidence: ReadonlyArray<CrossSurfaceQrEvidenceRow>
  readonly reviewer: CrossSurfaceQrEvidenceReviewer
  readonly privacy: CrossSurfaceQrEvidencePrivacy
}

export interface CrossSurfaceQrEvidencePacketConfig {
  readonly bundleId: string
  readonly generatedAt: string
  readonly scenarioId: string
  readonly qrArtifact: CrossSurfaceQrArtifactReference
  readonly finalDecision: CrossSurfaceQrDecision
  readonly surfaceEvidence: ReadonlyArray<CrossSurfaceQrEvidenceRow>
  readonly reviewer: CrossSurfaceQrEvidenceReviewer
  readonly privacy: CrossSurfaceQrEvidencePrivacy
}

const REQUIRED_PROOF_PREFIXES: Record<CrossSurfaceQrEvidenceSurface, string> = {
  contract_fixture: "docs/public/",
  worker_drill: "docs/public/",
  web_lab: "docs/public/",
  backend_scanner_decision: "docs/public/",
  ios_scanner: "docs/public/evidence/iphone/",
}

export const makeCrossSurfaceQrEvidencePacket = (
  config: CrossSurfaceQrEvidencePacketConfig,
): CrossSurfaceQrEvidencePacket => {
  const packet: CrossSurfaceQrEvidencePacket = {
    artifact_type: "cross_surface_qr_evidence_packet",
    bundle_id: config.bundleId,
    generated_at: config.generatedAt,
    scenario_id: config.scenarioId,
    qr_artifact: config.qrArtifact,
    final_decision: config.finalDecision,
    surface_evidence: config.surfaceEvidence,
    reviewer: config.reviewer,
    privacy: config.privacy,
  }

  assertCrossSurfaceQrEvidencePacket(packet)

  return packet
}

export const assertCrossSurfaceQrEvidencePacket = (
  packet: CrossSurfaceQrEvidencePacket,
): void => {
  if (!isRecord(packet)) {
    throw new Error("Cross-surface QR evidence packet must be an object")
  }
  if (packet.artifact_type !== "cross_surface_qr_evidence_packet") {
    throw new Error(
      "Cross-surface QR evidence artifact_type must be cross_surface_qr_evidence_packet",
    )
  }
  assertNonEmpty(packet.bundle_id, "bundle_id")
  assertNonEmpty(packet.scenario_id, "scenario_id")
  assertDateTime(packet.generated_at, "generated_at", packet.scenario_id)
  assertPrivacy(packet.privacy)
  assertReviewer(packet.reviewer, packet.scenario_id)
  assertQrArtifact(packet.qr_artifact, packet.scenario_id)
  assertDecision(packet.final_decision, "final_decision", packet.scenario_id)
  assertSurfaceEvidence(packet)
}

export const collectCrossSurfaceQrEvidenceRefs = (
  packet: CrossSurfaceQrEvidencePacket,
): ReadonlyArray<string> => {
  assertCrossSurfaceQrEvidencePacket(packet)

  return packet.surface_evidence.map((row) => row.proof_ref)
}

const assertQrArtifact = (
  artifact: unknown,
  scenarioId: string,
): void => {
  if (!isRecord(artifact)) {
    throw new Error(
      `Cross-surface QR evidence requires qr_artifact for ${scenarioId}`,
    )
  }
  assertNonEmpty(artifact.artifact_ref, "qr_artifact.artifact_ref")
  assertHash(artifact.payload_hash, "qr_artifact.payload_hash", scenarioId)
  assertDomainFingerprint(
    artifact.destination_fingerprint,
    "qr_artifact.destination_fingerprint",
    scenarioId,
  )
  const usagePolicy = artifact.usage_policy
  if (usagePolicy !== "one_time" && usagePolicy !== "reusable_public") {
    throw new Error(
      `Cross-surface QR evidence has invalid qr_artifact.usage_policy for ${scenarioId}: ${String(usagePolicy)}`,
    )
  }
}

const assertSurfaceEvidence = (
  packet: CrossSurfaceQrEvidencePacket,
): void => {
  if (!Array.isArray(packet.surface_evidence)) {
    throw new Error(
      `Cross-surface QR evidence surface_evidence must be an array for ${packet.scenario_id}`,
    )
  }
  const surfaces = packet.surface_evidence.map((row) => row.surface)
  if (surfaces.length !== CROSS_SURFACE_QR_EVIDENCE_SURFACES.length) {
    throw new Error(
      `Cross-surface QR evidence must include exactly ${CROSS_SURFACE_QR_EVIDENCE_SURFACES.length} surface rows for ${packet.scenario_id}`,
    )
  }

  const duplicateSurfaces = [...new Set(
    surfaces.filter((surface, index) => surfaces.indexOf(surface) !== index),
  )]
  if (duplicateSurfaces.length > 0) {
    throw new Error(
      `Cross-surface QR evidence duplicates surfaces for ${packet.scenario_id}: ${duplicateSurfaces.join(", ")}`,
    )
  }

  if (
    !CROSS_SURFACE_QR_EVIDENCE_SURFACES.every(
      (surface, index) => surfaces[index] === surface,
    )
  ) {
    throw new Error(
      `Cross-surface QR evidence surfaces must use the canonical handoff order for ${packet.scenario_id}`,
    )
  }

  const proofRefs = new Set<string>()
  for (const row of packet.surface_evidence) {
    assertSurfaceRow(row, packet)
    if (proofRefs.has(row.proof_ref)) {
      throw new Error(
        `Cross-surface QR evidence reuses proof_ref for ${packet.scenario_id}: ${row.proof_ref}`,
      )
    }
    proofRefs.add(row.proof_ref)
  }
}

const assertSurfaceRow = (
  row: CrossSurfaceQrEvidenceRow,
  packet: CrossSurfaceQrEvidencePacket,
): void => {
  if (!isRecord(row)) {
    throw new Error(
      `Cross-surface QR evidence surface row must be an object for ${packet.scenario_id}`,
    )
  }
  if (!isCrossSurfaceQrEvidenceSurface(row.surface)) {
    throw new Error(
      `Cross-surface QR evidence has invalid surface for ${packet.scenario_id}: ${String(row.surface)}`,
    )
  }
  assertNonEmpty(row.artifact_ref, `${row.surface}.artifact_ref`)
  assertNonEmpty(row.proof_ref, `${row.surface}.proof_ref`)
  assertDateTime(row.observed_at, `${row.surface}.observed_at`, packet.scenario_id)
  assertDecision(row, row.surface, packet.scenario_id)
  assertProofRef(row)

  if (row.artifact_ref !== packet.qr_artifact.artifact_ref) {
    throw new Error(
      `Cross-surface QR evidence artifact_ref mismatch for ${packet.scenario_id} at ${row.surface}`,
    )
  }

  if (row.decision_color !== packet.final_decision.decision_color) {
    throw new Error(
      `Cross-surface QR evidence color mismatch for ${packet.scenario_id} at ${row.surface}`,
    )
  }

  if (row.decision_state !== packet.final_decision.decision_state) {
    throw new Error(
      `Cross-surface QR evidence state mismatch for ${packet.scenario_id} at ${row.surface}`,
    )
  }
}

const assertDecision = (
  decision: unknown,
  label: string,
  scenarioId: string,
): void => {
  if (!isRecord(decision)) {
    throw new Error(
      `Cross-surface QR evidence requires decision object for ${scenarioId}: ${label}`,
    )
  }
  const decisionColor = decision.decision_color
  if (
    decisionColor !== "green" &&
    decisionColor !== "orange" &&
    decisionColor !== "red"
  ) {
    throw new Error(
      `Cross-surface QR evidence has invalid decision color for ${scenarioId}: ${label}`,
    )
  }
  assertNonEmpty(decision.decision_state, `${label}.decision_state`)
  if (
    !Array.isArray(decision.reason_codes) ||
    decision.reason_codes.length === 0 ||
    decision.reason_codes.some(
      (code) => typeof code !== "string" || code.trim() === "",
    )
  ) {
    throw new Error(
      `Cross-surface QR evidence requires non-empty reason codes for ${scenarioId}: ${label}`,
    )
  }
}

const assertProofRef = (row: CrossSurfaceQrEvidenceRow): void => {
  const prefix = REQUIRED_PROOF_PREFIXES[row.surface]
  if (!row.proof_ref.startsWith(prefix) || row.proof_ref.includes("..")) {
    throw new Error(
      `Cross-surface QR evidence has invalid proof_ref for ${row.surface}: ${row.proof_ref}`,
    )
  }
}

const assertHash = (value: unknown, label: string, scenarioId: string): void => {
  if (typeof value !== "string") {
    throw new Error(
      `Cross-surface QR evidence has invalid ${label} for ${scenarioId}: ${String(value)}`,
    )
  }
  if (!isSha256Fingerprint(value)) {
    throw new Error(
      `Cross-surface QR evidence has invalid ${label} for ${scenarioId}: ${value}`,
    )
  }
}

const assertDomainFingerprint = (
  value: unknown,
  label: string,
  scenarioId: string,
): void => {
  if (typeof value !== "string") {
    throw new Error(
      `Cross-surface QR evidence has invalid ${label} for ${scenarioId}: ${String(value)}`,
    )
  }
  const validation = validateCompactDomainFingerprint(value)
  if (validation.valid) {
    return
  }

  if (validation.reason !== "raw_url_token") {
    throw new Error(
      `Cross-surface QR evidence has invalid ${label} for ${scenarioId}: ${value}`,
    )
  }

  throw new Error(
    `Cross-surface QR evidence ${label} must not expose a raw URL for ${scenarioId}`,
  )
}

const assertPrivacy = (privacy: unknown): void => {
  if (!isRecord(privacy)) {
    throw new Error("Cross-surface QR evidence privacy must be an object")
  }
  if (privacy.secrets_included !== false) {
    throw new Error("Cross-surface QR evidence must not include secrets.")
  }

  if (!privacy.raw_urls_redacted) {
    throw new Error(
      "Cross-surface QR evidence must redact raw URLs before public handoff.",
    )
  }
}

const assertReviewer = (reviewer: unknown, scenarioId: string): void => {
  if (!isRecord(reviewer)) {
    throw new Error(
      `Cross-surface QR evidence reviewer must be an object for ${scenarioId}`,
    )
  }
  assertNonEmpty(reviewer.name, "reviewer.name")
  assertNonEmpty(reviewer.role, "reviewer.role")
  assertEvidenceReviewDate(
    reviewer.reviewed_at,
    "Cross-surface QR evidence",
    "reviewer.reviewed_at",
    scenarioId,
  )
}

const assertDateTime = (
  value: unknown,
  label: string,
  scenarioId: string,
): void => {
  if (typeof value !== "string") {
    throw new Error(
      `Cross-surface QR evidence has invalid ${label} for ${scenarioId}: ${String(value)}`,
    )
  }
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(
      `Cross-surface QR evidence has invalid ${label} for ${scenarioId}: ${value}`,
    )
  }
}

function assertNonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") {
    throw new Error(`Cross-surface QR evidence requires ${label}`)
  }
  if (value.trim() === "") {
    throw new Error(`Cross-surface QR evidence requires ${label}`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isCrossSurfaceQrEvidenceSurface = (
  value: unknown,
): value is CrossSurfaceQrEvidenceSurface =>
  typeof value === "string" &&
  CROSS_SURFACE_QR_EVIDENCE_SURFACES.some((surface) => surface === value)
