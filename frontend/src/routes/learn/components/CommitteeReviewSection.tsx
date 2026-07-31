import { ExternalLink, FileDown, Scale, Waypoints } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  buildLabLink,
  buildLearnTrackLink,
  buildOperatorLink,
  lessonTracks,
  lookupUseCaseForScenario,
  resolveLessonTrackComparisonPair,
  scenarioIllustrationMap,
  type LessonTrack,
} from "@/routes/learn/content"
import {
  buildCommitteeReviewPacketHtml,
  downloadCommitteeReviewPacket,
} from "@/routes/learn/export/committeeReviewPacket"
import {
  buildComparisonCardHtml,
  downloadComparisonCard,
} from "@/routes/learn/export/comparisonCard"
import {
  buildReviewPacketHtml,
  downloadReviewPacket,
} from "@/routes/learn/export/reviewPacket"

import ScenarioIllustrationStrip from "./ScenarioIllustrationStrip"

type CommitteeReviewSectionProps = {
  activeTrack: LessonTrack | null
  onNavigate: (path: string) => void
}

function buildAbsoluteLink(path: string): string {
  if (typeof window === "undefined") return path
  return `${window.location.origin}${path}`
}

function toRelativePath(href: string) {
  if (typeof window === "undefined") return href
  return href.replace(window.location.origin, "")
}

function describeCommitteeHref(href: string): string {
  const path = toRelativePath(href).split("?")[0] ?? href

  if (path === "/learn") return "Guided sequence"
  if (path === "/lab") return "Live verifier lab"
  if (path === "/operator") return "Operator inspection"
  return "Internal handoff"
}

function resolveCommitteeTrack(activeTrack: LessonTrack | null): LessonTrack {
  return activeTrack ?? lessonTracks["reviewer-defense"]
}

function mostVisibleChangedLayer(
  left: typeof scenarioIllustrationMap.valid,
  right: typeof scenarioIllustrationMap.valid,
) {
  const changed = left.layers.findIndex((layer, index) => {
    const counterpart = right.layers[index]
    return layer.value !== counterpart?.value
  })

  if (changed < 0) return "Multiple supporting attributes"
  return left.layers[changed]?.title ?? "Multiple supporting attributes"
}

type CommitteePair = ReturnType<typeof resolveLessonTrackComparisonPair>
type CommitteeUseCase = ReturnType<typeof lookupUseCaseForScenario>
type CommitteeIllustration = (typeof scenarioIllustrationMap)[keyof typeof scenarioIllustrationMap]

type CommitteeLinks = {
  committeeHref: string
  comparisonLabHref: string
  liveLabHref: string
  operatorHref: string
  reviewerModeHref: string
}

type CommitteeContext = {
  changedLayer: string
  leftIllustration: CommitteeIllustration
  leftUseCase: CommitteeUseCase
  pair: CommitteePair
  rightIllustration: CommitteeIllustration
  rightUseCase: CommitteeUseCase
  teachingPrompt: string
  track: LessonTrack
}

function CommitteeReviewHeader({ track }: { track: LessonTrack }) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Final handoff
        </p>
        <h2 className="mt-2 font-serif text-4xl leading-[0.96] tracking-[-0.05em] text-foreground md:text-5xl">
          Committee review mode
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
          This is the last guided surface in `/learn`. It assembles the active
          sequence packet, the strongest comparison pair, and the direct links
          someone needs to move from the paper’s claim to a live technical proof.
        </p>
      </div>
      <Card className="max-w-md rounded-[24px] border-border/70 bg-background/78 shadow-none">
        <CardContent className="p-4 text-sm leading-6 text-muted-foreground">
          The current handoff is anchored to{" "}
          <span className="font-medium text-foreground">{track.label}</span>.
          If no sequence is active, this defaults to reviewer mode.
        </CardContent>
      </Card>
    </div>
  )
}

function CommitteeExportPanel({
  changedLayer,
  leftIllustration,
  leftUseCase,
  links,
  pair,
  rightIllustration,
  rightUseCase,
  teachingPrompt,
  track,
}: CommitteeContext & { links: CommitteeLinks }) {
  return (
    <article className="rounded-[28px] border border-border/70 bg-card/92 p-5 shadow-[0_16px_40px_rgba(22,29,24,0.06)] md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-full bg-amber-400/12 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-950">
          {track.audience}
        </span>
        <span className="inline-flex rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Comparison pair: {pair.scenario} vs {pair.compareScenario}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-[22px] border border-border/70 bg-background/78 p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Sequence packet
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Download the prepared track as a printable artifact before the
            meeting starts.
          </p>
        </div>
        <div className="rounded-[22px] border border-border/70 bg-background/78 p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Most visible changed layer
          </p>
          <p className="mt-2 text-base font-medium text-foreground">
            {changedLayer}
          </p>
        </div>
        <div className="rounded-[22px] border border-amber-900/10 bg-amber-400/8 p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Teaching prompt
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {teachingPrompt}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <Button
          onClick={() => {
            const html = buildReviewPacketHtml(track)
            downloadReviewPacket(`${track.key}-sequence-packet.html`, html)
          }}
        >
          <FileDown className="size-4" />
          Download sequence packet
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const html = buildComparisonCardHtml({
              leftScenario: pair.scenario,
              rightScenario: pair.compareScenario,
              leftUseCase,
              rightUseCase,
              leftIllustration,
              rightIllustration,
              mostVisibleChangedLayer: changedLayer,
              teachingPrompt,
            })
            downloadComparisonCard(
              `${pair.scenario}-vs-${pair.compareScenario}-comparison-card.html`,
              html,
            )
          }}
        >
          <Scale className="size-4" />
          Download comparison card
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const html = buildCommitteeReviewPacketHtml({
              scenarioLabel: "Primary case",
              compareLabel: "Comparison case",
              leftScenario: pair.scenario,
              rightScenario: pair.compareScenario,
              leftUseCase,
              rightUseCase,
              leftIllustration,
              rightIllustration,
              mostVisibleChangedLayer: changedLayer,
              teachingPrompt,
              reviewerModeHref: links.reviewerModeHref,
              liveLabHref: links.liveLabHref,
              operatorHref: links.operatorHref,
              committeeHref: links.committeeHref,
            })
            downloadCommitteeReviewPacket(
              `${pair.scenario}-vs-${pair.compareScenario}-committee-review.html`,
              html,
            )
          }}
        >
          <Waypoints className="size-4" />
          Download committee handoff
        </Button>
      </div>
    </article>
  )
}

function CommitteeDirectLinks({
  links,
  onNavigate,
}: {
  links: CommitteeLinks
  onNavigate: (path: string) => void
}) {
  const directLinks = [
    {
      title: "Reviewer mode",
      href: links.reviewerModeHref,
      copy: "Prepared defense sequence from architecture claim to live proof.",
    },
    {
      title: "Live lab case",
      href: links.liveLabHref,
      copy: "Open the working verifier with the selected blocking or contrast case.",
    },
    {
      title: "Comparison handoff",
      href: links.comparisonLabHref,
      copy: "Open the live lab with the primary case preloaded and the comparison case explicitly carried into the handoff path.",
    },
    {
      title: "Operator route",
      href: links.operatorHref,
      copy: "Current split target for runtime posture and access-control discussion.",
    },
  ]

  return (
    <article className="rounded-[28px] border border-border/70 bg-card/92 p-5 shadow-[0_16px_40px_rgba(22,29,24,0.06)] md:p-6">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Direct links
      </p>
      <h3 className="mt-2 font-serif text-3xl leading-[0.98] tracking-[-0.04em] text-foreground">
        What someone can open next
      </h3>

      <div className="mt-4 space-y-3">
        {directLinks.map((item) => (
          <div
            key={item.title}
            className="rounded-[22px] border border-border/70 bg-background/78 p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              <button
                type="button"
                onClick={() => onNavigate(toRelativePath(item.href))}
                className="inline-flex items-center gap-1 text-sm font-medium text-foreground"
              >
                Open
                <ExternalLink className="size-3.5" />
              </button>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {item.copy}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full border border-border/70 bg-card/74 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {describeCommitteeHref(item.href)}
              </span>
              <details>
                <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground transition hover:text-foreground">
                  Show route
                </summary>
                <p className="mt-2 max-w-full break-all rounded-[14px] border border-border/70 bg-card/74 px-3 py-2 font-mono text-[12px] leading-5 text-muted-foreground">
                  {item.href}
                </p>
              </details>
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}

function CommitteeProofBridge({
  leftIllustration,
  leftUseCase,
  links,
  onNavigate,
  pair,
  rightIllustration,
  rightUseCase,
}: Omit<CommitteeContext, "changedLayer" | "teachingPrompt" | "track"> & {
  links: CommitteeLinks
  onNavigate: (path: string) => void
}) {
  const handoffSteps = [
    {
      label: "1",
      title: "Start with reviewer mode",
      copy: "Use the prepared defense order when the committee needs the full argument.",
      href: links.reviewerModeHref,
      action: "Open sequence",
      primary: false,
    },
    {
      label: "2",
      title: "Run the comparison in lab",
      copy: "Open the live verifier with the primary case and comparison case preserved.",
      href: links.comparisonLabHref,
      action: "Open live proof",
      primary: true,
    },
    {
      label: "3",
      title: "Inspect runtime posture",
      copy: "Use operator mode only when the discussion moves to service state or access control.",
      href: links.operatorHref,
      action: "Open operator",
      primary: false,
    },
  ]

  return (
    <article className="overflow-hidden rounded-[30px] border border-border/70 bg-card/92 shadow-[0_18px_50px_rgba(22,29,24,0.065)]">
      <div className="grid gap-5 p-5 md:p-6 xl:grid-cols-[0.72fr,1.28fr] xl:items-start">
        <div className="grid gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Proof bridge
            </p>
            <h3 className="mt-2 text-2xl font-semibold leading-tight tracking-[-0.035em] text-foreground">
              Compare the claim, then open the exact live proof
            </h3>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              This compact board keeps the reviewer handoff in one place: the
              contrast case, the baseline case, and the runtime route that proves
              the difference.
            </p>
          </div>

          <div className="grid gap-3">
            {handoffSteps.map((item) => (
              <div
                key={item.title}
                className="grid gap-3 rounded-[22px] border border-border/70 bg-background/76 p-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start"
              >
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-emerald-500/12 text-sm font-semibold text-emerald-900">
                  {item.label}
                </span>
                <div className="min-w-0">
                  <p className="font-medium leading-6 text-foreground">
                    {item.title}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {item.copy}
                  </p>
                  <Button
                    className="mt-3"
                    size="sm"
                    variant={item.primary ? "default" : "outline"}
                    onClick={() => onNavigate(toRelativePath(item.href))}
                  >
                    {item.action}
                    <ExternalLink className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4">
          <ScenarioIllustrationStrip
            illustration={leftIllustration}
            compareLabel={rightUseCase?.title ?? pair.compareScenario}
            className="mt-0"
            variant="timeline"
          />
          <ScenarioIllustrationStrip
            illustration={rightIllustration}
            compareLabel={leftUseCase?.title ?? pair.scenario}
            className="mt-0"
            variant="timeline"
          />
        </div>
      </div>
    </article>
  )
}

export default function CommitteeReviewSection({
  activeTrack,
  onNavigate,
}: CommitteeReviewSectionProps) {
  const track = resolveCommitteeTrack(activeTrack)
  const pair = resolveLessonTrackComparisonPair(track)
  const leftUseCase = lookupUseCaseForScenario(pair.scenario)
  const rightUseCase = lookupUseCaseForScenario(pair.compareScenario)
  const leftIllustration = scenarioIllustrationMap[pair.scenario]
  const rightIllustration = scenarioIllustrationMap[pair.compareScenario]
  const changedLayer = mostVisibleChangedLayer(leftIllustration, rightIllustration)
  const teachingPrompt =
    leftUseCase?.lesson ??
    "Use the comparison artifact first, then move into the live lab if the committee wants a direct proof."

  const links: CommitteeLinks = {
    reviewerModeHref: buildAbsoluteLink(buildLearnTrackLink("reviewer-defense", 0)),
    liveLabHref: buildAbsoluteLink(buildLabLink(pair.scenario, pair.nonceMode)),
    operatorHref: buildAbsoluteLink(
      buildOperatorLink({
        focus: "runtime",
        source: "committee-review",
        scenario: pair.scenario,
        compareScenario: pair.compareScenario,
        nonceMode: pair.nonceMode,
      }),
    ),
    committeeHref: buildAbsoluteLink("/learn#committee-review"),
    comparisonLabHref: buildAbsoluteLink(
      `${buildLabLink(pair.scenario, pair.nonceMode)}&compare=${pair.compareScenario}`,
    ),
  }
  const context: CommitteeContext = {
    changedLayer,
    leftIllustration,
    leftUseCase,
    pair,
    rightIllustration,
    rightUseCase,
    teachingPrompt,
    track,
  }

  return (
    <section id="committee-review" className="grid gap-6">
      <CommitteeReviewHeader track={track} />
      <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
        <CommitteeExportPanel {...context} links={links} />
        <CommitteeDirectLinks links={links} onNavigate={onNavigate} />
      </div>
      <CommitteeProofBridge {...context} links={links} onNavigate={onNavigate} />
    </section>
  )
}
