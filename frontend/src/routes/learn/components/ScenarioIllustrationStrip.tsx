import type {
  IllustrationTone,
  ScenarioIllustration,
} from "@/routes/learn/content"
import { cn } from "@/lib/utils"
import { ArrowRight } from "lucide-react"
import { Fragment } from "react"

type ScenarioIllustrationStripProps = {
  illustration: ScenarioIllustration
  compareLabel?: string
  className?: string
  variant?: "cards" | "timeline"
}

const toneClasses: Record<IllustrationTone, string> = {
  neutral:
    "border-border/70 bg-background/82 text-foreground/80",
  success:
    "border-emerald-900/10 bg-emerald-500/9 text-emerald-950 dark:border-emerald-200/10 dark:bg-emerald-300/8 dark:text-emerald-50",
  warning:
    "border-amber-900/10 bg-amber-400/10 text-amber-950 dark:border-amber-200/10 dark:bg-amber-300/8 dark:text-amber-50",
  blocked:
    "border-red-900/10 bg-red-500/9 text-red-950 dark:border-red-200/10 dark:bg-red-300/8 dark:text-red-50",
}

const toneAccentClasses: Record<IllustrationTone, string> = {
  neutral: "bg-foreground/30",
  success: "bg-emerald-700",
  warning: "bg-amber-700",
  blocked: "bg-red-700",
}

export default function ScenarioIllustrationStrip({
  illustration,
  compareLabel,
  className,
  variant = "cards",
}: ScenarioIllustrationStripProps) {
  return (
    <section
      className={cn(
        "mt-4 overflow-hidden rounded-[24px] border border-border/70 bg-background/78",
        className,
      )}
    >
      <div className="grid gap-4 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Evidence lane
            </p>
            <h4 className="mt-1 text-xl font-semibold leading-tight tracking-[-0.025em] text-foreground">
              {illustration.title}
            </h4>
          </div>
          {compareLabel ? (
            <p className="max-w-lg rounded-full border border-border/70 bg-card/72 px-3 py-1.5 text-xs font-medium uppercase leading-5 tracking-[0.14em] text-muted-foreground">
              Compare against{" "}
              <span className="text-foreground">{compareLabel}</span>
            </p>
          ) : (
            <p className="max-w-md rounded-full border border-border/70 bg-card/72 px-3 py-1.5 text-xs leading-5 text-muted-foreground">
              Read the layers in order: the first failed layer explains the terminal
              verifier outcome.
            </p>
          )}
        </div>

        {variant === "timeline" ? (
          <div className="grid gap-2">
            {illustration.layers.map((layer, index) => (
              <article
                key={`${layer.title}-${layer.value}`}
                className={`grid gap-3 rounded-[18px] border p-3 shadow-[0_8px_18px_rgba(22,29,24,0.035)] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center ${toneClasses[layer.tone]}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex size-2.5 rounded-full ring-4 ring-background/85 ${toneAccentClasses[layer.tone]}`}
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-current/70">
                    Layer {index + 1}
                  </span>
                </div>

                <div className="min-w-0">
                  <h5 className="text-[11px] font-semibold uppercase leading-4 tracking-[0.12em] text-current/78">
                    {layer.title}
                  </h5>
                  <p className="mt-1 text-[13px] leading-5 text-current/74">
                    {layer.note}
                  </p>
                </div>

                <p className="w-fit rounded-full bg-background/68 px-3 py-1 text-base font-semibold leading-none tracking-[-0.025em] text-current sm:justify-self-end">
                  {layer.value}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)_2rem_minmax(0,1fr)_2rem_minmax(0,1fr)]">
            {illustration.layers.map((layer, index) => (
              <Fragment key={`${layer.title}-${layer.value}`}>
                <article
                  className={`rounded-[20px] border p-4 shadow-[0_10px_22px_rgba(22,29,24,0.045)] ${toneClasses[layer.tone]}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex size-2.5 rounded-full ring-4 ring-background/85 ${toneAccentClasses[layer.tone]}`}
                    />
                    <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-current/70">
                      Layer {index + 1}
                    </p>
                  </div>

                  <h5 className="mt-3 min-h-8 text-[11px] font-semibold uppercase leading-4 tracking-[0.12em] text-current/78">
                    {layer.title}
                  </h5>
                  <p className="mt-1 text-2xl font-semibold leading-none tracking-[-0.035em] text-current">
                    {layer.value}
                  </p>
                  <p className="mt-3 text-[13px] leading-5 text-current/76">
                    {layer.note}
                  </p>
                </article>
                {index < illustration.layers.length - 1 ? (
                  <div aria-hidden="true" className="hidden items-center xl:flex">
                    <div className="flex w-full items-center rounded-full border border-emerald-900/10 bg-emerald-500/8 px-1 text-emerald-900/60">
                      <span className="h-0.5 flex-1 rounded-full bg-current" />
                      <ArrowRight className="-ml-1 size-5" strokeWidth={2.8} />
                    </div>
                  </div>
                ) : null}
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
