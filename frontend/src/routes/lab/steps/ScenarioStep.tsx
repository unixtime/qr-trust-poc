import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ConsoleChip } from "@/components/ui/console-chip"
import { Eyebrow } from "@/components/ui/eyebrow"
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
          <Eyebrow as="h2" className="mb-2">
            {group}
          </Eyebrow>
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
                  className="text-left"
                >
                  <Card
                    interactive
                    size="sm"
                    className={cn(
                      "h-full",
                      selected && "border-(--border-accent) shadow-(--glow)",
                    )}
                  >
                    <CardContent className="grid gap-1">
                      <span className="block text-sm font-medium">
                        {scenarioLabels[key]}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {scenarioMeta[key].note}
                      </span>
                    </CardContent>
                  </Card>
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
            <ConsoleChip
              data-testid="compare-none"
              pressed={compareScenario === null}
              aria-pressed={compareScenario === null}
              onClick={() => onSelectCompare(null)}
            >
              None
            </ConsoleChip>
            {scenarioKeys.map((key) => (
              <ConsoleChip
                key={key}
                data-testid={`compare-${key}`}
                pressed={compareScenario === key}
                aria-pressed={compareScenario === key}
                onClick={() => onSelectCompare(key)}
              >
                {scenarioLabels[key]}
              </ConsoleChip>
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
