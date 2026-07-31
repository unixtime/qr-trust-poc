import { ArrowRight, Scale, ShieldAlert, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  buildLabLink,
  publicUseCases,
  scenarioIllustrationMap,
} from "@/routes/learn/content"

import ScenarioIllustrationStrip from "./ScenarioIllustrationStrip"

type CaseStudySectionProps = {
  onNavigate: (path: string) => void
}

export default function CaseStudySection({ onNavigate }: CaseStudySectionProps) {
  return (
    <section id="case-studies" className="grid gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Interactive case studies
          </p>
          <h2 className="mt-2 max-w-3xl text-3xl font-semibold leading-[1.02] tracking-[-0.045em] text-foreground md:text-4xl">
            Use cases people can actually reason about
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
            These cases adapt the paper’s model to the working verifier surfaces
            already implemented in this repo. The point is not to invent new
            abstract states. The point is to connect the model to the lab people
            can actually run.
          </p>
        </div>
        <Card className="max-w-md rounded-[24px] border-border/70 bg-background/78 shadow-none">
          <CardContent className="p-4 text-sm leading-6 text-muted-foreground">
            Pick a case, read its trust strip, then open the real verifier lab
            with the matching scenario preloaded.
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5">
        {publicUseCases.map((item) => {
          const illustration = scenarioIllustrationMap[item.scenario]
          const compareLabel = item.compareScenario
            ? publicUseCases.find(
                (candidate) => candidate.scenario === item.compareScenario,
              )?.title
            : undefined

          return (
            <Card
              key={item.title}
              className="rounded-[28px] border-border/70 bg-card/92 shadow-[0_16px_40px_rgba(22,29,24,0.06)]"
            >
              <CardContent className="grid gap-5 p-5 md:p-6 xl:grid-cols-[minmax(280px,0.56fr)_minmax(0,1.44fr)] xl:items-start">
                <div className="grid gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex rounded-full bg-amber-400/12 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-950">
                      {item.audience}
                    </span>
                    <span className="inline-flex rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Lab scenario: {item.scenario}
                    </span>
                  </div>

                  <div>
                    <h3 className="text-2xl font-semibold leading-tight tracking-[-0.035em] text-foreground md:text-3xl">
                      {item.title}
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-muted-foreground">
                      {item.summary}
                    </p>
                  </div>

                  <dl className="grid gap-3 text-sm leading-6 text-muted-foreground">
                    <div className="rounded-[20px] border border-border/70 bg-background/72 p-3">
                      <dt className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        <Sparkles className="size-3.5" />
                        Actor
                      </dt>
                      <dd className="mt-2 text-foreground/82">{item.actor}</dd>
                    </div>
                    <div className="rounded-[20px] border border-border/70 bg-background/72 p-3">
                      <dt className="font-medium text-foreground">Environment</dt>
                      <dd className="mt-1">{item.environment}</dd>
                    </div>
                    <div className="rounded-[20px] border border-amber-900/10 bg-amber-400/8 p-3">
                      <dt className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        <ShieldAlert className="size-3.5" />
                        Failure to look for
                      </dt>
                      <dd className="mt-2">{item.threat}</dd>
                    </div>
                    <div className="rounded-[20px] border border-emerald-900/10 bg-emerald-500/8 p-3">
                      <dt className="font-medium text-foreground">Takeaway</dt>
                      <dd className="mt-1">{item.lesson}</dd>
                    </div>
                  </dl>
                </div>

                <div className="grid gap-4">
                  {illustration ? (
                    <ScenarioIllustrationStrip
                      illustration={illustration}
                      compareLabel={compareLabel}
                      className="mt-0"
                    />
                  ) : null}

                  <div className="flex flex-col gap-3 rounded-[22px] border border-border/70 bg-background/78 px-4 py-3 text-sm leading-6 text-muted-foreground md:flex-row md:items-center md:justify-between">
                    {item.compareScenario ? (
                      <div className="flex items-center gap-2">
                        <Scale className="size-4 text-foreground" />
                        <span className="font-medium text-foreground">Compare next:</span>
                        <span>{compareLabel ?? item.compareScenario}</span>
                      </div>
                    ) : (
                      <div className="font-medium text-foreground">
                        Run this baseline first, then repeat the QR to expose
                        replay behavior.
                      </div>
                    )}
                    <div className="flex flex-wrap gap-3">
                      <Button
                        variant="outline"
                        onClick={() =>
                          onNavigate(
                            buildLabLink(
                              item.scenario,
                              item.nonceMode ?? "fixed",
                              item.usagePolicy,
                            ),
                          )
                        }
                      >
                        Open in lab
                        <ArrowRight className="size-4" />
                      </Button>
                      {item.compareScenario ? (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            onNavigate(
                              buildLabLink(
                                item.compareScenario!,
                                item.nonceMode ?? "fixed",
                                item.usagePolicy,
                              ),
                            )
                          }
                        >
                          Open compare case
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
