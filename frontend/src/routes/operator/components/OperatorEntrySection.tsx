import { ArrowRight, ShieldCheck, Waypoints } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export type OperatorEntryContext = {
  focus: "runtime" | "access"
  source: string | null
  scenario: string | null
  compareScenario: string | null
  recommendedLabPath: string
}

type OperatorEntrySectionProps = {
  context: OperatorEntryContext
  onNavigate: (path: string) => void
  onJumpToRuntime: () => void
  onJumpToAccess: () => void
}

function describeSource(source: string | null) {
  if (!source) return "direct operator visit"
  if (source === "committee-review") return "committee review handoff"
  if (source === "reviewer-defense") return "reviewer mode handoff"
  if (source === "professor-seminar") return "professor mode handoff"
  return source.replace(/-/g, " ")
}

export default function OperatorEntrySection({
  context,
  onNavigate,
  onJumpToRuntime,
  onJumpToAccess,
}: OperatorEntrySectionProps) {
  const comparisonLabel =
    context.scenario && context.compareScenario
      ? `${context.scenario} vs ${context.compareScenario}`
      : context.scenario ?? "no scenario pair attached"

  const focusCopy =
    context.focus === "access"
      ? "Start with access control if the question is whether the runtime is gated correctly and the lab is using the right verifier key."
      : "Start with runtime posture if the question is whether the service state supports the verifier outcome the paper or lab just showed."

  return (
    <section className="grid gap-4 xl:grid-cols-[1.05fr,0.95fr]">
      <Card className="rounded-[28px] border-emerald-900/12 bg-emerald-500/8 shadow-[0_16px_40px_rgba(22,29,24,0.06)]">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Context-aware handoff</Badge>
            <Badge variant="outline">{describeSource(context.source)}</Badge>
          </div>
          <CardTitle className="text-2xl">Why you landed on operator mode</CardTitle>
          <CardDescription className="text-sm leading-6 text-muted-foreground">
            The guided route handed off a concrete technical question. This page
            keeps that context visible instead of dropping you into a generic
            admin surface.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-[22px] border border-border/70 bg-background/78 p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Scenario context
              </p>
              <p className="mt-2 text-sm font-medium text-foreground">
                {comparisonLabel}
              </p>
            </div>
            <div className="rounded-[22px] border border-border/70 bg-background/78 p-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Recommended first check
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {focusCopy}
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <Button variant="outline" onClick={onJumpToRuntime}>
              <ShieldCheck className="size-4" />
              Runtime posture
            </Button>
            <Button variant="outline" onClick={onJumpToAccess}>
              <Waypoints className="size-4" />
              Access control
            </Button>
            <Button onClick={() => onNavigate(context.recommendedLabPath)}>
              Back to lab case
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-[28px] border-border/70 bg-card/92 shadow-[0_16px_40px_rgba(22,29,24,0.06)]">
        <CardHeader>
          <CardTitle className="text-base">How to use this route</CardTitle>
          <CardDescription>
            Keep operator mode narrow. It should explain runtime truth and key
            posture, then send you back to the working verifier.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm leading-6 text-muted-foreground">
          <p>
            Use <span className="font-medium text-foreground">runtime posture</span> when
            you need to validate rate limits, Redis connectivity, auth flags, or
            headers before trusting a verifier outcome.
          </p>
          <p>
            Use <span className="font-medium text-foreground">access control</span> when the
            question is whether the lab has the right browser-side verifier key or
            whether dynamic key issuance is enabled on this runtime.
          </p>
          <p>
            Return to the lab once you have answered the runtime question. The
            technical proof still belongs in the verifier flow.
          </p>
        </CardContent>
      </Card>
    </section>
  )
}
