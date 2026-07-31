export const SIGNING_CUSTODY_AUDIT_SCHEMA_VERSION = "2026-05-21" as const

export const SIGNING_CUSTODY_AUDIT_PUBLICATION_RESULTS = [
  "published",
  "rejected",
  "failed",
  "pending",
] as const

export type SigningCustodyAuditPublicationResult =
  (typeof SIGNING_CUSTODY_AUDIT_PUBLICATION_RESULTS)[number]

export interface SigningCustodyAuditScope {
  readonly root_program_id: string
  readonly delegated_authority_id?: string
  readonly issuer_id?: string
}

export interface SigningCustodyAuditEntry {
  readonly audit_event_id: string
  readonly artifact_id: string
  readonly artifact_type: string
  readonly artifact_version: number
  readonly artifact_hash: string
  readonly root_program_id: string
  readonly delegated_authority_id?: string
  readonly issuer_id?: string
  readonly signer_id: string
  readonly key_id: string
  readonly algorithm_id: string
  readonly custody_provider_ref: string
  readonly provider_audit_id: string
  readonly automation_identity: string
  readonly requested_at: string
  readonly publication_result: SigningCustodyAuditPublicationResult
  readonly reason_codes?: ReadonlyArray<string>
}

export interface SigningCustodyAuditSummary {
  readonly entry_count: number
  readonly published: number
  readonly rejected: number
  readonly failed: number
  readonly pending: number
  readonly provider_refs: ReadonlyArray<string>
}

export interface SigningCustodyAuditExport {
  readonly artifact_type: "signing_custody_audit_export"
  readonly schema_version: typeof SIGNING_CUSTODY_AUDIT_SCHEMA_VERSION
  readonly export_id: string
  readonly generated_at: string
  readonly scope: SigningCustodyAuditScope
  readonly redaction_status: "public_safe"
  readonly entries: ReadonlyArray<SigningCustodyAuditEntry>
  readonly summary: SigningCustodyAuditSummary
}

export interface SigningCustodyAuditExportConfig {
  readonly exportId: string
  readonly generatedAt: string
  readonly scope: SigningCustodyAuditScope
  readonly entries: ReadonlyArray<SigningCustodyAuditEntry>
}

const MANAGED_PROVIDER_REF_PREFIXES = [
  "kms://",
  "hsm://",
  "managed://",
] as const

const SHA256_FINGERPRINT_RE = /^sha256:[a-f0-9]{64}$/
const PRIVATE_MATERIAL_LEAK_TOKENS = [
  "-----BEGIN PRIVATE KEY-----",
  "-----END PRIVATE KEY-----",
  "pem://",
  "env://",
  "file://",
  "private_key",
  "private-key",
] as const

export const makeSigningCustodyAuditExport = (
  config: SigningCustodyAuditExportConfig,
): SigningCustodyAuditExport => {
  const exportArtifact: SigningCustodyAuditExport = {
    artifact_type: "signing_custody_audit_export",
    schema_version: SIGNING_CUSTODY_AUDIT_SCHEMA_VERSION,
    export_id: config.exportId,
    generated_at: config.generatedAt,
    scope: config.scope,
    redaction_status: "public_safe",
    entries: config.entries,
    summary: summarizeSigningCustodyAuditEntries(config.entries),
  }

  assertSigningCustodyAuditExport(exportArtifact)

  return exportArtifact
}

export const summarizeSigningCustodyAuditEntries = (
  entries: ReadonlyArray<SigningCustodyAuditEntry>,
): SigningCustodyAuditSummary => {
  const providerRefs = Array.from(
    new Set(entries.map((entry) => entry.custody_provider_ref)),
  ).sort()

  return {
    entry_count: entries.length,
    published: countResults(entries, "published"),
    rejected: countResults(entries, "rejected"),
    failed: countResults(entries, "failed"),
    pending: countResults(entries, "pending"),
    provider_refs: providerRefs,
  }
}

export const renderSigningCustodyAuditJsonl = (
  exportArtifact: SigningCustodyAuditExport,
): string => {
  assertSigningCustodyAuditExport(exportArtifact)

  return exportArtifact.entries
    .map((entry) => JSON.stringify(entry))
    .join("\n")
}

export const assertSigningCustodyAuditExport = (
  exportArtifact: SigningCustodyAuditExport,
): void => {
  assertNonEmpty(exportArtifact.export_id, "export_id")
  assertDateTime(exportArtifact.generated_at, "generated_at")
  assertNonEmpty(exportArtifact.scope.root_program_id, "scope.root_program_id")

  if (exportArtifact.schema_version !== SIGNING_CUSTODY_AUDIT_SCHEMA_VERSION) {
    throw new Error("Signing custody audit export schema_version is unsupported")
  }
  if (exportArtifact.redaction_status !== "public_safe") {
    throw new Error("Signing custody audit export must be public_safe")
  }
  if (exportArtifact.entries.length === 0) {
    throw new Error("Signing custody audit export requires at least one entry")
  }

  const seenAuditEventIds = new Set<string>()
  for (const entry of exportArtifact.entries) {
    assertSigningCustodyAuditEntry(entry, exportArtifact.scope)
    if (seenAuditEventIds.has(entry.audit_event_id)) {
      throw new Error(
        `Signing custody audit export duplicates event: ${entry.audit_event_id}`,
      )
    }
    seenAuditEventIds.add(entry.audit_event_id)
  }

  const expectedSummary = summarizeSigningCustodyAuditEntries(
    exportArtifact.entries,
  )
  assertSummaryMatches(exportArtifact.summary, expectedSummary)
  assertPublicSafe(exportArtifact)
}

const assertSigningCustodyAuditEntry = (
  entry: SigningCustodyAuditEntry,
  exportScope: SigningCustodyAuditScope,
): void => {
  assertNonEmpty(entry.audit_event_id, "audit_event_id")
  assertNonEmpty(entry.artifact_id, "artifact_id")
  assertNonEmpty(entry.artifact_type, "artifact_type")
  assertNonEmpty(entry.root_program_id, "root_program_id")
  assertNonEmpty(entry.signer_id, "signer_id")
  assertNonEmpty(entry.key_id, "key_id")
  assertNonEmpty(entry.algorithm_id, "algorithm_id")
  assertNonEmpty(entry.custody_provider_ref, "custody_provider_ref")
  assertNonEmpty(entry.provider_audit_id, "provider_audit_id")
  assertNonEmpty(entry.automation_identity, "automation_identity")
  assertDateTime(entry.requested_at, "requested_at")

  if (!Number.isInteger(entry.artifact_version) || entry.artifact_version < 1) {
    throw new Error(
      `Signing custody audit entry ${entry.audit_event_id} needs a positive artifact_version`,
    )
  }
  if (!SHA256_FINGERPRINT_RE.test(entry.artifact_hash)) {
    throw new Error(
      `Signing custody audit entry ${entry.audit_event_id} needs a sha256 artifact_hash`,
    )
  }
  if (!isManagedProviderRef(entry.custody_provider_ref)) {
    throw new Error(
      `Signing custody audit entry ${entry.audit_event_id} must use managed custody provider refs`,
    )
  }
  if (!isPublicationResult(entry.publication_result)) {
    throw new Error(
      `Signing custody audit entry ${entry.audit_event_id} has invalid publication_result`,
    )
  }
  if (entry.root_program_id !== exportScope.root_program_id) {
    throw new Error(
      `Signing custody audit entry ${entry.audit_event_id} is outside export root scope`,
    )
  }
  if (
    exportScope.delegated_authority_id
    && entry.delegated_authority_id !== exportScope.delegated_authority_id
  ) {
    throw new Error(
      `Signing custody audit entry ${entry.audit_event_id} is outside export authority scope`,
    )
  }
  if (exportScope.issuer_id && entry.issuer_id !== exportScope.issuer_id) {
    throw new Error(
      `Signing custody audit entry ${entry.audit_event_id} is outside export issuer scope`,
    )
  }
  if (
    entry.reason_codes
    && (entry.reason_codes.length === 0
      || entry.reason_codes.some((reasonCode) => !reasonCode.trim()))
  ) {
    throw new Error(
      `Signing custody audit entry ${entry.audit_event_id} reason_codes cannot contain empty values`,
    )
  }
}

const countResults = (
  entries: ReadonlyArray<SigningCustodyAuditEntry>,
  result: SigningCustodyAuditPublicationResult,
): number =>
  entries.filter((entry) => entry.publication_result === result).length

const assertSummaryMatches = (
  actual: SigningCustodyAuditSummary,
  expected: SigningCustodyAuditSummary,
): void => {
  const countFields = [
    "entry_count",
    "published",
    "rejected",
    "failed",
    "pending",
  ] as const

  for (const field of countFields) {
    if (actual[field] !== expected[field]) {
      throw new Error(
        `Signing custody audit summary ${field} must match entries`,
      )
    }
  }

  if (
    actual.provider_refs.length !== expected.provider_refs.length
    || actual.provider_refs.some(
      (providerRef, index) => providerRef !== expected.provider_refs[index],
    )
  ) {
    throw new Error(
      "Signing custody audit summary provider_refs must match entries",
    )
  }
}

const assertPublicSafe = (value: unknown): void => {
  const serialized = JSON.stringify(value).toLowerCase()
  for (const token of PRIVATE_MATERIAL_LEAK_TOKENS) {
    if (serialized.includes(token.toLowerCase())) {
      throw new Error(
        `Signing custody audit export contains private material marker: ${token}`,
      )
    }
  }
}

const assertNonEmpty = (value: string, field: string): void => {
  if (!value.trim()) {
    throw new Error(`Signing custody audit ${field} must be non-empty`)
  }
}

const assertDateTime = (value: string, field: string): void => {
  assertNonEmpty(value, field)
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    throw new Error(`Signing custody audit ${field} must be an ISO date-time`)
  }
}

const isManagedProviderRef = (value: string): boolean =>
  MANAGED_PROVIDER_REF_PREFIXES.some((prefix) => value.startsWith(prefix))

const isPublicationResult = (
  value: string,
): value is SigningCustodyAuditPublicationResult =>
  SIGNING_CUSTODY_AUDIT_PUBLICATION_RESULTS.some((result) => result === value)
