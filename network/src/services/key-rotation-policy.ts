import type { TrustKeyRecord, TrustKeyScope } from "./trust-key-registry.js"

export type RotationAssessmentStatus = "accepted" | "warning" | "rejected"

export type RotationReasonCode =
  | "planned_overlap_accepted"
  | "same_key_id"
  | "scope_mismatch"
  | "root_program_mismatch"
  | "signer_mismatch"
  | "delegated_authority_mismatch"
  | "next_key_not_active"
  | "current_key_terminal_without_emergency"
  | "overlap_too_short"
  | "overlap_too_long"
  | "verifier_cache_outlives_rotation"
  | "emergency_revocation_not_applied"
  | "emergency_revocation_sla_missed"
  | "emergency_revocation_accepted"

export type VerifierCacheRotationInstruction =
  | "accept_overlap"
  | "refresh_before_green"
  | "fail_closed"

export interface TrustKeyRotationPolicy {
  readonly scope: TrustKeyScope
  readonly minimum_overlap_seconds: number
  readonly maximum_overlap_seconds: number
  readonly emergency_revocation_sla_seconds: number
  readonly cache_must_expire_before_retired_key: boolean
}

export interface TrustKeyRotationPlan {
  readonly current_key: TrustKeyRecord
  readonly next_key: TrustKeyRecord
  readonly next_key_activates_at: Date
  readonly current_key_retires_at: Date
  readonly verifier_cache_expires_at?: Date
  readonly emergency_revoked_at?: Date
  readonly emergency_status_event_published_at?: Date
}

export interface TrustKeyRotationAssessment {
  readonly status: RotationAssessmentStatus
  readonly reason_codes: ReadonlyArray<RotationReasonCode>
  readonly overlap_seconds: number
  readonly verifier_cache_instruction: VerifierCacheRotationInstruction
}

export const defaultRootTrustKeyRotationPolicy: TrustKeyRotationPolicy = {
  scope: "root_program",
  minimum_overlap_seconds: 7 * 24 * 60 * 60,
  maximum_overlap_seconds: 45 * 24 * 60 * 60,
  emergency_revocation_sla_seconds: 60 * 60,
  cache_must_expire_before_retired_key: true,
}

export const defaultDelegatedAuthorityTrustKeyRotationPolicy: TrustKeyRotationPolicy =
  {
    scope: "delegated_authority",
    minimum_overlap_seconds: 24 * 60 * 60,
    maximum_overlap_seconds: 14 * 24 * 60 * 60,
    emergency_revocation_sla_seconds: 15 * 60,
    cache_must_expire_before_retired_key: true,
  }

const rejectionCodes = new Set<RotationReasonCode>([
  "same_key_id",
  "scope_mismatch",
  "root_program_mismatch",
  "signer_mismatch",
  "delegated_authority_mismatch",
  "next_key_not_active",
  "current_key_terminal_without_emergency",
  "overlap_too_short",
  "emergency_revocation_not_applied",
])

export const assessTrustKeyRotation = (
  policy: TrustKeyRotationPolicy,
  plan: TrustKeyRotationPlan,
): TrustKeyRotationAssessment => {
  const reasonCodes: RotationReasonCode[] = []
  const overlapSeconds = secondsBetween(
    plan.next_key_activates_at,
    plan.current_key_retires_at,
  )

  if (plan.current_key.key_id === plan.next_key.key_id) {
    reasonCodes.push("same_key_id")
  }

  if (
    plan.current_key.scope !== policy.scope ||
    plan.next_key.scope !== policy.scope
  ) {
    reasonCodes.push("scope_mismatch")
  }

  if (plan.current_key.root_program_id !== plan.next_key.root_program_id) {
    reasonCodes.push("root_program_mismatch")
  }

  if (plan.current_key.signer_id !== plan.next_key.signer_id) {
    reasonCodes.push("signer_mismatch")
  }

  if (
    plan.current_key.scope === "delegated_authority" &&
    plan.current_key.delegated_authority_id !==
      plan.next_key.delegated_authority_id
  ) {
    reasonCodes.push("delegated_authority_mismatch")
  }

  if (plan.next_key.status !== "active") {
    reasonCodes.push("next_key_not_active")
  }

  if (
    !plan.emergency_revoked_at &&
    (plan.current_key.status === "revoked" ||
      plan.current_key.status === "expired")
  ) {
    reasonCodes.push("current_key_terminal_without_emergency")
  }

  if (overlapSeconds < policy.minimum_overlap_seconds) {
    reasonCodes.push("overlap_too_short")
  } else {
    reasonCodes.push("planned_overlap_accepted")
  }

  if (overlapSeconds > policy.maximum_overlap_seconds) {
    reasonCodes.push("overlap_too_long")
  }

  if (
    policy.cache_must_expire_before_retired_key &&
    plan.verifier_cache_expires_at &&
    plan.verifier_cache_expires_at.getTime() >
      plan.current_key_retires_at.getTime()
  ) {
    reasonCodes.push("verifier_cache_outlives_rotation")
  }

  if (plan.emergency_revoked_at) {
    if (
      plan.current_key.status !== "revoked" &&
      plan.current_key.status !== "suspended"
    ) {
      reasonCodes.push("emergency_revocation_not_applied")
    } else {
      reasonCodes.push("emergency_revocation_accepted")
    }

    if (plan.emergency_status_event_published_at) {
      const publishLatencySeconds = secondsBetween(
        plan.emergency_revoked_at,
        plan.emergency_status_event_published_at,
      )
      if (publishLatencySeconds > policy.emergency_revocation_sla_seconds) {
        reasonCodes.push("emergency_revocation_sla_missed")
      }
    }
  }

  const status = assessmentStatus(reasonCodes)

  return {
    status,
    reason_codes: dedupe(reasonCodes),
    overlap_seconds: overlapSeconds,
    verifier_cache_instruction: cacheInstruction(status, reasonCodes),
  }
}

const assessmentStatus = (
  reasonCodes: ReadonlyArray<RotationReasonCode>,
): RotationAssessmentStatus => {
  if (reasonCodes.some((code) => rejectionCodes.has(code))) {
    return "rejected"
  }

  if (
    reasonCodes.includes("overlap_too_long") ||
    reasonCodes.includes("verifier_cache_outlives_rotation") ||
    reasonCodes.includes("emergency_revocation_sla_missed")
  ) {
    return "warning"
  }

  return "accepted"
}

const cacheInstruction = (
  status: RotationAssessmentStatus,
  reasonCodes: ReadonlyArray<RotationReasonCode>,
): VerifierCacheRotationInstruction => {
  if (status === "rejected") {
    return "fail_closed"
  }

  if (
    reasonCodes.includes("verifier_cache_outlives_rotation") ||
    reasonCodes.includes("emergency_revocation_accepted")
  ) {
    return "refresh_before_green"
  }

  return "accept_overlap"
}

const secondsBetween = (start: Date, end: Date): number =>
  Math.floor((end.getTime() - start.getTime()) / 1000)

const dedupe = <T>(values: ReadonlyArray<T>): ReadonlyArray<T> => [
  ...new Set(values),
]
