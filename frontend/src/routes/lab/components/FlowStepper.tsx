import { Check } from "lucide-react"

import { useT, type MessageKey } from "@/i18n"
import { cn } from "@/lib/utils"
import type { FlowState, FlowStepId } from "@/routes/lab/deriveFlowStep"

const stepTitleKeys: Record<FlowStepId, MessageKey> = {
  1: "lab.stepper.step1",
  2: "lab.stepper.step2",
  3: "lab.stepper.step3",
  4: "lab.stepper.step4",
}

const flowStepIds: FlowStepId[] = [1, 2, 3, 4]

type FlowStepperProps = {
  activeStep: FlowStepId
  flow: FlowState
  visitedSteps: ReadonlySet<FlowStepId>
  onSelectStep: (step: FlowStepId) => void
}

export function FlowStepper({
  activeStep,
  flow,
  visitedSteps,
  onSelectStep,
}: FlowStepperProps) {
  const t = useT()

  return (
    <nav
      aria-label={t("lab.stepper.label")}
      data-testid="flow-stepper"
      className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-1"
    >
      {flowStepIds.map((step) => {
        const unlocked = step <= flow.maxUnlockedStep || visitedSteps.has(step)
        const active = step === activeStep
        return (
          <button
            key={step}
            type="button"
            data-testid={`flow-step-${step}`}
            disabled={!unlocked}
            aria-current={active ? "step" : undefined}
            onClick={() => onSelectStep(step)}
            className={cn(
              "flex shrink-0 items-center gap-3 rounded-2xl border border-transparent px-3 py-2 text-left text-sm transition-colors",
              active
                ? "border-primary/30 bg-primary/10 font-medium text-foreground shadow-[0_0_20px_-8px_rgba(69,212,131,0.45)]"
                : unlocked
                  ? "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  : "cursor-not-allowed text-muted-foreground/50",
            )}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : flow.completed[step]
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground",
              )}
            >
              {flow.completed[step] && !active ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                step
              )}
            </span>
            {t(stepTitleKeys[step])}
          </button>
        )
      })}
    </nav>
  )
}
