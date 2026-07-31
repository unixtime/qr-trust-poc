export const PRODUCTION_EVIDENCE_REVIEW_ROLES = [
  "database_operator",
  "release_owner",
  "security_reviewer",
  "operations_reviewer",
  "custody_operator",
  "runtime_operator",
] as const

export type ProductionEvidenceReviewRole =
  (typeof PRODUCTION_EVIDENCE_REVIEW_ROLES)[number]

export const PRODUCTION_EVIDENCE_REVIEW_ROLE_SET = new Set<string>(
  PRODUCTION_EVIDENCE_REVIEW_ROLES,
)
