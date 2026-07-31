import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { Console, Effect } from "effect"

import {
  DEPLOYMENT_READINESS_CHECK_IDS,
  type DeploymentReadinessCheck,
  type DeploymentReadinessConfig,
  type DeploymentReadinessEvidenceRef,
  type DeploymentReadinessMode,
  type DeploymentReadinessReport,
  makeDeploymentReadinessReport,
} from "../index.js"
import { isEvidenceReviewDate } from "../services/evidence-review.js"

const DEFAULT_JSON_OUTPUT = fileURLToPath(
  new URL("../../../local/network-readiness-report.json", import.meta.url),
)
const DEFAULT_MARKDOWN_OUTPUT = fileURLToPath(
  new URL("../../../local/network-readiness-report.md", import.meta.url),
)

const program = Effect.gen(function* () {
  const report = makeDeploymentReadinessReport(readConfigFromEnv())
  const jsonPath =
    process.env.QRTRUST_DEPLOYMENT_READINESS_JSON ?? DEFAULT_JSON_OUTPUT
  const markdownPath =
    process.env.QRTRUST_DEPLOYMENT_READINESS_MD ?? DEFAULT_MARKDOWN_OUTPUT

  yield* writeReport(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  yield* writeReport(markdownPath, renderMarkdown(report))

  yield* Console.log(
    JSON.stringify(
      {
        status: report.status,
        mode: report.mode,
        blocking_checks: report.blocking_checks.length,
        warning_checks: report.warning_checks.length,
        json: jsonPath,
        markdown: markdownPath,
      },
      null,
      2,
    ),
  )
})

const readConfigFromEnv = (): DeploymentReadinessConfig => {
  const mode = readMode()
  const scannerDecisionPersistence =
    readBooleanEnv("QRTRUST_SCANNER_DECISION_PERSISTENCE_ENABLED")

  return {
    mode,
    evidenceRefs: readEvidenceRefsFromEnv(),
    ...(scannerDecisionPersistence === undefined
      ? mode === "reference"
        ? { scannerDecisionPersistenceEnabled: true }
        : {}
      : { scannerDecisionPersistenceEnabled: scannerDecisionPersistence }),
    ...optionalString("postgresDatabaseUrl", "QRTRUST_NETWORK_DATABASE_URL"),
    ...optionalBoolean("migrationLedgerEnabled", "QRTRUST_MIGRATION_LEDGER_ENABLED"),
    ...optionalBoolean(
      "restoreAutomationDocumented",
      "QRTRUST_RESTORE_AUTOMATION_DOCUMENTED",
    ),
    ...optionalBoolean(
      "packagedDeploymentOwnershipDocumented",
      "QRTRUST_PACKAGED_DEPLOYMENT_OWNERSHIP_DOCUMENTED",
    ),
    ...optionalString("natsUrl", "QRTRUST_NETWORK_NATS_URL"),
    ...optionalString(
      "managedKeyMaterialProvider",
      "QRTRUST_MANAGED_KEY_MATERIAL_PROVIDER",
    ),
    ...optionalString(
      "managedSigningCustodyProvider",
      "QRTRUST_MANAGED_SIGNING_CUSTODY_PROVIDER",
    ),
    ...optionalBoolean(
      "custodyAuditExportConfigured",
      "QRTRUST_CUSTODY_AUDIT_EXPORT_CONFIGURED",
    ),
    ...optionalString(
      "runtimeSafetyProvider",
      "QRTRUST_RUNTIME_SAFETY_PROVIDER",
    ),
    ...optionalBoolean(
      "workerOperationsEvidenceReady",
      "QRTRUST_WORKER_OPERATIONS_EVIDENCE_READY",
    ),
    ...optionalBoolean(
      "operatorRunbooksDocumented",
      "QRTRUST_OPERATOR_RUNBOOKS_DOCUMENTED",
    ),
  }
}

const readEvidenceRefsFromEnv = (): NonNullable<
  DeploymentReadinessConfig["evidenceRefs"]
> => {
  const path = process.env.QRTRUST_DEPLOYMENT_READINESS_EVIDENCE_JSON?.trim()
  if (!path) {
    return {}
  }

  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!isEvidenceRefMap(parsed)) {
    throw new Error(
      "QRTRUST_DEPLOYMENT_READINESS_EVIDENCE_JSON must point to a JSON object keyed by readiness check id.",
    )
  }

  return parsed
}

const isEvidenceRefMap = (
  value: unknown,
): value is NonNullable<DeploymentReadinessConfig["evidenceRefs"]> => {
  if (!isRecord(value)) {
    return false
  }

  const checkIds = new Set<string>(DEPLOYMENT_READINESS_CHECK_IDS)
  return Object.values(value).every(
    (refs) => Array.isArray(refs) && refs.every(isEvidenceRef),
  ) && Object.keys(value).every((checkId) => checkIds.has(checkId))
}

const isEvidenceRef = (value: unknown): value is DeploymentReadinessEvidenceRef =>
  isRecord(value)
  && typeof value.label === "string"
  && value.label.trim().length > 0
  && typeof value.uri === "string"
  && value.uri.trim().length > 0
  && typeof value.owner === "string"
  && value.owner.trim().length > 0
  && isEvidenceReviewDate(value.reviewed_at)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const readMode = (): DeploymentReadinessMode => {
  const mode = process.env.QRTRUST_DEPLOYMENT_READINESS_MODE ?? "reference"
  if (mode === "reference" || mode === "production") {
    return mode
  }

  throw new Error(
    `Unsupported QRTRUST_DEPLOYMENT_READINESS_MODE '${mode}'. Use 'reference' or 'production'.`,
  )
}

const optionalString = <Key extends keyof DeploymentReadinessConfig>(
  key: Key,
  envName: string,
): Partial<Pick<DeploymentReadinessConfig, Key>> => {
  const value = process.env[envName]?.trim()
  return value ? ({ [key]: value } as Partial<Pick<DeploymentReadinessConfig, Key>>) : {}
}

const optionalBoolean = <Key extends keyof DeploymentReadinessConfig>(
  key: Key,
  envName: string,
): Partial<Pick<DeploymentReadinessConfig, Key>> => {
  const value = readBooleanEnv(envName)
  return value === undefined
    ? {}
    : ({ [key]: value } as Partial<Pick<DeploymentReadinessConfig, Key>>)
}

const readBooleanEnv = (envName: string): boolean | undefined => {
  const rawValue = process.env[envName]?.trim().toLowerCase()
  if (!rawValue) {
    return undefined
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

const renderMarkdown = (report: DeploymentReadinessReport): string => {
  const rows = report.checks.map(renderCheckRow).join("\n")
  return `# QR Trust Network Readiness Report

Mode: \`${report.mode}\`

Status: \`${report.status}\`

${renderVerdict(report)}

## Blocking Checks

${renderCheckList(report.blocking_checks)}

## Warning Checks

${renderCheckList(report.warning_checks)}

## Check Matrix

| Layer | Check | Status | Evidence | Remediation |
| --- | --- | --- | --- | --- |
${rows}

## Evidence References

${renderEvidenceRefs(report)}

## Operator Notes

- This report is generated from local environment settings and should not be committed.
- Reference mode may warn about production-owned controls while still being suitable for a local drill.
- Production mode must have no blocking checks before the deployment is described as production-ready.
`
}

const renderVerdict = (report: DeploymentReadinessReport): string => {
  if (report.status === "ready_for_reference_drill") {
    return "Verdict: usable for a reference implementation drill. Do not present this as production readiness."
  }

  if (report.status === "ready_for_production_drill") {
    return "Verdict: all modeled production readiness checks passed for this drill."
  }

  return "Verdict: blocked for production. Resolve the blocking checks before deployment."
}

const renderCheckList = (
  checks: ReadonlyArray<DeploymentReadinessReport["blocking_checks"][number]>,
): string => {
  if (checks.length === 0) {
    return "None."
  }

  return checks.map((check) => `- \`${check}\``).join("\n")
}

const renderCheckRow = (check: DeploymentReadinessCheck): string =>
  [
    check.layer,
    check.title,
    `\`${check.status}\``,
    check.evidence,
    check.remediation ?? "",
  ]
    .map(escapeMarkdownCell)
    .join(" | ")
    .replace(/^/, "| ")
    .replace(/$/, " |")

const escapeMarkdownCell = (value: string): string =>
  value.replace(/\|/g, "\\|").replace(/\n/g, " ")

const renderEvidenceRefs = (report: DeploymentReadinessReport): string => {
  const rows = report.checks.flatMap((check) =>
    (check.evidence_refs ?? []).map(
      (ref) =>
        `- \`${check.id}\`: ${ref.label} (${ref.uri}) reviewed by ${ref.owner} on ${ref.reviewed_at}`,
    ),
  )

  return rows.length > 0 ? rows.join("\n") : "None."
}

Effect.runPromise(program)
