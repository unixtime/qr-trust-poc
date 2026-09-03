import type { MessageKey } from "@/i18n/catalog/en"
import type { DemoMaterialsRequest, DemoTrustEcho } from "@/lib/verifier-client"
import type { ScenarioKey, ScenarioMeta } from "@/routes/lab/types"

export const scenarioMeta: Record<ScenarioKey, ScenarioMeta> = {
  valid: {
    payload: "https://acme.example/pay",
    verifiedDomains: ["acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    expectedOutcome: {
      tone: "green",
      label: "Looks safe",
      layer: "Verifier state",
      summary:
        "Issuer legitimacy, destination binding, and runtime checks should all pass.",
    },
  },
  expired: {
    payload: "https://acme.example/pay",
    verifiedDomains: ["acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    issuedOffsetMinutes: -10,
    expiresOffsetMinutes: -2,
    expectedOutcome: {
      tone: "red",
      label: "Do not open",
      layer: "Freshness",
      summary:
        "The signed envelope is valid structurally, but its time window is already closed.",
    },
  },
  revoked: {
    payload: "https://acme.example/pay",
    verifiedDomains: ["acme.example"],
    allowSubdomains: false,
    certificateRevoked: true,
    keyState: "revoked",
    certificateRevocationReason: "Issuer revoked this demo certificate for testing.",
    expiresOffsetMinutes: 5,
    expectedOutcome: {
      tone: "red",
      label: "Do not open",
      layer: "Issuer legitimacy",
      summary:
        "The issuer certificate has been revoked, so later destination checks should not rescue it.",
    },
  },
  "key-rotated": {
    payload: "https://acme.example/pay",
    verifiedDomains: ["acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    rotateKey: true,
    expectedOutcome: {
      tone: "green",
      label: "Safe to open",
      layer: "Issuer legitimacy",
      summary:
        "The issuer rotated its signing key; this code is signed under the new key and verifies, and a code sealed before the rotation still verifies under the retired key.",
    },
  },
  "key-revoked": {
    payload: "https://acme.example/pay",
    verifiedDomains: ["acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: "Issuer revoked this signing key for testing.",
    expiresOffsetMinutes: 5,
    keyState: "revoked",
    expectedOutcome: {
      tone: "red",
      label: "Do not open",
      layer: "Issuer legitimacy",
      summary:
        "The signing key is revoked, so everything signed under it is blocked — including codes that were valid before the revocation.",
    },
  },
  "subdomain-allowed": {
    payload: "https://checkout.acme.example/pay",
    verifiedDomains: ["acme.example"],
    allowSubdomains: true,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    expectedOutcome: {
      tone: "green",
      label: "Looks safe",
      layer: "Destination binding",
      summary:
        "The subdomain is allowed by issuer policy, so the destination remains bound.",
    },
  },
  "subdomain-blocked": {
    payload: "https://checkout.acme.example/pay",
    verifiedDomains: ["acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    expectedOutcome: {
      tone: "red",
      label: "Do not open",
      layer: "Destination binding",
      summary:
        "The subdomain is outside the issuer-approved destination policy.",
    },
  },
  "payload-mismatch": {
    payload: "https://rogue.example/phish",
    verifiedDomains: ["acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    expectedOutcome: {
      tone: "red",
      label: "Do not open",
      layer: "Destination binding",
      summary:
        "A valid signature does not make a rogue destination issuer-approved.",
    },
  },
  "redirect-approved": {
    payload:
      "https://qr.acme.example/r/pay?final=https%3A%2F%2Facme.example%2Fpay&hops=1",
    verifiedDomains: ["qr.acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    expectedOutcome: {
      tone: "red",
      label: "Do not open",
      layer: "Redirect policy",
      summary:
        "The resolver is enrolled, but this build has no live observer to confirm its final destination.",
    },
  },
  "redirect-final-mismatch": {
    payload:
      "https://qr.acme.example/r/pay?final=https%3A%2F%2Fevil.example%2Fpay&hops=1",
    verifiedDomains: ["qr.acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    expectedOutcome: {
      tone: "red",
      label: "Do not open",
      layer: "Redirect policy",
      summary:
        "The asserted final target is fixture input, not an observed redirect result.",
    },
  },
  "redirect-too-many-hops": {
    payload:
      "https://qr.acme.example/r/pay?final=https%3A%2F%2Facme.example%2Fpay&hops=3",
    verifiedDomains: ["qr.acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    expectedOutcome: {
      tone: "red",
      label: "Do not open",
      layer: "Redirect policy",
      summary:
        "The asserted hop count is fixture input, not an observed redirect chain.",
    },
  },
  "redirect-nested-shortener": {
    payload:
      "https://qr.acme.example/r/pay?final=https%3A%2F%2Facme.example%2Fpay&hops=1&nested=1",
    verifiedDomains: ["qr.acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    expectedOutcome: {
      tone: "red",
      label: "Do not open",
      layer: "Redirect policy",
      summary:
        "The asserted nested-hop flag is fixture input, not an observed redirect chain.",
    },
  },
  "runtime-risky": {
    payload: "https://acme.example/pay?runtime=risky",
    verifiedDomains: ["acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    expectedOutcome: {
      tone: "amber",
      label: "Use caution",
      layer: "Runtime safety",
      summary:
        "Issuer and binding checks pass, but present-time destination risk is elevated.",
    },
  },
  "runtime-blocked": {
    payload: "https://acme.example/pay?runtime=blocked",
    verifiedDomains: ["acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    expectedOutcome: {
      tone: "red",
      label: "Do not open",
      layer: "Runtime safety",
      summary:
        "Issuer and binding checks pass, but scan-time safety blocks the destination.",
    },
  },
  "stale-cache": {
    payload: "https://acme.example/pay",
    verifiedDomains: ["acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    governanceCacheProfile: "stale",
    expectedOutcome: {
      tone: "amber",
      label: "Use caution",
      layer: "Verifier cache",
      summary:
        "The destination can match policy, but stale shared state should prevent a positive trust badge.",
    },
  },
  "unknown-issuer": {
    payload: "https://acme.example/pay",
    verifiedDomains: ["acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    registerScannerTrust: false,
    expectedOutcome: {
      tone: "amber",
      label: "Use caution",
      layer: "Issuer legitimacy",
      summary:
        "The signature is intact, but the scanner cannot trace the certificate to an enrolled issuer, so it must not show a positive badge.",
    },
  },
  "artifact-quiet-zone": {
    payload: "https://acme.example/pay",
    verifiedDomains: ["acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    artifactProfile: "low-quiet-zone",
    expectedOutcome: {
      tone: "amber",
      label: "Use caution",
      layer: "Artifact integrity",
      summary:
        "Issuer and destination verify, but the scanned image itself looks tampered, so the scanner downgrades to a caution instead of a positive badge.",
    },
  },
  "artifact-mismatch": {
    payload: "https://acme.example/pay",
    verifiedDomains: ["acme.example"],
    allowSubdomains: false,
    certificateRevoked: false,
    certificateRevocationReason: null,
    expiresOffsetMinutes: 5,
    artifactProfile: "payload-mismatch",
    expectedOutcome: {
      tone: "red",
      label: "Do not open",
      layer: "Artifact integrity",
      summary:
        "The decoded image does not match the submitted payload, so the scan blocks at artifact integrity before issuer or destination checks can run.",
    },
  },
}

const scenarioKeys = Object.keys(scenarioMeta) as ScenarioKey[]

function isScenarioKey(value: string | null): value is ScenarioKey {
  return scenarioKeys.includes(value as ScenarioKey)
}

export function parseInitialScenarioParam(): ScenarioKey {
  if (typeof window === "undefined") return "valid"
  const value = new URLSearchParams(window.location.search).get("scenario")
  if (isScenarioKey(value)) {
    return value
  }
  return "valid"
}

export function parseInitialCompareScenarioParam(): ScenarioKey | null {
  if (typeof window === "undefined") return null
  const value = new URLSearchParams(window.location.search).get("compare")
  if (isScenarioKey(value)) {
    return value
  }
  return null
}

export function shouldAutogenerateFromRoute() {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("autogenerate") === "1"
}

// How long a freshly sealed demo QR stays valid. The window is the only
// freshness input the verifier reads, so the workbench keeps it short enough
// that a session cannot outlive the code it just sealed. The scenario's own
// `expiresOffsetMinutes` is a floor, not the value: it keeps its sign (which
// is what the comparison card's freshness row reads) and a non-positive
// offset -- the `expired` scenario -- wins whatever the operator picked.
export const DEFAULT_LIFETIME_MINUTES = 5

// Thirty days: long enough for any poster-style code the workbench should
// seal, short enough that a slip in the picker cannot mint a year-long claim.
// The server enforces the same bound on `expires_offset_minutes`.
export const MAX_LIFETIME_MINUTES = 30 * 24 * 60

export function lifetimeMinutesFor(
  meta: Pick<ScenarioMeta, "expiresOffsetMinutes">,
  customMinutes: number | null = null,
): number {
  if (meta.expiresOffsetMinutes <= 0) return meta.expiresOffsetMinutes
  if (customMinutes !== null && customMinutes > 0) return customMinutes
  return Math.max(meta.expiresOffsetMinutes, DEFAULT_LIFETIME_MINUTES)
}

// `<input type="datetime-local">` speaks wall-clock time with no zone, so the
// picker value is formatted and parsed with the local getters on both sides:
// the instant the operator sees is the instant the request seals.
function pad2(value: number) {
  return String(value).padStart(2, "0")
}

export function expiryInputValue(epochMs: number): string {
  const at = new Date(epochMs)
  const date = `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`
  return `${date}T${pad2(at.getHours())}:${pad2(at.getMinutes())}`
}

// Minutes from `now` to the picked instant, or null when nothing usable was
// picked. Callers decide what an empty or unparsable pick means.
export function customExpiryMinutes(localValue: string | null, now = Date.now()): number | null {
  if (!localValue) return null
  const at = Date.parse(localValue)
  if (Number.isNaN(at)) return null
  return Math.round((at - now) / 60_000)
}

export type ExpiryProblem = "invalid" | "past" | "tooFar"

export function expiryValidation(localValue: string | null, now = Date.now()): ExpiryProblem | null {
  if (!localValue) return null
  const minutes = customExpiryMinutes(localValue, now)
  if (minutes === null) return "invalid"
  if (minutes <= 0) return "past"
  if (minutes > MAX_LIFETIME_MINUTES) return "tooFar"
  return null
}

export type ScenarioRequestOptions = {
  customExpiryMinutes?: number | null
}

export function buildScenarioRequest(
  scenario: ScenarioKey,
  options: ScenarioRequestOptions = {},
): DemoMaterialsRequest {
  const meta = scenarioMeta[scenario]
  return {
    payload: meta.payload,
    governance_cache_profile: meta.governanceCacheProfile ?? "fresh",
    verified_domains: meta.verifiedDomains,
    allow_subdomains: meta.allowSubdomains,
    certificate_active: true,
    certificate_revoked: meta.certificateRevoked,
    certificate_revocation_reason: meta.certificateRevocationReason,
    issued_offset_minutes: meta.issuedOffsetMinutes ?? -1,
    expires_offset_minutes: lifetimeMinutesFor(meta, options.customExpiryMinutes ?? null),
    register_scanner_trust: meta.registerScannerTrust ?? true,
    key_state: meta.keyState,
    rotate_key: meta.rotateKey ?? false,
    artifact_profile: meta.artifactProfile ?? "clean",
  }
}

/**
 * The toast title after a successful generation. Decided from the trust echo
 * the backend returned, not from the chip that was clicked: the first
 * `key-rotated` press on a fresh backend retires nothing and gets the plain
 * title, and any chip that produced a revoked key says so.
 */
export function generateToastTitleKey(
  meta: ScenarioMeta,
  trust: DemoTrustEcho
): MessageKey {
  if (trust.key_state === "revoked") {
    return "lab.generate.keyRevoked.title"
  }
  if (meta.rotateKey && trust.retired_key_refs.length > 0) {
    return "lab.generate.rotated.title"
  }
  return "lab.generate.ready.title"
}
