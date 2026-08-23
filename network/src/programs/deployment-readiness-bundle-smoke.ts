import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { Console, Effect } from "effect"

import {
  DEPLOYMENT_READINESS_BUNDLE_FILE_ROLES,
  DEPLOYMENT_READINESS_CHECK_IDS,
  type DeploymentReadinessBundleFileSource,
  type DeploymentReadinessCheckId,
  type DeploymentReadinessEvidenceRef,
  makeDeploymentReadinessBundle,
  makeDeploymentReadinessReport,
} from "../index.js"

const ROOT_DIR = fileURLToPath(new URL("../../../", import.meta.url))
const SMOKE_DIR = `${mkdtempSync(join(tmpdir(), "qrtrust-network-readiness-bundle-smoke-"))}/`
const REPORT_JSON = `${SMOKE_DIR}network-readiness-report.json`
const REPORT_MARKDOWN = `${SMOKE_DIR}network-readiness-report.md`
const BROKEN_EVIDENCE_MAP = `${SMOKE_DIR}broken-deployment-readiness-evidence-map.json`
const UNKNOWN_CHECK_EVIDENCE_MAP =
  `${SMOKE_DIR}unknown-check-deployment-readiness-evidence-map.json`
const MALFORMED_EVIDENCE_REF_MAP =
  `${SMOKE_DIR}malformed-ref-deployment-readiness-evidence-map.json`
const MALFORMED_EVIDENCE_REVIEW_DATE_MAP =
  `${SMOKE_DIR}malformed-review-date-deployment-readiness-evidence-map.json`
const BROKEN_SCANNER_FLEET_PACKET = `${SMOKE_DIR}broken-scanner-fleet-evidence.json`
const BROKEN_CROSS_SURFACE_QR_EVIDENCE_PACKET =
  `${SMOKE_DIR}broken-cross-surface-qr-evidence.json`
const BROKEN_WORKER_OPERATIONS_EVIDENCE_PACKET =
  `${SMOKE_DIR}broken-worker-operations-evidence.json`
const BROKEN_RESTORE_AUTOMATION_EVIDENCE_PACKET =
  `${SMOKE_DIR}broken-restore-automation-evidence.json`
const BROKEN_PACKAGED_DEPLOYMENT_APPROVAL_EVIDENCE_PACKET =
  `${SMOKE_DIR}broken-packaged-deployment-approval-evidence.json`
const BROKEN_OPERATOR_EVIDENCE_INDEX =
  `${SMOKE_DIR}broken-operator-evidence-index.json`
const BROKEN_SIGNING_CUSTODY_PUBLICATION_AUDIT_EXPORT =
  `${SMOKE_DIR}broken-signing-custody-publication-audit-export.json`
const PRODUCTION_ENV_TEMPLATE = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/deployment-readiness.production.env.example",
    import.meta.url,
  ),
)
const EVIDENCE_MAP = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/deployment-readiness.evidence.example.json",
    import.meta.url,
  ),
)
const OPERATOR_GUIDE = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/deployment-readiness-operator-guide.md",
    import.meta.url,
  ),
)
const SIGNING_CUSTODY_AUDIT_EXPORT_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/signing-custody-audit-export.md",
    import.meta.url,
  ),
)
const SIGNING_CUSTODY_PUBLICATION_AUDIT_EXPORT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/signing-custody-publication-audit-export-reference.json",
    import.meta.url,
  ),
)
const SCANNER_DECISION_RUNTIME_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/scanner-decision-http-runtime.md",
    import.meta.url,
  ),
)
const VERIFIER_PROFILE_DISTRIBUTION_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/verifier-profile-distribution.md",
    import.meta.url,
  ),
)
const SCANNER_FLEET_EVIDENCE_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/scanner-fleet-evidence.md",
    import.meta.url,
  ),
)
const SCANNER_FLEET_EVIDENCE_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json",
    import.meta.url,
  ),
)
const CROSS_SURFACE_QR_EVIDENCE_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/cross-surface-qr-evidence.md",
    import.meta.url,
  ),
)
const CROSS_SURFACE_QR_EVIDENCE_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/cross-surface-qr-evidence-reference.json",
    import.meta.url,
  ),
)
const WORKER_OPERATIONS_EVIDENCE_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/worker-operations-evidence.md",
    import.meta.url,
  ),
)
const WORKER_OPERATIONS_EVIDENCE_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/worker-operations-evidence-reference.json",
    import.meta.url,
  ),
)
const RESTORE_AUTOMATION_EVIDENCE_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/restore-automation-evidence.md",
    import.meta.url,
  ),
)
const RESTORE_AUTOMATION_EVIDENCE_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/restore-automation-evidence-reference.json",
    import.meta.url,
  ),
)
const PACKAGED_DEPLOYMENT_APPROVAL_EVIDENCE_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/packaged-deployment-approval-evidence.md",
    import.meta.url,
  ),
)
const PACKAGED_DEPLOYMENT_APPROVAL_EVIDENCE_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/packaged-deployment-approval-evidence-reference.json",
    import.meta.url,
  ),
)
const OPERATOR_EVIDENCE_INDEX_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/operator-evidence-index.md",
    import.meta.url,
  ),
)
const OPERATOR_EVIDENCE_INDEX_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/operator-evidence-index-reference.json",
    import.meta.url,
  ),
)

const program = Effect.gen(function* () {
  const report = makeDeploymentReadinessReport({
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

  yield* writeSmokeFile(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`)
  yield* writeSmokeFile(
    REPORT_MARKDOWN,
    `# Smoke Readiness Report\n\nStatus: ${report.status}\n`,
  )
  yield* writeSmokeFile(
    BROKEN_EVIDENCE_MAP,
    `${JSON.stringify(
      {
        postgres_source_of_truth: [
          {
            label: "Only one evidence ref is not enough for a production-ready bundle",
            uri: "ops://qrtrust/smoke/postgres_source_of_truth",
            owner: "QR Trust operator",
            reviewed_at: "2026-05-20",
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
  yield* writeSmokeFile(
    UNKNOWN_CHECK_EVIDENCE_MAP,
    `${JSON.stringify(
      {
        postgres_source_of_truth: [
          {
            label: "Smoke evidence for postgres_source_of_truth",
            uri: "ops://qrtrust/smoke/postgres_source_of_truth",
            owner: "QR Trust operator",
            reviewed_at: "2026-05-20",
          },
        ],
        unmodeled_operator_control: [
          {
            label: "Unknown controls must be modeled before bundle handoff",
            uri: "ops://qrtrust/smoke/unmodeled_operator_control",
            owner: "QR Trust operator",
            reviewed_at: "2026-05-20",
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
  yield* writeSmokeFile(
    MALFORMED_EVIDENCE_REF_MAP,
    `${JSON.stringify(
      {
        postgres_source_of_truth: [
          {
            label: "Malformed evidence refs must fail closed",
            uri: "ops://qrtrust/smoke/postgres_source_of_truth",
            owner: "",
            reviewed_at: "2026-05-20",
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
  yield* writeSmokeFile(
    MALFORMED_EVIDENCE_REVIEW_DATE_MAP,
    `${JSON.stringify(
      {
        postgres_source_of_truth: [
          {
            label: "Review dates must be machine-checkable",
            uri: "ops://qrtrust/smoke/postgres_source_of_truth",
            owner: "QR Trust operator",
            reviewed_at: "pending-review",
          },
        ],
      },
      null,
      2,
    )}\n`,
  )
  yield* writeSmokeFile(
    BROKEN_SCANNER_FLEET_PACKET,
    `${JSON.stringify(
      {
        artifact_type: "scanner_fleet_evidence_packet",
        packet_id: "broken",
      },
      null,
      2,
    )}\n`,
  )
  yield* writeSmokeFile(
    BROKEN_CROSS_SURFACE_QR_EVIDENCE_PACKET,
    `${JSON.stringify(
      {
        artifact_type: "cross_surface_qr_evidence_packet",
        bundle_id: "broken",
      },
      null,
      2,
    )}\n`,
  )
  yield* writeSmokeFile(
    BROKEN_WORKER_OPERATIONS_EVIDENCE_PACKET,
    `${JSON.stringify(
      {
        artifact_type: "worker_operations_evidence_packet",
        packet_id: "broken",
      },
      null,
      2,
    )}\n`,
  )
  yield* writeSmokeFile(
    BROKEN_RESTORE_AUTOMATION_EVIDENCE_PACKET,
    `${JSON.stringify(
      {
        artifact_type: "restore_automation_evidence_packet",
        packet_id: "broken",
      },
      null,
      2,
    )}\n`,
  )
  yield* writeSmokeFile(
    BROKEN_PACKAGED_DEPLOYMENT_APPROVAL_EVIDENCE_PACKET,
    `${JSON.stringify(
      {
        artifact_type: "packaged_deployment_approval_evidence_packet",
        packet_id: "broken",
      },
      null,
      2,
    )}\n`,
  )
  yield* writeSmokeFile(
    BROKEN_OPERATOR_EVIDENCE_INDEX,
    `${JSON.stringify(
      {
        artifact_type: "operator_evidence_index",
        index_id: "broken",
      },
      null,
      2,
    )}\n`,
  )
  yield* writeSmokeFile(
    BROKEN_SIGNING_CUSTODY_PUBLICATION_AUDIT_EXPORT,
    `${JSON.stringify(
      {
        artifact_type: "signing_custody_audit_export",
        schema_version: "2026-05-21",
        export_id: "broken",
        generated_at: "2026-05-20T00:00:00.000Z",
        scope: { root_program_id: "root:qrtrust-demo:2026" },
        redaction_status: "public_safe",
        entries: [],
        summary: {
          entry_count: 0,
          published: 0,
          rejected: 0,
          failed: 0,
          pending: 0,
          provider_refs: [],
        },
      },
      null,
      2,
    )}\n`,
  )

  const bundle = makeDeploymentReadinessBundle({
    rootDir: ROOT_DIR,
    generatedAt: "2026-05-20T00:00:00.000Z",
    reportJsonPath: REPORT_JSON,
    files: bundleFileSources(),
  })

  yield* assertSmoke(
    bundle.artifact_type === "deployment_readiness_bundle",
    "bundle artifact type should be stable",
  )
  yield* assertSmoke(
    bundle.report.status === "ready_for_production_drill",
    "bundle should summarize the readiness report status",
  )
  yield* assertSmoke(
    DEPLOYMENT_READINESS_BUNDLE_FILE_ROLES.every((role) =>
      bundle.files.some((file) => file.role === role),
    ),
    "bundle should include every required handoff file role",
  )
  yield* assertSmoke(
    bundle.files.every(
      (file) => file.bytes > 0 && /^[a-f0-9]{64}$/.test(file.sha256),
    ),
    "bundle should fingerprint every handoff file",
  )
  yield* assertSmoke(
    throwsMissingRole(),
    "bundle should fail closed when a required role is missing",
  )
  yield* assertSmoke(
    throwsIncompleteProductionEvidenceMap(),
    "bundle should fail closed when a production evidence map is incomplete",
  )
  yield* assertSmoke(
    throwsUnknownProductionEvidenceMapCheckId(),
    "bundle should fail closed when a production evidence map contains an unknown check id",
  )
  yield* assertSmoke(
    throwsMalformedProductionEvidenceRefs(),
    "bundle should fail closed when a production evidence map contains malformed refs",
  )
  yield* assertSmoke(
    throwsMalformedProductionEvidenceReviewDate(),
    "bundle should fail closed when a production evidence map contains a malformed review date",
  )
  yield* assertSmoke(
    throwsMalformedScannerFleetEvidencePacket(),
    "bundle should fail closed when scanner-fleet evidence is malformed",
  )
  yield* assertSmoke(
    throwsMalformedCrossSurfaceQrEvidencePacket(),
    "bundle should fail closed when cross-surface QR evidence is malformed",
  )
  yield* assertSmoke(
    throwsMalformedWorkerOperationsEvidencePacket(),
    "bundle should fail closed when worker-operations evidence is malformed",
  )
  yield* assertSmoke(
    throwsMalformedRestoreAutomationEvidencePacket(),
    "bundle should fail closed when restore-automation evidence is malformed",
  )
  yield* assertSmoke(
    throwsMalformedPackagedDeploymentApprovalEvidencePacket(),
    "bundle should fail closed when packaged-deployment approval evidence is malformed",
  )
  yield* assertSmoke(
    throwsMalformedOperatorEvidenceIndex(),
    "bundle should fail closed when operator evidence index is malformed",
  )
  yield* assertSmoke(
    throwsMalformedSigningCustodyPublicationAuditExport(),
    "bundle should fail closed when publication-backed custody audit evidence is malformed",
  )

  yield* Console.log(
    JSON.stringify(
      {
        status: bundle.report.status,
        files: bundle.files.map((file) => file.role),
      },
      null,
      2,
    ),
  )
})

const writeSmokeFile = (
  path: string,
  content: string,
): Effect.Effect<void> =>
  Effect.sync(() => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, "utf8")
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
          label: `Smoke evidence for ${checkId}`,
          uri: `ops://qrtrust/smoke/${checkId}`,
          owner: "QR Trust operator",
          reviewed_at: "2026-05-20",
        },
      ],
    }),
    {} as Record<DeploymentReadinessCheckId, ReadonlyArray<DeploymentReadinessEvidenceRef>>,
  )

const throwsMissingRole = (): boolean => {
  try {
    makeDeploymentReadinessBundle({
      rootDir: ROOT_DIR,
      generatedAt: "2026-05-20T00:00:00.000Z",
      reportJsonPath: REPORT_JSON,
      files: bundleFileSources().slice(0, 2),
    })
    return false
  } catch (error) {
    return error instanceof Error
      && error.message.includes("missing required file roles")
  }
}

const throwsIncompleteProductionEvidenceMap = (): boolean => {
  try {
    makeDeploymentReadinessBundle({
      rootDir: ROOT_DIR,
      generatedAt: "2026-05-20T00:00:00.000Z",
      reportJsonPath: REPORT_JSON,
      files: bundleFileSources({
        evidence_map: BROKEN_EVIDENCE_MAP,
      }),
    })
    return false
  } catch (error) {
    return error instanceof Error
      && error.message.includes(
        "evidence_map is missing production evidence refs",
      )
  }
}

const throwsUnknownProductionEvidenceMapCheckId = (): boolean => {
  try {
    makeDeploymentReadinessBundle({
      rootDir: ROOT_DIR,
      generatedAt: "2026-05-20T00:00:00.000Z",
      reportJsonPath: REPORT_JSON,
      files: bundleFileSources({
        evidence_map: UNKNOWN_CHECK_EVIDENCE_MAP,
      }),
    })
    return false
  } catch (error) {
    return error instanceof Error
      && error.message.includes(
        "evidence_map contains unknown readiness check id",
      )
  }
}

const throwsMalformedProductionEvidenceRefs = (): boolean => {
  try {
    makeDeploymentReadinessBundle({
      rootDir: ROOT_DIR,
      generatedAt: "2026-05-20T00:00:00.000Z",
      reportJsonPath: REPORT_JSON,
      files: bundleFileSources({
        evidence_map: MALFORMED_EVIDENCE_REF_MAP,
      }),
    })
    return false
  } catch (error) {
    return error instanceof Error
      && error.message.includes(
        "evidence_map has malformed evidence refs",
      )
  }
}

const throwsMalformedProductionEvidenceReviewDate = (): boolean => {
  try {
    makeDeploymentReadinessBundle({
      rootDir: ROOT_DIR,
      generatedAt: "2026-05-20T00:00:00.000Z",
      reportJsonPath: REPORT_JSON,
      files: bundleFileSources({
        evidence_map: MALFORMED_EVIDENCE_REVIEW_DATE_MAP,
      }),
    })
    return false
  } catch (error) {
    return error instanceof Error
      && error.message.includes(
        "evidence_map has malformed evidence refs",
      )
  }
}

const throwsMalformedScannerFleetEvidencePacket = (): boolean => {
  try {
    makeDeploymentReadinessBundle({
      rootDir: ROOT_DIR,
      generatedAt: "2026-05-20T00:00:00.000Z",
      reportJsonPath: REPORT_JSON,
      files: bundleFileSources({
        scanner_fleet_evidence_packet: BROKEN_SCANNER_FLEET_PACKET,
      }),
    })
    return false
  } catch (error) {
    return error instanceof Error
      && error.message.includes(
        "scanner_fleet_evidence_packet failed semantic validation",
      )
  }
}

const throwsMalformedCrossSurfaceQrEvidencePacket = (): boolean => {
  try {
    makeDeploymentReadinessBundle({
      rootDir: ROOT_DIR,
      generatedAt: "2026-05-20T00:00:00.000Z",
      reportJsonPath: REPORT_JSON,
      files: bundleFileSources({
        cross_surface_qr_evidence_packet: BROKEN_CROSS_SURFACE_QR_EVIDENCE_PACKET,
      }),
    })
    return false
  } catch (error) {
    return error instanceof Error
      && error.message.includes(
        "cross_surface_qr_evidence_packet failed semantic validation",
      )
  }
}

const throwsMalformedWorkerOperationsEvidencePacket = (): boolean => {
  try {
    makeDeploymentReadinessBundle({
      rootDir: ROOT_DIR,
      generatedAt: "2026-05-20T00:00:00.000Z",
      reportJsonPath: REPORT_JSON,
      files: bundleFileSources({
        worker_operations_evidence_packet: BROKEN_WORKER_OPERATIONS_EVIDENCE_PACKET,
      }),
    })
    return false
  } catch (error) {
    return error instanceof Error
      && error.message.includes(
        "worker_operations_evidence_packet failed semantic validation",
      )
  }
}

const throwsMalformedRestoreAutomationEvidencePacket = (): boolean => {
  try {
    makeDeploymentReadinessBundle({
      rootDir: ROOT_DIR,
      generatedAt: "2026-05-20T00:00:00.000Z",
      reportJsonPath: REPORT_JSON,
      files: bundleFileSources({
        restore_automation_evidence_packet: BROKEN_RESTORE_AUTOMATION_EVIDENCE_PACKET,
      }),
    })
    return false
  } catch (error) {
    return error instanceof Error
      && error.message.includes(
        "restore_automation_evidence_packet failed semantic validation",
      )
  }
}

const throwsMalformedPackagedDeploymentApprovalEvidencePacket = (): boolean => {
  try {
    makeDeploymentReadinessBundle({
      rootDir: ROOT_DIR,
      generatedAt: "2026-05-20T00:00:00.000Z",
      reportJsonPath: REPORT_JSON,
      files: bundleFileSources({
        packaged_deployment_approval_evidence_packet:
          BROKEN_PACKAGED_DEPLOYMENT_APPROVAL_EVIDENCE_PACKET,
      }),
    })
    return false
  } catch (error) {
    return error instanceof Error
      && error.message.includes(
        "packaged_deployment_approval_evidence_packet failed semantic validation",
      )
  }
}

const throwsMalformedOperatorEvidenceIndex = (): boolean => {
  try {
    makeDeploymentReadinessBundle({
      rootDir: ROOT_DIR,
      generatedAt: "2026-05-20T00:00:00.000Z",
      reportJsonPath: REPORT_JSON,
      files: bundleFileSources({
        operator_evidence_index_packet: BROKEN_OPERATOR_EVIDENCE_INDEX,
      }),
    })
    return false
  } catch (error) {
    return error instanceof Error
      && error.message.includes(
        "operator_evidence_index_packet failed semantic validation",
      )
  }
}

const throwsMalformedSigningCustodyPublicationAuditExport = (): boolean => {
  try {
    makeDeploymentReadinessBundle({
      rootDir: ROOT_DIR,
      generatedAt: "2026-05-20T00:00:00.000Z",
      reportJsonPath: REPORT_JSON,
      files: bundleFileSources({
        signing_custody_publication_audit_export:
          BROKEN_SIGNING_CUSTODY_PUBLICATION_AUDIT_EXPORT,
      }),
    })
    return false
  } catch (error) {
    return error instanceof Error
      && error.message.includes(
        "signing_custody_publication_audit_export failed semantic validation",
      )
  }
}

const bundleFileSources = (
  overrides: Partial<Record<
    (typeof DEPLOYMENT_READINESS_BUNDLE_FILE_ROLES)[number],
    string
  >> = {},
): ReadonlyArray<DeploymentReadinessBundleFileSource> => {
  const sources: ReadonlyArray<DeploymentReadinessBundleFileSource> = [
    { role: "readiness_json_report", path: REPORT_JSON },
    { role: "readiness_markdown_report", path: REPORT_MARKDOWN },
    { role: "production_env_template", path: PRODUCTION_ENV_TEMPLATE },
    { role: "evidence_map", path: EVIDENCE_MAP },
    { role: "operator_guide", path: OPERATOR_GUIDE },
    {
      role: "signing_custody_audit_export_contract",
      path: SIGNING_CUSTODY_AUDIT_EXPORT_CONTRACT,
    },
    {
      role: "signing_custody_publication_audit_export",
      path: SIGNING_CUSTODY_PUBLICATION_AUDIT_EXPORT,
    },
    {
      role: "scanner_decision_runtime_contract",
      path: SCANNER_DECISION_RUNTIME_CONTRACT,
    },
    {
      role: "verifier_profile_distribution_contract",
      path: VERIFIER_PROFILE_DISTRIBUTION_CONTRACT,
    },
    {
      role: "scanner_fleet_evidence_contract",
      path: SCANNER_FLEET_EVIDENCE_CONTRACT,
    },
    {
      role: "scanner_fleet_evidence_packet",
      path: SCANNER_FLEET_EVIDENCE_PACKET,
    },
    {
      role: "cross_surface_qr_evidence_contract",
      path: CROSS_SURFACE_QR_EVIDENCE_CONTRACT,
    },
    {
      role: "cross_surface_qr_evidence_packet",
      path: CROSS_SURFACE_QR_EVIDENCE_PACKET,
    },
    {
      role: "worker_operations_evidence_contract",
      path: WORKER_OPERATIONS_EVIDENCE_CONTRACT,
    },
    {
      role: "worker_operations_evidence_packet",
      path: WORKER_OPERATIONS_EVIDENCE_PACKET,
    },
    {
      role: "restore_automation_evidence_contract",
      path: RESTORE_AUTOMATION_EVIDENCE_CONTRACT,
    },
    {
      role: "restore_automation_evidence_packet",
      path: RESTORE_AUTOMATION_EVIDENCE_PACKET,
    },
    {
      role: "packaged_deployment_approval_evidence_contract",
      path: PACKAGED_DEPLOYMENT_APPROVAL_EVIDENCE_CONTRACT,
    },
    {
      role: "packaged_deployment_approval_evidence_packet",
      path: PACKAGED_DEPLOYMENT_APPROVAL_EVIDENCE_PACKET,
    },
    {
      role: "operator_evidence_index_contract",
      path: OPERATOR_EVIDENCE_INDEX_CONTRACT,
    },
    {
      role: "operator_evidence_index_packet",
      path: OPERATOR_EVIDENCE_INDEX_PACKET,
    },
  ]

  return sources.map((source) => ({
    ...source,
    path: overrides[source.role] ?? source.path,
  }))
}

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Deployment readiness bundle smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
