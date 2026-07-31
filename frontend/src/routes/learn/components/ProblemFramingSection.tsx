import { Card, CardContent } from "@/components/ui/card"
import { problemPipeline } from "@/routes/learn/content"

import ProblemTrustDiagram from "./ProblemTrustDiagram"

export default function ProblemFramingSection() {
  return (
    <section id="problem-framing" className="grid gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Figure 1 · Problem framing
          </p>
          <h2 className="mt-2 font-serif text-4xl leading-[0.96] tracking-[-0.05em] text-foreground md:text-5xl">
            QR code security is a trust problem
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
            The paper starts by separating three things that are usually blurred
            together: what scanners do today, what integrity-focused systems
            check, and what the user actually needs at scan time.
          </p>
        </div>
        <Card className="max-w-md rounded-[24px] border-border/70 bg-background/78 shadow-none">
          <CardContent className="p-4 text-sm leading-6 text-muted-foreground">
            Read the cards in order. The point is not that signatures are useless. The
            point is that integrity evidence alone does not answer the trust
            question a user is actually asking.
          </CardContent>
        </Card>
      </div>

      <ProblemTrustDiagram />

      <div className="grid gap-4 xl:grid-cols-3">
        {problemPipeline.map((column, index) => (
          <Card
            key={column.title}
            className="relative overflow-hidden rounded-[24px] border-border/70 bg-card/90 shadow-[0_12px_32px_rgba(22,29,24,0.05)]"
          >
            <div className="pointer-events-none absolute right-4 top-3 text-[64px] font-serif leading-none tracking-[-0.06em] text-foreground/[0.05]">
              {index + 1}
            </div>
            <CardContent className="p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {column.subtitle}
              </p>
              <h3 className="mt-2 font-serif text-3xl leading-tight tracking-[-0.04em] text-foreground">
                {column.title}
              </h3>
              <div className="mt-5 rounded-[20px] border border-border/70 bg-background/80 p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Why this matters
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {column.note}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
