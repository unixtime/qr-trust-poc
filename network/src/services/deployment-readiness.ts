export type DeploymentReadinessMode = "reference" | "production"

export type DeploymentReadinessStatus =
  | "ready_for_reference_drill"
  | "blocked_for_production"
  | "ready_for_production_drill"

export type DeploymentReadinessCheckStatus = "pass" | "warn" | "block"

export type DeploymentReadinessCheckId =
  | "postgres_source_of_truth"
  | "migration_ledger"
  | "restore_automation"
  | "packaged_deployment_ownership"
  | "nats_propagation"
  | "managed_key_material"
  | "managed_signing_custody"
  | "custody_audit_export"
  | "runtime_safety_provider"
  | "scanner_decision_persistence"
  | "worker_operations_evidence"
  | "operator_runbooks"

export const DEPLOYMENT_READINESS_CHECK_IDS = [
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
] as const satisfies ReadonlyArray<DeploymentReadinessCheckId>

export interface DeploymentReadinessConfig {
  readonly mode: DeploymentReadinessMode
  readonly postgresDatabaseUrl?: string
  readonly migrationLedgerEnabled?: boolean
  readonly restoreAutomationDocumented?: boolean
  readonly packagedDeploymentOwnershipDocumented?: boolean
  readonly natsUrl?: string
  readonly managedKeyMaterialProvider?: string
  readonly managedSigningCustodyProvider?: string
  readonly custodyAuditExportConfigured?: boolean
  readonly runtimeSafetyProvider?: string
  readonly scannerDecisionPersistenceEnabled?: boolean
  readonly workerOperationsEvidenceReady?: boolean
  readonly operatorRunbooksDocumented?: boolean
  readonly evidenceRefs?: Partial<
    Record<DeploymentReadinessCheckId, ReadonlyArray<DeploymentReadinessEvidenceRef>>
  >
}

export interface DeploymentReadinessEvidenceRef {
  readonly label: string
  readonly uri: string
  readonly owner: string
  readonly reviewed_at: string
}

export interface DeploymentReadinessCheck {
  readonly id: DeploymentReadinessCheckId
  readonly layer: string
  readonly title: string
  readonly status: DeploymentReadinessCheckStatus
  readonly evidence: string
  readonly remediation?: string
  readonly evidence_refs?: ReadonlyArray<DeploymentReadinessEvidenceRef>
}

export interface DeploymentReadinessReport {
  readonly artifact_type: "deployment_readiness_report"
  readonly schema_version: "2026-05-20"
  readonly mode: DeploymentReadinessMode
  readonly status: DeploymentReadinessStatus
  readonly blocking_checks: ReadonlyArray<DeploymentReadinessCheckId>
  readonly warning_checks: ReadonlyArray<DeploymentReadinessCheckId>
  readonly checks: ReadonlyArray<DeploymentReadinessCheck>
}

export const makeDeploymentReadinessReport = (
  config: DeploymentReadinessConfig,
): DeploymentReadinessReport => {
  const production = config.mode === "production"
  const checks: ReadonlyArray<DeploymentReadinessCheck> = [
    productionRequiredCheck({
      production,
      id: "postgres_source_of_truth",
      layer: "Source of truth",
      title: "Postgres trust-state store",
      present: Boolean(config.postgresDatabaseUrl),
      referenceEvidence:
        "Reference mode can use the local shared-infra database or deterministic smokes.",
      productionEvidence: config.postgresDatabaseUrl
        ? "Production database URL is configured."
        : "Production source-of-truth database is not configured.",
      evidenceRefs: config.evidenceRefs?.postgres_source_of_truth,
      remediation:
        "Configure a dedicated QR Trust Postgres database and keep publisher or other app databases separate.",
    }),
    productionRequiredCheck({
      production,
      id: "migration_ledger",
      layer: "Schema ownership",
      title: "Migration ledger gate",
      present: Boolean(config.migrationLedgerEnabled),
      referenceEvidence:
        "Reference schema and migration status checks are available in the repo.",
      productionEvidence: config.migrationLedgerEnabled
        ? "Migration ledger gate is enabled."
        : "Migration ledger gate is not enabled.",
      evidenceRefs: config.evidenceRefs?.migration_ledger,
      remediation:
        "Apply and verify reference migrations through the migration ledger before workers write state.",
    }),
    productionRequiredCheck({
      production,
      id: "restore_automation",
      layer: "Operations",
      title: "Backup and restore automation",
      present: Boolean(config.restoreAutomationDocumented),
      referenceEvidence:
        "Reference mode documents restore as deployment-owned work.",
      productionEvidence: config.restoreAutomationDocumented
        ? "Restore automation is documented."
        : "Restore automation is not documented.",
      evidenceRefs: config.evidenceRefs?.restore_automation,
      remediation:
        "Add backup execution, restore drill, and rollback ownership before production deployment.",
    }),
    productionRequiredCheck({
      production,
      id: "packaged_deployment_ownership",
      layer: "Operations",
      title: "Packaged deployment ownership",
      present: Boolean(config.packagedDeploymentOwnershipDocumented),
      referenceEvidence:
        "Reference mode can run from local compose and scripted smokes without a packaged release owner.",
      productionEvidence: config.packagedDeploymentOwnershipDocumented
        ? "Packaged deployment ownership is documented."
        : "Packaged deployment ownership is not documented.",
      evidenceRefs: config.evidenceRefs?.packaged_deployment_ownership,
      remediation:
        "Assign owners for deployable artifacts, image provenance, release approval, environment promotion, and rollback before production deployment.",
    }),
    productionRequiredCheck({
      production,
      id: "nats_propagation",
      layer: "Propagation",
      title: "NATS JetStream propagation",
      present: Boolean(config.natsUrl),
      referenceEvidence:
        "Reference mode can validate event subjects without requiring a live broker.",
      productionEvidence: config.natsUrl
        ? "NATS propagation URL is configured."
        : "NATS propagation URL is not configured.",
      evidenceRefs: config.evidenceRefs?.nats_propagation,
      remediation:
        "Configure NATS JetStream for propagation after Postgres-backed artifacts are durable.",
    }),
    productionRequiredCheck({
      production,
      id: "managed_key_material",
      layer: "Verifier cache",
      title: "Managed public-key material source",
      present: Boolean(config.managedKeyMaterialProvider),
      referenceEvidence:
        "Fixture, environment, filesystem, and managed key-material ports are available for tests.",
      productionEvidence: config.managedKeyMaterialProvider
        ? `Managed key-material provider configured: ${config.managedKeyMaterialProvider}.`
        : "Managed key-material provider is not configured.",
      evidenceRefs: config.evidenceRefs?.managed_key_material,
      remediation:
        "Wire KMS, HSM, or another managed source for public verification material references.",
    }),
    productionRequiredCheck({
      production,
      id: "managed_signing_custody",
      layer: "Artifact issuance",
      title: "Managed signing custody",
      present: Boolean(config.managedSigningCustodyProvider),
      referenceEvidence:
        "Fixture, environment, filesystem, static, and managed custody ports are contract-tested.",
      productionEvidence: config.managedSigningCustodyProvider
        ? `Managed signing custody provider configured: ${config.managedSigningCustodyProvider}.`
        : "Managed signing custody provider is not configured.",
      evidenceRefs: config.evidenceRefs?.managed_signing_custody,
      remediation:
        "Move artifact signing into a managed KMS or HSM custody provider before production issuance.",
    }),
    productionRequiredCheck({
      production,
      id: "custody_audit_export",
      layer: "Artifact issuance",
      title: "Custody audit export",
      present: Boolean(config.custodyAuditExportConfigured),
      referenceEvidence:
        "Reference mode proves that private material is not exposed in signing results.",
      productionEvidence: config.custodyAuditExportConfigured
        ? "Custody audit export is configured."
        : "Custody audit export is not configured.",
      evidenceRefs: config.evidenceRefs?.custody_audit_export,
      remediation:
        "Export signing custody audit events to an operator-owned audit trail.",
    }),
    productionRequiredCheck({
      production,
      id: "runtime_safety_provider",
      layer: "Scan-time safety",
      title: "Live runtime-safety provider",
      present: Boolean(config.runtimeSafetyProvider),
      referenceEvidence:
        "Deterministic runtime-safety providers are sufficient for reproducible local tests.",
      productionEvidence: config.runtimeSafetyProvider
        ? `Runtime-safety provider configured: ${config.runtimeSafetyProvider}.`
        : "Live runtime-safety provider is not configured.",
      evidenceRefs: config.evidenceRefs?.runtime_safety_provider,
      remediation:
        "Configure a live safe-browsing, reputation, redirect, or TLS inspector with privacy boundaries.",
    }),
    productionRequiredCheck({
      production,
      id: "scanner_decision_persistence",
      layer: "Scanner decision",
      title: "Scanner-visible decision persistence",
      present: Boolean(config.scannerDecisionPersistenceEnabled),
      referenceEvidence:
        "Reference mode includes scanner decision contract and persistence smokes.",
      productionEvidence: config.scannerDecisionPersistenceEnabled
        ? "Scanner decision persistence is enabled."
        : "Scanner decision persistence is not enabled.",
      evidenceRefs: config.evidenceRefs?.scanner_decision_persistence,
      remediation:
        "Persist scanner-visible green, orange, and red outcomes for audit and review.",
    }),
    productionRequiredCheck({
      production,
      id: "worker_operations_evidence",
      layer: "Operations",
      title: "Worker operations evidence packet",
      present: Boolean(config.workerOperationsEvidenceReady),
      referenceEvidence:
        "Reference mode can run deterministic worker-operations evidence smokes without production supervisors.",
      productionEvidence: config.workerOperationsEvidenceReady
        ? "Worker operations evidence covers artifact publication, event outbox propagation, verifier-cache materialization, scanner runtime, monitoring, and replay/recovery drills."
        : "Worker operations evidence packet is not configured.",
      evidenceRefs: config.evidenceRefs?.worker_operations_evidence,
      remediation:
        "Attach a worker operations evidence packet before claiming production readiness.",
    }),
    productionRequiredCheck({
      production,
      id: "operator_runbooks",
      layer: "Operations",
      title: "Operator runbooks",
      present: Boolean(config.operatorRunbooksDocumented),
      referenceEvidence:
        "Reference mode documents the intended operator-owned boundaries.",
      productionEvidence: config.operatorRunbooksDocumented
        ? "Operator runbooks are documented."
        : "Operator runbooks are not documented.",
      evidenceRefs: config.evidenceRefs?.operator_runbooks,
      remediation:
        "Document issuance, key rotation, provider outage, worker recovery, and rollback procedures.",
    }),
  ]

  const blockingChecks = checks
    .filter((check) => check.status === "block")
    .map((check) => check.id)
  const warningChecks = checks
    .filter((check) => check.status === "warn")
    .map((check) => check.id)

  return {
    artifact_type: "deployment_readiness_report",
    schema_version: "2026-05-20",
    mode: config.mode,
    status: statusFor(config.mode, blockingChecks),
    blocking_checks: blockingChecks,
    warning_checks: warningChecks,
    checks,
  }
}

const productionRequiredCheck = (input: {
  readonly production: boolean
  readonly id: DeploymentReadinessCheckId
  readonly layer: string
  readonly title: string
  readonly present: boolean
  readonly referenceEvidence: string
  readonly productionEvidence: string
  readonly evidenceRefs: ReadonlyArray<DeploymentReadinessEvidenceRef> | undefined
  readonly remediation: string
}): DeploymentReadinessCheck => {
  if (input.production) {
    const evidenceRefs = input.evidenceRefs ?? []
    const presentWithEvidence = input.present && evidenceRefs.length > 0
    return {
      id: input.id,
      layer: input.layer,
      title: input.title,
      status: presentWithEvidence ? "pass" : "block",
      evidence: input.present && evidenceRefs.length === 0
        ? `${input.productionEvidence} Evidence references are missing.`
        : input.productionEvidence,
      ...(evidenceRefs.length > 0 ? { evidence_refs: evidenceRefs } : {}),
      ...(presentWithEvidence ? {} : { remediation: input.remediation }),
    }
  }

  return {
    id: input.id,
    layer: input.layer,
    title: input.title,
    status: input.present ? "pass" : "warn",
    evidence: input.present
      ? input.productionEvidence
      : input.referenceEvidence,
    ...(input.present ? {} : { remediation: input.remediation }),
  }
}

const statusFor = (
  mode: DeploymentReadinessMode,
  blockingChecks: ReadonlyArray<DeploymentReadinessCheckId>,
): DeploymentReadinessStatus => {
  if (mode === "reference") {
    return "ready_for_reference_drill"
  }

  return blockingChecks.length > 0
    ? "blocked_for_production"
    : "ready_for_production_drill"
}
