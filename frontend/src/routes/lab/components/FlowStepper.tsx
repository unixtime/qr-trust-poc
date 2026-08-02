import { Check } from "lucide-react"

import { cn } from "@/lib/utils"
import type { FlowState, FlowStepId } from "@/routes/lab/deriveFlowStep"

const stepTitles: Record<FlowStepId, string> = {
  1: "Pick scenario",
  2: "Generate QR",
  3: "Scan",
  4: "Verdict & evidence",
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
  return (
    <nav
      aria-label="Workflow steps"
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
              "flex shrink-0 items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
              active
                ? "bg-secondary font-medium text-foreground"
                : unlocked
                  ? "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                  : "cursor-not-allowed text-muted-foreground/50",
            )}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
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
            {stepTitles[step]}
          </button>
        )
      })}
    </nav>
  )
}
