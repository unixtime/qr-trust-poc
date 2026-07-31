import { Console, Effect } from "effect"

import {
  REFERENCE_NETWORK_ADOPTION_BOUNDARY_IDS,
  assertReferenceNetworkAdoptionEvidenceCoverage,
  assertReferenceNetworkAdoptionStageGate,
  collectReferenceNetworkAdoptionEvidenceRefs,
  makeReferenceNetworkAdoptionStageGate,
  type ReferenceNetworkAdoptionBoundaryId,
  type ReferenceNetworkAdoptionEvidenceRef,
} from "../index.js"

const GENERATED_AT = "2026-05-21T00:00:00.000Z"

const program = Effect.gen(function* () {
  const stageOneGate = makeReferenceNetworkAdoptionStageGate({
    stage: 1,
    claimMode: "reference_only",
    generatedAt: GENERATED_AT,
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
    evidenceRefs: referenceEvidenceRefs(),
  })

  assertReferenceNetworkAdoptionStageGate(stageOneGate)
  yield* assertSmoke(
    stageOneGate.status === "ready_for_stage_1_reference",
    "stage 1 reference gate should be claimable when required boundaries pass",
  )
  yield* assertSmoke(
    stageOneGate.blocking_boundaries.length === 0,
    "stage 1 reference gate should have no blockers",
  )
  yield* assertSmoke(
    stageOneGate.warning_boundaries.includes("nats_propagation"),
    "stage 1 reference gate should warn on stage 2 propagation",
  )
  yield* assertSmoke(
    stageOneGate.boundaries.map((boundary) => boundary.id).join(",")
      === REFERENCE_NETWORK_ADOPTION_BOUNDARY_IDS.join(","),
    "gate boundaries should use canonical order",
  )
  yield* assertSmoke(
    boundaryTier(stageOneGate, "scanner_decision_runtime") === "reference_backed",
    "reference stage pass boundaries should be marked reference-backed",
  )
  yield* assertSmoke(
    boundaryTier(stageOneGate, "nats_propagation") === "unattached",
    "warning boundaries should remain unattached",
  )
  yield* assertSmoke(
    throwsStageTwoWithoutNats(),
    "stage 2 claim should block when NATS propagation is missing",
  )
  yield* assertSmoke(
    throwsProductionCandidateWithoutEvidence(),
    "production candidate should fail closed without evidence refs for passing boundaries",
  )
  yield* assertSmoke(
    throwsProductionCandidateWithReferenceEvidence(),
    "production candidate should reject reference-backed evidence refs",
  )
  yield* assertSmoke(
    productionCandidateWithOperatorEvidenceIsReady(),
    "production candidate should accept operator-backed evidence refs",
  )
  yield* assertSmoke(
    productionCandidateEvidenceCoverageIsReady(),
    "production candidate evidence refs should be coverable by an operator evidence index",
  )
  yield* assertSmoke(
    throwsProductionCandidateMissingOperatorEvidenceIndexRef(),
    "production candidate should reject adoption evidence not covered by an operator evidence index",
  )
  yield* assertSmoke(
    throwsWrongStageName(),
    "stage gate should reject mismatched stage names",
  )
  yield* assertSmoke(
    throwsBoundarySummaryMismatch(),
    "stage gate should reject blocking summary drift",
  )
  yield* assertSmoke(
    throwsMissingBoundary(),
    "stage gate should reject missing canonical boundaries",
  )
  yield* assertSmoke(
    throwsMalformedEvidenceReviewDate(),
    "stage gate should reject malformed evidence review dates",
  )

  yield* Console.log(
    JSON.stringify(
      {
        status: stageOneGate.status,
        stage: stageOneGate.stage_name,
        warnings: stageOneGate.warning_boundaries,
      },
      null,
      2,
    ),
  )
})

const boundaryTier = (
  gate: ReturnType<typeof makeReferenceNetworkAdoptionStageGate>,
  boundaryId: ReferenceNetworkAdoptionBoundaryId,
): string | undefined =>
  gate.boundaries.find((boundary) => boundary.id === boundaryId)?.evidence_tier

const referenceEvidenceRefs = (): Partial<
  Record<ReferenceNetworkAdoptionBoundaryId, ReadonlyArray<ReferenceNetworkAdoptionEvidenceRef>>
> => ({
  postgres_source_of_truth: [ref("Reference Postgres schema", "docs/public/network-contracts/reference-postgres-schema.sql")],
  authority_publication: [ref("Authority publication smoke", "network/src/programs/authority-publication-service-smoke.ts")],
  verifier_cache_read_model: [ref("Verifier cache read-model smoke", "network/src/programs/verifier-cache-read-model-worker-smoke.ts")],
  scanner_decision_runtime: [ref("Scanner decision runtime smoke", "network/src/programs/scanner-decision-http-runtime-smoke.ts")],
  scanner_fleet_evidence: [ref("Scanner fleet evidence packet", "docs/public/network-contracts/examples/scanner-fleet-evidence-reference.json")],
  cross_surface_qr_evidence: [ref("Cross-surface QR evidence packet", "docs/public/network-contracts/examples/cross-surface-qr-evidence-reference.json")],
  worker_operations_evidence: [ref("Worker operations evidence packet", "docs/public/network-contracts/examples/worker-operations-evidence-reference.json")],
  signing_custody_audit_export: [ref("Publication-backed signing custody audit export", "docs/public/network-contracts/examples/signing-custody-publication-audit-export-reference.json")],
  operator_runbooks: [ref("Deployment readiness operator guide", "docs/public/network-contracts/deployment-readiness-operator-guide.md")],
  backup_restore: [ref("Migration and restore policy", "docs/public/network-contracts/postgres-migration-deployment-policy.md")],
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

const operatorEvidenceRefs = (): Partial<
  Record<ReferenceNetworkAdoptionBoundaryId, ReadonlyArray<ReferenceNetworkAdoptionEvidenceRef>>
> =>
  Object.fromEntries(
    REFERENCE_NETWORK_ADOPTION_BOUNDARY_IDS.map((boundaryId) => [
      boundaryId,
      [
        {
          label: `Operator evidence for ${boundaryId}`,
          uri: `ops://qrtrust/adoption-stage/2026-05-21/${boundaryId}`,
          owner: "QR Trust operator",
          reviewed_at: "2026-05-21",
        },
      ],
    ]),
  ) as Partial<
    Record<ReferenceNetworkAdoptionBoundaryId, ReadonlyArray<ReferenceNetworkAdoptionEvidenceRef>>
  >

const allReferenceEvidenceRefs = (): Partial<
  Record<ReferenceNetworkAdoptionBoundaryId, ReadonlyArray<ReferenceNetworkAdoptionEvidenceRef>>
> =>
  Object.fromEntries(
    REFERENCE_NETWORK_ADOPTION_BOUNDARY_IDS.map((boundaryId) => [
      boundaryId,
      [
        {
          label: `Reference evidence for ${boundaryId}`,
          uri: `docs/public/network-contracts/examples/${boundaryId}.json`,
          owner: "QR Trust reference maintainer",
          reviewed_at: "2026-05-21",
        },
      ],
    ]),
  ) as Partial<
    Record<ReferenceNetworkAdoptionBoundaryId, ReadonlyArray<ReferenceNetworkAdoptionEvidenceRef>>
  >

const throwsStageTwoWithoutNats = (): boolean => {
  const gate = makeReferenceNetworkAdoptionStageGate({
    stage: 2,
    claimMode: "reference_only",
    generatedAt: GENERATED_AT,
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

  return gate.status === "blocked_for_stage_claim"
    && gate.blocking_boundaries.includes("nats_propagation")
}

const throwsProductionCandidateWithoutEvidence = (): boolean => {
  try {
    makeReferenceNetworkAdoptionStageGate({
      stage: 1,
      claimMode: "production_candidate",
      generatedAt: GENERATED_AT,
      postgresSourceOfTruthReady: true,
      authorityPublicationReady: true,
      natsPropagationReady: true,
      verifierCacheReadModelReady: true,
      scannerDecisionRuntimeReady: true,
      scannerFleetEvidenceReady: true,
      crossSurfaceQrEvidenceReady: true,
      workerOperationsEvidenceReady: true,
      signingCustodyAuditExportReady: true,
      signingCustodyReady: true,
      runtimeSafetyProviderReady: true,
      operatorRunbooksReady: true,
      backupRestoreReady: true,
      externalGovernanceAuditReady: true,
    })
    return false
  } catch (error) {
    return isExpectedError(error, "needs evidence_refs")
  }
}

const throwsProductionCandidateWithReferenceEvidence = (): boolean => {
  try {
    makeReferenceNetworkAdoptionStageGate({
      stage: 3,
      claimMode: "production_candidate",
      generatedAt: GENERATED_AT,
      ...stageThreePassingInputs(),
      evidenceRefs: allReferenceEvidenceRefs(),
    })
    return false
  } catch (error) {
    return isExpectedError(error, "must be operator_backed")
  }
}

const productionCandidateWithOperatorEvidenceIsReady = (): boolean => {
  const gate = makeReferenceNetworkAdoptionStageGate({
    stage: 3,
    claimMode: "production_candidate",
    generatedAt: GENERATED_AT,
    ...stageThreePassingInputs(),
    evidenceRefs: operatorEvidenceRefs(),
  })

  return gate.status === "ready_for_production_candidate"
    && gate.boundaries.every(
      (boundary) => boundary.evidence_tier === "operator_backed",
    )
}

const productionCandidateEvidenceCoverageIsReady = (): boolean => {
  const gate = productionCandidateGate()
  assertReferenceNetworkAdoptionEvidenceCoverage(
    gate,
    collectReferenceNetworkAdoptionEvidenceRefs(gate),
    "operator-evidence-index:smoke",
  )

  return true
}

const throwsProductionCandidateMissingOperatorEvidenceIndexRef = (): boolean => {
  const gate = productionCandidateGate()
  const missingRef = "ops://qrtrust/adoption-stage/2026-05-21/runtime_safety_provider"
  const coveredRefs = collectReferenceNetworkAdoptionEvidenceRefs(gate)
    .filter((ref) => ref !== missingRef)

  try {
    assertReferenceNetworkAdoptionEvidenceCoverage(
      gate,
      coveredRefs,
      "operator-evidence-index:smoke",
    )
    return false
  } catch (error) {
    return isExpectedError(error, "missing from operator-evidence-index:smoke")
  }
}

const productionCandidateGate = (): ReturnType<
  typeof makeReferenceNetworkAdoptionStageGate
> =>
  makeReferenceNetworkAdoptionStageGate({
    stage: 3,
    claimMode: "production_candidate",
    generatedAt: GENERATED_AT,
    ...stageThreePassingInputs(),
    evidenceRefs: operatorEvidenceRefs(),
  })

const throwsWrongStageName = (): boolean => {
  const gate = makeReferenceNetworkAdoptionStageGate({
    stage: 0,
    claimMode: "reference_only",
    generatedAt: GENERATED_AT,
    scannerDecisionRuntimeReady: true,
    scannerFleetEvidenceReady: true,
    crossSurfaceQrEvidenceReady: true,
  })

  try {
    assertReferenceNetworkAdoptionStageGate({
      ...gate,
      stage_name: "single_operator_pilot",
    })
    return false
  } catch (error) {
    return isExpectedError(error, "stage_name")
  }
}

const throwsBoundarySummaryMismatch = (): boolean => {
  const gate = makeReferenceNetworkAdoptionStageGate({
    stage: 2,
    claimMode: "reference_only",
    generatedAt: GENERATED_AT,
    postgresSourceOfTruthReady: true,
    authorityPublicationReady: true,
    verifierCacheReadModelReady: true,
    scannerDecisionRuntimeReady: true,
    scannerFleetEvidenceReady: true,
    crossSurfaceQrEvidenceReady: true,
    workerOperationsEvidenceReady: true,
    operatorRunbooksReady: true,
    backupRestoreReady: true,
  })

  try {
    assertReferenceNetworkAdoptionStageGate({
      ...gate,
      blocking_boundaries: [],
    })
    return false
  } catch (error) {
    return isExpectedError(error, "blocking_boundaries")
  }
}

const throwsMissingBoundary = (): boolean => {
  const gate = makeReferenceNetworkAdoptionStageGate({
    stage: 0,
    claimMode: "reference_only",
    generatedAt: GENERATED_AT,
    scannerDecisionRuntimeReady: true,
    scannerFleetEvidenceReady: true,
    crossSurfaceQrEvidenceReady: true,
  })

  try {
    assertReferenceNetworkAdoptionStageGate({
      ...gate,
      boundaries: gate.boundaries.filter(
        (boundary) => boundary.id !== "external_governance_audit",
      ),
    })
    return false
  } catch (error) {
    return isExpectedError(error, "exactly 14 boundaries")
  }
}

const throwsMalformedEvidenceReviewDate = (): boolean => {
  try {
    makeReferenceNetworkAdoptionStageGate({
      stage: 1,
      claimMode: "reference_only",
      generatedAt: GENERATED_AT,
      ...stageOnePassingInputs(),
      evidenceRefs: {
        scanner_decision_runtime: [
          {
            label: "Malformed review date",
            uri: "docs/public/network-contracts/scanner-decision-http-runtime.md",
            owner: "QR Trust reference maintainer",
            reviewed_at: "pending-review",
          },
        ],
      },
    })
    return false
  } catch (error) {
    return isExpectedError(error, "evidence_ref.reviewed_at")
  }
}

const stageOnePassingInputs = (): Pick<
  Parameters<typeof makeReferenceNetworkAdoptionStageGate>[0],
  | "postgresSourceOfTruthReady"
  | "authorityPublicationReady"
  | "verifierCacheReadModelReady"
  | "scannerDecisionRuntimeReady"
  | "scannerFleetEvidenceReady"
  | "crossSurfaceQrEvidenceReady"
  | "workerOperationsEvidenceReady"
  | "signingCustodyAuditExportReady"
  | "operatorRunbooksReady"
  | "backupRestoreReady"
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

const stageThreePassingInputs = (): Pick<
  Parameters<typeof makeReferenceNetworkAdoptionStageGate>[0],
  | "postgresSourceOfTruthReady"
  | "authorityPublicationReady"
  | "natsPropagationReady"
  | "verifierCacheReadModelReady"
  | "scannerDecisionRuntimeReady"
  | "scannerFleetEvidenceReady"
  | "crossSurfaceQrEvidenceReady"
  | "workerOperationsEvidenceReady"
  | "signingCustodyAuditExportReady"
  | "signingCustodyReady"
  | "runtimeSafetyProviderReady"
  | "operatorRunbooksReady"
  | "backupRestoreReady"
  | "externalGovernanceAuditReady"
> => ({
  postgresSourceOfTruthReady: true,
  authorityPublicationReady: true,
  natsPropagationReady: true,
  verifierCacheReadModelReady: true,
  scannerDecisionRuntimeReady: true,
  scannerFleetEvidenceReady: true,
  crossSurfaceQrEvidenceReady: true,
  workerOperationsEvidenceReady: true,
  signingCustodyAuditExportReady: true,
  signingCustodyReady: true,
  runtimeSafetyProviderReady: true,
  operatorRunbooksReady: true,
  backupRestoreReady: true,
  externalGovernanceAuditReady: true,
})

const assertSmoke = (
  condition: boolean,
  message: string,
): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Reference network adoption stage smoke failed: ${message}`)
    }
  })

const isExpectedError = (error: unknown, expected: string): boolean =>
  error instanceof Error && error.message.includes(expected)

Effect.runPromise(program).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
