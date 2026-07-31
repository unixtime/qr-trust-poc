import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

import { Console, Effect } from "effect"

import {
  assertOperatorEvidenceIndex,
  assertProductionEvidenceCollectionTemplate,
  assertProductionEvidenceCollectionTemplateMatches,
  assertProductionEvidenceGapReport,
  assertProductionEvidenceGapReportMatches,
  assertProductionEvidenceRequirements,
  type DeploymentReadinessBundle,
  type OperatorEvidenceIndex,
  type ProductionEvidenceCollectionTemplate,
  type ProductionEvidenceGapReport,
  type ProductionEvidenceRequirements,
  type ReferenceNetworkAdoptionStageGate,
} from "../index.js"

const ROOT_DIR = fileURLToPath(new URL("../../../", import.meta.url))
const DEFAULT_OUTPUT = fileURLToPath(
  new URL("../../../local/reference-network-handoff-bundle.json", import.meta.url),
)
const DEFAULT_ADOPTION_JSON = fileURLToPath(
  new URL("../../../local/reference-network-adoption-stage.json", import.meta.url),
)
const DEFAULT_ADOPTION_MARKDOWN = fileURLToPath(
  new URL("../../../local/reference-network-adoption-stage.md", import.meta.url),
)
const DEFAULT_ADOPTION_GAP_MAP = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/production-adoption-gap-map.md",
    import.meta.url,
  ),
)
const DEFAULT_NETWORK_ARCHITECTURE_PLAN = fileURLToPath(
  new URL("../../../docs/public/NETWORK_ARCHITECTURE_PLAN.md", import.meta.url),
)
const DEFAULT_READINESS_BUNDLE = fileURLToPath(
  new URL("../../../local/network-readiness-bundle.json", import.meta.url),
)
const DEFAULT_READINESS_REPORT_JSON = fileURLToPath(
  new URL("../../../local/network-readiness-report.json", import.meta.url),
)
const DEFAULT_READINESS_REPORT_MARKDOWN = fileURLToPath(
  new URL("../../../local/network-readiness-report.md", import.meta.url),
)
const DEFAULT_OPERATOR_EVIDENCE_INDEX_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/operator-evidence-index-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_PRODUCTION_OPERATOR_EVIDENCE_INDEX_PACKET = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/operator-evidence-index-production-candidate.json",
    import.meta.url,
  ),
)
const DEFAULT_PRODUCTION_EVIDENCE_REQUIREMENTS_JSON = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/production-evidence-requirements-reference.json",
    import.meta.url,
  ),
)
const DEFAULT_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_JSON = fileURLToPath(
  new URL(
    "../../../local/production-evidence-collection-template.json",
    import.meta.url,
  ),
)
const DEFAULT_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_MARKDOWN = fileURLToPath(
  new URL(
    "../../../local/production-evidence-collection-template.md",
    import.meta.url,
  ),
)
const DEFAULT_PRODUCTION_EVIDENCE_GAP_JSON = fileURLToPath(
  new URL("../../../local/production-evidence-gap-report.json", import.meta.url),
)
const DEFAULT_PRODUCTION_EVIDENCE_GAP_MARKDOWN = fileURLToPath(
  new URL("../../../local/production-evidence-gap-report.md", import.meta.url),
)

const HANDOFF_FILE_ROLES = [
  "adoption_stage_json_report",
  "adoption_stage_markdown_report",
  "production_adoption_gap_map",
  "network_architecture_plan",
  "deployment_readiness_bundle",
  "deployment_readiness_json_report",
  "deployment_readiness_markdown_report",
  "operator_evidence_index_packet",
  "production_operator_evidence_index_packet",
  "production_evidence_requirements_json",
  "production_evidence_collection_template_json",
  "production_evidence_collection_template_markdown",
  "production_evidence_gap_json_report",
  "production_evidence_gap_markdown_report",
] as const

type HandoffFileRole = (typeof HANDOFF_FILE_ROLES)[number]

interface HandoffFileSource {
  readonly role: HandoffFileRole
  readonly path: string
}

interface HandoffFile {
  readonly role: HandoffFileRole
  readonly path: string
  readonly sha256: string
  readonly bytes: number
}

interface ReferenceNetworkHandoffBundle {
  readonly artifact_type: "reference_network_handoff_bundle"
  readonly schema_version: "2026-05-22"
  readonly generated_at: string
  readonly bundle_role: "reference_network_stage_and_readiness_handoff"
  readonly adoption: {
    readonly stage: ReferenceNetworkAdoptionStageGate["stage"]
    readonly stage_name: ReferenceNetworkAdoptionStageGate["stage_name"]
    readonly claim_mode: ReferenceNetworkAdoptionStageGate["claim_mode"]
    readonly status: ReferenceNetworkAdoptionStageGate["status"]
    readonly blocking_boundaries: ReferenceNetworkAdoptionStageGate[
      "blocking_boundaries"
    ]
    readonly warning_boundaries: ReferenceNetworkAdoptionStageGate[
      "warning_boundaries"
    ]
  }
  readonly readiness: DeploymentReadinessBundle["report"]
  readonly files: ReadonlyArray<HandoffFile>
  readonly review_notes: ReadonlyArray<string>
}

const program = Effect.gen(function* () {
  const outputPath =
    process.env.QRTRUST_REFERENCE_HANDOFF_BUNDLE_JSON ?? DEFAULT_OUTPUT
  const adoptionReportPath =
    process.env.QRTRUST_REFERENCE_HANDOFF_ADOPTION_JSON ?? DEFAULT_ADOPTION_JSON
  const readinessBundlePath =
    process.env.QRTRUST_REFERENCE_HANDOFF_READINESS_BUNDLE_JSON
    ?? DEFAULT_READINESS_BUNDLE
  const operatorEvidenceIndexPath =
    process.env.QRTRUST_REFERENCE_HANDOFF_OPERATOR_EVIDENCE_INDEX_PACKET
    ?? DEFAULT_OPERATOR_EVIDENCE_INDEX_PACKET
  const productionOperatorEvidenceIndexPath =
    process.env
      .QRTRUST_REFERENCE_HANDOFF_PRODUCTION_OPERATOR_EVIDENCE_INDEX_PACKET
    ?? DEFAULT_PRODUCTION_OPERATOR_EVIDENCE_INDEX_PACKET
  const productionEvidenceRequirementsPath =
    process.env.QRTRUST_REFERENCE_HANDOFF_PRODUCTION_EVIDENCE_REQUIREMENTS_JSON
    ?? DEFAULT_PRODUCTION_EVIDENCE_REQUIREMENTS_JSON
  const productionEvidenceCollectionTemplatePath =
    process.env
      .QRTRUST_REFERENCE_HANDOFF_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_JSON
    ?? DEFAULT_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_JSON
  const productionEvidenceGapPath =
    process.env.QRTRUST_REFERENCE_HANDOFF_PRODUCTION_EVIDENCE_GAP_JSON
    ?? DEFAULT_PRODUCTION_EVIDENCE_GAP_JSON

  const adoption = readAdoptionStageGate(adoptionReportPath)
  const readiness = readDeploymentReadinessBundle(readinessBundlePath)
  assertCompatibleClaims(adoption, readiness)

  const bundle = makeReferenceNetworkHandoffBundle({
    adoption,
    readiness,
    generatedAt:
      process.env.QRTRUST_REFERENCE_HANDOFF_GENERATED_AT
      ?? new Date().toISOString(),
    files: [
      {
        role: "adoption_stage_json_report",
        path: adoptionReportPath,
      },
      {
        role: "adoption_stage_markdown_report",
        path: process.env.QRTRUST_REFERENCE_HANDOFF_ADOPTION_MD
          ?? DEFAULT_ADOPTION_MARKDOWN,
      },
      {
        role: "production_adoption_gap_map",
        path: process.env.QRTRUST_REFERENCE_HANDOFF_ADOPTION_GAP_MAP
          ?? DEFAULT_ADOPTION_GAP_MAP,
      },
      {
        role: "network_architecture_plan",
        path: process.env.QRTRUST_REFERENCE_HANDOFF_NETWORK_ARCHITECTURE_PLAN
          ?? DEFAULT_NETWORK_ARCHITECTURE_PLAN,
      },
      {
        role: "deployment_readiness_bundle",
        path: readinessBundlePath,
      },
      {
        role: "deployment_readiness_json_report",
        path: process.env.QRTRUST_REFERENCE_HANDOFF_READINESS_REPORT_JSON
          ?? DEFAULT_READINESS_REPORT_JSON,
      },
      {
        role: "deployment_readiness_markdown_report",
        path: process.env.QRTRUST_REFERENCE_HANDOFF_READINESS_REPORT_MD
          ?? DEFAULT_READINESS_REPORT_MARKDOWN,
      },
      {
        role: "operator_evidence_index_packet",
        path: operatorEvidenceIndexPath,
      },
      {
        role: "production_operator_evidence_index_packet",
        path: productionOperatorEvidenceIndexPath,
      },
      {
        role: "production_evidence_requirements_json",
        path: productionEvidenceRequirementsPath,
      },
      {
        role: "production_evidence_collection_template_json",
        path: productionEvidenceCollectionTemplatePath,
      },
      {
        role: "production_evidence_collection_template_markdown",
        path: process.env
          .QRTRUST_REFERENCE_HANDOFF_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_MD
          ?? DEFAULT_PRODUCTION_EVIDENCE_COLLECTION_TEMPLATE_MARKDOWN,
      },
      {
        role: "production_evidence_gap_json_report",
        path: productionEvidenceGapPath,
      },
      {
        role: "production_evidence_gap_markdown_report",
        path: process.env.QRTRUST_REFERENCE_HANDOFF_PRODUCTION_EVIDENCE_GAP_MD
          ?? DEFAULT_PRODUCTION_EVIDENCE_GAP_MARKDOWN,
      },
    ],
  })

  yield* writeBundle(outputPath, `${JSON.stringify(bundle, null, 2)}\n`)
  yield* Console.log(
    JSON.stringify(
      {
        status: bundle.adoption.status,
        stage: bundle.adoption.stage_name,
        claim_mode: bundle.adoption.claim_mode,
        readiness: bundle.readiness.status,
        files: bundle.files.length,
        output: outputPath,
      },
      null,
      2,
    ),
  )
})

interface ReferenceNetworkHandoffBundleConfig {
  readonly adoption: ReferenceNetworkAdoptionStageGate
  readonly readiness: DeploymentReadinessBundle
  readonly generatedAt: string
  readonly files: ReadonlyArray<HandoffFileSource>
}

const makeReferenceNetworkHandoffBundle = (
  config: ReferenceNetworkHandoffBundleConfig,
): ReferenceNetworkHandoffBundle => {
  const files = config.files.map((file) => fingerprintFile(file))
  assertRequiredRoles(files)
  assertProductionEvidenceHandoffConsistency(config.files)

  return {
    artifact_type: "reference_network_handoff_bundle",
    schema_version: "2026-05-22",
    generated_at: config.generatedAt,
    bundle_role: "reference_network_stage_and_readiness_handoff",
    adoption: {
      stage: config.adoption.stage,
      stage_name: config.adoption.stage_name,
      claim_mode: config.adoption.claim_mode,
      status: config.adoption.status,
      blocking_boundaries: config.adoption.blocking_boundaries,
      warning_boundaries: config.adoption.warning_boundaries,
    },
    readiness: config.readiness.report,
    files,
    review_notes: makeReviewNotes(config.adoption, config.readiness),
  }
}

const readAdoptionStageGate = (path: string): ReferenceNetworkAdoptionStageGate => {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!isAdoptionStageGate(parsed)) {
    throw new Error(
      `Reference handoff expected an adoption-stage report JSON object at ${path}`,
    )
  }

  return parsed
}

const readDeploymentReadinessBundle = (
  path: string,
): DeploymentReadinessBundle => {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!isDeploymentReadinessBundle(parsed)) {
    throw new Error(
      `Reference handoff expected a deployment-readiness bundle JSON object at ${path}`,
    )
  }

  return parsed
}

const isAdoptionStageGate = (
  value: unknown,
): value is ReferenceNetworkAdoptionStageGate =>
  isRecord(value)
  && value.artifact_type === "reference_network_adoption_stage_gate"
  && typeof value.stage === "number"
  && typeof value.stage_name === "string"
  && typeof value.claim_mode === "string"
  && typeof value.status === "string"
  && Array.isArray(value.blocking_boundaries)
  && Array.isArray(value.warning_boundaries)
  && Array.isArray(value.boundaries)

const isDeploymentReadinessBundle = (
  value: unknown,
): value is DeploymentReadinessBundle =>
  isRecord(value)
  && value.artifact_type === "deployment_readiness_bundle"
  && isRecord(value.report)
  && (value.report.mode === "reference" || value.report.mode === "production")
  && typeof value.report.status === "string"
  && Array.isArray(value.report.blocking_checks)
  && Array.isArray(value.report.warning_checks)
  && Array.isArray(value.files)

const assertCompatibleClaims = (
  adoption: ReferenceNetworkAdoptionStageGate,
  readiness: DeploymentReadinessBundle,
): void => {
  if (
    adoption.claim_mode === "production_candidate"
    && readiness.report.mode !== "production"
  ) {
    throw new Error(
      "Production-candidate adoption claims must be paired with a production-mode readiness bundle.",
    )
  }

  if (
    adoption.status === "ready_for_production_candidate"
    && readiness.report.status !== "ready_for_production_drill"
  ) {
    throw new Error(
      "Production-candidate handoff requires a readiness bundle that is ready_for_production_drill.",
    )
  }
}

const fingerprintFile = (file: HandoffFileSource): HandoffFile => {
  const content = readFileSync(file.path)
  validateHandoffFileContent(file, content.toString("utf8"))

  return {
    role: file.role,
    path: normalizePath(relative(ROOT_DIR, file.path)),
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: content.byteLength,
  }
}

const validateHandoffFileContent = (
  file: HandoffFileSource,
  content: string,
): void => {
  if (
    file.role === "operator_evidence_index_packet" ||
    file.role === "production_operator_evidence_index_packet"
  ) {
    const parsed: unknown = JSON.parse(content)
    assertOperatorEvidenceIndex(parsed as OperatorEvidenceIndex)
    if (
      file.role === "production_operator_evidence_index_packet" &&
      (parsed as OperatorEvidenceIndex).claim_mode !== "production_candidate"
    ) {
      throw new Error(
        "Reference handoff production operator evidence index packet must use claim_mode production_candidate",
      )
    }
    return
  }

  if (file.role === "production_evidence_requirements_json") {
    const parsed: unknown = JSON.parse(content)
    assertProductionEvidenceRequirements(parsed as ProductionEvidenceRequirements)
    return
  }

  if (file.role === "production_evidence_collection_template_json") {
    const parsed: unknown = JSON.parse(content)
    assertProductionEvidenceCollectionTemplate(
      parsed as ProductionEvidenceCollectionTemplate,
    )
    return
  }

  if (file.role === "production_evidence_gap_json_report") {
    const parsed: unknown = JSON.parse(content)
    assertProductionEvidenceGapReport(parsed as ProductionEvidenceGapReport)
  }
}

const assertProductionEvidenceHandoffConsistency = (
  files: ReadonlyArray<HandoffFileSource>,
): void => {
  const requirementsPath = requiredSourcePath(
    files,
    "production_evidence_requirements_json",
  )
  const gapReportPath = requiredSourcePath(
    files,
    "production_evidence_gap_json_report",
  )
  const collectionTemplatePath = requiredSourcePath(
    files,
    "production_evidence_collection_template_json",
  )
  const productionIndexPath = requiredSourcePath(
    files,
    "production_operator_evidence_index_packet",
  )

  const requirements = readJsonFile<ProductionEvidenceRequirements>(
    requirementsPath,
  )
  const collectionTemplate = readJsonFile<ProductionEvidenceCollectionTemplate>(
    collectionTemplatePath,
  )
  const gapReport = readJsonFile<ProductionEvidenceGapReport>(gapReportPath)
  const productionIndex = readJsonFile<OperatorEvidenceIndex>(
    productionIndexPath,
  )

  assertProductionEvidenceCollectionTemplateMatches(
    collectionTemplate,
    requirements,
  )
  assertProductionEvidenceGapReportMatches(
    gapReport,
    requirements,
    productionIndex,
  )
}

const requiredSourcePath = (
  files: ReadonlyArray<HandoffFileSource>,
  role: HandoffFileRole,
): string => {
  const match = files.find((file) => file.role === role)
  if (!match) {
    throw new Error(`Reference handoff bundle is missing required role ${role}`)
  }

  return match.path
}

const readJsonFile = <T>(path: string): T =>
  JSON.parse(readFileSync(path, "utf8")) as T

const assertRequiredRoles = (files: ReadonlyArray<HandoffFile>): void => {
  const roles = new Set(files.map((file) => file.role))
  const missingRoles = HANDOFF_FILE_ROLES.filter((role) => !roles.has(role))
  if (missingRoles.length > 0) {
    throw new Error(
      `Reference handoff bundle is missing required file roles: ${missingRoles.join(", ")}`,
    )
  }
}

const makeReviewNotes = (
  adoption: ReferenceNetworkAdoptionStageGate,
  readiness: DeploymentReadinessBundle,
): ReadonlyArray<string> => {
  const notes = [
    "The adoption-stage report and deployment-readiness bundle are separate claims and should be reviewed together.",
    "The handoff fingerprints public-safe reports and evidence indexes; operator-owned production evidence must remain outside the public repository.",
    "The production evidence collection template is a checklist for operators; placeholder refs are not proof.",
    "The production evidence gap report identifies missing operator-owned ops:// refs; it is an audit aid, not production evidence.",
  ]

  if (
    adoption.claim_mode === "production_candidate"
    && readiness.report.status === "ready_for_production_drill"
  ) {
    notes.push(
      "This handoff is suitable for a production-drill review, not for claiming a live ecosystem deployment.",
    )
  }

  return notes
}

const writeBundle = (path: string, content: string): Effect.Effect<void> =>
  Effect.sync(() => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  })

const normalizePath = (path: string): string => path.replaceAll("\\", "/")

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

Effect.runPromise(program).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
