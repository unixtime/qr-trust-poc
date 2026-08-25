import { ArrowRight, GitCompareArrows } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Eyebrow } from "@/components/ui/eyebrow"
import { scenarioLabelKeys, type ScenarioKey } from "@/domain/scenarios"
import { useT } from "@/i18n"
import { cn } from "@/lib/utils"
import {
  compareScenarios,
  comparisonLayerLabelKeys,
  type ComparisonRow,
} from "@/routes/lab/comparison"
import { scenarioMeta } from "@/routes/lab/content"

type Tone = "green" | "amber" | "red"

// Same dot/text recipes the scenario grid uses, so a verdict colour means the
// same thing here as it does everywhere else in the lab.
const toneDot: Record<Tone, string> = {
  green: "bg-trust-green shadow-[0_0_8px_rgba(69,212,131,0.9)]",
  amber: "bg-trust-amber shadow-[0_0_8px_rgba(245,165,36,0.9)]",
  red: "bg-trust-red shadow-[0_0_8px_rgba(242,95,92,0.9)]",
}
const toneText: Record<Tone, string> = {
  green: "text-trust-green",
  amber: "text-trust-amber",
  red: "text-trust-red",
}

// Two columns on phones (A | B, the layer label spanning both), three from
// `sm` up (layer | A | B). Every row and the head share this template.
const rowGrid =
  "grid grid-cols-2 gap-x-3 gap-y-1 px-4 sm:grid-cols-[minmax(120px,160px)_minmax(0,1fr)_minmax(0,1fr)]"

type ComparisonCardProps = {
  scenario: ScenarioKey
  compareScenario: ScenarioKey
  isGenerating?: boolean
  /** When provided, the card offers to generate B and swap the pair. */
  onLoadPaired?: () => void
  className?: string
}

/**
 * The A/B proof card. A is the current scenario, B the paired one; the card
 * reduces both to one token per trust layer (see `comparison.ts`), names the
 * single layer that differs, and lays the evidence side by side so a reader
 * can attribute any change in the verdict to exactly one cause.
 */
export function ComparisonCard({
  scenario,
  compareScenario,
  isGenerating = false,
  onLoadPaired,
  className,
}: ComparisonCardProps) {
  const t = useT()
  const current = scenarioMeta[scenario]
  const paired = scenarioMeta[compareScenario]
  const comparison = compareScenarios(current, paired)
  const evidenceRows = comparison.rows.filter((row) => row.layer !== "decision")
  const decisionRow = comparison.rows.find((row) => row.layer === "decision")

  return (
    <Card
      data-testid="comparison-card"
      data-changed-layer={comparison.layer ?? "none"}
      className={className}
    >
      <CardHeader>
        <div className="flex items-center gap-2">
          <GitCompareArrows aria-hidden className="size-3.5 text-primary" />
          <Eyebrow tone="primary">{t("lab.compare.eyebrow")}</Eyebrow>
        </div>
        <CardTitle className="text-xl tracking-tight text-balance">
          {t("lab.compare.title")}
        </CardTitle>
        <CardDescription className="max-w-[640px]">
          {t("lab.compare.purpose")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div
          data-testid="comparison-layer"
          className={cn(
            "rounded-xl border px-4 py-3",
            comparison.layer
              ? "border-primary/40 bg-primary/8"
              : "border-white/8 bg-white/3",
          )}
        >
          {comparison.layer ? (
            <>
              <Eyebrow as="p" tone="primary">
                {t("lab.compare.changedLayer")}
              </Eyebrow>
              <p className="mt-1 text-base font-semibold tracking-tight">
                {t(comparisonLayerLabelKeys[comparison.layer])}
              </p>
            </>
          ) : (
            <>
              <Eyebrow as="p">{t("lab.compare.identical.title")}</Eyebrow>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("lab.compare.identical.body")}
              </p>
            </>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-white/8">
          <div className={cn(rowGrid, "border-b border-white/8 bg-white/3 py-2.5")}>
            <span aria-hidden className="hidden sm:block" />
            <ScenarioHead
              label={t("lab.compare.current")}
              scenario={scenario}
              tone={current.expectedOutcome.tone}
            />
            <ScenarioHead
              label={t("lab.compare.paired")}
              scenario={compareScenario}
              tone={paired.expectedOutcome.tone}
            />
          </div>

          {evidenceRows.map((row) => (
            <EvidenceRow key={row.layer} row={row} />
          ))}

          {decisionRow ? (
            <div
              data-testid="comparison-row-decision"
              data-changed={decisionRow.differs}
              className={cn(rowGrid, "border-t border-white/8 bg-white/3 py-3")}
            >
              <Eyebrow as="p" className="col-span-2 self-center sm:col-span-1">
                {t(comparisonLayerLabelKeys.decision)}
              </Eyebrow>
              <VerdictValue
                tone={current.expectedOutcome.tone}
                label={t(decisionRow.currentKey)}
              />
              <VerdictValue
                tone={paired.expectedOutcome.tone}
                label={t(decisionRow.pairedKey)}
              />
            </div>
          ) : null}
        </div>

        {onLoadPaired ? (
          <div className="flex flex-col gap-3 border-t border-white/6 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-[460px] text-xs text-muted-foreground">
              {t("lab.compare.loadHint")}
            </p>
            <Button
              variant="outline"
              data-testid="comparison-load"
              disabled={isGenerating}
              onClick={onLoadPaired}
            >
              {t("lab.compare.load", {
                scenario: t(scenarioLabelKeys[compareScenario]),
              })}
              <ArrowRight aria-hidden className="size-4" />
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ScenarioHead({
  label,
  scenario,
  tone,
}: {
  label: string
  scenario: ScenarioKey
  tone: Tone
}) {
  const t = useT()
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-2">
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", toneDot[tone])} />
        <Eyebrow>{label}</Eyebrow>
      </span>
      <span className="truncate text-sm font-semibold">
        {t(scenarioLabelKeys[scenario])}
      </span>
      {/* The wire key, same as the scenario grid: what the API receives. */}
      <span className="truncate font-mono text-[10px] text-muted-foreground">
        {scenario}
      </span>
    </div>
  )
}

function EvidenceRow({ row }: { row: ComparisonRow }) {
  const t = useT()
  return (
    <div
      data-testid={`comparison-row-${row.layer}`}
      data-changed={row.differs}
      className={cn(
        rowGrid,
        "border-b border-white/6 py-2.5 last:border-b-0",
        row.differs && "bg-primary/8",
      )}
    >
      <span
        className={cn(
          "col-span-2 self-center text-xs font-medium sm:col-span-1",
          row.differs ? "text-primary" : "text-muted-foreground",
        )}
      >
        {t(comparisonLayerLabelKeys[row.layer])}
      </span>
      <span
        className={cn(
          "text-sm",
          row.differs ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        {t(row.currentKey)}
      </span>
      <span
        className={cn(
          "text-sm",
          row.differs ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        {t(row.pairedKey)}
      </span>
    </div>
  )
}

function VerdictValue({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={cn("flex items-center gap-2 text-sm font-semibold", toneText[tone])}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", toneDot[tone])} />
      {label}
    </span>
  )
}

/**
 * Shown on the verdict when no pair is chosen: a one-line pitch for what the
 * comparison proves, and the way back to step 1 to pick one.
 */
export function ComparisonNudge({ onChoosePaired }: { onChoosePaired: () => void }) {
  const t = useT()
  return (
    <section
      data-testid="comparison-nudge"
      className="glass-panel flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <GitCompareArrows aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="flex flex-col gap-0.5">
          <Eyebrow as="p" tone="primary">
            {t("lab.compare.eyebrow")}
          </Eyebrow>
          <p className="text-sm text-muted-foreground">{t("lab.compare.nudge.body")}</p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        data-testid="comparison-choose"
        onClick={onChoosePaired}
        className="shrink-0"
      >
        {t("lab.compare.nudge.action")}
        <ArrowRight aria-hidden className="size-3.5" />
      </Button>
    </section>
  )
}
