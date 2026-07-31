import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import type {
  ProductionEvidenceCollectionTemplate,
  ProductionEvidenceGapReport,
} from "../index.js"

const NETWORK_DIR = fileURLToPath(new URL("../../", import.meta.url))
const ROOT_DIR = fileURLToPath(new URL("../../../", import.meta.url))
const TEMP_DIR = mkdtempSync(join(tmpdir(), "qrtrust-handoff-smoke-"))

const PRODUCTION_ADOPTION_JSON = join(
  TEMP_DIR,
  "reference-network-adoption-production-drill-report.json",
)
const PRODUCTION_ADOPTION_MD = join(
  TEMP_DIR,
  "reference-network-adoption-production-drill-report.md",
)
const PRODUCTION_READINESS_BUNDLE = join(
  TEMP_DIR,
  "network-readiness-production-drill-bundle.json",
)
const PRODUCTION_READINESS_JSON = join(
  TEMP_DIR,
  "network-readiness-production-drill-report.json",
)
const PRODUCTION_READINESS_MD = join(
  TEMP_DIR,
  "network-readiness-production-drill-report.md",
)
const PRODUCTION_ADOPTION_EVIDENCE = join(
  ROOT_DIR,
  "docs/public/network-contracts/reference-network-adoption.evidence.example.json",
)
const PRODUCTION_READINESS_EVIDENCE = join(
  ROOT_DIR,
  "docs/public/network-contracts/deployment-readiness.evidence.example.json",
)
const REFERENCE_OPERATOR_INDEX = join(
  ROOT_DIR,
  "docs/public/network-contracts/examples/operator-evidence-index-reference.json",
)
const PRODUCTION_OPERATOR_INDEX = join(
  ROOT_DIR,
  "docs/public/network-contracts/examples/operator-evidence-index-production-candidate.json",
)
const PRODUCTION_REQUIREMENTS = join(
  ROOT_DIR,
  "docs/public/network-contracts/examples/production-evidence-requirements-reference.json",
)
const PRODUCTION_COLLECTION_TEMPLATE = join(
  TEMP_DIR,
  "production-evidence-collection-template.json",
)
const PRODUCTION_COLLECTION_TEMPLATE_MARKDOWN = join(
  TEMP_DIR,
  "production-evidence-collection-template.md",
)
const PRODUCTION_GAP_REPORT = join(
  TEMP_DIR,
  "production-evidence-gap-report.json",
)
const PRODUCTION_GAP_MARKDOWN = join(TEMP_DIR, "production-evidence-gap-report.md")

generateProductionDrillInputs()

const baseEnvironment = {
  ...process.env,
  QRTRUST_REFERENCE_HANDOFF_ADOPTION_JSON: PRODUCTION_ADOPTION_JSON,
  QRTRUST_REFERENCE_HANDOFF_ADOPTION_MD: PRODUCTION_ADOPTION_MD,
  QRTRUST_REFERENCE_HANDOFF_READINESS_BUNDLE_JSON: PRODUCTION_READINESS_BUNDLE,
  QRTRUST_REFERENCE_HANDOFF_READINESS_REPORT_JSON: PRODUCTION_READINESS_JSON,
  QRTRUST_REFERENCE_HANDOFF_READINESS_REPORT_MD: PRODUCTION_READINESS_MD,
  QRTRUST_REFERENCE_HANDOFF_OPERATOR_EVIDENCE_INDEX_PACKET:
    PRODUCTION_OPERATOR_INDEX,
  QRTRUST_REFERENCE_HANDOFF_PRODUCTION_OPERATOR_EVIDENCE_INDEX_PACKET:
    PRODUCTION_OPERATOR_INDEX,
  QRTRUST_REFERENCE_HANDOFF_PRODUCTION_EVIDENCE_REQUIREMENTS_JSON:
    PRODUCTION_REQUIREMENTS,
  QRTRUST_REFERENCE_HANDOFF_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_JSON:
    PRODUCTION_COLLECTION_TEMPLATE,
  QRTRUST_REFERENCE_HANDOFF_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_MD:
    PRODUCTION_COLLECTION_TEMPLATE_MARKDOWN,
  QRTRUST_REFERENCE_HANDOFF_PRODUCTION_EVIDENCE_GAP_JSON:
    PRODUCTION_GAP_REPORT,
  QRTRUST_REFERENCE_HANDOFF_PRODUCTION_EVIDENCE_GAP_MD:
    PRODUCTION_GAP_MARKDOWN,
  QRTRUST_REFERENCE_HANDOFF_BUNDLE_JSON: join(TEMP_DIR, "handoff.json"),
}

const happyPath = runBundle(baseEnvironment)
if (happyPath.status !== 0) {
  throw new Error(
    `Expected production-drill handoff bundle to pass.\n${happyPath.stderr}`,
  )
}

expectFailure(
  "reference operator evidence index cannot masquerade as production evidence",
  {
    ...baseEnvironment,
    QRTRUST_REFERENCE_HANDOFF_PRODUCTION_OPERATOR_EVIDENCE_INDEX_PACKET:
      REFERENCE_OPERATOR_INDEX,
    QRTRUST_REFERENCE_HANDOFF_BUNDLE_JSON: join(
      TEMP_DIR,
      "wrong-operator-index-handoff.json",
    ),
  },
  "claim_mode production_candidate",
)

const staleGapReportPath = join(TEMP_DIR, "stale-production-gap-report.json")
writeFileSync(
  staleGapReportPath,
  `${JSON.stringify(makeStaleGapReport(), null, 2)}\n`,
)

expectFailure(
  "stale gap report cannot be fingerprinted into a handoff",
  {
    ...baseEnvironment,
    QRTRUST_REFERENCE_HANDOFF_PRODUCTION_EVIDENCE_GAP_JSON: staleGapReportPath,
    QRTRUST_REFERENCE_HANDOFF_BUNDLE_JSON: join(
      TEMP_DIR,
      "stale-gap-handoff.json",
    ),
  },
  "stale or does not match",
)

const staleCollectionTemplatePath = join(
  TEMP_DIR,
  "stale-production-evidence-collection-template.json",
)
writeFileSync(
  staleCollectionTemplatePath,
  `${JSON.stringify(makeStaleCollectionTemplate(), null, 2)}\n`,
)

expectFailure(
  "stale collection template cannot be fingerprinted into a handoff",
  {
    ...baseEnvironment,
    QRTRUST_REFERENCE_HANDOFF_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_JSON:
      staleCollectionTemplatePath,
    QRTRUST_REFERENCE_HANDOFF_BUNDLE_JSON: join(
      TEMP_DIR,
      "stale-collection-template-handoff.json",
    ),
  },
  "stale or does not match",
)

console.log(
  JSON.stringify(
    {
      status: "ok",
      happy_path_bundle: baseEnvironment.QRTRUST_REFERENCE_HANDOFF_BUNDLE_JSON,
      rejected_cases: [
        "reference_operator_index_as_production_index",
        "stale_production_evidence_collection_template",
        "stale_production_evidence_gap_report",
      ],
    },
    null,
    2,
  ),
)

function runBundle(environment: NodeJS.ProcessEnv) {
  return runProgram("src/programs/reference-network-handoff-bundle.ts", environment)
}

function generateProductionDrillInputs(): void {
  runPrerequisite("src/programs/reference-network-adoption-stage.ts", {
    QRTRUST_ADOPTION_STAGE: "3",
    QRTRUST_ADOPTION_CLAIM_MODE: "production_candidate",
    QRTRUST_ADOPTION_REFERENCE_PRESET: "false",
    QRTRUST_ADOPTION_EVIDENCE_JSON: PRODUCTION_ADOPTION_EVIDENCE,
    QRTRUST_ADOPTION_OPERATOR_EVIDENCE_INDEX_JSON: PRODUCTION_OPERATOR_INDEX,
    QRTRUST_ADOPTION_POSTGRES_READY: "true",
    QRTRUST_ADOPTION_AUTHORITY_PUBLICATION_READY: "true",
    QRTRUST_ADOPTION_NATS_READY: "true",
    QRTRUST_ADOPTION_VERIFIER_CACHE_READY: "true",
    QRTRUST_ADOPTION_SCANNER_DECISION_READY: "true",
    QRTRUST_ADOPTION_SCANNER_FLEET_EVIDENCE_READY: "true",
    QRTRUST_ADOPTION_CROSS_SURFACE_EVIDENCE_READY: "true",
    QRTRUST_ADOPTION_WORKER_OPERATIONS_EVIDENCE_READY: "true",
    QRTRUST_ADOPTION_SIGNING_CUSTODY_AUDIT_EXPORT_READY: "true",
    QRTRUST_ADOPTION_SIGNING_CUSTODY_READY: "true",
    QRTRUST_ADOPTION_RUNTIME_SAFETY_READY: "true",
    QRTRUST_ADOPTION_OPERATOR_RUNBOOKS_READY: "true",
    QRTRUST_ADOPTION_BACKUP_RESTORE_READY: "true",
    QRTRUST_ADOPTION_EXTERNAL_GOVERNANCE_AUDIT_READY: "true",
    QRTRUST_ADOPTION_JSON: PRODUCTION_ADOPTION_JSON,
    QRTRUST_ADOPTION_MD: PRODUCTION_ADOPTION_MD,
  })

  runPrerequisite("src/programs/deployment-readiness-report.ts", {
    QRTRUST_DEPLOYMENT_READINESS_MODE: "production",
    QRTRUST_DEPLOYMENT_READINESS_EVIDENCE_JSON: PRODUCTION_READINESS_EVIDENCE,
    QRTRUST_NETWORK_DATABASE_URL: "postgres://qrtrust.example/reference",
    QRTRUST_MIGRATION_LEDGER_ENABLED: "true",
    QRTRUST_RESTORE_AUTOMATION_DOCUMENTED: "true",
    QRTRUST_PACKAGED_DEPLOYMENT_OWNERSHIP_DOCUMENTED: "true",
    QRTRUST_NETWORK_NATS_URL: "nats://qrtrust.example:4222",
    QRTRUST_MANAGED_KEY_MATERIAL_PROVIDER: "managed://qrtrust/key-material",
    QRTRUST_MANAGED_SIGNING_CUSTODY_PROVIDER:
      "managed://qrtrust/signing-custody",
    QRTRUST_CUSTODY_AUDIT_EXPORT_CONFIGURED: "true",
    QRTRUST_RUNTIME_SAFETY_PROVIDER: "managed://qrtrust/runtime-safety",
    QRTRUST_SCANNER_DECISION_PERSISTENCE_ENABLED: "true",
    QRTRUST_WORKER_OPERATIONS_EVIDENCE_READY: "true",
    QRTRUST_OPERATOR_RUNBOOKS_DOCUMENTED: "true",
    QRTRUST_DEPLOYMENT_READINESS_JSON: PRODUCTION_READINESS_JSON,
    QRTRUST_DEPLOYMENT_READINESS_MD: PRODUCTION_READINESS_MD,
  })

  runPrerequisite("src/programs/deployment-readiness-bundle.ts", {
    QRTRUST_DEPLOYMENT_READINESS_REPORT_JSON: PRODUCTION_READINESS_JSON,
    QRTRUST_DEPLOYMENT_READINESS_REPORT_MD: PRODUCTION_READINESS_MD,
    QRTRUST_DEPLOYMENT_READINESS_OPERATOR_EVIDENCE_INDEX_PACKET:
      PRODUCTION_OPERATOR_INDEX,
    QRTRUST_DEPLOYMENT_READINESS_BUNDLE_JSON: PRODUCTION_READINESS_BUNDLE,
  })

  runPrerequisite("src/programs/production-evidence-gap-report.ts", {
    QRTRUST_PRODUCTION_EVIDENCE_REQUIREMENTS_JSON: PRODUCTION_REQUIREMENTS,
    QRTRUST_PRODUCTION_EVIDENCE_INDEX_JSON: PRODUCTION_OPERATOR_INDEX,
    QRTRUST_PRODUCTION_EVIDENCE_GAP_JSON: PRODUCTION_GAP_REPORT,
    QRTRUST_PRODUCTION_EVIDENCE_GAP_MD: PRODUCTION_GAP_MARKDOWN,
  })

  runPrerequisite("src/programs/production-evidence-collection-template.ts", {
    QRTRUST_PRODUCTION_EVIDENCE_REQUIREMENTS_JSON: PRODUCTION_REQUIREMENTS,
    QRTRUST_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_JSON:
      PRODUCTION_COLLECTION_TEMPLATE,
    QRTRUST_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_MD:
      PRODUCTION_COLLECTION_TEMPLATE_MARKDOWN,
    QRTRUST_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_GENERATED_AT:
      "2026-05-22T00:00:00Z",
  })
}

function runPrerequisite(
  program: string,
  environment: NodeJS.ProcessEnv,
): void {
  const result = runProgram(program, environment)
  if (result.status !== 0) {
    throw new Error(
      `Expected handoff smoke prerequisite to pass: ${program}\n${result.stdout}\n${result.stderr}`,
    )
  }
}

function runProgram(program: string, environment: NodeJS.ProcessEnv) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", program],
    {
      cwd: NETWORK_DIR,
      env: {
        ...process.env,
        ...environment,
      },
      encoding: "utf8",
    },
  )
}

function makeStaleGapReport(): ProductionEvidenceGapReport {
  const report = JSON.parse(
    readFileSync(PRODUCTION_GAP_REPORT, "utf8"),
  ) as ProductionEvidenceGapReport

  return {
    ...report,
    next_actions: [...report.next_actions, "Synthetic stale report marker."],
  }
}

function makeStaleCollectionTemplate(): ProductionEvidenceCollectionTemplate {
  const template = JSON.parse(
    readFileSync(PRODUCTION_COLLECTION_TEMPLATE, "utf8"),
  ) as ProductionEvidenceCollectionTemplate

  return {
    ...template,
    controls: template.controls.map((control, index) =>
      index === 0
        ? {
            ...control,
            evidence_slots: control.evidence_slots.slice(1),
          }
        : control,
    ),
  }
}

function expectFailure(
  label: string,
  environment: NodeJS.ProcessEnv,
  expectedMessage: string,
): void {
  const result = runBundle(environment)
  if (result.status === 0) {
    throw new Error(`Expected handoff bundle smoke failure: ${label}`)
  }

  const output = `${result.stdout}\n${result.stderr}`
  if (!output.includes(expectedMessage)) {
    throw new Error(
      `Expected handoff bundle smoke failure "${label}" to include "${expectedMessage}".\n${output}`,
    )
  }
}
