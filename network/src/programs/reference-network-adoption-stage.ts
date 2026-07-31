import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { Console, Effect } from "effect"

import {
  REFERENCE_NETWORK_ADOPTION_BOUNDARY_IDS,
  assertOperatorEvidenceIndex,
  assertReferenceNetworkAdoptionEvidenceCoverage,
  collectOperatorEvidenceRefs,
  makeReferenceNetworkAdoptionStageGate,
  type OperatorEvidenceIndex,
  type ReferenceNetworkAdoptionBoundary,
  type ReferenceNetworkAdoptionBoundaryId,
  type ReferenceNetworkAdoptionClaimMode,
  type ReferenceNetworkAdoptionEvidenceRef,
  type ReferenceNetworkAdoptionStage,
  type ReferenceNetworkAdoptionStageGate,
  type ReferenceNetworkAdoptionStageGateConfig,
} from "../index.js"
import { isEvidenceReviewDate } from "../services/evidence-review.js"

const DEFAULT_JSON_OUTPUT = fileURLToPath(
  new URL("../../../local/reference-network-adoption-stage.json", import.meta.url),
)
const DEFAULT_MARKDOWN_OUTPUT = fileURLToPath(
  new URL("../../../local/reference-network-adoption-stage.md", import.meta.url),
)

const program = Effect.gen(function* () {
  const gate = makeReferenceNetworkAdoptionStageGate(readConfigFromEnv())
  const operatorEvidenceIndex = readOperatorEvidenceIndexFromEnv()
  if (operatorEvidenceIndex) {
    assertOperatorEvidenceIndex(operatorEvidenceIndex)
    assertReferenceNetworkAdoptionEvidenceCoverage(
      gate,
      collectOperatorEvidenceRefs(operatorEvidenceIndex),
      operatorEvidenceIndex.index_id,
    )
  }
  const jsonPath = process.env.QRTRUST_ADOPTION_JSON ?? DEFAULT_JSON_OUTPUT
  const markdownPath =
    process.env.QRTRUST_ADOPTION_MD ?? DEFAULT_MARKDOWN_OUTPUT

  yield* writeReport(jsonPath, `${JSON.stringify(gate, null, 2)}\n`)
  yield* writeReport(markdownPath, renderMarkdown(gate))

  yield* Console.log(
    JSON.stringify(
      {
        status: gate.status,
        stage: gate.stage_name,
        claim_mode: gate.claim_mode,
        blocking_boundaries: gate.blocking_boundaries.length,
        warning_boundaries: gate.warning_boundaries.length,
        operator_evidence_index: operatorEvidenceIndex?.index_id ?? null,
        json: jsonPath,
        markdown: markdownPath,
      },
      null,
      2,
    ),
  )
})

const readConfigFromEnv = (): ReferenceNetworkAdoptionStageGateConfig => {
  const referencePreset = readBooleanEnv(
    "QRTRUST_ADOPTION_REFERENCE_PRESET",
    true,
  )
  const evidenceRefs = readEvidenceRefsFromEnv()
    ?? (referencePreset ? referenceEvidenceRefs() : undefined)

  return {
    ...(referencePreset ? stageOneReferencePreset() : {}),
    stage: readStage(),
    claimMode: readClaimMode(),
    generatedAt:
      process.env.QRTRUST_ADOPTION_GENERATED_AT ?? new Date().toISOString(),
    ...optionalBoolean(
      "postgresSourceOfTruthReady",
      "QRTRUST_ADOPTION_POSTGRES_READY",
    ),
    ...optionalBoolean(
      "authorityPublicationReady",
      "QRTRUST_ADOPTION_AUTHORITY_PUBLICATION_READY",
    ),
    ...optionalBoolean(
      "natsPropagationReady",
      "QRTRUST_ADOPTION_NATS_READY",
    ),
    ...optionalBoolean(
      "verifierCacheReadModelReady",
      "QRTRUST_ADOPTION_VERIFIER_CACHE_READY",
    ),
    ...optionalBoolean(
      "scannerDecisionRuntimeReady",
      "QRTRUST_ADOPTION_SCANNER_DECISION_READY",
    ),
    ...optionalBoolean(
      "scannerFleetEvidenceReady",
      "QRTRUST_ADOPTION_SCANNER_FLEET_EVIDENCE_READY",
    ),
    ...optionalBoolean(
      "crossSurfaceQrEvidenceReady",
      "QRTRUST_ADOPTION_CROSS_SURFACE_EVIDENCE_READY",
    ),
    ...optionalBoolean(
      "workerOperationsEvidenceReady",
      "QRTRUST_ADOPTION_WORKER_OPERATIONS_EVIDENCE_READY",
    ),
    ...optionalBoolean(
      "signingCustodyAuditExportReady",
      "QRTRUST_ADOPTION_SIGNING_CUSTODY_AUDIT_EXPORT_READY",
    ),
    ...optionalBoolean(
      "signingCustodyReady",
      "QRTRUST_ADOPTION_SIGNING_CUSTODY_READY",
    ),
    ...optionalBoolean(
      "runtimeSafetyProviderReady",
      "QRTRUST_ADOPTION_RUNTIME_SAFETY_READY",
    ),
    ...optionalBoolean(
      "operatorRunbooksReady",
      "QRTRUST_ADOPTION_OPERATOR_RUNBOOKS_READY",
    ),
    ...optionalBoolean(
      "backupRestoreReady",
      "QRTRUST_ADOPTION_BACKUP_RESTORE_READY",
    ),
    ...optionalBoolean(
      "externalGovernanceAuditReady",
      "QRTRUST_ADOPTION_EXTERNAL_GOVERNANCE_AUDIT_READY",
    ),
    ...(evidenceRefs ? { evidenceRefs } : {}),
  }
}

const stageOneReferencePreset = (): Partial<
  ReferenceNetworkAdoptionStageGateConfig
> => ({
  postgresSourceOfTruthReady: true,
  authorityPublicationReady: true,
  verifierCacheReadModelReady: true,
  scannerDecisionRuntimeReady: true,
  scannerFleetEvidenceReady: true,
  crossSurfaceQrEvidenceReady: true,
  workerOperationsEvidenceReady: true,
  signingCustodyAuditExportReady: true,
  operatorRunbooksReady: true,
  backupRestoreReady: true,
})

const readEvidenceRefsFromEnv = ():
  | NonNullable<ReferenceNetworkAdoptionStageGateConfig["evidenceRefs"]>
  | undefined => {
  const path = process.env.QRTRUST_ADOPTION_EVIDENCE_JSON?.trim()
  if (!path) {
    return undefined
  }

  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!isEvidenceRefMap(parsed)) {
    throw new Error(
      "QRTRUST_ADOPTION_EVIDENCE_JSON must point to a JSON object keyed by adoption boundary id.",
    )
  }

  return parsed
}

const readOperatorEvidenceIndexFromEnv = (): OperatorEvidenceIndex | undefined => {
  const path = process.env.QRTRUST_ADOPTION_OPERATOR_EVIDENCE_INDEX_JSON
    ?.trim()
  if (!path) {
    return undefined
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as OperatorEvidenceIndex
  assertOperatorEvidenceIndex(parsed)

  return parsed
}

const referenceEvidenceRefs = (): NonNullable<
  ReferenceNetworkAdoptionStageGateConfig["evidenceRefs"]
> => ({
  postgres_source_of_truth: [
    ref("Reference Postgres schema", "docs/public/network-contracts/reference-postgres-schema.sql"),
  ],
  authority_publication: [
    ref("Authority publication smoke", "network/src/programs/authority-publication-service-smoke.ts"),
  ],
  verifier_cache_read_model: [
    ref("Verifier cache read-model smoke", "network/src/programs/verifier-cache-read-model-worker-smoke.ts"),
  ],
  scanner_decision_runtime: [
    ref("Scanner decision runtime smoke", "network/src/programs/scanner-decision-http-runtime-smoke.ts"),
  ],
  scanner_fleet_evidence: [
    ref("Scanner fleet evidence packet", "docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json"),
  ],
  cross_surface_qr_evidence: [
    ref("Cross-surface QR evidence packet", "docs/public/network-contracts/examples/cross-surface-qr-evidence-reference.json"),
  ],
  worker_operations_evidence: [
    ref("Worker operations evidence packet", "docs/public/network-contracts/examples/worker-operations-evidence-reference.json"),
  ],
  signing_custody_audit_export: [
    ref("Publication-backed signing custody audit export", "docs/public/network-contracts/examples/signing-custody-publication-audit-export-reference.json"),
  ],
  operator_runbooks: [
    ref("Deployment readiness operator guide", "docs/public/network-contracts/deployment-readiness-operator-guide.md"),
  ],
  backup_restore: [
    ref("Migration and restore policy", "docs/public/network-contracts/postgres-migration-deployment-policy.md"),
  ],
})

const ref = (
  label: string,
  uri: string,
): ReferenceNetworkAdoptionEvidenceRef => ({
  label,
  uri,
  owner: "QR Trust reference maintainer",
  reviewed_at: "2026-05-21",
})

const isEvidenceRefMap = (
  value: unknown,
): value is NonNullable<ReferenceNetworkAdoptionStageGateConfig["evidenceRefs"]> => {
  if (!isRecord(value)) {
    return false
  }

  const boundaryIds = new Set<string>(REFERENCE_NETWORK_ADOPTION_BOUNDARY_IDS)
  return Object.keys(value).every((boundaryId) => boundaryIds.has(boundaryId))
    && Object.values(value).every(
      (refs) => Array.isArray(refs) && refs.every(isEvidenceRef),
    )
}

const isEvidenceRef = (
  value: unknown,
): value is ReferenceNetworkAdoptionEvidenceRef =>
  isRecord(value)
  && typeof value.label === "string"
  && value.label.trim().length > 0
  && typeof value.uri === "string"
  && value.uri.trim().length > 0
  && typeof value.owner === "string"
  && value.owner.trim().length > 0
  && isEvidenceReviewDate(value.reviewed_at)

const readStage = (): ReferenceNetworkAdoptionStage => {
  const rawValue = process.env.QRTRUST_ADOPTION_STAGE?.trim() ?? "1"
  const stage = Number(rawValue)
  if (stage === 0 || stage === 1 || stage === 2 || stage === 3) {
    return stage
  }

  throw new Error(
    `Unsupported QRTRUST_ADOPTION_STAGE '${rawValue}'. Use 0, 1, 2, or 3.`,
  )
}

const readClaimMode = (): ReferenceNetworkAdoptionClaimMode => {
  const mode = process.env.QRTRUST_ADOPTION_CLAIM_MODE ?? "reference_only"
  if (mode === "reference_only" || mode === "production_candidate") {
    return mode
  }

  throw new Error(
    `Unsupported QRTRUST_ADOPTION_CLAIM_MODE '${mode}'. Use 'reference_only' or 'production_candidate'.`,
  )
}

const optionalBoolean = <Key extends keyof ReferenceNetworkAdoptionStageGateConfig>(
  key: Key,
  envName: string,
): Partial<Pick<ReferenceNetworkAdoptionStageGateConfig, Key>> => {
  const value = readBooleanEnv(envName)
  return value === undefined
    ? {}
    : ({ [key]: value } as Partial<Pick<ReferenceNetworkAdoptionStageGateConfig, Key>>)
}

const readBooleanEnv = (
  envName: string,
  defaultValue?: boolean,
): boolean | undefined => {
  const rawValue = process.env[envName]?.trim().toLowerCase()
  if (!rawValue) {
    return defaultValue
  }

  if (["1", "true", "yes", "y", "enabled"].includes(rawValue)) {
    return true
  }

  if (["0", "false", "no", "n", "disabled"].includes(rawValue)) {
    return false
  }

  throw new Error(
    `${envName} must be a boolean value: true, false, yes, no, enabled, or disabled.`,
  )
}

const writeReport = (path: string, content: string): Effect.Effect<void> =>
  Effect.sync(() => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, "utf8")
  })

const renderMarkdown = (gate: ReferenceNetworkAdoptionStageGate): string => {
  const rows = gate.boundaries.map(renderBoundaryRow).join("\n")
  return `# QR Trust Reference Network Adoption Stage

Stage: \`${gate.stage}\` / \`${gate.stage_name}\`

Claim mode: \`${gate.claim_mode}\`

Status: \`${gate.status}\`

${renderVerdict(gate)}

## Blocking Boundaries

${renderBoundaryList(gate.blocking_boundaries)}

## Warning Boundaries

${renderBoundaryList(gate.warning_boundaries)}

## Boundary Matrix

| Layer | Boundary | Status | Evidence tier | Evidence | Remediation |
| --- | --- | --- | --- | --- | --- |
${rows}

## Evidence Tier Summary

${renderEvidenceTierSummary(gate)}

## Evidence References

${renderEvidenceRefs(gate)}

## Review Notes

${gate.review_notes.map((note) => `- ${note}`).join("\n")}

## Operator Notes

- This report is generated under \`local/\` and should not be committed.
- Stage 1 is a single-operator reference pilot, not federation or production custody.
- Managed KMS/HSM custody, live runtime safety, and external governance review remain later-stage requirements unless explicitly configured.
`
}

const renderVerdict = (gate: ReferenceNetworkAdoptionStageGate): string => {
  if (gate.status.startsWith("ready_for_stage_")) {
    return "Verdict: this reference implementation can claim the selected stage with the listed warnings."
  }

  if (gate.status === "ready_for_production_candidate") {
    return "Verdict: all modeled adoption boundaries passed for a production-candidate claim."
  }

  return "Verdict: blocked. Resolve the listed boundaries before making this stage claim."
}

const renderBoundaryList = (
  boundaries: ReadonlyArray<ReferenceNetworkAdoptionBoundaryId>,
): string => {
  if (boundaries.length === 0) {
    return "None."
  }

  return boundaries.map((boundary) => `- \`${boundary}\``).join("\n")
}

const renderBoundaryRow = (boundary: ReferenceNetworkAdoptionBoundary): string =>
  [
    boundary.layer,
    boundary.title,
    `\`${boundary.status}\``,
    `\`${boundary.evidence_tier}\``,
    boundary.evidence,
    boundary.remediation ?? "",
  ]
    .map(escapeMarkdownCell)
    .join(" | ")
    .replace(/^/, "| ")
    .replace(/$/, " |")

const escapeMarkdownCell = (value: string): string =>
  value.replace(/\|/g, "\\|").replace(/\n/g, " ")

const renderEvidenceRefs = (gate: ReferenceNetworkAdoptionStageGate): string => {
  const rows = gate.boundaries.flatMap((boundary) =>
    (boundary.evidence_refs ?? []).map(
      (ref) =>
        `- \`${boundary.id}\`: ${ref.label} (${ref.uri}) reviewed by ${ref.owner} on ${ref.reviewed_at}`,
    ),
  )

  return rows.length > 0 ? rows.join("\n") : "None."
}

const renderEvidenceTierSummary = (
  gate: ReferenceNetworkAdoptionStageGate,
): string => {
  const operatorBacked = gate.boundaries.filter(
    (boundary) => boundary.evidence_tier === "operator_backed",
  ).length
  const referenceBacked = gate.boundaries.filter(
    (boundary) => boundary.evidence_tier === "reference_backed",
  ).length
  const unattached = gate.boundaries.filter(
    (boundary) => boundary.evidence_tier === "unattached",
  ).length

  return [
    `- \`operator_backed\`: ${operatorBacked} boundaries cite operator-owned \`ops://qrtrust/\` evidence.`,
    `- \`reference_backed\`: ${referenceBacked} boundaries cite repository reference docs, examples, or smoke programs.`,
    `- \`unattached\`: ${unattached} boundaries have no accepted evidence attached to this report.`,
  ].join("\n")
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

Effect.runPromise(program)
