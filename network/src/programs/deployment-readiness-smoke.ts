import { readFileSync } from "node:fs"

import { Console, Effect } from "effect"

import {
  DEPLOYMENT_READINESS_CHECK_IDS,
  type DeploymentReadinessCheckId,
  type DeploymentReadinessEvidenceRef,
  makeDeploymentReadinessReport,
} from "../index.js"

const program = Effect.gen(function* () {
  const referenceReport = makeDeploymentReadinessReport({
    mode: "reference",
    scannerDecisionPersistenceEnabled: true,
  })

  const blockedProductionReport = makeDeploymentReadinessReport({
    mode: "production",
    scannerDecisionPersistenceEnabled: true,
    ...(process.env.QRTRUST_NETWORK_DATABASE_URL
      ? { postgresDatabaseUrl: process.env.QRTRUST_NETWORK_DATABASE_URL }
      : {}),
    ...(process.env.QRTRUST_NETWORK_NATS_URL
      ? { natsUrl: process.env.QRTRUST_NETWORK_NATS_URL }
      : {}),
  })

  const fixtureBlockedProductionReport = makeDeploymentReadinessReport({
    mode: "production",
    scannerDecisionPersistenceEnabled: true,
  })

  const productionDrillReport = makeDeploymentReadinessReport({
    mode: "production",
    postgresDatabaseUrl: "postgres://qrtrust.example/reference",
    migrationLedgerEnabled: true,
    restoreAutomationDocumented: true,
    packagedDeploymentOwnershipDocumented: true,
    natsUrl: "nats://qrtrust.example:4222",
    managedKeyMaterialProvider: "managed://qrtrust/key-material",
    managedSigningCustodyProvider: "managed://qrtrust/signing-custody",
    custodyAuditExportConfigured: true,
    runtimeSafetyProvider: "managed://qrtrust/runtime-safety",
    scannerDecisionPersistenceEnabled: true,
    workerOperationsEvidenceReady: true,
    operatorRunbooksDocumented: true,
    evidenceRefs: productionEvidenceRefs(),
  })

  yield* assertSmoke(
    referenceReport.status === "ready_for_reference_drill",
    "reference mode must stay usable without production-only providers",
  )
  yield* assertSmoke(
    referenceReport.warning_checks.includes("managed_signing_custody"),
    "reference mode should warn about missing production custody",
  )
  yield* assertSmoke(
    blockedProductionReport.status === "blocked_for_production",
    "production mode must block when production-owned controls are missing",
  )
  yield* assertSmoke(
    blockedProductionReport.blocking_checks.includes("managed_key_material"),
    "production mode must require managed key-material provider wiring",
  )
  yield* assertSmoke(
    blockedProductionReport.blocking_checks.includes(
      "runtime_safety_provider",
    ),
    "production mode must require a live runtime-safety provider",
  )
  yield* assertSmoke(
    productionDrillReport.status === "ready_for_production_drill",
    "production drill fixture should pass when all required controls are present",
  )
  yield* assertSmoke(
    productionDrillReport.checks.every(
      (check) => (check.evidence_refs ?? []).length > 0,
    ),
    "production drill fixture should require evidence refs for every passing check",
  )
  yield* assertSmoke(
    productionDrillReport.blocking_checks.length === 0,
    "production drill fixture should not leave blocking checks",
  )
  yield* assertReportMatchesExample(
    referenceReport,
    "deployment-readiness-reference.json",
  )
  yield* assertReportMatchesExample(
    fixtureBlockedProductionReport,
    "deployment-readiness-production-blocked.json",
  )
  yield* assertReportMatchesExample(
    productionDrillReport,
    "deployment-readiness-production-ready.json",
  )

  yield* Console.log(
    JSON.stringify(
      {
        reference: summarize(referenceReport),
        production_missing: summarize(blockedProductionReport),
        production_drill: summarize(productionDrillReport),
      },
      null,
      2,
    ),
  )
})

const summarize = (
  report: ReturnType<typeof makeDeploymentReadinessReport>,
) => ({
  mode: report.mode,
  status: report.status,
  blocking_checks: report.blocking_checks,
  warning_checks: report.warning_checks,
})

const productionEvidenceRefs = (): Record<
  DeploymentReadinessCheckId,
  ReadonlyArray<DeploymentReadinessEvidenceRef>
> =>
  DEPLOYMENT_READINESS_CHECK_IDS.reduce(
    (refs, checkId) => ({
      ...refs,
      [checkId]: [
        {
          label: evidenceLabels[checkId],
          uri: evidenceUris[checkId],
          owner: "QR Trust operator",
          reviewed_at: "2026-05-20",
        },
      ],
    }),
    {} as Record<DeploymentReadinessCheckId, ReadonlyArray<DeploymentReadinessEvidenceRef>>,
  )

const evidenceLabels: Record<DeploymentReadinessCheckId, string> = {
  postgres_source_of_truth: "Dedicated Postgres source-of-truth database",
  migration_ledger: "Migration ledger status gate",
  restore_automation: "Backup and restore drill",
  packaged_deployment_ownership: "Packaged deployment ownership",
  nats_propagation: "NATS JetStream propagation plan",
  managed_key_material: "Managed public-key material source",
  managed_signing_custody: "Managed signing custody provider",
  custody_audit_export: "Publication-backed signing custody audit export",
  runtime_safety_provider: "Runtime-safety provider integration",
  scanner_decision_persistence: "Scanner decision persistence evidence",
  worker_operations_evidence: "Worker operations evidence packet",
  operator_runbooks: "Operator runbook bundle",
}

const evidenceUris: Record<DeploymentReadinessCheckId, string> = {
  postgres_source_of_truth:
    "docs/public/network-contracts/reference-postgres-schema.sql",
  migration_ledger:
    "docs/public/network-contracts/postgres-migration-deployment-policy.md",
  restore_automation: "ops://qrtrust/restore-drill/2026-05-20",
  packaged_deployment_ownership:
    "docs/public/network-contracts/deployment-readiness-operator-guide.md",
  nats_propagation: "docs/public/network-contracts/nats-subjects.md",
  managed_key_material:
    "docs/public/network-contracts/managed-signing-custody-deployment-policy.md",
  managed_signing_custody:
    "docs/public/network-contracts/managed-signing-custody-deployment-policy.md",
  custody_audit_export:
    "docs/public/network-contracts/examples/signing-custody-publication-audit-export-reference.json",
  runtime_safety_provider:
    "docs/public/network-contracts/runtime-safety-provider-deployment-policy.md",
  scanner_decision_persistence:
    "docs/public/network-contracts/scanner-decision.schema.json",
  worker_operations_evidence:
    "docs/public/network-contracts/examples/worker-operations-evidence-reference.json",
  operator_runbooks:
    "docs/public/network-contracts/deployment-readiness-operator-guide.md",
}

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Deployment readiness smoke failed: ${message}`)
    }
  })

const assertReportMatchesExample = (
  report: ReturnType<typeof makeDeploymentReadinessReport>,
  exampleName: string,
): Effect.Effect<void> =>
  Effect.sync(() => {
    const example = JSON.parse(
      readFileSync(
        new URL(
          `../../../docs/public/network-contracts/examples/${exampleName}`,
          import.meta.url,
        ),
        "utf8",
      ),
    )

    if (JSON.stringify(report) !== JSON.stringify(example)) {
      throw new Error(
        `Deployment readiness smoke failed: generated report drifted from ${exampleName}`,
      )
    }
  })

Effect.runPromise(program)
