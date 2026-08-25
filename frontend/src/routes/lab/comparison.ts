/**
 * Pure A/B comparison of two lab scenarios.
 *
 * Every scenario in `content.ts` is the `valid` case with exactly one trust
 * layer perturbed. This module reduces a `ScenarioMeta` to one token per
 * layer so the UI can show which single layer separates two cases — and stay
 * honest (`layer: null`) when nothing does. Tokens, never display strings:
 * the catalogue owns the words (`comparisonValueKeys`).
 *
 * Only `import type` on purpose: `scripts/comparison-smoke.mjs` loads this
 * file straight into node with `--experimental-strip-types`, which erases
 * type imports but cannot resolve the `@/` alias for value imports.
 */
import type { MessageKey } from "@/i18n/catalog/en"
import type { ScenarioMeta } from "@/routes/lab/types"

/** Evidence layers in verification order; the first differing one is "the change". */
export const comparisonLayers = [
  "issuer",
  "destination",
  "redirect",
  "freshness",
  "runtime",
  "cache",
  "artifact",
  "decision",
] as const

export type ComparisonLayer = (typeof comparisonLayers)[number]

export const comparisonLayerLabelKeys = {
  issuer: "lab.compare.layer.issuer",
  destination: "lab.compare.layer.destination",
  redirect: "lab.compare.layer.redirect",
  freshness: "lab.compare.layer.freshness",
  runtime: "lab.compare.layer.runtime",
  cache: "lab.compare.layer.cache",
  artifact: "lab.compare.layer.artifact",
  decision: "lab.compare.layer.decision",
} as const satisfies Record<ComparisonLayer, MessageKey>

export const comparisonValueKeys = {
  issuer: {
    active: "lab.compare.value.issuer.active",
    revoked: "lab.compare.value.issuer.revoked",
    unenrolled: "lab.compare.value.issuer.unenrolled",
  },
  destination: {
    exact: "lab.compare.value.destination.exact",
    subdomain: "lab.compare.value.destination.subdomain",
    outside: "lab.compare.value.destination.outside",
  },
  redirect: {
    none: "lab.compare.value.redirect.none",
    approved: "lab.compare.value.redirect.approved",
    nestedShortener: "lab.compare.value.redirect.nestedShortener",
    tooManyHops: "lab.compare.value.redirect.tooManyHops",
    finalMismatch: "lab.compare.value.redirect.finalMismatch",
  },
  freshness: {
    fresh: "lab.compare.value.freshness.fresh",
    expired: "lab.compare.value.freshness.expired",
  },
  runtime: {
    clean: "lab.compare.value.runtime.clean",
    risky: "lab.compare.value.runtime.risky",
    blocked: "lab.compare.value.runtime.blocked",
  },
  cache: {
    fresh: "lab.compare.value.cache.fresh",
    stale: "lab.compare.value.cache.stale",
    expired: "lab.compare.value.cache.expired",
  },
  artifact: {
    clean: "lab.compare.value.artifact.clean",
    lowQuietZone: "lab.compare.value.artifact.lowQuietZone",
    payloadMismatch: "lab.compare.value.artifact.payloadMismatch",
  },
  decision: {
    green: "lab.compare.value.decision.green",
    amber: "lab.compare.value.decision.amber",
    red: "lab.compare.value.decision.red",
  },
} as const satisfies Record<ComparisonLayer, Record<string, MessageKey>>

export type ScenarioSummary = {
  [L in ComparisonLayer]: keyof (typeof comparisonValueKeys)[L]
}

export type ComparisonRow = {
  layer: ComparisonLayer
  currentKey: MessageKey
  pairedKey: MessageKey
  differs: boolean
}

export type ScenarioComparison = {
  /** First layer that differs, or null when the two scenarios are evidence-identical. */
  layer: ComparisonLayer | null
  rows: ComparisonRow[]
}

/*
 * Fixture vocabulary mirrored from `content.ts`: the approved resolver host and
 * the destination it may forward to. `comparison-smoke.mjs` pins these to the
 * documented `expectedOutcome.layer` of every scenario, so drift fails CI.
 */
const approvedResolverHost = "qr.acme.example"
const approvedResolverFinal = "https://acme.example/pay"

function parsePayload(payload: string): URL | null {
  try {
    return new URL(payload)
  } catch {
    return null
  }
}

function issuerFor(meta: ScenarioMeta): ScenarioSummary["issuer"] {
  if (meta.certificateRevoked) return "revoked"
  if (meta.registerScannerTrust === false) return "unenrolled"
  return "active"
}

function destinationFor(meta: ScenarioMeta): ScenarioSummary["destination"] {
  const host = parsePayload(meta.payload)?.hostname ?? meta.payload
  if (meta.verifiedDomains.includes(host)) return "exact"
  const underVerifiedDomain = meta.verifiedDomains.some((domain) =>
    host.endsWith(`.${domain}`),
  )
  if (meta.allowSubdomains && underVerifiedDomain) return "subdomain"
  return "outside"
}

function redirectFor(meta: ScenarioMeta): ScenarioSummary["redirect"] {
  const url = parsePayload(meta.payload)
  if (!url || url.hostname !== approvedResolverHost) return "none"
  if (url.searchParams.get("nested") === "1") return "nestedShortener"
  const hops = Number.parseInt(url.searchParams.get("hops") ?? "1", 10)
  if (Number.isFinite(hops) && hops > 1) return "tooManyHops"
  if (url.searchParams.get("final") !== approvedResolverFinal) return "finalMismatch"
  return "approved"
}

function freshnessFor(meta: ScenarioMeta): ScenarioSummary["freshness"] {
  return meta.expiresOffsetMinutes > 0 ? "fresh" : "expired"
}

function runtimeFor(meta: ScenarioMeta): ScenarioSummary["runtime"] {
  const signal = parsePayload(meta.payload)?.searchParams.get("runtime")
  if (signal === "risky" || signal === "blocked") return signal
  return "clean"
}

function cacheFor(meta: ScenarioMeta): ScenarioSummary["cache"] {
  return meta.governanceCacheProfile ?? "fresh"
}

function artifactFor(meta: ScenarioMeta): ScenarioSummary["artifact"] {
  switch (meta.artifactProfile) {
    case "low-quiet-zone":
      return "lowQuietZone"
    case "payload-mismatch":
      return "payloadMismatch"
    default:
      return "clean"
  }
}

export function summariseScenario(meta: ScenarioMeta): ScenarioSummary {
  return {
    issuer: issuerFor(meta),
    destination: destinationFor(meta),
    redirect: redirectFor(meta),
    freshness: freshnessFor(meta),
    runtime: runtimeFor(meta),
    cache: cacheFor(meta),
    artifact: artifactFor(meta),
    decision: meta.expectedOutcome.tone,
  }
}

function valueKey<L extends ComparisonLayer>(layer: L, token: ScenarioSummary[L]): MessageKey {
  return (comparisonValueKeys[layer] as Record<string, MessageKey>)[token as string]
}

export function compareScenarios(current: ScenarioMeta, paired: ScenarioMeta): ScenarioComparison {
  const a = summariseScenario(current)
  const b = summariseScenario(paired)
  const rows = comparisonLayers.map((layer) => ({
    layer,
    currentKey: valueKey(layer, a[layer]),
    pairedKey: valueKey(layer, b[layer]),
    differs: a[layer] !== b[layer],
  }))
  return { layer: rows.find((row) => row.differs)?.layer ?? null, rows }
}
