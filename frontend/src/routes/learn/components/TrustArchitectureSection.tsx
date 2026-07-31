import { Card, CardContent } from "@/components/ui/card"
import { trustStackLayers } from "@/routes/learn/content"

import TrustStackDiagram from "./TrustStackDiagram"

export default function TrustArchitectureSection() {
  return (
    <section id="trust-architecture" className="grid gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Required trust stack
          </p>
          <h2 className="mt-2 font-serif text-4xl leading-[0.96] tracking-[-0.05em] text-foreground md:text-5xl">
            The four layers the scanner must combine
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
            This is the architectural center of the paper. A convincing QR trust
            system has to keep issuer legitimacy, destination binding, runtime
            safety, and user-visible decision UX separate long enough to evaluate
            them correctly.
          </p>
        </div>
        <Card className="max-w-md rounded-[24px] border-border/70 bg-background/78 shadow-none">
          <CardContent className="p-4 text-sm leading-6 text-muted-foreground">
            The verifier is only the last step. The design burden is deciding
            what each layer means and how failures propagate into scanner-visible
            outcomes.
          </CardContent>
        </Card>
      </div>

      <TrustStackDiagram />

      <div className="grid gap-4 xl:grid-cols-4">
        {trustStackLayers.map((layer, index) => (
          <Card
            key={layer.title}
            className="rounded-[24px] border-border/70 bg-card/90 shadow-[0_12px_32px_rgba(22,29,24,0.05)]"
          >
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <span className="inline-flex size-10 items-center justify-center rounded-full bg-foreground text-sm font-semibold text-background">
                  {index + 1}
                </span>
                <h3 className="font-serif text-[28px] leading-tight tracking-[-0.03em] text-foreground">
                  {layer.title}
                </h3>
              </div>

              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                {layer.question}
              </p>

              <div className="mt-5 rounded-[20px] border border-border/70 bg-background/80 p-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Concrete examples
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {layer.examples}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  )
}
