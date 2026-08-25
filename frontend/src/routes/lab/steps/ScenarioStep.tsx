import { useState } from "react"
import {
  ArrowRight,
  Ban,
  Check,
  GitCompareArrows,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ConsoleChip } from "@/components/ui/console-chip"
import { Eyebrow } from "@/components/ui/eyebrow"
import { cn } from "@/lib/utils"
import { useT } from "@/i18n"
import {
  scenarioGroupLabelKeys,
  scenarioGroups,
  scenarioKeys,
  scenarioLabelKeys,
  scenarioNoteKeys,
  type ScenarioGroup,
  type ScenarioKey,
} from "@/domain/scenarios"
import { ComparisonCard } from "@/routes/lab/components/ComparisonCard"

// Slugs, not display strings — the rendered heading comes from
// `scenarioGroupLabelKeys`. This array only fixes the order.
const groupOrder: ScenarioGroup[] = [
  "valid",
  "tampered",
  "policyBlocked",
  "runtimeDegraded",
]

// The flat grid renders every scenario in group order; each card still needs
// its group's tone, so invert `scenarioGroups` once at module load.
const scenarioOrder: ScenarioKey[] = groupOrder.flatMap(
  (group) => scenarioGroups[group],
)
const groupOf = Object.fromEntries(
  groupOrder.flatMap((group) =>
    scenarioGroups[group].map((key) => [key, group]),
  ),
) as Record<ScenarioKey, ScenarioGroup>

// Visual tone per group, keyed by the same slugs. The icon disambiguates the
// two red groups: X = the artifact itself is tampered, Ban = policy forbids it.
const groupTone: Record<
  ScenarioGroup,
  { icon: LucideIcon; glyph: string; text: string; tag: string; dot: string }
> = {
  valid: {
    icon: Check,
    glyph: "border-trust-green/50 bg-trust-green/12",
    text: "text-trust-green",
    tag: "text-trust-green/80",
    dot: "bg-trust-green shadow-[0_0_8px_rgba(69,212,131,0.9)]",
  },
  tampered: {
    icon: X,
    glyph: "border-trust-red/50 bg-trust-red/12",
    text: "text-trust-red",
    tag: "text-trust-red/80",
    dot: "bg-trust-red shadow-[0_0_8px_rgba(242,95,92,0.9)]",
  },
  policyBlocked: {
    icon: Ban,
    glyph: "border-trust-red/50 bg-trust-red/12",
    text: "text-trust-red",
    tag: "text-trust-red/80",
    dot: "bg-trust-red shadow-[0_0_8px_rgba(242,95,92,0.9)]",
  },
  runtimeDegraded: {
    icon: TriangleAlert,
    glyph: "border-trust-amber/50 bg-trust-amber/12",
    text: "text-trust-amber",
    tag: "text-trust-amber/80",
    dot: "bg-trust-amber shadow-[0_0_8px_rgba(245,165,36,0.9)]",
  },
}

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
  const [filter, setFilter] = useState<ScenarioGroup | "all">("all")
  const t = useT()

  const visibleKeys = filter === "all" ? scenarioOrder : scenarioGroups[filter]
  const selectedTone = groupTone[groupOf[scenario]]
  const SelectedIcon = selectedTone.icon

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="size-[7px] shrink-0 rounded-full bg-trust-green shadow-[0_0_10px_rgba(69,212,131,0.9)]"
          />
          <span className="font-mono text-[11px] font-semibold tracking-[0.18em] text-trust-green uppercase">
            {t("lab.scenarioStep.eyebrow")}
          </span>
          <span className="hidden font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase sm:inline">
            {t("lab.scenarioStep.eyebrowDetail", {
              count: scenarioKeys.length,
            })}
          </span>
          <span
            aria-hidden
            className="h-px flex-1 bg-linear-90 from-[rgba(69,212,131,0.4)] to-transparent"
          />
        </div>
        <h1 className="max-w-2xl text-4xl leading-[1.06] font-bold tracking-tight text-balance sm:text-5xl">
          {t("lab.scenarioStep.titleLead", { count: scenarioKeys.length })}{" "}
          <span className="aurora-text">{t("lab.scenarioStep.titleAccent")}</span>
        </h1>
        <p className="max-w-[620px] text-base leading-normal text-muted-foreground">
          {t("lab.scenarioStep.subtitle")}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="filter-all"
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
          className={cn(
            "flex h-[34px] items-center gap-2 rounded-full border px-4 text-xs font-medium transition-colors",
            filter === "all"
              ? "border-white/18 bg-white/8 text-foreground"
              : "border-white/8 text-muted-foreground hover:border-white/15 hover:text-foreground",
          )}
        >
          {t("lab.scenarioStep.filter.all")}
          <span className="font-mono text-[10px] text-muted-foreground">
            {scenarioKeys.length}
          </span>
        </button>
        {groupOrder.map((group) => {
          const tone = groupTone[group]
          const active = filter === group
          return (
            <button
              key={group}
              type="button"
              data-testid={`filter-${group}`}
              aria-pressed={active}
              onClick={() => setFilter(active ? "all" : group)}
              className={cn(
                "flex h-[34px] items-center gap-2 rounded-full border px-4 text-xs font-medium transition-colors",
                active
                  ? "border-white/18 bg-white/8 text-foreground"
                  : "border-white/8 text-muted-foreground hover:border-white/15 hover:text-foreground",
              )}
            >
              <span aria-hidden className={cn("size-1.5 rounded-full", tone.dot)} />
              {t(scenarioGroupLabelKeys[group])}
              <span className="font-mono text-[10px] text-muted-foreground">
                {scenarioGroups[group].length}
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visibleKeys.map((key) => {
          const group = groupOf[key]
          const tone = groupTone[group]
          const Icon = tone.icon
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
                  selected &&
                    "border-primary/55 bg-linear-180 from-primary/10 to-[rgba(9,16,26,0.85)] shadow-[0_0_36px_-10px_rgba(69,212,131,0.4),inset_0_1px_0_rgba(255,255,255,0.08)]",
                )}
              >
                <CardContent className="flex flex-col gap-2">
                  <span className="flex items-center justify-between gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-[26px] shrink-0 items-center justify-center rounded-full border",
                        tone.glyph,
                      )}
                    >
                      <Icon className={cn("size-3.5", tone.text)} />
                    </span>
                    <span className="flex items-center gap-1.5">
                      {selected && (
                        <span className="rounded-full border border-primary/50 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.16em] text-primary uppercase">
                          {t("lab.scenarioStep.active")}
                        </span>
                      )}
                      <span
                        className={cn(
                          "font-mono text-[9px] tracking-[0.16em] uppercase",
                          tone.tag,
                        )}
                      >
                        {t(scenarioGroupLabelKeys[group])}
                      </span>
                    </span>
                  </span>
                  <span className="block text-sm font-semibold">
                    {t(scenarioLabelKeys[key])}
                  </span>
                  {/* The wire identifier, on purpose — the console voice
                      of this UI shows the key the API actually receives. */}
                  <span
                    className={cn(
                      "block font-mono text-[10px]",
                      selected ? "text-primary/80" : "text-muted-foreground",
                    )}
                  >
                    {key}
                  </span>
                  <span className="line-clamp-2 block text-xs text-muted-foreground">
                    {t(scenarioNoteKeys[key])}
                  </span>
                </CardContent>
              </Card>
            </button>
          )
        })}
      </div>

      {/* Optional A/B pairing. The chips navigate (see FlowPage) so the pair
          lives in the URL and survives a reload or a shared link. */}
      <section
        data-testid="compare-section"
        className="glass-panel flex flex-col gap-4 rounded-2xl p-4 sm:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <GitCompareArrows aria-hidden className="size-3.5 text-primary" />
              <Eyebrow tone="primary">{t("lab.scenarioStep.compare.eyebrow")}</Eyebrow>
            </div>
            <p className="max-w-[620px] text-sm text-muted-foreground">
              {t("lab.scenarioStep.compare.purpose")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            data-testid="compare-toggle"
            aria-expanded={compareOpen}
            onClick={() => setCompareOpen((open) => !open)}
            className="shrink-0"
          >
            {compareOpen
              ? t("lab.scenarioStep.compare.hide")
              : t("lab.scenarioStep.compare.show")}
          </Button>
        </div>
        {compareOpen ? (
          <div className="flex flex-wrap gap-2">
            <ConsoleChip
              data-testid="compare-none"
              pressed={compareScenario === null}
              aria-pressed={compareScenario === null}
              onClick={() => onSelectCompare(null)}
            >
              {t("lab.scenarioStep.compare.none")}
            </ConsoleChip>
            {scenarioKeys.map((key) => (
              <ConsoleChip
                key={key}
                data-testid={`compare-${key}`}
                pressed={compareScenario === key}
                aria-pressed={compareScenario === key}
                onClick={() => onSelectCompare(key)}
              >
                {t(scenarioLabelKeys[key])}
              </ConsoleChip>
            ))}
          </div>
        ) : null}
        {compareScenario ? (
          <ComparisonCard scenario={scenario} compareScenario={compareScenario} />
        ) : null}
      </section>

      <div className="mx-auto flex w-full max-w-[880px] items-center gap-4 rounded-[20px] border border-white/9 bg-linear-180 from-[rgba(16,26,40,0.92)] to-[rgba(9,16,26,0.94)] p-4 shadow-[0_32px_64px_-28px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-xl sm:p-5">
        <span
          aria-hidden
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl border",
            selectedTone.glyph,
          )}
        >
          <SelectedIcon className={cn("size-4.5", selectedTone.text)} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">
            {t(scenarioLabelKeys[scenario])}
          </span>
          <span className="block truncate font-mono text-[10px] text-muted-foreground">
            {scenario} · {t(scenarioGroupLabelKeys[groupOf[scenario]])}
          </span>
        </span>
        <Button size="lg" data-testid="scenario-next" onClick={onNext}>
          {t("lab.scenarioStep.next")}
          <ArrowRight aria-hidden className="size-4" />
        </Button>
      </div>
    </div>
  )
}
