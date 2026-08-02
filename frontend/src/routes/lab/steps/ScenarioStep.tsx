import { useState } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  scenarioGroups,
  scenarioKeys,
  scenarioLabels,
  type ScenarioGroup,
  type ScenarioKey,
} from "@/domain/scenarios"
import { scenarioMeta } from "@/routes/lab/content"

const groupOrder: ScenarioGroup[] = [
  "Valid",
  "Tampered",
  "Policy-blocked",
  "Runtime-degraded",
]

type ScenarioStepProps = {
  scenario: ScenarioKey
  compareScenario: ScenarioKey | null
  onSelectScenario: (key: ScenarioKey) => void
  onSelectCompare: (key: ScenarioKey | null) => void
  onNext: () => void
}

export default function ScenarioStep({
  scenario,
  compareScenario,
  onSelectScenario,
  onSelectCompare,
  onNext,
}: ScenarioStepProps) {
  const [compareOpen, setCompareOpen] = useState(compareScenario !== null)

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold">Pick a scenario</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Each scenario issues a QR whose trust evidence passes or fails one
          specific check.
        </p>
      </header>

      {groupOrder.map((group) => (
        <section key={group}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {scenarioGroups[group].map((key) => {
              const selected = key === scenario
              return (
                <button
                  key={key}
                  type="button"
                  data-testid={`scenario-${key}`}
                  aria-pressed={selected}
                  onClick={() => onSelectScenario(key)}
                  className={cn(
                    "rounded-md border p-3 text-left transition-colors",
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <span className="block text-sm font-medium">
                    {scenarioLabels[key]}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {scenarioMeta[key].note}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ))}

      <section className="rounded-md border border-border p-3">
        <button
          type="button"
          data-testid="compare-toggle"
          onClick={() => setCompareOpen((open) => !open)}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {compareOpen ? "Hide comparison" : "Compare against a second scenario"}
        </button>
        {compareOpen ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="compare-none"
              aria-pressed={compareScenario === null}
              onClick={() => onSelectCompare(null)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                compareScenario === null
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              None
            </button>
            {scenarioKeys.map((key) => (
              <button
                key={key}
                type="button"
                data-testid={`compare-${key}`}
                aria-pressed={compareScenario === key}
                onClick={() => onSelectCompare(key)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors",
                  compareScenario === key
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {scenarioLabels[key]}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <div className="flex justify-end border-t border-border pt-4">
        <Button data-testid="scenario-next" onClick={onNext}>
          Next: Generate QR
        </Button>
      </div>
    </div>
  )
}
