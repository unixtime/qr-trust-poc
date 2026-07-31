import type {
  ArtifactPublicationFailure,
  ArtifactPublicationQueueWorkerReport,
  ArtifactPublicationSuccess,
} from "./artifact-publication-queue-worker.js"
import {
  makeSigningCustodyAuditExport,
  type SigningCustodyAuditEntry,
  type SigningCustodyAuditExport,
  type SigningCustodyAuditScope,
} from "./signing-custody-audit-export.js"

export interface SigningCustodyPublicationAuditOutcome {
  readonly work_item_id: string
  readonly artifact_id: string
  readonly artifact_type: string
  readonly artifact_version: number
  readonly artifact_hash: string
  readonly root_program_id: string
  readonly delegated_authority_id?: string
  readonly issuer_id?: string
  readonly publication_result: "published" | "failed"
  readonly requested_at: string
  readonly reason_codes?: ReadonlyArray<string>
}

export interface SigningCustodyPublicationAuditMetadata {
  readonly signer_id: string
  readonly key_id: string
  readonly algorithm_id: string
  readonly custody_provider_ref: string
  readonly provider_audit_id: string
}

export type SigningCustodyPublicationAuditMetadataResolver = (
  outcome: SigningCustodyPublicationAuditOutcome,
) => SigningCustodyPublicationAuditMetadata

export interface SigningCustodyPublicationAuditExportConfig {
  readonly exportId: string
  readonly generatedAt: string
  readonly scope: SigningCustodyAuditScope
  readonly workerReport: ArtifactPublicationQueueWorkerReport
  readonly resolveMetadata: SigningCustodyPublicationAuditMetadataResolver
  readonly automationIdentity?: string
  readonly requestedAtByWorkItemId?: Readonly<Record<string, string>>
}

export const makeSigningCustodyPublicationAuditExport = (
  config: SigningCustodyPublicationAuditExportConfig,
): SigningCustodyAuditExport => {
  const outcomes = [
    ...config.workerReport.successes.map((success) =>
      successToOutcome(config, success),
    ),
    ...config.workerReport.failures.map((failure) =>
      failureToOutcome(config, failure),
    ),
  ].sort((left, right) => left.work_item_id.localeCompare(right.work_item_id))

  const entries = outcomes.map((outcome) =>
    outcomeToAuditEntry(config, outcome),
  )

  return makeSigningCustodyAuditExport({
    exportId: config.exportId,
    generatedAt: config.generatedAt,
    scope: config.scope,
    entries,
  })
}

export const reasonCodeFromPublicationFailure = (reason: string): string => {
  const normalized = reason
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96)

  return normalized ? `publication_failed_${normalized}` : "publication_failed"
}

const successToOutcome = (
  config: SigningCustodyPublicationAuditExportConfig,
  success: ArtifactPublicationSuccess,
): SigningCustodyPublicationAuditOutcome => {
  const envelope = success.result.event.envelope

  return {
    work_item_id: success.work_item_id,
    artifact_id: success.artifact_id,
    artifact_type: success.result.artifact.artifact_type,
    artifact_version: success.result.artifact.version,
    artifact_hash: success.artifact_hash,
    root_program_id: envelope.root_program_id,
    ...(envelope.delegated_authority_id
      ? { delegated_authority_id: envelope.delegated_authority_id }
      : {}),
    ...(envelope.issuer_id ? { issuer_id: envelope.issuer_id } : {}),
    publication_result: "published",
    requested_at: requestedAt(config, success.work_item_id),
  }
}

const failureToOutcome = (
  config: SigningCustodyPublicationAuditExportConfig,
  failure: ArtifactPublicationFailure,
): SigningCustodyPublicationAuditOutcome => ({
  work_item_id: failure.work_item_id,
  artifact_id: requiredString(failure.artifact_id, failure, "artifact_id"),
  artifact_type: requiredString(failure.artifact_type, failure, "artifact_type"),
  artifact_version: requiredNumber(
    failure.artifact_version,
    failure,
    "artifact_version",
  ),
  artifact_hash: requiredString(failure.artifact_hash, failure, "artifact_hash"),
  root_program_id: requiredString(
    failure.root_program_id,
    failure,
    "root_program_id",
  ),
  ...(failure.delegated_authority_id
    ? { delegated_authority_id: failure.delegated_authority_id }
    : {}),
  ...(failure.issuer_id ? { issuer_id: failure.issuer_id } : {}),
  publication_result: "failed",
  requested_at: requestedAt(config, failure.work_item_id),
  reason_codes: [reasonCodeFromPublicationFailure(failure.reason)],
})

const outcomeToAuditEntry = (
  config: SigningCustodyPublicationAuditExportConfig,
  outcome: SigningCustodyPublicationAuditOutcome,
): SigningCustodyAuditEntry => {
  const metadata = config.resolveMetadata(outcome)

  return {
    audit_event_id: `audit:signing-custody:${outcome.work_item_id}:${outcome.publication_result}`,
    artifact_id: outcome.artifact_id,
    artifact_type: outcome.artifact_type,
    artifact_version: outcome.artifact_version,
    artifact_hash: outcome.artifact_hash,
    root_program_id: outcome.root_program_id,
    ...(outcome.delegated_authority_id
      ? { delegated_authority_id: outcome.delegated_authority_id }
      : {}),
    ...(outcome.issuer_id ? { issuer_id: outcome.issuer_id } : {}),
    signer_id: metadata.signer_id,
    key_id: metadata.key_id,
    algorithm_id: metadata.algorithm_id,
    custody_provider_ref: metadata.custody_provider_ref,
    provider_audit_id: metadata.provider_audit_id,
    automation_identity: config.automationIdentity ?? config.workerReport.worker_id,
    requested_at: outcome.requested_at,
    publication_result: outcome.publication_result,
    ...(outcome.reason_codes ? { reason_codes: outcome.reason_codes } : {}),
  }
}

const requestedAt = (
  config: SigningCustodyPublicationAuditExportConfig,
  workItemId: string,
): string => config.requestedAtByWorkItemId?.[workItemId] ?? config.generatedAt

const requiredString = (
  value: string | undefined,
  failure: ArtifactPublicationFailure,
  field: string,
): string => {
  if (!value?.trim()) {
    throw new Error(
      `Artifact publication failure ${failure.work_item_id} is missing ${field} for signing custody audit export`,
    )
  }

  return value
}

const requiredNumber = (
  value: number | undefined,
  failure: ArtifactPublicationFailure,
  field: string,
): number => {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new Error(
      `Artifact publication failure ${failure.work_item_id} is missing ${field} for signing custody audit export`,
    )
  }

  return value
}
