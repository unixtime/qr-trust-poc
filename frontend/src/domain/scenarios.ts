import type { MessageKey } from "@/i18n/catalog/en"
import type { UsagePolicy } from "@/lib/verifier-client"

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

// Group names were the display strings themselves ("Policy-blocked"), which
// made the union untranslatable: the type, the object keys, and the rendered
// label were one value. They are slugs now, with the display text in the
// catalogue.
export type ScenarioGroup =
  | "valid"
  | "tampered"
  | "policyBlocked"
  | "runtimeDegraded"

// `import type` — erased at build time, so the domain layer gains no runtime
// dependency on the catalogue. These maps name copy; they do not hold it.
export const scenarioLabelKeys: Record<ScenarioKey, MessageKey> = {
  valid: "lab.scenario.valid.label",
  expired: "lab.scenario.expired.label",
  revoked: "lab.scenario.revoked.label",
  "subdomain-allowed": "lab.scenario.subdomainAllowed.label",
  "subdomain-blocked": "lab.scenario.subdomainBlocked.label",
  "payload-mismatch": "lab.scenario.payloadMismatch.label",
  "redirect-approved": "lab.scenario.redirectApproved.label",
  "redirect-final-mismatch": "lab.scenario.redirectFinalMismatch.label",
  "redirect-too-many-hops": "lab.scenario.redirectTooManyHops.label",
  "redirect-nested-shortener": "lab.scenario.redirectNestedShortener.label",
  "runtime-risky": "lab.scenario.runtimeRisky.label",
  "runtime-blocked": "lab.scenario.runtimeBlocked.label",
  "stale-cache": "lab.scenario.staleCache.label",
  "unknown-issuer": "lab.scenario.unknownIssuer.label",
  "artifact-quiet-zone": "lab.scenario.artifactQuietZone.label",
  "artifact-mismatch": "lab.scenario.artifactMismatch.label",
}

export const scenarioNoteKeys: Record<ScenarioKey, MessageKey> = {
  valid: "lab.scenario.valid.note",
  expired: "lab.scenario.expired.note",
  revoked: "lab.scenario.revoked.note",
  "subdomain-allowed": "lab.scenario.subdomainAllowed.note",
  "subdomain-blocked": "lab.scenario.subdomainBlocked.note",
  "payload-mismatch": "lab.scenario.payloadMismatch.note",
  "redirect-approved": "lab.scenario.redirectApproved.note",
  "redirect-final-mismatch": "lab.scenario.redirectFinalMismatch.note",
  "redirect-too-many-hops": "lab.scenario.redirectTooManyHops.note",
  "redirect-nested-shortener": "lab.scenario.redirectNestedShortener.note",
  "runtime-risky": "lab.scenario.runtimeRisky.note",
  "runtime-blocked": "lab.scenario.runtimeBlocked.note",
  "stale-cache": "lab.scenario.staleCache.note",
  "unknown-issuer": "lab.scenario.unknownIssuer.note",
  "artifact-quiet-zone": "lab.scenario.artifactQuietZone.note",
  "artifact-mismatch": "lab.scenario.artifactMismatch.note",
}

export const scenarioGroupLabelKeys: Record<ScenarioGroup, MessageKey> = {
  valid: "lab.group.valid",
  tampered: "lab.group.tampered",
  policyBlocked: "lab.group.policyBlocked",
  runtimeDegraded: "lab.group.runtimeDegraded",
}

export const scenarioGroups: Record<ScenarioGroup, ScenarioKey[]> = {
  valid: ["valid", "subdomain-allowed", "redirect-approved"],
  tampered: [
    "payload-mismatch",
    "redirect-final-mismatch",
    "artifact-quiet-zone",
    "artifact-mismatch",
  ],
  policyBlocked: [
    "expired",
    "revoked",
    "subdomain-blocked",
    "redirect-too-many-hops",
    "redirect-nested-shortener",
    "unknown-issuer",
  ],
  runtimeDegraded: ["runtime-risky", "runtime-blocked", "stale-cache"],
}

// Usage policy is not a scenario, but it is the same kind of thing: a wire
// value that also has to be readable. Previously the UI derived its display
// text with `replaceAll("_", " ")`, which is a translation of the identifier
// rather than of the meaning.
export const usagePolicyLabelKeys: Record<UsagePolicy, MessageKey> = {
  reusable_public: "lab.usagePolicy.reusablePublic",
  one_time: "lab.usagePolicy.oneTime",
  time_limited: "lab.usagePolicy.timeLimited",
}

export const scenarioKeys = Object.keys(scenarioLabelKeys) as ScenarioKey[]

export function isScenarioKey(
  value: string | null | undefined
): value is ScenarioKey {
  return typeof value === "string" && value in scenarioLabelKeys
}
