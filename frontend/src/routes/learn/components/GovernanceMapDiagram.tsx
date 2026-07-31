import { ArrowRight } from "lucide-react"

type GovernanceStage = {
  title: string
  items: readonly string[]
}

type GovernanceMapDiagramProps = {
  activeIndex: number
  activePhaseLabel: string
  onSelectStage: (index: number) => void
  stages: readonly GovernanceStage[]
}

const laneLabels = [
  "Governance actors",
  "Shared-state publication",
  "Verifier consumption",
] as const

export default function GovernanceMapDiagram({
  activeIndex,
  activePhaseLabel,
  onSelectStage,
  stages,
}: GovernanceMapDiagramProps) {
  const renderStageCard = (
    stage: GovernanceStage,
    index: number,
    activeTone: string,
  ) => {
    const active = index === activeIndex

    return (
      <button
        key={stage.title}
        type="button"
        aria-label={`${active ? "Selected" : "View"} governance node ${index + 1}: ${stage.title}`}
        aria-pressed={active}
        onClick={() => onSelectStage(index)}
        className={[
          "min-h-[11rem] w-full rounded-[22px] border p-4 text-left transition-[background-color,border-color,box-shadow,transform]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700/35",
          active
            ? activeTone
            : "border-border/70 bg-background/82 hover:-translate-y-0.5 hover:border-emerald-900/16 hover:bg-card hover:shadow-[0_16px_34px_rgba(22,29,24,0.07)]",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {index + 1}
          </p>
          <span
            className={[
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
              active
                ? "border-emerald-900/12 bg-emerald-700 text-white"
                : "border-border/70 bg-background/70 text-muted-foreground",
            ].join(" ")}
          >
            {active ? "Active" : "View"}
          </span>
        </div>
        <h4 className="mt-2 font-serif text-2xl leading-tight tracking-[-0.03em] text-foreground">
          {stage.title}
        </h4>
        <div className="mt-3 space-y-2">
          {stage.items.slice(0, index === 3 ? 3 : 1).map((item) => (
            <p key={item} className="text-sm leading-6 text-muted-foreground">
              {item}
            </p>
          ))}
        </div>
        <p className="mt-4 border-t border-border/60 pt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {active ? "Details shown below" : "Click to inspect"}
        </p>
      </button>
    )
  }

  return (
    <section className="rounded-[28px] border border-border/70 bg-card/92 p-5 shadow-[0_20px_50px_rgba(22,29,24,0.06)] md:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Flow diagram
          </p>
          <h3 className="mt-2 font-serif text-3xl leading-[0.96] tracking-[-0.04em] text-foreground md:text-4xl">
            Governance becomes scanner trust only after publication and synchronization
          </h3>
        </div>
        <p className="max-w-lg text-sm leading-6 text-muted-foreground">
          Select a node to synchronize the explanation below. The map shows
          the difference between governed authority, published state, and
          scan-time consumption.
        </p>
      </div>

      <div className="mt-6 space-y-4">
        <div className="grid gap-3 xl:grid-cols-3">
          {laneLabels.map((label, index) => (
            <div
              key={label}
              className="relative rounded-full border border-border/70 bg-background/78 px-4 py-2 text-center"
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Lane {index + 1}
              </p>
              <p className="mt-1 text-sm font-medium text-foreground/80">{label}</p>
            </div>
          ))}
        </div>

        <div
          aria-hidden="true"
          className="hidden grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-center xl:grid"
        >
          <span className="h-px" />
          <span className="flex items-center justify-center text-emerald-900/70">
            <span className="h-0.5 flex-1 rounded-full bg-current/45" />
            <span className="grid size-7 place-items-center rounded-full border border-emerald-900/12 bg-card shadow-[0_8px_18px_rgba(22,29,24,0.06)]">
              <ArrowRight className="size-4" strokeWidth={2.8} />
            </span>
          </span>
          <span className="h-px" />
          <span className="flex items-center justify-center text-emerald-900/70">
            <span className="h-0.5 flex-1 rounded-full bg-current/45" />
            <span className="grid size-7 place-items-center rounded-full border border-emerald-900/12 bg-card shadow-[0_8px_18px_rgba(22,29,24,0.06)]">
              <ArrowRight className="size-4" strokeWidth={2.8} />
            </span>
          </span>
          <span className="h-px" />
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <div className="space-y-3">
            {stages
              .slice(0, 3)
              .map((stage, index) =>
                renderStageCard(
                  stage,
                  index,
                  "border-emerald-900/10 bg-emerald-500/8 shadow-[0_18px_36px_rgba(31,95,81,0.12)]",
                ),
              )}
          </div>

          <div className="space-y-3">
            {stages
              .slice(3, 4)
              .map((stage, index) =>
                renderStageCard(
                  stage,
                  index + 3,
                  "border-amber-900/10 bg-amber-400/10 shadow-[0_18px_36px_rgba(191,138,57,0.12)]",
                ),
              )}
          </div>

          <div className="space-y-3">
            {stages
              .slice(4)
              .map((stage, index) =>
                renderStageCard(
                  stage,
                  index + 4,
                  "border-sky-900/10 bg-sky-500/8 shadow-[0_18px_36px_rgba(59,130,246,0.10)]",
                ),
              )}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-[22px] border border-border/70 bg-background/78 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Active emphasis
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              The currently selected node belongs to the{" "}
              <span className="font-medium text-foreground">{activePhaseLabel}</span>{" "}
              phase.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <span className="inline-flex size-2.5 rounded-full bg-emerald-700" />
            <span>Governance</span>
            <span className="inline-flex size-2.5 rounded-full bg-amber-700" />
            <span>Published state</span>
            <span className="inline-flex size-2.5 rounded-full bg-sky-700" />
            <span>Verifier</span>
          </div>
        </div>
      </div>
    </section>
  )
}
