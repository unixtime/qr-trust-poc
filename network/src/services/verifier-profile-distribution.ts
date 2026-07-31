import { isSha256Fingerprint } from "./fingerprint-validation.js"

export const VERIFIER_PROFILE_DISTRIBUTION_CHANNELS = [
  "mdm",
  "enterprise_app_configuration",
  "signed_app_bundle",
  "signed_remote_profile",
  "browser_managed_profile",
  "scanner_sdk_configuration",
] as const

export type VerifierProfileDistributionChannel =
  (typeof VERIFIER_PROFILE_DISTRIBUTION_CHANNELS)[number]

export const VERIFIER_PROFILE_GREEN_CONTROLS = [
  "issuer_recognized",
  "destination_bound",
  "runtime_clear",
  "cache_fresh",
] as const

export const VERIFIER_PROFILE_HOLD_TRIGGERS = [
  "decision_color_orange",
  "decision_color_red",
  "caption_domain_mismatch",
  "risk_score_gte_30",
] as const

export type VerifierProfileDistributionStatus =
  | "active"
  | "not_yet_valid"
  | "expired"
  | "revoked"

export interface VerifierProfileColorPolicy {
  readonly green_requires: ReadonlyArray<string>
  readonly orange_conditions: ReadonlyArray<string>
  readonly red_conditions: ReadonlyArray<string>
}

export interface VerifierProfileHoldToOpenPolicy {
  readonly enabled: boolean
  readonly duration_ms: number
  readonly trigger_conditions: ReadonlyArray<string>
}

export interface VerifierProfileDistributionMetadata {
  readonly channel: VerifierProfileDistributionChannel
  readonly publisher: string
  readonly scanner_build_constraint: string
}

export interface VerifierProfileArtifact {
  readonly artifact_type: "verifier_profile"
  readonly profile_id: string
  readonly profile_version: number
  readonly profile_fingerprint: string
  readonly root_program_id: string
  readonly accepted_delegated_authority_ids: ReadonlyArray<string>
  readonly verifier_id: string
  readonly scanner_decision_endpoint: string
  readonly runtime_safety_policy_id: string
  readonly cache_freshness_budget_seconds: number
  readonly decision_color_policy: VerifierProfileColorPolicy
  readonly hold_to_open_policy: VerifierProfileHoldToOpenPolicy
  readonly valid_from: string
  readonly valid_until: string
  readonly signing_key_id: string
  readonly signature: string
  readonly distribution: VerifierProfileDistributionMetadata
}

export interface VerifierProfileDistributionPolicy {
  readonly acceptedRootProgramIds: ReadonlyArray<string>
  readonly acceptedDelegatedAuthorityIds: ReadonlyArray<string>
  readonly acceptedSigningKeyIds: ReadonlyArray<string>
  readonly expectedScannerDecisionEndpoint?: string
  readonly revokedProfileFingerprints?: ReadonlyArray<string>
  readonly minimumHoldDurationMs?: number
}

export interface VerifierProfileDistributionReceipt {
  readonly artifact_type: "verifier_profile_distribution_receipt"
  readonly received_at: string
  readonly status: VerifierProfileDistributionStatus
  readonly profile_id: string
  readonly profile_version: number
  readonly profile_fingerprint: string
  readonly root_program_id: string
  readonly accepted_delegated_authority_ids: ReadonlyArray<string>
  readonly verifier_id: string
  readonly scanner_decision_endpoint: string
  readonly runtime_safety_policy_id: string
  readonly cache_freshness_budget_seconds: number
  readonly signing_key_id: string
  readonly distribution_channel: VerifierProfileDistributionChannel
  readonly reviewer_notes: ReadonlyArray<string>
}

export type VerifierProfileDistributionReportStatus =
  | "active"
  | "blocked_by_profile"

export type VerifierProfileDistributionControlStatus = "passed" | "blocked"

export type VerifierProfileDistributionControlId =
  | "profile_scope"
  | "endpoint_binding"
  | "signature_binding"
  | "validity_window"
  | "color_policy"
  | "hold_to_open_policy"
  | "scanner_receipt_logging"

export interface VerifierProfileDistributionControlCheck {
  readonly id: VerifierProfileDistributionControlId
  readonly status: VerifierProfileDistributionControlStatus
  readonly summary: string
  readonly detail: string
}

export interface VerifierProfileDistributionReportConfig {
  readonly generatedAt: string
  readonly observedAt: string
  readonly profile: VerifierProfileArtifact
  readonly policy: VerifierProfileDistributionPolicy
}

export interface VerifierProfileDistributionReport {
  readonly artifact_type: "verifier_profile_distribution_report"
  readonly schema_version: "2026-05-22"
  readonly generated_at: string
  readonly observed_at: string
  readonly status: VerifierProfileDistributionReportStatus
  readonly profile: {
    readonly profile_id: string
    readonly profile_version: number
    readonly profile_fingerprint: string
    readonly root_program_id: string
    readonly accepted_delegated_authority_ids: ReadonlyArray<string>
    readonly verifier_id: string
    readonly scanner_decision_endpoint: string
    readonly runtime_safety_policy_id: string
    readonly distribution_channel: VerifierProfileDistributionChannel
  }
  readonly policy: {
    readonly accepted_root_program_ids: ReadonlyArray<string>
    readonly accepted_delegated_authority_ids: ReadonlyArray<string>
    readonly accepted_signing_key_ids: ReadonlyArray<string>
    readonly expected_scanner_decision_endpoint?: string
    readonly minimum_hold_duration_ms: number
  }
  readonly receipt?: VerifierProfileDistributionReceipt
  readonly error?: string
  readonly checks: ReadonlyArray<VerifierProfileDistributionControlCheck>
  readonly next_actions: ReadonlyArray<string>
  readonly review_notes: ReadonlyArray<string>
}

const DEFAULT_MINIMUM_HOLD_DURATION_MS = 800

export const makeVerifierProfileDistributionReceipt = (
  profile: VerifierProfileArtifact,
  policy: VerifierProfileDistributionPolicy,
  receivedAt: string,
): VerifierProfileDistributionReceipt => {
  assertVerifierProfile(profile, policy, receivedAt)

  return {
    artifact_type: "verifier_profile_distribution_receipt",
    received_at: receivedAt,
    status: profileDistributionStatus(profile, policy, receivedAt),
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    profile_fingerprint: profile.profile_fingerprint,
    root_program_id: profile.root_program_id,
    accepted_delegated_authority_ids: [
      ...profile.accepted_delegated_authority_ids,
    ],
    verifier_id: profile.verifier_id,
    scanner_decision_endpoint: profile.scanner_decision_endpoint,
    runtime_safety_policy_id: profile.runtime_safety_policy_id,
    cache_freshness_budget_seconds: profile.cache_freshness_budget_seconds,
    signing_key_id: profile.signing_key_id,
    distribution_channel: profile.distribution.channel,
    reviewer_notes: [
      "Profile distribution is scanner-side managed trust state, not QR payload data.",
      "Scanner decisions should persist this profile fingerprint with every scan record.",
    ],
  }
}

export const makeVerifierProfileDistributionReport = ({
  generatedAt,
  observedAt,
  profile,
  policy,
}: VerifierProfileDistributionReportConfig): VerifierProfileDistributionReport => {
  let receipt: VerifierProfileDistributionReceipt | undefined
  let error: string | undefined

  try {
    receipt = makeVerifierProfileDistributionReceipt(profile, policy, observedAt)
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught)
  }

  const status: VerifierProfileDistributionReportStatus = receipt
    ? "active"
    : "blocked_by_profile"

  return {
    artifact_type: "verifier_profile_distribution_report",
    schema_version: "2026-05-22",
    generated_at: generatedAt,
    observed_at: observedAt,
    status,
    profile: {
      profile_id: profile.profile_id,
      profile_version: profile.profile_version,
      profile_fingerprint: profile.profile_fingerprint,
      root_program_id: profile.root_program_id,
      accepted_delegated_authority_ids: [
        ...profile.accepted_delegated_authority_ids,
      ],
      verifier_id: profile.verifier_id,
      scanner_decision_endpoint: profile.scanner_decision_endpoint,
      runtime_safety_policy_id: profile.runtime_safety_policy_id,
      distribution_channel: profile.distribution.channel,
    },
    policy: {
      accepted_root_program_ids: [...policy.acceptedRootProgramIds],
      accepted_delegated_authority_ids: [
        ...policy.acceptedDelegatedAuthorityIds,
      ],
      accepted_signing_key_ids: [...policy.acceptedSigningKeyIds],
      ...(policy.expectedScannerDecisionEndpoint
        ? {
            expected_scanner_decision_endpoint:
              policy.expectedScannerDecisionEndpoint,
          }
        : {}),
      minimum_hold_duration_ms:
        policy.minimumHoldDurationMs ?? DEFAULT_MINIMUM_HOLD_DURATION_MS,
    },
    ...(receipt ? { receipt } : {}),
    ...(error ? { error } : {}),
    checks: makeDistributionControlChecks(profile, policy, observedAt, receipt, error),
    next_actions: distributionReportNextActions(status),
    review_notes: [
      "This report covers scanner-side verifier profile distribution, not QR payload validation.",
      "A scanner release should keep this profile fingerprint with every scan decision record.",
      "A blocked profile means the scanner should fail closed or degrade to an unverified/orange state before opening links.",
    ],
  }
}

export const assertVerifierProfile = (
  profile: VerifierProfileArtifact,
  policy: VerifierProfileDistributionPolicy,
  observedAt: string,
): void => {
  assertBasicShape(profile)
  assertDateTime("observed_at", observedAt)
  assertDateTime("valid_from", profile.valid_from)
  assertDateTime("valid_until", profile.valid_until)

  if (!isSha256Fingerprint(profile.profile_fingerprint)) {
    throw new Error("Verifier profile fingerprint must be sha256-prefixed.")
  }

  if (!profile.scanner_decision_endpoint.startsWith("https://")) {
    throw new Error("Verifier profile scanner decision endpoint must use HTTPS.")
  }

  if (
    policy.expectedScannerDecisionEndpoint
    && profile.scanner_decision_endpoint !== policy.expectedScannerDecisionEndpoint
  ) {
    throw new Error("Verifier profile scanner decision endpoint does not match policy.")
  }

  if (!policy.acceptedRootProgramIds.includes(profile.root_program_id)) {
    throw new Error("Verifier profile root program is not accepted by local policy.")
  }

  const acceptedAuthority = profile.accepted_delegated_authority_ids.some(
    (authorityId) => policy.acceptedDelegatedAuthorityIds.includes(authorityId),
  )
  if (!acceptedAuthority) {
    throw new Error("Verifier profile delegates to no accepted authority.")
  }

  if (!policy.acceptedSigningKeyIds.includes(profile.signing_key_id)) {
    throw new Error("Verifier profile signing key is not accepted by local policy.")
  }

  if (!profile.signature.startsWith("ed25519:")) {
    throw new Error("Verifier profile signature must identify the signature scheme.")
  }

  if (profile.cache_freshness_budget_seconds < 1) {
    throw new Error("Verifier profile cache freshness budget must be positive.")
  }

  assertColorPolicy(profile.decision_color_policy)
  assertHoldPolicy(
    profile.hold_to_open_policy,
    policy.minimumHoldDurationMs ?? DEFAULT_MINIMUM_HOLD_DURATION_MS,
  )

  if (!VERIFIER_PROFILE_DISTRIBUTION_CHANNELS.includes(profile.distribution.channel)) {
    throw new Error("Verifier profile distribution channel is not supported.")
  }

  const status = profileDistributionStatus(profile, policy, observedAt)
  if (status !== "active") {
    throw new Error(`Verifier profile is not active: ${status}.`)
  }
}

export const profileDistributionStatus = (
  profile: Pick<
    VerifierProfileArtifact,
    "profile_fingerprint" | "valid_from" | "valid_until"
  >,
  policy: Pick<VerifierProfileDistributionPolicy, "revokedProfileFingerprints">,
  observedAt: string,
): VerifierProfileDistributionStatus => {
  if (policy.revokedProfileFingerprints?.includes(profile.profile_fingerprint)) {
    return "revoked"
  }

  const observed = Date.parse(observedAt)
  const validFrom = Date.parse(profile.valid_from)
  const validUntil = Date.parse(profile.valid_until)

  if (observed < validFrom) {
    return "not_yet_valid"
  }
  if (observed > validUntil) {
    return "expired"
  }
  return "active"
}

const makeDistributionControlChecks = (
  profile: VerifierProfileArtifact,
  policy: VerifierProfileDistributionPolicy,
  observedAt: string,
  receipt: VerifierProfileDistributionReceipt | undefined,
  error: string | undefined,
): ReadonlyArray<VerifierProfileDistributionControlCheck> => [
  profileScopeCheck(profile, policy),
  endpointBindingCheck(profile, policy),
  signatureBindingCheck(profile, policy),
  validityWindowCheck(profile, policy, observedAt),
  colorPolicyCheck(profile),
  holdToOpenPolicyCheck(profile, policy),
  scannerReceiptLoggingCheck(receipt, error),
]

const profileScopeCheck = (
  profile: VerifierProfileArtifact,
  policy: VerifierProfileDistributionPolicy,
): VerifierProfileDistributionControlCheck => {
  const rootAccepted = policy.acceptedRootProgramIds.includes(
    profile.root_program_id,
  )
  const acceptedAuthorities = profile.accepted_delegated_authority_ids.filter(
    (authorityId) => policy.acceptedDelegatedAuthorityIds.includes(authorityId),
  )
  return check(
    "profile_scope",
    rootAccepted && acceptedAuthorities.length > 0,
    "Profile is scoped to an accepted root and delegated authority.",
    `root=${profile.root_program_id}; accepted_authorities=${acceptedAuthorities.join(", ") || "none"}`,
  )
}

const endpointBindingCheck = (
  profile: VerifierProfileArtifact,
  policy: VerifierProfileDistributionPolicy,
): VerifierProfileDistributionControlCheck => {
  const usesHttps = profile.scanner_decision_endpoint.startsWith("https://")
  const matchesExpected =
    !policy.expectedScannerDecisionEndpoint
    || profile.scanner_decision_endpoint === policy.expectedScannerDecisionEndpoint
  return check(
    "endpoint_binding",
    usesHttps && matchesExpected,
    "Scanner decision endpoint is HTTPS-bound and matches local policy.",
    `endpoint=${profile.scanner_decision_endpoint}; expected=${policy.expectedScannerDecisionEndpoint ?? "not pinned"}`,
  )
}

const signatureBindingCheck = (
  profile: VerifierProfileArtifact,
  policy: VerifierProfileDistributionPolicy,
): VerifierProfileDistributionControlCheck =>
  check(
    "signature_binding",
    isSha256Fingerprint(profile.profile_fingerprint)
      && policy.acceptedSigningKeyIds.includes(profile.signing_key_id)
      && profile.signature.startsWith("ed25519:"),
    "Profile fingerprint and signing key are locally accepted.",
    `fingerprint=${profile.profile_fingerprint}; signing_key=${profile.signing_key_id}; signature_scheme=${profile.signature.split(":", 1)[0] || "unknown"}`,
  )

const validityWindowCheck = (
  profile: VerifierProfileArtifact,
  policy: VerifierProfileDistributionPolicy,
  observedAt: string,
): VerifierProfileDistributionControlCheck => {
  const datesAreValid =
    !Number.isNaN(Date.parse(observedAt))
    && !Number.isNaN(Date.parse(profile.valid_from))
    && !Number.isNaN(Date.parse(profile.valid_until))
  const status = datesAreValid
    ? profileDistributionStatus(profile, policy, observedAt)
    : "expired"
  return check(
    "validity_window",
    datesAreValid && status === "active",
    "Profile is active at the observation time and is not revoked.",
    `observed_at=${observedAt}; valid_from=${profile.valid_from}; valid_until=${profile.valid_until}; status=${datesAreValid ? status : "invalid_date"}`,
  )
}

const colorPolicyCheck = (
  profile: VerifierProfileArtifact,
): VerifierProfileDistributionControlCheck => {
  const missingGreenControls = VERIFIER_PROFILE_GREEN_CONTROLS.filter(
    (control) => !profile.decision_color_policy.green_requires.includes(control),
  )
  const hasDowngrades =
    profile.decision_color_policy.orange_conditions.length > 0
    && profile.decision_color_policy.red_conditions.length > 0
  return check(
    "color_policy",
    missingGreenControls.length === 0 && hasDowngrades,
    "Green, orange, and red decision states preserve the paper's trust layers.",
    `missing_green_controls=${missingGreenControls.join(", ") || "none"}; orange_conditions=${profile.decision_color_policy.orange_conditions.length}; red_conditions=${profile.decision_color_policy.red_conditions.length}`,
  )
}

const holdToOpenPolicyCheck = (
  profile: VerifierProfileArtifact,
  policy: VerifierProfileDistributionPolicy,
): VerifierProfileDistributionControlCheck => {
  const minimumDuration =
    policy.minimumHoldDurationMs ?? DEFAULT_MINIMUM_HOLD_DURATION_MS
  const missingTriggers = VERIFIER_PROFILE_HOLD_TRIGGERS.filter(
    (trigger) => !profile.hold_to_open_policy.trigger_conditions.includes(trigger),
  )
  return check(
    "hold_to_open_policy",
    profile.hold_to_open_policy.enabled
      && profile.hold_to_open_policy.duration_ms >= minimumDuration
      && missingTriggers.length === 0,
    "Hold-to-open is enabled for risky or mismatched scanner-visible outcomes.",
    `enabled=${profile.hold_to_open_policy.enabled}; duration_ms=${profile.hold_to_open_policy.duration_ms}; minimum_ms=${minimumDuration}; missing_triggers=${missingTriggers.join(", ") || "none"}`,
  )
}

const scannerReceiptLoggingCheck = (
  receipt: VerifierProfileDistributionReceipt | undefined,
  error: string | undefined,
): VerifierProfileDistributionControlCheck =>
  check(
    "scanner_receipt_logging",
    Boolean(receipt),
    "Scanner can persist a distribution receipt with profile fingerprint.",
    receipt
      ? `receipt_profile_fingerprint=${receipt.profile_fingerprint}; status=${receipt.status}`
      : `receipt_unavailable=${error ?? "unknown error"}`,
  )

const check = (
  id: VerifierProfileDistributionControlId,
  passed: boolean,
  summary: string,
  detail: string,
): VerifierProfileDistributionControlCheck => ({
  id,
  status: passed ? "passed" : "blocked",
  summary,
  detail,
})

const distributionReportNextActions = (
  status: VerifierProfileDistributionReportStatus,
): ReadonlyArray<string> => {
  if (status === "active") {
    return [
      "Attach this report to scanner release evidence before native capture.",
      "Run make network-deployed-scanner-readiness-report to combine profile distribution with scanner-fleet and native provider-profile evidence.",
      "Keep the profile fingerprint in scan logs so each scanner-visible decision is auditable.",
    ]
  }

  return [
    "Do not claim deployed scanner readiness until the verifier profile report is active.",
    "Fix the blocked profile control, regenerate this report, then rerun deployed-scanner readiness.",
    "Scanner clients should degrade to unverified/orange or fail closed while profile distribution is blocked.",
  ]
}

const assertBasicShape = (profile: VerifierProfileArtifact): void => {
  if (profile.artifact_type !== "verifier_profile") {
    throw new Error("Verifier profile artifact_type must be verifier_profile.")
  }
  assertNonEmptyString("profile_id", profile.profile_id)
  if (!Number.isInteger(profile.profile_version) || profile.profile_version < 1) {
    throw new Error("Verifier profile version must be a positive integer.")
  }
  assertNonEmptyString("root_program_id", profile.root_program_id)
  assertNonEmptyString("verifier_id", profile.verifier_id)
  assertNonEmptyString("runtime_safety_policy_id", profile.runtime_safety_policy_id)
  assertNonEmptyString("signing_key_id", profile.signing_key_id)
  assertNonEmptyString("signature", profile.signature)
  if (profile.accepted_delegated_authority_ids.length === 0) {
    throw new Error("Verifier profile must accept at least one delegated authority.")
  }
}

const assertColorPolicy = (policy: VerifierProfileColorPolicy): void => {
  const missingGreenControls = VERIFIER_PROFILE_GREEN_CONTROLS.filter(
    (control) => !policy.green_requires.includes(control),
  )
  if (missingGreenControls.length > 0) {
    throw new Error(
      `Verifier profile green policy is missing controls: ${missingGreenControls.join(", ")}.`,
    )
  }
  if (policy.orange_conditions.length === 0) {
    throw new Error("Verifier profile orange policy must list downgrade conditions.")
  }
  if (policy.red_conditions.length === 0) {
    throw new Error("Verifier profile red policy must list block conditions.")
  }
}

const assertHoldPolicy = (
  policy: VerifierProfileHoldToOpenPolicy,
  minimumDurationMs: number,
): void => {
  if (!policy.enabled) {
    throw new Error("Verifier profile hold-to-open policy must be enabled.")
  }
  if (policy.duration_ms < minimumDurationMs) {
    throw new Error(
      `Verifier profile hold-to-open duration must be at least ${minimumDurationMs}ms.`,
    )
  }

  const missingTriggers = VERIFIER_PROFILE_HOLD_TRIGGERS.filter(
    (trigger) => !policy.trigger_conditions.includes(trigger),
  )
  if (missingTriggers.length > 0) {
    throw new Error(
      `Verifier profile hold-to-open policy is missing triggers: ${missingTriggers.join(", ")}.`,
    )
  }
}

const assertNonEmptyString = (label: string, value: string): void => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Verifier profile ${label} must be a non-empty string.`)
  }
}

const assertDateTime = (label: string, value: string): void => {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Verifier profile ${label} must be an ISO date-time string.`)
  }
}
