import { ArrowRight } from "lucide-react"

import { trustStackLayers } from "@/routes/learn/content"

export default function TrustStackDiagram() {
  return (
    <section className="rounded-[28px] border border-border/70 bg-card/92 p-5 shadow-[0_20px_50px_rgba(22,29,24,0.06)] md:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Architecture diagram
          </p>
          <h3 className="mt-2 font-serif text-3xl leading-[0.96] tracking-[-0.04em] text-foreground md:text-4xl">
            Four independent layers collapse into one scanner-visible decision
          </h3>
        </div>
        <p className="max-w-lg text-sm leading-6 text-muted-foreground">
          The design burden is keeping these layers separate long enough to
          evaluate them correctly. A positive issuer signal cannot erase a
          destination mismatch, and a clean destination cannot invent issuer
          legitimacy.
        </p>
      </div>

      <div className="mt-6 rounded-[24px] border border-border/70 bg-background/74 p-4 md:p-5">
        <div className="grid gap-4 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
          {trustStackLayers.map((layer, index) => (
            <div key={layer.title} className="contents">
              <article
                className={`rounded-[24px] border p-4 shadow-[0_12px_24px_rgba(22,29,24,0.04)] ${layer.tone}`}
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-9 items-center justify-center rounded-full bg-background/80 text-sm font-semibold text-current ring-1 ring-current/10">
                    {index + 1}
                  </span>
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-current/72">
                    Layer {index + 1}
                  </p>
                </div>
                <h4 className="mt-3 font-serif text-[28px] leading-tight tracking-[-0.03em] text-current/95">
                  {layer.title}
                </h4>
                <p className="mt-3 text-sm leading-6 text-current/84">{layer.question}</p>
              </article>

              {index < trustStackLayers.length - 1 ? (
                <div
                  aria-hidden="true"
                  className="hidden items-center justify-center xl:flex"
                >
                  <div className="flex w-10 items-center text-muted-foreground/45">
                    <span className="h-px flex-1 rounded-full bg-current" />
                    <ArrowRight className="-ml-1 size-4" strokeWidth={2.4} />
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-[22px] border border-border/70 bg-card/80 p-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Terminal semantic rule
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The scanner-visible state is not emitted until all four layers have
            had a chance to contribute. Trust emerges from evaluation order and
            policy precedence, not from one strong signal overriding the rest.
          </p>
        </div>
      </div>
    </section>
  )
}
