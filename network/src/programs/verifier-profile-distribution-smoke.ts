import { readFileSync } from "node:fs"

import { Console, Effect } from "effect"

import {
  assertVerifierProfile,
  makeVerifierProfileDistributionReceipt,
  type VerifierProfileArtifact,
  type VerifierProfileDistributionPolicy,
} from "../index.js"

const OBSERVED_AT = "2026-05-20T12:00:00.000Z"

const POLICY = {
  acceptedRootProgramIds: ["root:qrtrust-demo:2026"],
  acceptedDelegatedAuthorityIds: ["authority:qrtrust-demo:merchant-web"],
  acceptedSigningKeyIds: [
    "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
  ],
  expectedScannerDecisionEndpoint: "https://qrtrust.local:8443/scanner/decisions",
  revokedProfileFingerprints: [],
  minimumHoldDurationMs: 800,
} satisfies VerifierProfileDistributionPolicy

const program = Effect.gen(function* () {
  const profile = loadReferenceProfile()
  const receipt = makeVerifierProfileDistributionReceipt(profile, POLICY, OBSERVED_AT)
  const negativeCases = [
    ["http endpoint", throwsHttpEndpoint],
    ["expired profile", throwsExpiredProfile],
    ["revoked profile", throwsRevokedProfile],
    ["missing green control", throwsMissingGreenControl],
    ["disabled hold-to-open", throwsDisabledHoldToOpen],
    ["short hold duration", throwsShortHoldDuration],
    ["missing hold trigger", throwsMissingHoldTrigger],
    ["unaccepted authority", throwsUnacceptedAuthority],
    ["endpoint mismatch", throwsEndpointMismatch],
    ["unaccepted signing key", throwsUnacceptedSigningKey],
  ] as const

  yield* assertSmoke(
    receipt.artifact_type === "verifier_profile_distribution_receipt",
    "receipt artifact type should be stable",
  )
  yield* assertSmoke(receipt.status === "active", "reference profile should be active")
  yield* assertSmoke(
    receipt.profile_fingerprint === profile.profile_fingerprint,
    "receipt should preserve the active profile fingerprint",
  )
  yield* assertSmoke(
    receipt.distribution_channel === "signed_app_bundle",
    "reference profile should document its distribution channel",
  )

  for (const [label, assertion] of negativeCases) {
    yield* assertSmoke(assertion(profile), `negative case failed: ${label}`)
  }

  yield* Console.log(
    JSON.stringify(
      {
        status: "ok",
        profile_id: receipt.profile_id,
        profile_fingerprint: receipt.profile_fingerprint,
        distribution_channel: receipt.distribution_channel,
        negative_cases: negativeCases.length,
      },
      null,
      2,
    ),
  )
})

const loadReferenceProfile = (): VerifierProfileArtifact =>
  JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/public/network-contracts/examples/verifier-profile-reference.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as VerifierProfileArtifact

const throwsHttpEndpoint = (profile: VerifierProfileArtifact): boolean =>
  throwsExpected(
    {
      ...profile,
      scanner_decision_endpoint: profile.scanner_decision_endpoint.replace(
        "https://",
        "http://",
      ),
    },
    POLICY,
    "must use HTTPS",
  )

const throwsExpiredProfile = (profile: VerifierProfileArtifact): boolean =>
  throwsExpected(
    { ...profile, valid_until: "2026-05-19T23:59:59.000Z" },
    POLICY,
    "not active: expired",
  )

const throwsRevokedProfile = (profile: VerifierProfileArtifact): boolean =>
  throwsExpected(
    profile,
    {
      ...POLICY,
      revokedProfileFingerprints: [profile.profile_fingerprint],
    },
    "not active: revoked",
  )

const throwsMissingGreenControl = (profile: VerifierProfileArtifact): boolean =>
  throwsExpected(
    {
      ...profile,
      decision_color_policy: {
        ...profile.decision_color_policy,
        green_requires: profile.decision_color_policy.green_requires.filter(
          (control) => control !== "runtime_clear",
        ),
      },
    },
    POLICY,
    "missing controls",
  )

const throwsDisabledHoldToOpen = (profile: VerifierProfileArtifact): boolean =>
  throwsExpected(
    {
      ...profile,
      hold_to_open_policy: {
        ...profile.hold_to_open_policy,
        enabled: false,
      },
    },
    POLICY,
    "must be enabled",
  )

const throwsShortHoldDuration = (profile: VerifierProfileArtifact): boolean =>
  throwsExpected(
    {
      ...profile,
      hold_to_open_policy: {
        ...profile.hold_to_open_policy,
        duration_ms: 300,
      },
    },
    POLICY,
    "at least 800ms",
  )

const throwsMissingHoldTrigger = (profile: VerifierProfileArtifact): boolean =>
  throwsExpected(
    {
      ...profile,
      hold_to_open_policy: {
        ...profile.hold_to_open_policy,
        trigger_conditions: profile.hold_to_open_policy.trigger_conditions.filter(
          (trigger) => trigger !== "risk_score_gte_30",
        ),
      },
    },
    POLICY,
    "missing triggers",
  )

const throwsUnacceptedAuthority = (profile: VerifierProfileArtifact): boolean =>
  throwsExpected(
    {
      ...profile,
      accepted_delegated_authority_ids: [
        "authority:qrtrust-demo:unaccepted",
      ],
    },
    POLICY,
    "no accepted authority",
  )

const throwsEndpointMismatch = (profile: VerifierProfileArtifact): boolean =>
  throwsExpected(
    profile,
    {
      ...POLICY,
      expectedScannerDecisionEndpoint:
        "https://another-verifier.example/scanner/decisions",
    },
    "endpoint does not match",
  )

const throwsUnacceptedSigningKey = (profile: VerifierProfileArtifact): boolean =>
  throwsExpected(
    { ...profile, signing_key_id: "key:qrtrust-demo:unaccepted" },
    POLICY,
    "signing key is not accepted",
  )

const throwsExpected = (
  profile: VerifierProfileArtifact,
  policy: VerifierProfileDistributionPolicy,
  message: string,
): boolean => {
  try {
    assertVerifierProfile(profile, policy, OBSERVED_AT)
    return false
  } catch (error) {
    return error instanceof Error && error.message.includes(message)
  }
}

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Verifier profile distribution smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
