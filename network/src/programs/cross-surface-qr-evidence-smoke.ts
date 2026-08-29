import { Console, Effect } from "effect"

import {
  CROSS_SURFACE_QR_EVIDENCE_SURFACES,
  assertCrossSurfaceQrEvidencePacket,
  collectCrossSurfaceQrEvidenceRefs,
  makeCrossSurfaceQrEvidencePacket,
  type CrossSurfaceQrDecision,
  type CrossSurfaceQrEvidencePacket,
  type CrossSurfaceQrEvidenceRow,
} from "../index.js"

const ARTIFACT_REF = "qr-artifact:qrtrust-demo:redirect-final-mismatch:001"
const PAYLOAD_HASH = `sha256:${"4".repeat(64)}`
const FINAL_DECISION: CrossSurfaceQrDecision = {
  decision_color: "red",
  decision_state: "resolver_final_target_mismatch",
  reason_codes: [
    "issuer_recognized",
    "resolver_host_approved",
    "redirect_final_destination_mismatch",
  ],
}

const program = Effect.gen(function* () {
  const packet = makeReferencePacket()
  assertCrossSurfaceQrEvidencePacket(packet)
  const proofRefs = collectCrossSurfaceQrEvidenceRefs(packet)

  yield* assertSmoke(
    packet.artifact_type === "cross_surface_qr_evidence_packet",
    "artifact type should be stable",
  )
  yield* assertSmoke(
    packet.surface_evidence.length === CROSS_SURFACE_QR_EVIDENCE_SURFACES.length,
    "packet should include every required surface",
  )
  yield* assertSmoke(
    packet.surface_evidence.every(
      (row, index) => row.surface === CROSS_SURFACE_QR_EVIDENCE_SURFACES[index],
    ),
    "surface rows should use the canonical review order",
  )
  yield* assertSmoke(
    packet.surface_evidence.every((row) => row.artifact_ref === ARTIFACT_REF),
    "every surface should reference the same QR artifact",
  )
  yield* assertSmoke(
    packet.surface_evidence.every(
      (row) =>
        row.decision_color === packet.final_decision.decision_color
        && row.decision_state === packet.final_decision.decision_state,
    ),
    "every surface should agree with the final scanner-visible decision",
  )
  yield* assertSmoke(
    proofRefs.length === CROSS_SURFACE_QR_EVIDENCE_SURFACES.length,
    "every surface should contribute one proof reference",
  )
  yield* assertSmoke(
    new Set(proofRefs).size === proofRefs.length,
    "proof references should be unique",
  )
  yield* assertSmoke(
    throwsMissingSurface(),
    "packet should fail closed when a surface is missing",
  )
  yield* assertSmoke(
    throwsWrongSurfaceOrder(),
    "packet should fail closed when surfaces are out of order",
  )
  yield* assertSmoke(
    throwsArtifactMismatch(),
    "packet should fail closed when a surface references another QR",
  )
  yield* assertSmoke(
    throwsDecisionMismatch(),
    "packet should fail closed when a surface disagrees with the final decision",
  )
  yield* assertSmoke(
    throwsDuplicateProofRef(),
    "packet should fail closed when a proof ref is reused",
  )
  yield* assertSmoke(
    throwsInvalidIosProofRef(),
    "packet should fail closed when iOS evidence is not in the iPhone evidence folder",
  )
  yield* assertSmoke(
    throwsUnredactedFingerprint(),
    "packet should fail closed when the QR artifact exposes a raw URL",
  )
  yield* assertSmoke(
    throwsPathLikeFingerprint(),
    "packet should fail closed when a compact fingerprint includes a path",
  )
  yield* assertSmoke(
    throwsMissingReasonCodes(),
    "packet should fail closed when the final decision has no reason codes",
  )
  yield* assertSmoke(
    throwsMalformedReviewerDate(),
    "packet should fail closed when reviewer review date is malformed",
  )

  yield* Console.log(
    JSON.stringify(
      {
        status: "ok",
        bundle_id: packet.bundle_id,
        scenario_id: packet.scenario_id,
        decision_state: packet.final_decision.decision_state,
        surfaces: packet.surface_evidence.map((row) => row.surface),
      },
      null,
      2,
    ),
  )
})

const makeReferencePacket = (
  overrides: Partial<{
    finalDecision: CrossSurfaceQrDecision
    surfaceEvidence: ReadonlyArray<CrossSurfaceQrEvidenceRow>
    destinationFingerprint: string
    reviewer: CrossSurfaceQrEvidencePacket["reviewer"]
    rawUrlsRedacted: boolean
  }> = {},
): CrossSurfaceQrEvidencePacket =>
  makeCrossSurfaceQrEvidencePacket({
    bundleId: "cross-surface-qr-evidence:smoke:redirect-final-mismatch:2026-05-21",
    generatedAt: "2026-05-21T00:00:00.000Z",
    scenarioId: "redirect-final-mismatch",
    qrArtifact: {
      artifact_ref: ARTIFACT_REF,
      payload_hash: PAYLOAD_HASH,
      destination_fingerprint:
        overrides.destinationFingerprint ?? "qr....ple.example",
    },
    finalDecision: overrides.finalDecision ?? FINAL_DECISION,
    surfaceEvidence:
      overrides.surfaceEvidence ?? makeSurfaceEvidence(FINAL_DECISION),
    reviewer: {
      name: "QR Trust reviewer",
      role: "cross-surface smoke",
      reviewed_at: "2026-05-21",
      ...overrides.reviewer,
    },
    privacy: {
      raw_urls_redacted: overrides.rawUrlsRedacted ?? true,
      secrets_included: false,
      notes: "Smoke packet uses compact fingerprints and local evidence refs.",
    },
  })

const makeSurfaceEvidence = (
  decision: CrossSurfaceQrDecision,
): ReadonlyArray<CrossSurfaceQrEvidenceRow> => [
  makeRow("contract_fixture", decision, {
    proofRef:
      "docs/public/network-contracts/examples/scanner-decision-red-runtime-blocked.json",
    observedAt: "2026-05-21T00:01:00.000Z",
  }),
  makeRow("worker_drill", decision, {
    proofRef: "docs/public/network-contracts/scan-time-validation-sequence.md",
    observedAt: "2026-05-21T00:02:00.000Z",
  }),
  makeRow("web_lab", decision, {
    proofRef: "docs/public/evidence/browser/redirect-final-mismatch-lab.png",
    observedAt: "2026-05-21T00:03:00.000Z",
  }),
  makeRow("backend_scanner_decision", decision, {
    proofRef:
      "docs/public/evidence/api/scanner-decision-redirect-final-mismatch.json",
    observedAt: "2026-05-21T00:04:00.000Z",
  }),
  makeRow("ios_scanner", decision, {
    proofRef: "docs/public/evidence/iphone/resolver-final-target-mismatch.png",
    observedAt: "2026-05-21T00:05:00.000Z",
  }),
]

const makeRow = (
  surface: CrossSurfaceQrEvidenceRow["surface"],
  decision: CrossSurfaceQrDecision,
  refs: { readonly proofRef: string; readonly observedAt: string },
): CrossSurfaceQrEvidenceRow => ({
  surface,
  artifact_ref: ARTIFACT_REF,
  proof_ref: refs.proofRef,
  decision_color: decision.decision_color,
  decision_state: decision.decision_state,
  reason_codes: decision.reason_codes,
  observed_at: refs.observedAt,
  notes: `${surface} agrees with ${decision.decision_state}.`,
})

const throwsMissingSurface = (): boolean => {
  try {
    makeReferencePacket({
      surfaceEvidence: makeSurfaceEvidence(FINAL_DECISION).filter(
        (row) => row.surface !== "web_lab",
      ),
    })
    return false
  } catch (error) {
    return isExpectedError(error, "exactly 5 surface rows")
  }
}

const throwsWrongSurfaceOrder = (): boolean => {
  const rows = [...makeSurfaceEvidence(FINAL_DECISION)]
  const first = rows[0]!
  rows[0] = rows[1]!
  rows[1] = first

  try {
    makeReferencePacket({ surfaceEvidence: rows })
    return false
  } catch (error) {
    return isExpectedError(error, "canonical handoff order")
  }
}

const throwsArtifactMismatch = (): boolean => {
  const rows = [...makeSurfaceEvidence(FINAL_DECISION)]
  rows[2] = {
    ...rows[2]!,
    artifact_ref: "qr-artifact:qrtrust-demo:other:001",
  }

  try {
    makeReferencePacket({ surfaceEvidence: rows })
    return false
  } catch (error) {
    return isExpectedError(error, "artifact_ref mismatch")
  }
}

const throwsDecisionMismatch = (): boolean => {
  const rows = [...makeSurfaceEvidence(FINAL_DECISION)]
  rows[3] = {
    ...rows[3]!,
    decision_color: "green",
  }

  try {
    makeReferencePacket({ surfaceEvidence: rows })
    return false
  } catch (error) {
    return isExpectedError(error, "color mismatch")
  }
}

const throwsDuplicateProofRef = (): boolean => {
  const rows = [...makeSurfaceEvidence(FINAL_DECISION)]
  rows[3] = {
    ...rows[3]!,
    proof_ref: rows[2]!.proof_ref,
  }

  try {
    makeReferencePacket({ surfaceEvidence: rows })
    return false
  } catch (error) {
    return isExpectedError(error, "reuses proof_ref")
  }
}

const throwsInvalidIosProofRef = (): boolean => {
  const rows = [...makeSurfaceEvidence(FINAL_DECISION)]
  rows[4] = {
    ...rows[4]!,
    proof_ref: "docs/public/evidence/browser/ios-scanner.png",
  }

  try {
    makeReferencePacket({ surfaceEvidence: rows })
    return false
  } catch (error) {
    return isExpectedError(error, "invalid proof_ref")
  }
}

const throwsUnredactedFingerprint = (): boolean => {
  try {
    makeReferencePacket({
      destinationFingerprint: "https://qr....ple.example/r/pay",
    })
    return false
  } catch (error) {
    return isExpectedError(error, "must not expose a raw URL")
  }
}

const throwsPathLikeFingerprint = (): boolean => {
  try {
    makeReferencePacket({
      destinationFingerprint: "qr....ple.example/r",
    })
    return false
  } catch (error) {
    return isExpectedError(error, "must not expose a raw URL")
  }
}

const throwsMissingReasonCodes = (): boolean => {
  try {
    makeReferencePacket({
      finalDecision: {
        ...FINAL_DECISION,
        reason_codes: [],
      },
      surfaceEvidence: makeSurfaceEvidence({
        ...FINAL_DECISION,
        reason_codes: [],
      }),
    })
    return false
  } catch (error) {
    return isExpectedError(error, "non-empty reason codes")
  }
}

const throwsMalformedReviewerDate = (): boolean => {
  try {
    makeReferencePacket({
      reviewer: {
        name: "QR Trust reviewer",
        role: "cross-surface smoke",
        reviewed_at: "pending-review",
      },
    })
    return false
  } catch (error) {
    return isExpectedError(error, "reviewer.reviewed_at")
  }
}

const isExpectedError = (error: unknown, message: string): boolean =>
  error instanceof Error && error.message.includes(message)

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Cross-surface QR evidence smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
