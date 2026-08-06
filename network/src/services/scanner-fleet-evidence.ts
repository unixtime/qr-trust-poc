import type { DecisionColor } from "../contracts.js"
import { assertEvidenceReviewDate } from "./evidence-review.js"
import {
  isSha256Fingerprint,
  validateCompactDomainFingerprint,
} from "./fingerprint-validation.js"

export const SCANNER_FLEET_REQUIRED_FIXTURES = [
  {
    fixture_id: "green_reusable_public",
    expected_color: "green",
    expected_state: "verified_issuer",
  },
  {
    fixture_id: "green_one_time_first_pass",
    expected_color: "green",
    expected_state: "verified_issuer",
  },
  {
    fixture_id: "red_one_time_replay",
    expected_color: "red",
    expected_state: "one_time_replay",
  },
  {
    fixture_id: "red_expired_qr",
    expected_color: "red",
    expected_state: "expired",
  },
  {
    fixture_id: "red_destination_mismatch",
    expected_color: "red",
    expected_state: "destination_policy_mismatch",
  },
  {
    fixture_id: "red_resolver_final_target_mismatch",
    expected_color: "red",
    expected_state: "resolver_final_target_mismatch",
  },
  {
    fixture_id: "orange_plain_url_unrecognized",
    expected_color: "orange",
    expected_state: "plain_url_unrecognized",
  },
  {
    fixture_id: "orange_verifier_unavailable_visible_destination",
    expected_color: "orange",
    expected_state: "verifier_unavailable_visible_destination",
  },
  {
    fixture_id: "orange_stale_verifier_profile",
    expected_color: "orange",
    expected_state: "profile_stale",
  },
  {
    fixture_id: "red_revoked_verifier_profile",
    expected_color: "red",
    expected_state: "profile_revoked",
  },
] as const satisfies ReadonlyArray<ScannerFleetFixture>

export type ScannerFleetRequiredFixtureId =
  (typeof SCANNER_FLEET_REQUIRED_FIXTURES)[number]["fixture_id"]

export interface ScannerFleetApp {
  readonly name: string
  readonly platform: string
  readonly build_version: string
  readonly os_version?: string
}

export interface VerifierProfileReference {
  readonly profile_id: string
  readonly profile_version: number
  readonly profile_fingerprint: string
}

export interface ScannerFleetFixture {
  readonly fixture_id: string
  readonly expected_color: DecisionColor
  readonly expected_state: string
}

export interface ScannerFleetEvidenceRow {
  readonly fixture_id: string
  readonly decision_id: string
  readonly scanner_client_id: string
  readonly scanner_build: string
  readonly profile_fingerprint: string
  readonly decision_color: DecisionColor
  readonly decision_state: string
  readonly reason_codes: ReadonlyArray<string>
  readonly domain_fingerprint: string
  readonly opened_by_user: boolean
  readonly hold_required: boolean
  readonly hold_completed: boolean
  readonly observed_at: string
  readonly screenshot_ref: string
  readonly history_entry_ref: string
  readonly accessibility_ref: string
}

export type ScannerFleetEvidenceArtifactKind =
  | "screenshot"
  | "history_entry"
  | "accessibility"

export interface ScannerFleetEvidenceArtifactRef {
  readonly fixture_id: string
  readonly decision_id: string
  readonly kind: ScannerFleetEvidenceArtifactKind
  readonly path: string
}

export interface ScannerFleetReviewer {
  readonly name: string
  readonly role: string
  readonly reviewed_at: string
}

export interface ScannerFleetPrivacyPosture {
  readonly raw_urls_redacted: boolean
  readonly secrets_included: false
  readonly notes?: string
}

export interface ScannerFleetEvidencePacket {
  readonly artifact_type: "scanner_fleet_evidence_packet"
  readonly packet_id: string
  readonly generated_at: string
  readonly scanner_app: ScannerFleetApp
  readonly active_verifier_profile: VerifierProfileReference
  readonly scanner_decision_endpoint_fingerprint: string
  readonly fixture_matrix: ReadonlyArray<ScannerFleetFixture>
  readonly evidence_rows: ReadonlyArray<ScannerFleetEvidenceRow>
  readonly reviewer: ScannerFleetReviewer
  readonly privacy: ScannerFleetPrivacyPosture
}

export interface ScannerFleetEvidencePacketConfig {
  readonly packetId: string
  readonly generatedAt: string
  readonly scannerApp: ScannerFleetApp
  readonly activeVerifierProfile: VerifierProfileReference
  readonly scannerDecisionEndpointFingerprint: string
  readonly evidenceRows: ReadonlyArray<ScannerFleetEvidenceRow>
  readonly reviewer: ScannerFleetReviewer
  readonly privacy: ScannerFleetPrivacyPosture
  readonly fixtureMatrix?: ReadonlyArray<ScannerFleetFixture>
}

const EVIDENCE_REF_PREFIX = "docs/public/evidence/iphone/"

export const makeScannerFleetEvidencePacket = (
  config: ScannerFleetEvidencePacketConfig,
): ScannerFleetEvidencePacket => {
  const fixtureMatrix =
    config.fixtureMatrix ?? SCANNER_FLEET_REQUIRED_FIXTURES

  const packet: ScannerFleetEvidencePacket = {
    artifact_type: "scanner_fleet_evidence_packet",
    packet_id: config.packetId,
    generated_at: config.generatedAt,
    scanner_app: config.scannerApp,
    active_verifier_profile: config.activeVerifierProfile,
    scanner_decision_endpoint_fingerprint:
      config.scannerDecisionEndpointFingerprint,
    fixture_matrix: fixtureMatrix,
    evidence_rows: config.evidenceRows,
    reviewer: config.reviewer,
    privacy: config.privacy,
  }

  assertScannerFleetEvidencePacket(packet)

  return packet
}

export const assertScannerFleetEvidencePacket = (
  packet: ScannerFleetEvidencePacket,
): void => {
  assertFingerprint(
    packet.active_verifier_profile.profile_fingerprint,
    "active verifier profile fingerprint",
  )
  assertFingerprint(
    packet.scanner_decision_endpoint_fingerprint,
    "scanner decision endpoint fingerprint",
  )
  assertPrivacy(packet.privacy)
  assertReviewer(packet.reviewer, packet.packet_id)

  const artifactPaths = new Set<string>()
  const fixturesById = new Map(
    packet.fixture_matrix.map((fixture) => [fixture.fixture_id, fixture]),
  )
  const rowsByFixture = groupRowsByFixture(packet.evidence_rows)

  for (const requiredFixture of SCANNER_FLEET_REQUIRED_FIXTURES) {
    if (!fixturesById.has(requiredFixture.fixture_id)) {
      throw new Error(
        `Scanner fleet evidence missing required fixture: ${requiredFixture.fixture_id}`,
      )
    }
    if (!rowsByFixture.has(requiredFixture.fixture_id)) {
      throw new Error(
        `Scanner fleet evidence missing evidence row for fixture: ${requiredFixture.fixture_id}`,
      )
    }
  }

  for (const row of packet.evidence_rows) {
    const fixture = fixturesById.get(row.fixture_id)
    if (!fixture) {
      throw new Error(
        `Scanner fleet evidence row references unknown fixture: ${row.fixture_id}`,
      )
    }

    assertFingerprint(row.profile_fingerprint, "evidence row profile fingerprint")
    assertReasonCodes(row.reason_codes, row.fixture_id, row.decision_state)
    assertDomainFingerprint(row.domain_fingerprint, row.fixture_id)
    assertEvidenceRef(row.screenshot_ref, "screenshot", ".png", row.fixture_id)
    assertEvidenceRef(
      row.history_entry_ref,
      "history entry",
      ".png",
      row.fixture_id,
    )
    assertEvidenceRef(
      row.accessibility_ref,
      "accessibility",
      ".txt",
      row.fixture_id,
    )
    assertUniqueArtifactRef(artifactPaths, row.screenshot_ref, row.fixture_id)
    assertUniqueArtifactRef(artifactPaths, row.history_entry_ref, row.fixture_id)
    assertUniqueArtifactRef(artifactPaths, row.accessibility_ref, row.fixture_id)
    assertDateTime(row.observed_at, "observed_at", row.fixture_id)

    if (
      row.profile_fingerprint !==
      packet.active_verifier_profile.profile_fingerprint
    ) {
      throw new Error(
        `Scanner fleet evidence row uses a different profile fingerprint: ${row.fixture_id}`,
      )
    }

    if (
      row.decision_color !== fixture.expected_color ||
      row.decision_state !== fixture.expected_state
    ) {
      throw new Error(
        `Scanner fleet evidence row does not match fixture expectation: ${row.fixture_id}`,
      )
    }

    if (row.decision_color !== "green" && !row.hold_required) {
      throw new Error(
        `Scanner fleet evidence row must require hold-to-open for non-green outcome: ${row.fixture_id}`,
      )
    }

    if (row.opened_by_user && row.hold_required && !row.hold_completed) {
      throw new Error(
        `Scanner fleet evidence row opened without completed hold: ${row.fixture_id}`,
      )
    }

    if (row.decision_color === "red" && row.opened_by_user) {
      throw new Error(
        `Scanner fleet evidence row must not open red outcomes: ${row.fixture_id}`,
      )
    }
  }
}

export const collectScannerFleetEvidenceArtifactRefs = (
  packet: ScannerFleetEvidencePacket,
): ReadonlyArray<ScannerFleetEvidenceArtifactRef> => {
  assertScannerFleetEvidencePacket(packet)

  return packet.evidence_rows.flatMap((row) => [
    {
      fixture_id: row.fixture_id,
      decision_id: row.decision_id,
      kind: "screenshot" as const,
      path: row.screenshot_ref,
    },
    {
      fixture_id: row.fixture_id,
      decision_id: row.decision_id,
      kind: "history_entry" as const,
      path: row.history_entry_ref,
    },
    {
      fixture_id: row.fixture_id,
      decision_id: row.decision_id,
      kind: "accessibility" as const,
      path: row.accessibility_ref,
    },
  ])
}

const groupRowsByFixture = (
  rows: ReadonlyArray<ScannerFleetEvidenceRow>,
): Map<string, ReadonlyArray<ScannerFleetEvidenceRow>> => {
  const grouped = new Map<string, ScannerFleetEvidenceRow[]>()
  for (const row of rows) {
    const bucket = grouped.get(row.fixture_id) ?? []
    bucket.push(row)
    grouped.set(row.fixture_id, bucket)
  }
  return grouped
}

const assertFingerprint = (value: string, label: string): void => {
  if (!isSha256Fingerprint(value)) {
    throw new Error(`Scanner fleet evidence has invalid ${label}: ${value}`)
  }
}

// Decision states whose path returns before destination binding is ever
// evaluated, so an evidence row in one of these states cannot attest to it:
//   one_time_replay  - narrowed verifier returns at the replay_guard stage
//                      before match_payload_to_verified_domains runs
//   expired          - the time_window stage returns before any payload match
//   profile_revoked  - the certificate_status stage returns first
//   plain_url_unrecognized / verifier_unavailable_visible_destination
//                    - no verified issuer profile to bind a destination against
// The verifier reports destination_binding as "not_evaluated" for each of
// them. profile_stale is deliberately absent: a stale cache still binds the
// destination against the cached profile and does emit destination_bound.
const DESTINATION_BINDING_NOT_EVALUATED_STATES: ReadonlySet<string> = new Set([
  "one_time_replay",
  "expired",
  "profile_revoked",
  "plain_url_unrecognized",
  "verifier_unavailable_visible_destination",
])

const DESTINATION_BINDING_REASON_CODE = "destination_bound"

const assertReasonCodes = (
  reasonCodes: ReadonlyArray<string>,
  fixtureId: string,
  decisionState: string,
): void => {
  if (reasonCodes.length === 0 || reasonCodes.some((code) => code.trim() === "")) {
    throw new Error(
      `Scanner fleet evidence row must include non-empty reason codes: ${fixtureId}`,
    )
  }
  if (
    DESTINATION_BINDING_NOT_EVALUATED_STATES.has(decisionState) &&
    reasonCodes.includes(DESTINATION_BINDING_REASON_CODE)
  ) {
    throw new Error(
      `Scanner fleet evidence row claims ${DESTINATION_BINDING_REASON_CODE} but decision state ` +
        `${decisionState} stops before destination binding is evaluated: ${fixtureId}`,
    )
  }
}

const assertDomainFingerprint = (
  domainFingerprint: string,
  fixtureId: string,
): void => {
  const validation = validateCompactDomainFingerprint(domainFingerprint)
  if (validation.valid) {
    return
  }

  if (validation.reason !== "raw_url_token") {
    throw new Error(
      `Scanner fleet evidence row has invalid domain fingerprint: ${fixtureId}`,
    )
  }

  throw new Error(
    `Scanner fleet evidence row domain fingerprint must not expose a raw URL: ${fixtureId}`,
  )
}

const assertEvidenceRef = (
  value: string,
  label: string,
  expectedExtension: string,
  fixtureId: string,
): void => {
  if (
    typeof value !== "string" ||
    !value.startsWith(EVIDENCE_REF_PREFIX) ||
    value.includes("..") ||
    !value.endsWith(expectedExtension)
  ) {
    throw new Error(
      `Scanner fleet evidence row has invalid ${label} reference: ${fixtureId}`,
    )
  }
}

const assertUniqueArtifactRef = (
  artifactPaths: Set<string>,
  value: string,
  fixtureId: string,
): void => {
  if (artifactPaths.has(value)) {
    throw new Error(
      `Scanner fleet evidence row reuses an evidence artifact reference: ${fixtureId}`,
    )
  }

  artifactPaths.add(value)
}

const assertDateTime = (
  value: string,
  label: string,
  fixtureId: string,
): void => {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(
      `Scanner fleet evidence row has invalid ${label}: ${fixtureId}`,
    )
  }
}

const assertPrivacy = (privacy: ScannerFleetPrivacyPosture): void => {
  if (privacy.secrets_included !== false) {
    throw new Error("Scanner fleet evidence must not include secrets.")
  }

  if (!privacy.raw_urls_redacted) {
    throw new Error(
      "Scanner fleet evidence must redact raw URLs before public handoff.",
    )
  }
}

const assertReviewer = (
  reviewer: ScannerFleetReviewer,
  packetId: string,
): void => {
  if (typeof reviewer !== "object" || reviewer === null) {
    throw new Error(
      `Scanner fleet evidence reviewer must be an object: ${packetId}`,
    )
  }
  if (typeof reviewer.name !== "string" || reviewer.name.trim() === "") {
    throw new Error(`Scanner fleet evidence reviewer needs name: ${packetId}`)
  }
  if (typeof reviewer.role !== "string" || reviewer.role.trim() === "") {
    throw new Error(`Scanner fleet evidence reviewer needs role: ${packetId}`)
  }
  assertEvidenceReviewDate(
    reviewer.reviewed_at,
    "Scanner fleet evidence",
    "reviewer.reviewed_at",
    packetId,
  )
}
