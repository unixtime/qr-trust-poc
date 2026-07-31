import { GraduationCap, Scale, Waypoints } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  learnStages,
  lessonTrackList,
  type LessonTrack,
  type LessonTrackKey,
  type LessonTrackStep,
} from "@/routes/learn/content"

import TrackScenarioTimeline from "./TrackScenarioTimeline"

type TeachingTracksSectionProps = {
  activeTrack: LessonTrack | null
  activeTrackStepIndex: number
  onStartTrack: (trackKey: LessonTrackKey) => void
  onContinueTrack: () => void
  onGoToCurrentStep: () => void
  onGoToTrackStep: (trackKey: LessonTrackKey, stepIndex: number) => void
  onClearTrack: () => void
}

function stepLabel(step: LessonTrackStep) {
  const stage = learnStages.find((item) => item.key === step.stage)
  return stage?.label ?? step.stage
}

export default function TeachingTracksSection({
  activeTrack,
  activeTrackStepIndex,
  onStartTrack,
  onContinueTrack,
  onGoToCurrentStep,
  onGoToTrackStep,
  onClearTrack,
}: TeachingTracksSectionProps) {
  const activeTrackStep =
    activeTrack && activeTrackStepIndex >= 0
      ? activeTrack.steps[activeTrackStepIndex] ?? null
      : null
  const nextTrackStep =
    activeTrack && activeTrackStepIndex >= 0
      ? activeTrack.steps[activeTrackStepIndex + 1] ?? null
      : null

  const immediateAction =
    activeTrackStep?.stage === "problem"
      ? "Read the framing diagram first, then continue into the trust-stack model."
      : activeTrackStep?.stage === "architecture"
        ? "Use the architecture cards and layer diagram before advancing into governance."
        : activeTrackStep?.stage === "governance"
          ? "Walk the trust-state path before you move into the concrete teaching case."
          : activeTrackStep?.stage === "cases"
            ? "Read the case card and trust strip first, then use the lab handoff to prove it live."
            : activeTrackStep?.stage === "lab"
              ? "Open the working lab with the preloaded scenario and run the live verifier result."
              : "Use the current prompt, then continue the sequence."

  return (
    <section id="teaching-tracks" className="grid gap-6">
      {activeTrack ? (
        <section className="rounded-[28px] border border-emerald-900/12 bg-emerald-500/8 p-5 shadow-[0_18px_50px_rgba(22,29,24,0.06)] md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="grid gap-3">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-900/72">
                <Waypoints className="size-3.5" />
                Prepared sequence active
              </div>
              <h2 className="font-serif text-4xl leading-[0.96] tracking-[-0.05em] text-foreground md:text-5xl">
                {activeTrack.label}
              </h2>
              <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
                {activeTrack.summary}
              </p>

              {activeTrackStep ? (
                <div className="rounded-[24px] border border-background/80 bg-background/78 p-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Current sequence step {activeTrackStepIndex + 1} of{" "}
                    {activeTrack.steps.length}
                  </p>
                  <p className="mt-2 text-lg font-medium text-foreground">
                    {activeTrackStep.title}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {activeTrackStep.prompt}
                  </p>
                  <div className="mt-4 rounded-[22px] border border-emerald-900/10 bg-emerald-500/8 px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-950/72">
                      Do this now
                    </p>
                    <p className="mt-2 text-sm leading-6 text-foreground/80">
                      {immediateAction}
                    </p>
                    <p className="mt-2 text-sm font-medium text-emerald-900">
                      Recommended next step:{" "}
                      {nextTrackStep ? nextTrackStep.title : "Open the lab or exit the sequence"}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="grid gap-3 lg:max-w-[360px]">
              <div className="flex flex-wrap gap-2">
                {activeTrack.steps.map((step, index) => (
                  <button
                    key={`${activeTrack.key}-${step.stage}-${step.title}`}
                    type="button"
                    aria-label={`Go to sequence step ${index + 1}: ${step.title}`}
                    aria-pressed={index === activeTrackStepIndex}
                    onClick={() => onGoToTrackStep(activeTrack.key, index)}
                    className={[
                      "inline-flex rounded-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] ring-1 transition",
                      index === activeTrackStepIndex
                        ? "bg-emerald-700 text-white ring-emerald-700/20"
                        : "bg-background/70 text-muted-foreground ring-border hover:text-foreground",
                    ].join(" ")}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={onGoToCurrentStep}>
                  Go to current step
                </Button>
                <Button
                  aria-label={
                    nextTrackStep
                      ? `Continue sequence to ${nextTrackStep.title}`
                      : "Open final sequence step"
                  }
                  onClick={onContinueTrack}
                >
                  {nextTrackStep ? "Continue sequence" : "Open final step"}
                </Button>
                <Button variant="ghost" onClick={onClearTrack}>
                  Exit sequence
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <TrackScenarioTimeline
              track={activeTrack}
              activeStepIndex={activeTrackStepIndex >= 0 ? activeTrackStepIndex : 0}
            />
          </div>
        </section>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Prepared modes
          </p>
          <h2 className="mt-2 font-serif text-4xl leading-[0.96] tracking-[-0.05em] text-foreground md:text-5xl">
            Reviewer and professor sequences
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
            These tracks do not create a second app. They preconfigure the
            existing learn route so a professor can teach from it and a reviewer
            can defend the paper from it without improvising the order live.
          </p>
        </div>
        <Card className="max-w-md rounded-[24px] border-border/70 bg-background/78 shadow-none">
          <CardContent className="p-4 text-sm leading-6 text-muted-foreground">
            Start a sequence once, then use the banner prompts to move through
            the intended order. The last step deliberately hands off to the real
            working lab.
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {lessonTrackList.map((track) => {
          const active = activeTrack?.key === track.key

          return (
            <article
              key={track.key}
              className={[
                "rounded-[28px] border p-5 shadow-[0_16px_40px_rgba(22,29,24,0.06)] transition md:p-6",
                active
                  ? "border-emerald-900/15 bg-emerald-500/8"
                  : "border-border/70 bg-card/92",
              ].join(" ")}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full bg-amber-400/12 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-950">
                  {track.audience}
                </span>
                {active ? (
                  <span className="inline-flex rounded-full bg-emerald-500/12 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-900">
                    Active
                  </span>
                ) : null}
              </div>

              <h3 className="mt-3 font-serif text-3xl leading-tight tracking-[-0.04em] text-foreground">
                {track.label}
              </h3>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                {track.summary}
              </p>

              <div className="mt-4 space-y-3">
                {track.steps.map((step, index) => (
                  <div
                    key={`${track.key}-${step.stage}-${step.title}`}
                    className="rounded-[22px] border border-border/70 bg-background/78 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex size-8 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
                        {index + 1}
                      </span>
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          {stepLabel(step)}
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          {step.title}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {step.prompt}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  variant={active ? "outline" : "default"}
                  onClick={() => onStartTrack(track.key)}
                >
                  {active ? "Restart sequence" : "Start sequence"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => onGoToTrackStep(track.key, track.steps.length - 1)}
                >
                  Open final lab handoff
                </Button>
              </div>
            </article>
          )
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/70 bg-card/92 shadow-none">
          <CardContent className="flex gap-3 p-4 text-sm leading-6 text-muted-foreground">
            <GraduationCap className="mt-0.5 size-4 shrink-0 text-foreground" />
            <div>
              <p className="font-medium text-foreground">Professor mode</p>
              Starts from the trust gap, then uses freshness, revocation, and
              policy contrast as teachable checkpoints.
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/70 bg-card/92 shadow-none">
          <CardContent className="flex gap-3 p-4 text-sm leading-6 text-muted-foreground">
            <Scale className="mt-0.5 size-4 shrink-0 text-foreground" />
            <div>
              <p className="font-medium text-foreground">Reviewer mode</p>
              Focuses on defendable claims: separate checks, managed revocation,
              and destination mismatch as a terminal rule.
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/70 bg-card/92 shadow-none">
          <CardContent className="flex gap-3 p-4 text-sm leading-6 text-muted-foreground">
            <Waypoints className="mt-0.5 size-4 shrink-0 text-foreground" />
            <div>
              <p className="font-medium text-foreground">Common rule</p>
              Both tracks end in the real verifier lab. The guided route does
              not simulate proof. It stages the path to the working demo.
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
