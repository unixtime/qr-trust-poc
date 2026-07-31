import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { relative } from "node:path"

import {
  DEPLOYMENT_READINESS_CHECK_IDS,
  type DeploymentReadinessCheckId,
  type DeploymentReadinessEvidenceRef,
  type DeploymentReadinessReport,
} from "./deployment-readiness.js"
import {
  assertCrossSurfaceQrEvidencePacket,
  type CrossSurfaceQrEvidencePacket,
} from "./cross-surface-qr-evidence.js"
import {
  assertScannerFleetEvidencePacket,
  type ScannerFleetEvidencePacket,
} from "./scanner-fleet-evidence.js"
import {
  assertSigningCustodyAuditExport,
  type SigningCustodyAuditExport,
} from "./signing-custody-audit-export.js"
import {
  assertWorkerOperationsEvidencePacket,
  type WorkerOperationsEvidencePacket,
} from "./worker-operations-evidence.js"
import {
  assertRestoreAutomationEvidencePacket,
  type RestoreAutomationEvidencePacket,
} from "./restore-automation-evidence.js"
import {
  assertPackagedDeploymentApprovalEvidencePacket,
  type PackagedDeploymentApprovalEvidencePacket,
} from "./packaged-deployment-approval-evidence.js"
import {
  assertOperatorEvidenceIndex,
  type OperatorEvidenceIndex,
} from "./operator-evidence-index.js"
import { isEvidenceReviewDate } from "./evidence-review.js"

export const DEPLOYMENT_READINESS_BUNDLE_FILE_ROLES = [
  "readiness_json_report",
  "readiness_markdown_report",
  "production_env_template",
  "evidence_map",
  "operator_guide",
  "signing_custody_audit_export_contract",
  "signing_custody_publication_audit_export",
  "scanner_decision_runtime_contract",
  "verifier_profile_distribution_contract",
  "scanner_fleet_evidence_contract",
  "scanner_fleet_evidence_packet",
  "cross_surface_qr_evidence_contract",
  "cross_surface_qr_evidence_packet",
  "worker_operations_evidence_contract",
  "worker_operations_evidence_packet",
  "restore_automation_evidence_contract",
  "restore_automation_evidence_packet",
  "packaged_deployment_approval_evidence_contract",
  "packaged_deployment_approval_evidence_packet",
  "operator_evidence_index_contract",
  "operator_evidence_index_packet",
] as const

export type DeploymentReadinessBundleFileRole =
  (typeof DEPLOYMENT_READINESS_BUNDLE_FILE_ROLES)[number]

export interface DeploymentReadinessBundleFileSource {
  readonly role: DeploymentReadinessBundleFileRole
  readonly path: string
}

export interface DeploymentReadinessBundleFile {
  readonly role: DeploymentReadinessBundleFileRole
  readonly path: string
  readonly sha256: string
  readonly bytes: number
}

export interface DeploymentReadinessBundleReportSummary {
  readonly mode: DeploymentReadinessReport["mode"]
  readonly status: DeploymentReadinessReport["status"]
  readonly blocking_checks: DeploymentReadinessReport["blocking_checks"]
  readonly warning_checks: DeploymentReadinessReport["warning_checks"]
}

export interface DeploymentReadinessBundle {
  readonly artifact_type: "deployment_readiness_bundle"
  readonly generated_at: string
  readonly bundle_role: "operator_handoff"
  readonly report: DeploymentReadinessBundleReportSummary
  readonly files: ReadonlyArray<DeploymentReadinessBundleFile>
  readonly review_notes: ReadonlyArray<string>
}

export interface DeploymentReadinessBundleConfig {
  readonly rootDir: string
  readonly generatedAt: string
  readonly reportJsonPath: string
  readonly files: ReadonlyArray<DeploymentReadinessBundleFileSource>
}

type DeploymentReadinessEvidenceMap = Partial<
  Record<DeploymentReadinessCheckId, ReadonlyArray<DeploymentReadinessEvidenceRef>>
>

const DEPLOYMENT_READINESS_CHECK_ID_SET = new Set<string>(
  DEPLOYMENT_READINESS_CHECK_IDS,
)

export const makeDeploymentReadinessBundle = (
  config: DeploymentReadinessBundleConfig,
): DeploymentReadinessBundle => {
  const report = readDeploymentReadinessReport(config.reportJsonPath)
  const files = config.files.map((file) => fingerprintFile(config.rootDir, file))

  assertRequiredRoles(files)
  assertProductionEvidenceMapCoverage(report, config.files)

  return {
    artifact_type: "deployment_readiness_bundle",
    generated_at: config.generatedAt,
    bundle_role: "operator_handoff",
    report: {
      mode: report.mode,
      status: report.status,
      blocking_checks: report.blocking_checks,
      warning_checks: report.warning_checks,
    },
    files,
    review_notes: makeReviewNotes(report),
  }
}

const readDeploymentReadinessReport = (path: string): DeploymentReadinessReport => {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!isDeploymentReadinessReport(parsed)) {
    throw new Error(
      `Deployment readiness bundle expected a readiness report JSON object at ${path}`,
    )
  }

  return parsed
}

const isDeploymentReadinessReport = (
  value: unknown,
): value is DeploymentReadinessReport => {
  if (!isRecord(value)) {
    return false
  }

  return value.artifact_type === "deployment_readiness_report"
    && (value.mode === "reference" || value.mode === "production")
    && typeof value.status === "string"
    && Array.isArray(value.blocking_checks)
    && Array.isArray(value.warning_checks)
    && Array.isArray(value.checks)
}

const fingerprintFile = (
  rootDir: string,
  file: DeploymentReadinessBundleFileSource,
): DeploymentReadinessBundleFile => {
  const content = readFileSync(file.path)
  assertRoleSpecificContent(file, content)

  return {
    role: file.role,
    path: normalizePath(relative(rootDir, file.path)),
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: content.byteLength,
  }
}

const assertRoleSpecificContent = (
  file: DeploymentReadinessBundleFileSource,
  content: Buffer,
): void => {
  if (file.role === "scanner_fleet_evidence_packet") {
    assertScannerFleetEvidencePacketContent(file, content)
    return
  }

  if (file.role === "cross_surface_qr_evidence_packet") {
    assertCrossSurfaceQrEvidencePacketContent(file, content)
    return
  }

  if (file.role === "worker_operations_evidence_packet") {
    assertWorkerOperationsEvidencePacketContent(file, content)
    return
  }

  if (file.role === "restore_automation_evidence_packet") {
    assertRestoreAutomationEvidencePacketContent(file, content)
    return
  }

  if (file.role === "packaged_deployment_approval_evidence_packet") {
    assertPackagedDeploymentApprovalEvidencePacketContent(file, content)
    return
  }

  if (file.role === "operator_evidence_index_packet") {
    assertOperatorEvidenceIndexContent(file, content)
    return
  }

  if (file.role === "signing_custody_publication_audit_export") {
    assertSigningCustodyPublicationAuditExportContent(file, content)
  }
}

const assertScannerFleetEvidencePacketContent = (
  file: DeploymentReadinessBundleFileSource,
  content: Buffer,
): void => {

  const parsed = parseJson(
    content.toString("utf8"),
    file.path,
    "scanner_fleet_evidence_packet",
  )
  if (
    !isRecord(parsed) ||
    parsed.artifact_type !== "scanner_fleet_evidence_packet"
  ) {
    throw new Error(
      `Deployment readiness bundle expected scanner_fleet_evidence_packet at ${file.path}`,
    )
  }

  try {
    assertScannerFleetEvidencePacket(
      parsed as unknown as ScannerFleetEvidencePacket,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Deployment readiness bundle scanner_fleet_evidence_packet failed semantic validation at ${file.path}: ${message}`,
    )
  }
}

const assertCrossSurfaceQrEvidencePacketContent = (
  file: DeploymentReadinessBundleFileSource,
  content: Buffer,
): void => {
  const parsed = parseJson(
    content.toString("utf8"),
    file.path,
    "cross_surface_qr_evidence_packet",
  )
  if (
    !isRecord(parsed) ||
    parsed.artifact_type !== "cross_surface_qr_evidence_packet"
  ) {
    throw new Error(
      `Deployment readiness bundle expected cross_surface_qr_evidence_packet at ${file.path}`,
    )
  }

  try {
    assertCrossSurfaceQrEvidencePacket(
      parsed as unknown as CrossSurfaceQrEvidencePacket,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Deployment readiness bundle cross_surface_qr_evidence_packet failed semantic validation at ${file.path}: ${message}`,
    )
  }
}

const assertWorkerOperationsEvidencePacketContent = (
  file: DeploymentReadinessBundleFileSource,
  content: Buffer,
): void => {
  const parsed = parseJson(
    content.toString("utf8"),
    file.path,
    "worker_operations_evidence_packet",
  )
  if (
    !isRecord(parsed) ||
    parsed.artifact_type !== "worker_operations_evidence_packet"
  ) {
    throw new Error(
      `Deployment readiness bundle expected worker_operations_evidence_packet at ${file.path}`,
    )
  }

  try {
    assertWorkerOperationsEvidencePacket(
      parsed as unknown as WorkerOperationsEvidencePacket,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Deployment readiness bundle worker_operations_evidence_packet failed semantic validation at ${file.path}: ${message}`,
    )
  }
}

const assertRestoreAutomationEvidencePacketContent = (
  file: DeploymentReadinessBundleFileSource,
  content: Buffer,
): void => {
  const parsed = parseJson(
    content.toString("utf8"),
    file.path,
    "restore_automation_evidence_packet",
  )
  if (
    !isRecord(parsed) ||
    parsed.artifact_type !== "restore_automation_evidence_packet"
  ) {
    throw new Error(
      `Deployment readiness bundle expected restore_automation_evidence_packet at ${file.path}`,
    )
  }

  try {
    assertRestoreAutomationEvidencePacket(
      parsed as unknown as RestoreAutomationEvidencePacket,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Deployment readiness bundle restore_automation_evidence_packet failed semantic validation at ${file.path}: ${message}`,
    )
  }
}

const assertPackagedDeploymentApprovalEvidencePacketContent = (
  file: DeploymentReadinessBundleFileSource,
  content: Buffer,
): void => {
  const parsed = parseJson(
    content.toString("utf8"),
    file.path,
    "packaged_deployment_approval_evidence_packet",
  )
  if (
    !isRecord(parsed) ||
    parsed.artifact_type !== "packaged_deployment_approval_evidence_packet"
  ) {
    throw new Error(
      `Deployment readiness bundle expected packaged_deployment_approval_evidence_packet at ${file.path}`,
    )
  }

  try {
    assertPackagedDeploymentApprovalEvidencePacket(
      parsed as unknown as PackagedDeploymentApprovalEvidencePacket,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Deployment readiness bundle packaged_deployment_approval_evidence_packet failed semantic validation at ${file.path}: ${message}`,
    )
  }
}

const assertOperatorEvidenceIndexContent = (
  file: DeploymentReadinessBundleFileSource,
  content: Buffer,
): void => {
  const parsed = parseJson(
    content.toString("utf8"),
    file.path,
    "operator_evidence_index_packet",
  )
  if (
    !isRecord(parsed) ||
    parsed.artifact_type !== "operator_evidence_index"
  ) {
    throw new Error(
      `Deployment readiness bundle expected operator_evidence_index at ${file.path}`,
    )
  }

  try {
    assertOperatorEvidenceIndex(parsed as unknown as OperatorEvidenceIndex)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Deployment readiness bundle operator_evidence_index_packet failed semantic validation at ${file.path}: ${message}`,
    )
  }
}

const assertSigningCustodyPublicationAuditExportContent = (
  file: DeploymentReadinessBundleFileSource,
  content: Buffer,
): void => {
  const parsed = parseJson(
    content.toString("utf8"),
    file.path,
    "signing_custody_publication_audit_export",
  )
  if (
    !isRecord(parsed) ||
    parsed.artifact_type !== "signing_custody_audit_export"
  ) {
    throw new Error(
      `Deployment readiness bundle expected signing_custody_audit_export at ${file.path}`,
    )
  }

  try {
    assertSigningCustodyAuditExport(
      parsed as unknown as SigningCustodyAuditExport,
    )
    assertPublicationWorkerOutcomeEvidence(
      parsed as unknown as SigningCustodyAuditExport,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Deployment readiness bundle signing_custody_publication_audit_export failed semantic validation at ${file.path}: ${message}`,
    )
  }
}

const assertPublicationWorkerOutcomeEvidence = (
  auditExport: SigningCustodyAuditExport,
): void => {
  const failedEntries = auditExport.entries.filter(
    (entry) => entry.publication_result === "failed",
  )
  if (failedEntries.length === 0) {
    throw new Error(
      "publication-worker audit export must include at least one failed publication outcome",
    )
  }
  if (
    failedEntries.some(
      (entry) => !entry.reason_codes || entry.reason_codes.length === 0,
    )
  ) {
    throw new Error(
      "failed publication outcomes must include reason_codes",
    )
  }
  if (
    !auditExport.entries.some((entry) =>
      entry.custody_provider_ref.includes("publication-worker"),
    )
  ) {
    throw new Error(
      "publication-worker audit export must identify the worker custody provider",
    )
  }
}

const parseJson = (
  content: string,
  path: string,
  role: DeploymentReadinessBundleFileRole,
): unknown => {
  try {
    return JSON.parse(content)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Deployment readiness bundle could not parse ${role} JSON at ${path}: ${message}`,
    )
  }
}

const assertRequiredRoles = (
  files: ReadonlyArray<DeploymentReadinessBundleFile>,
): void => {
  const roles = new Set(files.map((file) => file.role))
  const missing = DEPLOYMENT_READINESS_BUNDLE_FILE_ROLES.filter(
    (role) => !roles.has(role),
  )

  if (missing.length > 0) {
    throw new Error(
      `Deployment readiness bundle missing required file roles: ${missing.join(", ")}`,
    )
  }
}

const assertProductionEvidenceMapCoverage = (
  report: DeploymentReadinessReport,
  fileSources: ReadonlyArray<DeploymentReadinessBundleFileSource>,
): void => {
  if (
    report.mode !== "production" ||
    report.status !== "ready_for_production_drill"
  ) {
    return
  }

  const evidenceMapSource = fileSources.find(
    (file) => file.role === "evidence_map",
  )
  if (!evidenceMapSource) {
    throw new Error(
      "Deployment readiness bundle missing evidence_map source for production-ready report",
    )
  }

  const parsed = parseJson(
    readFileSync(evidenceMapSource.path, "utf8"),
    evidenceMapSource.path,
    "evidence_map",
  )
  const evidenceMap = assertDeploymentReadinessEvidenceMap(
    parsed,
    evidenceMapSource.path,
  )
  const missingCheckIds = report.checks
    .filter((check) => check.status === "pass")
    .filter((check) => !hasEvidenceRefArray(evidenceMap[check.id]))
    .map((check) => check.id)

  if (missingCheckIds.length > 0) {
    throw new Error(
      `Deployment readiness bundle evidence_map is missing production evidence refs for passing checks: ${missingCheckIds.join(", ")}`,
    )
  }
}

const assertDeploymentReadinessEvidenceMap = (
  value: unknown,
  path: string,
): DeploymentReadinessEvidenceMap => {
  if (!isRecord(value)) {
    throw new Error(
      `Deployment readiness bundle expected evidence_map object at ${path}`,
    )
  }

  for (const [checkId, evidenceRefs] of Object.entries(value)) {
    if (!DEPLOYMENT_READINESS_CHECK_ID_SET.has(checkId)) {
      throw new Error(
        `Deployment readiness bundle evidence_map contains unknown readiness check id at ${path}: ${checkId}`,
      )
    }

    if (!hasEvidenceRefArray(evidenceRefs)) {
      throw new Error(
        `Deployment readiness bundle evidence_map has malformed evidence refs for ${checkId} at ${path}`,
      )
    }
  }

  return value as DeploymentReadinessEvidenceMap
}

const hasEvidenceRefArray = (
  value: unknown,
): value is ReadonlyArray<DeploymentReadinessEvidenceRef> =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(isDeploymentReadinessEvidenceRef)

const isDeploymentReadinessEvidenceRef = (
  value: unknown,
): value is DeploymentReadinessEvidenceRef =>
  isRecord(value) &&
  isNonEmptyString(value.label) &&
  isNonEmptyString(value.uri) &&
  isNonEmptyString(value.owner) &&
  isEvidenceReviewDate(value.reviewed_at)

const makeReviewNotes = (
  report: DeploymentReadinessReport,
): ReadonlyArray<string> => {
  if (report.status === "ready_for_production_drill") {
    return [
      "Review every evidence URI before making a production claim.",
      "Treat the bundle as a handoff manifest, not as proof that the referenced systems still exist.",
    ]
  }

  if (report.status === "ready_for_reference_drill") {
    return [
      "Reference mode can demonstrate the architecture without satisfying production-owned controls.",
      "Generate a production-mode report before deployment review.",
    ]
  }

  return [
    "Resolve blocking checks before production deployment review.",
    "A blocked bundle can still be used to assign operator-owned remediation work.",
  ]
}

const normalizePath = (path: string): string => path.replaceAll("\\", "/")

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
