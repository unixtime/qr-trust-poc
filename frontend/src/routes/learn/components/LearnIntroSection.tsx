import { NotebookTabs } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

type LearnIntroSectionProps = {
  highlights: ReadonlyArray<{
    label: string
    value: string
  }>
}

export default function LearnIntroSection({
  highlights,
}: LearnIntroSectionProps) {
  return (
    <>
      <section className="grid gap-4 rounded-[2rem] border border-border/70 bg-card/90 p-6 shadow-[0_18px_60px_rgba(22,29,24,0.08)] backdrop-blur md:p-8">
        <Badge variant="outline" className="w-fit">
          Guided Learn Mode
        </Badge>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-end">
          <div className="grid gap-4">
            <h1 className="font-serif text-4xl leading-[0.96] tracking-[-0.05em] text-foreground md:text-6xl">
              Walk the paper model as an interactive verifier story.
            </h1>
            <p className="max-w-3xl text-base leading-7 text-muted-foreground">
              This route explains the paper through staged diagrams,
              implementation-backed case studies, and live lab handoffs. It is
              designed for reviewers, professors, and engineers who need the
              argument before the runtime details.
            </p>
          </div>
          <Card className="border-border/70 bg-background/80 shadow-none">
            <CardHeader>
              <CardTitle className="text-base">What this route covers</CardTitle>
              <CardDescription>
                Problem framing, trust-stack architecture, governance flow,
                implementation-aligned case studies, and prepared
                professor/reviewer tracks.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm text-muted-foreground">
              <div className="rounded-2xl border border-border/70 bg-card px-4 py-3">
                Learn mode explains why scanner-visible trust is a managed state,
                not a decoding result.
              </div>
              <div className="rounded-2xl border border-border/70 bg-card px-4 py-3">
                Lab mode keeps the implementation proof available when the reader
                wants to test the same case live.
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <Card className="rounded-[28px] border-border/70 bg-card/90 shadow-[0_18px_48px_rgba(22,29,24,0.06)]">
          <CardContent className="grid gap-4 p-5 md:p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-full border border-border/70 bg-background/80 p-2 text-muted-foreground">
                <NotebookTabs className="size-4" />
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Reading order
                </p>
                <h2 className="mt-1 text-lg font-medium text-foreground">
                  Start with the trust problem, then move into the four-layer
                  model.
                </h2>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <a
                href="#problem-framing"
                className="rounded-[22px] border border-border/70 bg-background/78 p-4 text-sm leading-6 text-muted-foreground transition-colors hover:bg-card"
              >
                <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Step 1
                </span>
                <span className="mt-2 block font-medium text-foreground">
                  Why decoding and integrity are not enough
                </span>
              </a>
              <a
                href="#trust-architecture"
                className="rounded-[22px] border border-border/70 bg-background/78 p-4 text-sm leading-6 text-muted-foreground transition-colors hover:bg-card"
              >
                <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Step 2
                </span>
                <span className="mt-2 block font-medium text-foreground">
                  Which trust layers the scanner must combine
                </span>
              </a>
              <a
                href="#governance-flow"
                className="rounded-[22px] border border-border/70 bg-background/78 p-4 text-sm leading-6 text-muted-foreground transition-colors hover:bg-card md:col-span-2"
              >
                <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Step 3
                </span>
                <span className="mt-2 block font-medium text-foreground">
                  How shared trust state reaches the verifier
                </span>
              </a>
              <a
                href="#case-studies"
                className="rounded-[22px] border border-border/70 bg-background/78 p-4 text-sm leading-6 text-muted-foreground transition-colors hover:bg-card md:col-span-2"
              >
                <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Step 4
                </span>
                <span className="mt-2 block font-medium text-foreground">
                  Move from the paper model into concrete lab-ready teaching
                  cases
                </span>
              </a>
              <a
                href="#teaching-tracks"
                className="rounded-[22px] border border-border/70 bg-background/78 p-4 text-sm leading-6 text-muted-foreground transition-colors hover:bg-card md:col-span-2"
              >
                <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Step 5
                </span>
                <span className="mt-2 block font-medium text-foreground">
                  Follow a prepared professor or reviewer sequence into the real
                  lab
                </span>
              </a>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-border/70 bg-card/90 shadow-[0_18px_48px_rgba(22,29,24,0.06)]">
          <CardContent className="grid gap-3 p-5 md:p-6">
            {highlights.map((item, index) => (
              <div key={item.label}>
                <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  {item.label}
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {item.value}
                </p>
                {index < highlights.length - 1 ? (
                  <Separator className="mt-3" />
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </>
  )
}
