import { ArrowRight, GraduationCap, ShieldCheck, Waypoints } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CardDescription } from "@/components/ui/card"
import {
  buildLabLink,
  buildLearnTrackLink,
  buildOperatorLink,
  lessonTracks,
  lookupUseCaseForScenario,
  resolveLessonTrackComparisonPair,
  type LessonTrack,
  type LessonTrackKey,
} from "@/routes/learn/content"

type LearnRouteBoundarySectionProps = {
  activeTrack: LessonTrack | null
  activeTrackStepIndex: number
  onNavigate: (path: string) => void
}

type BoundaryAction = {
  icon: typeof GraduationCap
  eyebrow: string
  title: string
  description: string
  actionLabel: string
  href: string
  tone: string
}

function resolveBoundaryTrack(activeTrack: LessonTrack | null) {
  return activeTrack ?? lessonTracks["reviewer-defense"]
}

function toRelativePath(path: string) {
  if (typeof window === "undefined") return path
  return path.replace(window.location.origin, "")
}

function describeHandoffTarget(href: string) {
  const path = href.split("?")[0] ?? href

  if (path === "/learn") return "Guided learn route"
  if (path === "/operator") return "Operator route"
  if (path === "/lab") return "Verifier lab"
  return "Internal route"
}

function boundedStepIndex(track: LessonTrack, stepIndex: number) {
  return Math.min(Math.max(0, stepIndex), track.steps.length - 1)
}

function buildBoundaryActions(
  track: LessonTrack,
  stepIndex: number,
): BoundaryAction[] {
  const boundedIndex = boundedStepIndex(track, stepIndex)
  const currentStep = track.steps[boundedIndex]
  const pair = resolveLessonTrackComparisonPair(track)
  const leftCase = lookupUseCaseForScenario(pair.scenario)
  const comparisonLabel = leftCase?.title ?? pair.scenario
  const labHref = `${buildLabLink(pair.scenario, pair.nonceMode)}&compare=${pair.compareScenario}`

  return [
    {
      icon: GraduationCap,
      eyebrow: "Guided sequence",
      title: `Resume ${track.label}`,
      description:
        currentStep?.stage === "lab"
          ? "You are already at the live-proof step. Re-open the active sequence if someone wants the guided order before rerunning the verifier."
          : `Continue at step ${boundedIndex + 1} so the walkthrough resumes exactly where the current teaching or review track left off.`,
      actionLabel: currentStep?.stage === "lab" ? "Open active sequence" : "Resume current step",
      href: buildLearnTrackLink(track.key as LessonTrackKey, boundedIndex),
      tone: "border-border/70 bg-card/92",
    },
    {
      icon: Waypoints,
      eyebrow: "Working proof surface",
      title: "Open the recommended lab proof",
      description: `Launch the working verifier with ${comparisonLabel} preloaded and the comparison case carried into the handoff path.`,
      actionLabel: "Open comparison in lab",
      href: labHref,
      tone: "border-emerald-900/12 bg-emerald-500/8",
    },
    {
      icon: ShieldCheck,
      eyebrow: "Runtime posture",
      title: "Inspect operator surfaces",
      description:
        "Move into the split runtime route if the discussion shifts from paper logic to live service posture, access control, or verifier-state administration.",
      actionLabel: "Open operator route",
      href: buildOperatorLink({
        focus: "runtime",
        source: track.key,
        scenario: pair.scenario,
        compareScenario: pair.compareScenario,
        nonceMode: pair.nonceMode,
      }),
      tone: "border-sky-900/10 bg-sky-500/8",
    },
  ]
}

export default function LearnRouteBoundarySection({
  activeTrack,
  activeTrackStepIndex,
  onNavigate,
}: LearnRouteBoundarySectionProps) {
  const boundaryTrack = resolveBoundaryTrack(activeTrack)
  const actions = buildBoundaryActions(boundaryTrack, activeTrackStepIndex)

  return (
    <section className="overflow-hidden rounded-[32px] border border-border/70 bg-card/92 shadow-[0_22px_60px_rgba(22,29,24,0.07)]">
      <div className="grid gap-5 p-5 md:p-6 xl:grid-cols-[0.78fr,1.22fr] xl:items-start">
        <div className="grid gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Route boundary
            </p>
            <h2 className="mt-2 text-3xl font-semibold leading-[1.02] tracking-[-0.045em] text-foreground md:text-4xl">
              Choose the exact next proof path
            </h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              The guided route should end with a specific next action, not a
              generic lab jump. This handoff stays anchored to the active
              sequence and points to the runtime surface a professor, reviewer,
              or engineer should open next.
            </p>
          </div>

          <div className="rounded-[24px] border border-emerald-900/10 bg-emerald-500/8 p-4 text-sm leading-6 text-muted-foreground">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-950/70">
              Active recommendation
            </p>
            <p className="mt-2">
              Anchored to{" "}
              <span className="font-medium text-foreground">{boundaryTrack.label}</span>.
              If no sequence is active, the route defaults to reviewer mode so
              the handoff remains defensible.
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          {actions.map((action, index) => {
            const Icon = action.icon
            const primary = action.eyebrow === "Working proof surface"

            return (
              <article
                key={action.title}
                className={`grid gap-4 rounded-[24px] border p-4 shadow-[0_10px_28px_rgba(22,29,24,0.045)] md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center ${action.tone}`}
              >
                <div className="flex items-center gap-3 md:items-start">
                  <div className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/78 text-foreground">
                    <Icon className="size-4" />
                  </div>
                  <div className="md:hidden">
                    <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      {index + 1}. {action.eyebrow}
                    </p>
                    <h3 className="mt-1 font-medium text-foreground">
                      {action.title}
                    </h3>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="hidden md:block">
                    <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      {index + 1}. {action.eyebrow}
                    </p>
                    <h3 className="mt-1 font-medium text-foreground">
                      {action.title}
                    </h3>
                  </div>
                  <CardDescription className="mt-2 text-sm leading-6 text-muted-foreground">
                    {action.description}
                  </CardDescription>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="inline-flex rounded-full border border-border/70 bg-background/72 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      {describeHandoffTarget(action.href)}
                    </span>
                    {primary ? (
                      <span className="inline-flex rounded-full border border-emerald-900/10 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-emerald-900">
                        Recommended proof
                      </span>
                    ) : null}
                  </div>
                </div>

                <Button
                  className="w-full md:w-auto"
                  variant={primary ? "default" : "outline"}
                  onClick={() => onNavigate(toRelativePath(action.href))}
                >
                  {action.actionLabel}
                  <ArrowRight className="size-4" />
                </Button>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
