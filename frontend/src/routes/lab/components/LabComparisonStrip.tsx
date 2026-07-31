import { ArrowRight, GitCompareArrows } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type {
  NonceMode,
  ScenarioKey,
  ScenarioMeta,
} from "@/routes/lab/types"

type LabComparisonStripProps = {
  scenario: ScenarioKey
  nonceMode: NonceMode
  currentScenario: ScenarioMeta
  compareScenario: ScenarioKey | null
  comparisonScenario: ScenarioMeta | null
  onGenerateComparisonDemo: () => void
}

type ScenarioSummary = {
  issuer: string
  destination: string
  redirect: string
  freshness: string
  runtime: string
  expected: string
}

function hostnameFor(payload: string) {
  try {
    return new URL(payload).hostname
  } catch {
    return payload
  }
}

function hostMatchesPolicy(meta: ScenarioMeta) {
  const host = hostnameFor(meta.payload)
  return meta.verifiedDomains.some((domain) => {
    if (host === domain) return true
    return meta.allowSubdomains && host.endsWith(`.${domain}`)
  })
}

function runtimeMarkerFor(meta: ScenarioMeta) {
  try {
    const parsed = new URL(meta.payload)
    return parsed.searchParams.get("runtime") ?? "clean"
  } catch {
    return "clean"
  }
}

function redirectMarkerFor(meta: ScenarioMeta) {
  try {
    const parsed = new URL(meta.payload)
    if (parsed.hostname !== "qr.acme.example") return "none"

    const finalUrl = parsed.searchParams.get("final") ?? ""
    const hops = Number.parseInt(parsed.searchParams.get("hops") ?? "1", 10)
    const nested = parsed.searchParams.get("nested") === "1"

    if (nested) return "nested shortener blocked"
    if (Number.isFinite(hops) && hops > 1) return "too many hops"
    if (finalUrl !== "https://acme.example/pay") return "final destination mismatch"
    return "approved resolver"
  } catch {
    return "none"
  }
}

function summariseScenario(meta: ScenarioMeta): ScenarioSummary {
  const destinationBound = hostMatchesPolicy(meta)
  const expired = meta.expiresOffsetMinutes <= 0
  const runtime = runtimeMarkerFor(meta)
  const redirect = redirectMarkerFor(meta)
  const redirectBlocked = [
    "nested shortener blocked",
    "too many hops",
    "final destination mismatch",
  ].includes(redirect)

  return {
    issuer: meta.certificateRevoked ? "revoked" : "active",
    destination: destinationBound
      ? meta.allowSubdomains
        ? "subdomain policy allows"
        : "exact host bound"
      : "outside approved set",
    redirect,
    freshness: expired ? "expired" : "fresh",
    runtime,
    expected: meta.certificateRevoked
      ? "block at certificate status"
      : expired
        ? "block at time window"
        : !destinationBound
          ? "block at payload revalidation"
          : redirectBlocked
            ? "block at redirect policy"
            : runtime === "risky"
              ? "caution at runtime safety"
              : runtime === "blocked"
                ? "block at runtime safety"
                : "accept first pass",
  }
}

function changedLayer(left: ScenarioSummary, right: ScenarioSummary) {
  if (left.issuer !== right.issuer) return "Issuer state"
  if (left.destination !== right.destination) return "Destination binding"
  if (left.redirect !== right.redirect) return "Resolver policy"
  if (left.freshness !== right.freshness) return "Freshness window"
  if (left.runtime !== right.runtime) return "Runtime safety"
  if (left.expected !== right.expected) return "Verifier decision"
  return "Replay behavior"
}

function SummaryBlock({
  label,
  scenarioKey,
  scenario,
  summary,
}: {
  label: string
  scenarioKey: ScenarioKey
  scenario: ScenarioMeta
  summary: ScenarioSummary
}) {
  return (
    <div className="rounded-[1.1rem] border border-border/70 bg-background/80 p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        <Badge variant="outline" className="max-w-full truncate">
          {scenarioKey}
        </Badge>
      </div>
      <h3 className="mt-2 text-base font-medium text-foreground">
        {scenario.label}
      </h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {scenario.note}
      </p>
      <dl className="mt-4 grid gap-2 text-sm">
        {[
          ["Issuer", summary.issuer],
          ["Destination", summary.destination],
          ["Resolver", summary.redirect],
          ["Freshness", summary.freshness],
          ["Runtime", summary.runtime],
          ["Expected", summary.expected],
        ].map(([key, value]) => (
          <div key={key} className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">{key}</dt>
            <dd className="max-w-[15rem] break-words text-right font-medium text-foreground">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export default function LabComparisonStrip({
  scenario,
  nonceMode,
  currentScenario,
  compareScenario,
  comparisonScenario,
  onGenerateComparisonDemo,
}: LabComparisonStripProps) {
  if (!compareScenario || !comparisonScenario) return null

  const currentSummary = summariseScenario(currentScenario)
  const comparisonSummary = summariseScenario(comparisonScenario)
  const layer = changedLayer(currentSummary, comparisonSummary)

  return (
    <Card className="security-card rounded-[1.9rem] bg-card/94">
      <CardHeader>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Comparison handoff</Badge>
              <Badge variant="outline">nonce: {nonceMode}</Badge>
            </div>
            <CardTitle className="mt-3 text-2xl font-black tracking-[-0.045em]">
              Prove the contrast before leaving the lab.
            </CardTitle>
          </div>
          <Button variant="outline" onClick={onGenerateComparisonDemo}>
            <GitCompareArrows className="size-4" />
            Load paired case
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)]">
        <SummaryBlock
          label="Current case"
          scenarioKey={scenario}
          scenario={currentScenario}
          summary={currentSummary}
        />

        <div className="flex flex-col justify-center rounded-[1.1rem] border border-emerald-900/12 bg-emerald-500/8 p-4 text-center">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-emerald-950/70">
            Expected changed layer
          </p>
          <p className="mt-2 text-lg font-medium text-foreground">{layer}</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Run the current scenario, then load the paired case to show this layer
            changing in the real verifier output.
          </p>
        </div>

        <SummaryBlock
          label="Paired case"
          scenarioKey={compareScenario}
          scenario={comparisonScenario}
          summary={comparisonSummary}
        />
      </CardContent>
    </Card>
  )
}
