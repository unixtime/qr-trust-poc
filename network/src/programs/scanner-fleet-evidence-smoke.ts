import { Console, Effect } from "effect"

import {
  SCANNER_FLEET_REQUIRED_FIXTURES,
  assertScannerFleetEvidencePacket,
  collectScannerFleetEvidenceArtifactRefs,
  makeScannerFleetEvidencePacket,
  type ScannerFleetEvidencePacket,
  type ScannerFleetEvidenceRow,
  type ScannerFleetFixture,
} from "../index.js"

const PROFILE_FINGERPRINT = `sha256:${"1".repeat(64)}`
const ENDPOINT_FINGERPRINT = `sha256:${"2".repeat(64)}`

const program = Effect.gen(function* () {
  const evidenceRows = SCANNER_FLEET_REQUIRED_FIXTURES.map(makeEvidenceRow)
  const packet = makeReferencePacket({ evidenceRows })
  assertScannerFleetEvidencePacket(packet)
  const artifactRefs = collectScannerFleetEvidenceArtifactRefs(packet)

  yield* assertSmoke(
    packet.artifact_type === "scanner_fleet_evidence_packet",
    "artifact type should be stable",
  )
  yield* assertSmoke(
    packet.fixture_matrix.length === SCANNER_FLEET_REQUIRED_FIXTURES.length,
    "packet should carry the full required fixture matrix",
  )
  yield* assertSmoke(
    packet.evidence_rows.every((row) =>
      row.decision_color === "green" || row.hold_required
    ),
    "every non-green row should require hold-to-open evidence",
  )
  yield* assertSmoke(
    packet.evidence_rows.every((row) => row.reason_codes.length > 0),
    "every row should carry scanner-visible reason codes",
  )
  yield* assertSmoke(
    packet.evidence_rows.every(
      (row) => row.history_entry_ref && row.accessibility_ref,
    ),
    "every row should link history and accessibility evidence",
  )
  yield* assertSmoke(
    artifactRefs.length === packet.evidence_rows.length * 3,
    "every row should expose screenshot, history, and accessibility artifact refs",
  )
  yield* assertSmoke(
    new Set(artifactRefs.map((ref) => ref.path)).size === artifactRefs.length,
    "artifact refs should be unique across the packet",
  )
  yield* assertSmoke(
    packet.evidence_rows.every(
      (row) => row.decision_color !== "red" || !row.opened_by_user,
    ),
    "red rows should not be opened by the user",
  )
  yield* assertSmoke(
    throwsMissingFixture(),
    "packet should fail closed when a required fixture is missing",
  )
  yield* assertSmoke(
    throwsMissingHoldGate(),
    "packet should fail closed when a non-green row lacks hold-to-open",
  )
  yield* assertSmoke(
    throwsProfileMismatch(),
    "packet should fail closed when scanner evidence uses another profile",
  )
  yield* assertSmoke(
    throwsUnredactedRawUrls(),
    "packet should fail closed when committed evidence keeps raw URLs",
  )
  yield* assertSmoke(
    throwsMissingReasonCodes(),
    "packet should fail closed when a row has no reason codes",
  )
  yield* assertSmoke(
    throwsDestinationBoundOnUnevaluatedBinding(),
    "packet should fail closed when a row claims binding the verifier never evaluated",
  )
  yield* assertSmoke(
    throwsRawDomainFingerprint(),
    "packet should fail closed when a row exposes a raw URL fingerprint",
  )
  yield* assertSmoke(
    throwsMissingEvidenceRef(),
    "packet should fail closed when a row lacks evidence references",
  )
  yield* assertSmoke(
    throwsDuplicateEvidenceRef(),
    "packet should fail closed when evidence artifacts are reused",
  )
  yield* assertSmoke(
    throwsRedOutcomeOpened(),
    "packet should fail closed when a red outcome is marked opened",
  )
  yield* assertSmoke(
    throwsMalformedReviewerDate(),
    "packet should fail closed when reviewer review date is malformed",
  )

  yield* Console.log(
    JSON.stringify(
      {
        status: "ok",
        packet_id: packet.packet_id,
        fixtures: packet.fixture_matrix.length,
        rows: packet.evidence_rows.length,
        artifact_refs: artifactRefs.length,
        hold_required_rows: packet.evidence_rows.filter(
          (row) => row.hold_required,
        ).length,
      },
      null,
      2,
    ),
  )
})

const makeReferencePacket = (
  overrides: Partial<{
    fixtureMatrix: ReadonlyArray<ScannerFleetFixture>
    evidenceRows: ReadonlyArray<ScannerFleetEvidenceRow>
    profileFingerprint: string
    reviewer: ScannerFleetEvidencePacket["reviewer"]
    rawUrlsRedacted: boolean
  }> = {},
): ScannerFleetEvidencePacket => {
  const config = {
    packetId: "scanner-fleet-evidence:smoke:ios-reference:2026-05-20",
    generatedAt: "2026-05-20T00:00:00.000Z",
    scannerApp: {
      name: "QR Trust",
      platform: "iOS",
      build_version: "ios-reference-smoke",
      os_version: "iOS reference smoke",
    },
    activeVerifierProfile: {
      profile_id: "profile:qrtrust-demo:ios-reference",
      profile_version: 1,
      profile_fingerprint: overrides.profileFingerprint ?? PROFILE_FINGERPRINT,
    },
    scannerDecisionEndpointFingerprint: ENDPOINT_FINGERPRINT,
    evidenceRows:
      overrides.evidenceRows
      ?? SCANNER_FLEET_REQUIRED_FIXTURES.map(makeEvidenceRow),
    reviewer: {
      name: "QR Trust reviewer",
      role: "reference scanner-fleet smoke",
      reviewed_at: "2026-05-20",
      ...overrides.reviewer,
    },
    privacy: {
      raw_urls_redacted: overrides.rawUrlsRedacted ?? true,
      secrets_included: false as const,
      notes: "Reference smoke uses redacted domain fingerprints only.",
    },
    ...(overrides.fixtureMatrix
      ? { fixtureMatrix: overrides.fixtureMatrix }
      : {}),
  }

  return makeScannerFleetEvidencePacket(config)
}

const makeEvidenceRow = (
  fixture: (typeof SCANNER_FLEET_REQUIRED_FIXTURES)[number],
  index = 0,
): ScannerFleetEvidenceRow => ({
  fixture_id: fixture.fixture_id,
  decision_id: `decision_${fixture.fixture_id}_001`,
  scanner_client_id: "scanner-ios-reference-001",
  scanner_build: "ios-reference-smoke",
  profile_fingerprint: PROFILE_FINGERPRINT,
  decision_color: fixture.expected_color,
  decision_state: fixture.expected_state,
  reason_codes: ["scanner_fleet_smoke", fixture.fixture_id],
  domain_fingerprint: makeDomainFingerprint(fixture.fixture_id),
  opened_by_user: fixture.expected_color === "green",
  hold_required: fixture.expected_color !== "green",
  hold_completed: false,
  observed_at: `2026-05-20T00:${String(index + 1).padStart(2, "0")}:00.000Z`,
  screenshot_ref: `docs/public/evidence/iphone/${fixture.fixture_id}.png`,
  history_entry_ref: `docs/public/evidence/iphone/history-${fixture.fixture_id}.png`,
  accessibility_ref: `docs/public/evidence/iphone/accessibility-${fixture.fixture_id}.txt`,
})

const makeDomainFingerprint = (fixtureId: string): string => {
  if (fixtureId.includes("plain_url")) {
    return "wik...org"
  }
  if (
    fixtureId.includes("mismatch")
    || fixtureId.includes("revoked")
  ) {
    return "evi...ple.example"
  }
  return "acm...ple.example"
}

const throwsMissingFixture = (): boolean => {
  try {
    makeReferencePacket({
      fixtureMatrix: SCANNER_FLEET_REQUIRED_FIXTURES.filter(
        (fixture) => fixture.fixture_id !== "red_expired_qr",
      ),
    })
    return false
  } catch (error) {
    return isExpectedError(error, "missing required fixture")
  }
}

const throwsMissingHoldGate = (): boolean => {
  const rows = SCANNER_FLEET_REQUIRED_FIXTURES.map((fixture, index) => {
    const row = makeEvidenceRow(fixture, index)
    if (fixture.fixture_id === "orange_plain_url_unrecognized") {
      return { ...row, hold_required: false }
    }
    return row
  })

  try {
    makeReferencePacket({ evidenceRows: rows })
    return false
  } catch (error) {
    return isExpectedError(error, "must require hold-to-open")
  }
}

const throwsProfileMismatch = (): boolean => {
  const rows = SCANNER_FLEET_REQUIRED_FIXTURES.map((fixture, index) => {
    const row = makeEvidenceRow(fixture, index)
    if (fixture.fixture_id === "green_verified_issuer") {
      return {
        ...row,
        profile_fingerprint: `sha256:${"3".repeat(64)}`,
      }
    }
    return row
  })

  try {
    makeReferencePacket({ evidenceRows: rows })
    return false
  } catch (error) {
    return isExpectedError(error, "different profile fingerprint")
  }
}

const throwsUnredactedRawUrls = (): boolean => {
  try {
    makeReferencePacket({ rawUrlsRedacted: false })
    return false
  } catch (error) {
    return isExpectedError(error, "redact raw URLs")
  }
}

const throwsMissingReasonCodes = (): boolean => {
  const rows = SCANNER_FLEET_REQUIRED_FIXTURES.map((fixture, index) => {
    const row = makeEvidenceRow(fixture, index)
    if (fixture.fixture_id === "orange_plain_url_unrecognized") {
      return { ...row, reason_codes: [] }
    }
    return row
  })

  try {
    makeReferencePacket({ evidenceRows: rows })
    return false
  } catch (error) {
    return isExpectedError(error, "non-empty reason codes")
  }
}

const throwsDestinationBoundOnUnevaluatedBinding = (): boolean => {
  const rows = SCANNER_FLEET_REQUIRED_FIXTURES.map((fixture, index) => {
    const row = makeEvidenceRow(fixture, index)
    if (fixture.fixture_id === "red_expired_qr") {
      return { ...row, reason_codes: [...row.reason_codes, "destination_bound"] }
    }
    return row
  })

  try {
    makeReferencePacket({ evidenceRows: rows })
    return false
  } catch (error) {
    return isExpectedError(error, "stops before destination binding")
  }
}

const throwsRawDomainFingerprint = (): boolean => {
  const rows = SCANNER_FLEET_REQUIRED_FIXTURES.map((fixture, index) => {
    const row = makeEvidenceRow(fixture, index)
    if (fixture.fixture_id === "orange_plain_url_unrecognized") {
      return { ...row, domain_fingerprint: "https://wik...org" }
    }
    return row
  })

  try {
    makeReferencePacket({ evidenceRows: rows })
    return false
  } catch (error) {
    return isExpectedError(error, "must not expose a raw URL")
  }
}

const throwsMissingEvidenceRef = (): boolean => {
  const rows = SCANNER_FLEET_REQUIRED_FIXTURES.map((fixture, index) => {
    const row = makeEvidenceRow(fixture, index)
    if (fixture.fixture_id === "green_verified_issuer") {
      const { accessibility_ref: _removed, ...missingAccessibilityRef } = row
      return missingAccessibilityRef as unknown as ScannerFleetEvidenceRow
    }
    return row
  })

  try {
    makeReferencePacket({ evidenceRows: rows })
    return false
  } catch (error) {
    return isExpectedError(error, "invalid accessibility reference")
  }
}

const throwsDuplicateEvidenceRef = (): boolean => {
  const rows = SCANNER_FLEET_REQUIRED_FIXTURES.map(makeEvidenceRow)
  const firstRow = rows[0]!
  const secondRow = rows[1]!
  rows[1] = {
    ...secondRow,
    screenshot_ref: firstRow.screenshot_ref,
  }

  try {
    makeReferencePacket({ evidenceRows: rows })
    return false
  } catch (error) {
    return isExpectedError(error, "reuses an evidence artifact reference")
  }
}

const throwsRedOutcomeOpened = (): boolean => {
  const rows = SCANNER_FLEET_REQUIRED_FIXTURES.map((fixture, index) => {
    const row = makeEvidenceRow(fixture, index)
    if (fixture.fixture_id === "red_destination_mismatch") {
      return { ...row, hold_completed: true, opened_by_user: true }
    }
    return row
  })

  try {
    makeReferencePacket({ evidenceRows: rows })
    return false
  } catch (error) {
    return isExpectedError(error, "must not open red outcomes")
  }
}

const throwsMalformedReviewerDate = (): boolean => {
  try {
    makeReferencePacket({
      reviewer: {
        name: "QR Trust reviewer",
        role: "reference scanner-fleet smoke",
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
      throw new Error(`Scanner fleet evidence smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
