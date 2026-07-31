import { Console, Effect } from "effect"

import {
  assessTrustKeyRotation,
  defaultDelegatedAuthorityTrustKeyRotationPolicy,
  defaultRootTrustKeyRotationPolicy,
  demoDelegatedAuthorityTrustKey,
  demoRootTrustKey,
  type TrustKeyRecord,
} from "../index.js"

const activatedAt = new Date("2026-05-18T00:00:00Z")

const program = Effect.gen(function* () {
  const delegatedV2: TrustKeyRecord = {
    ...demoDelegatedAuthorityTrustKey,
    key_id: "key:authority:qrtrust-demo:merchant-web:ed25519:v2",
    public_key_material_ref:
      "pem://fixture/authority/qrtrust-demo-merchant-web-v2",
  }

  const plannedDelegatedRotation = assessTrustKeyRotation(
    defaultDelegatedAuthorityTrustKeyRotationPolicy,
    {
      current_key: demoDelegatedAuthorityTrustKey,
      next_key: delegatedV2,
      next_key_activates_at: activatedAt,
      current_key_retires_at: plusSeconds(activatedAt, 2 * 24 * 60 * 60),
      verifier_cache_expires_at: plusSeconds(activatedAt, 30 * 60),
    },
  )

  const shortOverlap = assessTrustKeyRotation(
    defaultDelegatedAuthorityTrustKeyRotationPolicy,
    {
      current_key: demoDelegatedAuthorityTrustKey,
      next_key: delegatedV2,
      next_key_activates_at: activatedAt,
      current_key_retires_at: plusSeconds(activatedAt, 60 * 60),
    },
  )

  const staleCache = assessTrustKeyRotation(
    defaultDelegatedAuthorityTrustKeyRotationPolicy,
    {
      current_key: demoDelegatedAuthorityTrustKey,
      next_key: delegatedV2,
      next_key_activates_at: activatedAt,
      current_key_retires_at: plusSeconds(activatedAt, 2 * 24 * 60 * 60),
      verifier_cache_expires_at: plusSeconds(activatedAt, 3 * 24 * 60 * 60),
    },
  )

  const emergencyRevocation = assessTrustKeyRotation(
    defaultDelegatedAuthorityTrustKeyRotationPolicy,
    {
      current_key: {
        ...demoDelegatedAuthorityTrustKey,
        status: "revoked",
      },
      next_key: delegatedV2,
      next_key_activates_at: activatedAt,
      current_key_retires_at: plusSeconds(activatedAt, 2 * 24 * 60 * 60),
      emergency_revoked_at: activatedAt,
      emergency_status_event_published_at: plusSeconds(activatedAt, 5 * 60),
    },
  )

  const rootV2: TrustKeyRecord = {
    ...demoRootTrustKey,
    key_id: "key:root:qrtrust-demo:2026:ed25519:v2",
    public_key_material_ref: "pem://fixture/root/qrtrust-demo-2026-v2",
  }

  const plannedRootRotation = assessTrustKeyRotation(
    defaultRootTrustKeyRotationPolicy,
    {
      current_key: demoRootTrustKey,
      next_key: rootV2,
      next_key_activates_at: activatedAt,
      current_key_retires_at: plusSeconds(activatedAt, 14 * 24 * 60 * 60),
      verifier_cache_expires_at: plusSeconds(activatedAt, 60 * 60),
    },
  )

  yield* assertSmoke(
    plannedDelegatedRotation.status === "accepted",
    "delegated authority planned rotation should be accepted",
  )
  yield* assertSmoke(
    plannedDelegatedRotation.verifier_cache_instruction === "accept_overlap",
    "planned rotation should keep overlap cache behavior",
  )
  yield* assertSmoke(
    shortOverlap.status === "rejected" &&
      shortOverlap.reason_codes.includes("overlap_too_short"),
    "short overlap should fail closed",
  )
  yield* assertSmoke(
    staleCache.status === "warning" &&
      staleCache.verifier_cache_instruction === "refresh_before_green",
    "cache outliving retired key should force refresh before green",
  )
  yield* assertSmoke(
    emergencyRevocation.status === "accepted" &&
      emergencyRevocation.verifier_cache_instruction === "refresh_before_green",
    "emergency revocation should be accepted only with cache refresh behavior",
  )
  yield* assertSmoke(
    plannedRootRotation.status === "accepted",
    "root planned rotation should satisfy the longer root overlap policy",
  )

  yield* Console.log(
    JSON.stringify(
      {
        delegated_rotation: plannedDelegatedRotation,
        short_overlap: shortOverlap,
        stale_cache: staleCache,
        emergency_revocation: emergencyRevocation,
        root_rotation: plannedRootRotation,
      },
      null,
      2,
    ),
  )
})

const plusSeconds = (date: Date, seconds: number): Date =>
  new Date(date.getTime() + seconds * 1000)

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Key rotation policy smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
