import { problemDiagramFooters, problemPipeline } from "@/routes/learn/content"
import { ArrowRight } from "lucide-react"
import { Fragment } from "react"

function StepPill({ step }: { step: number }) {
  return (
    <span className="inline-flex size-6 items-center justify-center rounded-full border border-border/70 bg-background text-[11px] font-semibold text-muted-foreground">
      {step}
    </span>
  )
}

function FlowConnector({ label }: { label: string }) {
  return (
    <div aria-hidden="true" className="hidden items-center xl:flex">
      <div className="relative flex w-full items-center justify-center text-emerald-900/70">
        <span className="h-0.5 flex-1 rounded-full bg-current/45" />
        <span className="absolute inline-flex items-center gap-1 rounded-full border border-emerald-900/12 bg-card px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-[0_10px_24px_rgba(22,29,24,0.08)]">
          {label}
          <ArrowRight className="size-3.5" strokeWidth={3} />
        </span>
      </div>
    </div>
  )
}

export default function ProblemTrustDiagram() {
  return (
    <section className="rounded-[28px] border border-border/70 bg-card/92 p-5 shadow-[0_20px_50px_rgba(22,29,24,0.06)] md:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Visual model
          </p>
          <h3 className="mt-2 font-serif text-3xl leading-[0.96] tracking-[-0.04em] text-foreground md:text-4xl">
            The scan-time problem the paper is actually arguing about
          </h3>
        </div>
        <p className="max-w-lg text-sm leading-6 text-muted-foreground">
          Read the cards in order. The lower row shows what breaks when trust
          is collapsed into decoding or integrity alone.
        </p>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)_2.5rem_minmax(0,1fr)]">
        {problemPipeline.map((column, index) => (
          <Fragment key={column.title}>
            <article className="h-full rounded-[24px] border border-border/70 bg-background/78 p-5 shadow-[0_12px_24px_rgba(22,29,24,0.04)]">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {column.subtitle}
              </p>
              <h4 className="mt-2 font-serif text-[28px] leading-tight tracking-[-0.03em] text-foreground">
                {column.title}
              </h4>
              <ol className="mt-5 space-y-3 text-sm leading-6 text-muted-foreground">
                {column.items.map((item, itemIndex) => (
                  <li key={item} className="flex gap-3">
                    <StepPill step={itemIndex + 1} />
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </article>
            {index < problemPipeline.length - 1 ? (
              <FlowConnector label={index === 0 ? "then validate" : "then decide"} />
            ) : null}
          </Fragment>
        ))}
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        {problemDiagramFooters.map((footer) => (
          <article
            key={footer.label}
            className={`rounded-[24px] border p-4 shadow-[0_10px_24px_rgba(22,29,24,0.04)] ${footer.tone}`}
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-current/70">
              {footer.label}
            </p>
            <h5 className="mt-2 text-base font-semibold text-current/90">{footer.title}</h5>
            <p className="mt-2 text-sm leading-6 text-current/80">{footer.copy}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
