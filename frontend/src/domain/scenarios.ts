export type ScenarioKey =
  | "valid"
  | "expired"
  | "revoked"
  | "subdomain-allowed"
  | "subdomain-blocked"
  | "payload-mismatch"
  | "redirect-approved"
  | "redirect-final-mismatch"
  | "redirect-too-many-hops"
  | "redirect-nested-shortener"
  | "runtime-risky"
  | "runtime-blocked"
  | "stale-cache"
  | "unknown-issuer"
  | "artifact-quiet-zone"
  | "artifact-mismatch"

export type NonceMode = "fixed" | "timestamped"

export type ScenarioGroup =
  | "Valid"
  | "Tampered"
  | "Policy-blocked"
  | "Runtime-degraded"

export const scenarioLabels: Record<ScenarioKey, string> = {
  valid: "Valid first scan",
  expired: "Expired",
  revoked: "Revoked certificate",
  "subdomain-allowed": "Subdomain allowed",
  "subdomain-blocked": "Subdomain blocked",
  "payload-mismatch": "Payload mismatch",
  "redirect-approved": "Approved resolver flow",
  "redirect-final-mismatch": "Resolver final mismatch",
  "redirect-too-many-hops": "Too many redirect hops",
  "redirect-nested-shortener": "Nested shortener",
  "runtime-risky": "Verified issuer, destination risky",
  "runtime-blocked": "Runtime safety blocked",
  "stale-cache": "Stale verifier cache",
  "unknown-issuer": "Signed, unknown issuer",
  "artifact-quiet-zone": "Tampered print: missing quiet zone",
  "artifact-mismatch": "Tampered print: payload mismatch",
}

export const scenarioGroups: Record<ScenarioGroup, ScenarioKey[]> = {
  Valid: ["valid", "subdomain-allowed", "redirect-approved"],
  Tampered: [
    "payload-mismatch",
    "redirect-final-mismatch",
    "artifact-quiet-zone",
    "artifact-mismatch",
  ],
  "Policy-blocked": [
    "expired",
    "revoked",
    "subdomain-blocked",
    "redirect-too-many-hops",
    "redirect-nested-shortener",
    "unknown-issuer",
  ],
  "Runtime-degraded": ["runtime-risky", "runtime-blocked", "stale-cache"],
}

export const scenarioKeys = Object.keys(scenarioLabels) as ScenarioKey[]

export function isScenarioKey(
  value: string | null | undefined
): value is ScenarioKey {
  return typeof value === "string" && value in scenarioLabels
}
