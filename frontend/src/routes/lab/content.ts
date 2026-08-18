import type { DemoMaterialsRequest } from "@/lib/verifier-client"
import type {
  NonceMode,
  ScenarioKey,
  ScenarioMeta,
  UsagePolicy,
} from "@/routes/lab/types"

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
      layer: "Freshness and replay",
      summary:
        "The signed envelope is valid structurally, but its time window is already closed.",
    },
  },
  revoked: {
    payload: "https://acme.example/pay",
    verifiedDomains: ["acme.example"],
    allowSubdomains: false,
    certificateRevoked: true,
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
      tone: "green",
      label: "Looks safe",
      layer: "Redirect policy",
      summary:
        "The enrolled resolver ends at a final destination approved by the issuer.",
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
        "The resolver is trusted, but the final destination leaves the approved policy.",
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
        "The final host is approved, but the chain exceeds the allowed hop count.",
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
        "The route hides an extra shortener hop that the issuer policy forbids.",
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

export const fixedNonces: Record<ScenarioKey, string> = {
  valid: "lab-valid-fixed-001",
  expired: "lab-expired-fixed-001",
  revoked: "lab-revoked-fixed-001",
  "subdomain-allowed": "lab-subdomain-allow-001",
  "subdomain-blocked": "lab-subdomain-block-001",
  "payload-mismatch": "lab-mismatch-fixed-001",
  "redirect-approved": "lab-redirect-approved-001",
  "redirect-final-mismatch": "lab-redirect-final-mismatch-001",
  "redirect-too-many-hops": "lab-redirect-hop-limit-001",
  "redirect-nested-shortener": "lab-redirect-nested-001",
  "runtime-risky": "lab-runtime-risky-001",
  "runtime-blocked": "lab-runtime-blocked-001",
  "stale-cache": "lab-stale-cache-001",
  "unknown-issuer": "lab-unknown-issuer-001",
  "artifact-quiet-zone": "lab-artifact-quiet-zone-001",
  "artifact-mismatch": "lab-artifact-mismatch-001",
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

export function parseInitialNonceMode(): NonceMode {
  if (typeof window === "undefined") return "fixed"
  const value = new URLSearchParams(window.location.search).get("nonce")
  return value === "timestamped" ? "timestamped" : "fixed"
}

export function parseInitialUsagePolicy(): UsagePolicy {
  if (typeof window === "undefined") return "reusable_public"
  const value = new URLSearchParams(window.location.search).get("usage")
  if (
    value === "reusable_public" ||
    value === "one_time" ||
    value === "time_limited"
  ) {
    return value
  }
  return "reusable_public"
}

export function shouldAutogenerateFromRoute() {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("autogenerate") === "1"
}

function nonceForScenario(scenario: ScenarioKey, mode: NonceMode) {
  const base = fixedNonces[scenario]
  return mode === "timestamped" ? `${base}-${Date.now()}` : base
}

export function buildScenarioRequest(
  scenario: ScenarioKey,
  nonceMode: NonceMode,
  usagePolicy: UsagePolicy,
): DemoMaterialsRequest {
  const meta = scenarioMeta[scenario]
  return {
    payload: meta.payload,
    nonce: nonceForScenario(scenario, nonceMode),
    usage_policy: usagePolicy,
    governance_cache_profile: meta.governanceCacheProfile ?? "fresh",
    verified_domains: meta.verifiedDomains,
    allow_subdomains: meta.allowSubdomains,
    certificate_active: true,
    certificate_revoked: meta.certificateRevoked,
    certificate_revocation_reason: meta.certificateRevocationReason,
    issued_offset_minutes: meta.issuedOffsetMinutes ?? -1,
    expires_offset_minutes: meta.expiresOffsetMinutes,
    register_scanner_trust: meta.registerScannerTrust ?? true,
    artifact_profile: meta.artifactProfile ?? "clean",
  }
}
