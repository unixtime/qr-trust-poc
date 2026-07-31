import {
  learnStages,
  type LessonTrack,
} from "@/routes/learn/content"

type TrackScenarioTimelineProps = {
  track: LessonTrack
  activeStepIndex: number
}

function stageLabel(stage: string): string {
  return learnStages.find((item) => item.key === stage)?.label ?? stage
}

export default function TrackScenarioTimeline({
  track,
  activeStepIndex,
}: TrackScenarioTimelineProps) {
  return (
    <section className="rounded-[24px] border border-border/70 bg-background/78 p-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Sequence timeline
          </p>
          <h3 className="mt-2 font-serif text-3xl leading-[0.98] tracking-[-0.04em] text-foreground">
            {track.key === "reviewer-defense"
              ? "Defense path from architecture claim to live blocking proof"
              : "Teaching path from trust gap to live policy comparison"}
          </h3>
        </div>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">
          {track.key === "reviewer-defense"
            ? "Use this strip to make the defense order explicit: architecture first, governance second, terminal policy proof third, then the live lab."
            : "Use this strip to carry one teaching thread from the paper’s framing through the real verifier contrast without improvising the order live."}
        </p>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-5">
        {track.steps.map((step, index) => {
          const active = index === activeStepIndex
          const past = index < activeStepIndex

          return (
            <article
              key={`${track.key}-${step.stage}-${step.title}`}
              className={[
                "rounded-[20px] border p-4 transition",
                active
                  ? "border-emerald-900/15 bg-emerald-500/8 shadow-[0_14px_34px_rgba(33,70,60,0.10)]"
                  : past
                    ? "border-emerald-900/10 bg-card"
                    : "border-border/70 bg-background/78",
              ].join(" ")}
            >
              <div className="flex items-center gap-3">
                <span
                  className={[
                    "inline-flex h-9 w-9 items-center justify-center rounded-full text-[11px] font-medium",
                    active
                      ? "bg-emerald-700 text-white"
                      : past
                        ? "bg-emerald-500/12 text-emerald-800"
                        : "bg-muted text-muted-foreground",
                  ].join(" ")}
                >
                  {index + 1}
                </span>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    {stageLabel(step.stage)}
                  </p>
                  <p className="text-sm font-medium text-foreground">{step.title}</p>
                </div>
              </div>

              <div className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                {step.scenario ? (
                  <p>
                    <span className="font-medium text-foreground">Primary:</span>{" "}
                    {step.scenario}
                  </p>
                ) : null}
                {step.compareScenario ? (
                  <p>
                    <span className="font-medium text-foreground">Compare:</span>{" "}
                    {step.compareScenario}
                  </p>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
