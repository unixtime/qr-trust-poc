import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { Console, Effect } from "effect"

import { makeDeploymentReadinessBundle } from "../index.js"

const ROOT_DIR = fileURLToPath(new URL("../../../", import.meta.url))
const DEFAULT_OUTPUT = fileURLToPath(
  new URL("../../../local/network-readiness-bundle.json", import.meta.url),
)
const DEFAULT_REPORT_JSON = fileURLToPath(
  new URL("../../../local/network-readiness-report.json", import.meta.url),
)
const DEFAULT_REPORT_MARKDOWN = fileURLToPath(
  new URL("../../../local/network-readiness-report.md", import.meta.url),
)
const DEFAULT_PRODUCTION_ENV_TEMPLATE = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/deployment-readiness.production.env.example",
    import.meta.url,
  ),
)
const DEFAULT_EVIDENCE_MAP = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/deployment-readiness.evidence.example.json",
    import.meta.url,
  ),
)
const DEFAULT_OPERATOR_GUIDE = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/deployment-readiness-operator-guide.md",
    import.meta.url,
  ),
)
const DEFAULT_SIGNING_CUSTODY_AUDIT_EXPORT_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/signing-custody-audit-export.md",
    import.meta.url,
  ),
)
const DEFAULT_SIGNING_CUSTODY_PUBLICATION_AUDIT_EXPORT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/signing-custody-publication-audit-export-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_SCANNER_DECISION_RUNTIME_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/scanner-decision-http-runtime.md",
    import.meta.url,
  ),
)
const DEFAULT_VERIFIER_PROFILE_DISTRIBUTION_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/verifier-profile-distribution.md",
    import.meta.url,
  ),
)
const DEFAULT_SCANNER_FLEET_EVIDENCE_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/scanner-fleet-evidence.md",
    import.meta.url,
  ),
)
const DEFAULT_SCANNER_FLEET_EVIDENCE_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_CROSS_SURFACE_QR_EVIDENCE_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/cross-surface-qr-evidence.md",
    import.meta.url,
  ),
)
const DEFAULT_CROSS_SURFACE_QR_EVIDENCE_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/cross-surface-qr-evidence-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_WORKER_OPERATIONS_EVIDENCE_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/worker-operations-evidence.md",
    import.meta.url,
  ),
)
const DEFAULT_WORKER_OPERATIONS_EVIDENCE_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/worker-operations-evidence-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_RESTORE_AUTOMATION_EVIDENCE_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/restore-automation-evidence.md",
    import.meta.url,
  ),
)
const DEFAULT_RESTORE_AUTOMATION_EVIDENCE_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/restore-automation-evidence-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_PACKAGED_DEPLOYMENT_APPROVAL_EVIDENCE_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/packaged-deployment-approval-evidence.md",
    import.meta.url,
  ),
)
const DEFAULT_PACKAGED_DEPLOYMENT_APPROVAL_EVIDENCE_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/packaged-deployment-approval-evidence-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_OPERATOR_EVIDENCE_INDEX_CONTRACT = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/operator-evidence-index.md",
    import.meta.url,
  ),
)
const DEFAULT_OPERATOR_EVIDENCE_INDEX_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/operator-evidence-index-reference.json",
    import.meta.url,
  ),
)

const program = Effect.gen(function* () {
  const outputPath =
    process.env.QRTRUST_DEPLOYMENT_READINESS_BUNDLE_JSON ?? DEFAULT_OUTPUT
  const bundle = makeDeploymentReadinessBundle({
    rootDir: ROOT_DIR,
    generatedAt:
      process.env.QRTRUST_DEPLOYMENT_READINESS_BUNDLE_GENERATED_AT
      ?? new Date().toISOString(),
    reportJsonPath:
      process.env.QRTRUST_DEPLOYMENT_READINESS_REPORT_JSON
      ?? DEFAULT_REPORT_JSON,
    files: [
      {
        role: "readiness_json_report",
        path: process.env.QRTRUST_DEPLOYMENT_READINESS_REPORT_JSON
          ?? DEFAULT_REPORT_JSON,
      },
      {
        role: "readiness_markdown_report",
        path: process.env.QRTRUST_DEPLOYMENT_READINESS_REPORT_MD
          ?? DEFAULT_REPORT_MARKDOWN,
      },
      {
        role: "production_env_template",
        path: process.env.QRTRUST_DEPLOYMENT_READINESS_PRODUCTION_ENV_TEMPLATE
          ?? DEFAULT_PRODUCTION_ENV_TEMPLATE,
      },
      {
        role: "evidence_map",
        path: process.env.QRTRUST_DEPLOYMENT_READINESS_EVIDENCE_MAP
          ?? DEFAULT_EVIDENCE_MAP,
      },
      {
        role: "operator_guide",
        path: process.env.QRTRUST_DEPLOYMENT_READINESS_OPERATOR_GUIDE
          ?? DEFAULT_OPERATOR_GUIDE,
      },
      {
        role: "signing_custody_audit_export_contract",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_SIGNING_CUSTODY_AUDIT_EXPORT_CONTRACT
          ?? DEFAULT_SIGNING_CUSTODY_AUDIT_EXPORT_CONTRACT,
      },
      {
        role: "signing_custody_publication_audit_export",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_SIGNING_CUSTODY_PUBLICATION_AUDIT_EXPORT
          ?? DEFAULT_SIGNING_CUSTODY_PUBLICATION_AUDIT_EXPORT,
      },
      {
        role: "scanner_decision_runtime_contract",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_SCANNER_DECISION_RUNTIME_CONTRACT
          ?? DEFAULT_SCANNER_DECISION_RUNTIME_CONTRACT,
      },
      {
        role: "verifier_profile_distribution_contract",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_VERIFIER_PROFILE_DISTRIBUTION_CONTRACT
          ?? DEFAULT_VERIFIER_PROFILE_DISTRIBUTION_CONTRACT,
      },
      {
        role: "scanner_fleet_evidence_contract",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_SCANNER_FLEET_EVIDENCE_CONTRACT
          ?? DEFAULT_SCANNER_FLEET_EVIDENCE_CONTRACT,
      },
      {
        role: "scanner_fleet_evidence_packet",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_SCANNER_FLEET_EVIDENCE_PACKET
          ?? DEFAULT_SCANNER_FLEET_EVIDENCE_PACKET,
      },
      {
        role: "cross_surface_qr_evidence_contract",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_CROSS_SURFACE_QR_EVIDENCE_CONTRACT
          ?? DEFAULT_CROSS_SURFACE_QR_EVIDENCE_CONTRACT,
      },
      {
        role: "cross_surface_qr_evidence_packet",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_CROSS_SURFACE_QR_EVIDENCE_PACKET
          ?? DEFAULT_CROSS_SURFACE_QR_EVIDENCE_PACKET,
      },
      {
        role: "worker_operations_evidence_contract",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_WORKER_OPERATIONS_EVIDENCE_CONTRACT
          ?? DEFAULT_WORKER_OPERATIONS_EVIDENCE_CONTRACT,
      },
      {
        role: "worker_operations_evidence_packet",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_WORKER_OPERATIONS_EVIDENCE_PACKET
          ?? DEFAULT_WORKER_OPERATIONS_EVIDENCE_PACKET,
      },
      {
        role: "restore_automation_evidence_contract",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_RESTORE_AUTOMATION_EVIDENCE_CONTRACT
          ?? DEFAULT_RESTORE_AUTOMATION_EVIDENCE_CONTRACT,
      },
      {
        role: "restore_automation_evidence_packet",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_RESTORE_AUTOMATION_EVIDENCE_PACKET
          ?? DEFAULT_RESTORE_AUTOMATION_EVIDENCE_PACKET,
      },
      {
        role: "packaged_deployment_approval_evidence_contract",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_PACKAGED_DEPLOYMENT_APPROVAL_EVIDENCE_CONTRACT
          ?? DEFAULT_PACKAGED_DEPLOYMENT_APPROVAL_EVIDENCE_CONTRACT,
      },
      {
        role: "packaged_deployment_approval_evidence_packet",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_PACKAGED_DEPLOYMENT_APPROVAL_EVIDENCE_PACKET
          ?? DEFAULT_PACKAGED_DEPLOYMENT_APPROVAL_EVIDENCE_PACKET,
      },
      {
        role: "operator_evidence_index_contract",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_OPERATOR_EVIDENCE_INDEX_CONTRACT
          ?? DEFAULT_OPERATOR_EVIDENCE_INDEX_CONTRACT,
      },
      {
        role: "operator_evidence_index_packet",
        path: process.env
          .QRTRUST_DEPLOYMENT_READINESS_OPERATOR_EVIDENCE_INDEX_PACKET
          ?? DEFAULT_OPERATOR_EVIDENCE_INDEX_PACKET,
      },
    ],
  })

  yield* Effect.sync(() => {
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8")
  })

  yield* Console.log(
    JSON.stringify(
      {
        status: bundle.report.status,
        mode: bundle.report.mode,
        files: bundle.files.length,
        output: outputPath,
      },
      null,
      2,
    ),
  )
})

Effect.runPromise(program)
