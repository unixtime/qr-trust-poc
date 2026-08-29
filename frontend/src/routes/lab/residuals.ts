import type { ResidualFamily, ResidualTier, ResidualVector } from "@/lib/verifier-client"

export const residualFamilyOrder: readonly ResidualFamily[] = [
  "issuer_chain",
  "destination_policy",
  "redirect_flow",
  "runtime_safety",
  "freshness",
  "artifact_integrity",
]

// Lattice rank: 0 = no residual, 5 = terminal. Mirrors DECISION_SEMANTICS ordering.
export const residualTierRank: Record<ResidualTier, number> = {
  pass: 0,
  "not-applicable": 0,
  "not-checked": 1,
  unknown: 1,
  unavailable: 1,
  stale: 2,
  warn: 3,
  fail: 4,
  "unaccepted-issuer": 4,
  "invalid-managed-claim": 5,
  "revoked-issuer": 5,
  block: 5,
}

export function tierRank(tier: string): number {
  return Object.hasOwn(residualTierRank, tier)
    ? residualTierRank[tier as ResidualTier]
    : 4
}

/** Highest-ranked family; ties resolve to the first in family order; all rank 0 → null. */
export function decidingFamily(vector: ResidualVector): ResidualFamily | null {
  let best: ResidualFamily | null = null
  let bestRank = 0
  for (const family of residualFamilyOrder) {
    const rank = tierRank(vector[family]?.tier ?? "unknown")
    if (rank > bestRank) {
      best = family
      bestRank = rank
    }
  }
  return best
}

export type ResidualTone = "green" | "muted" | "amber" | "red"

export function residualTone(tier: string): ResidualTone {
  if (tier === "pass") return "green"
  if (tier === "not-applicable") return "muted"
  const rank = tierRank(tier)
  return rank >= 4 ? "red" : "amber"
}
