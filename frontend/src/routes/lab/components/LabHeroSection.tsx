import {
  ListChecks,
  ScanLine,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"

const proofSteps = [
  {
    title: "Choose a scenario",
  },
  {
    title: "Generate and scan",
  },
  {
    title: "Explain the evidence",
  },
] as const

function LabHeroSection({ decoderLabel }: { decoderLabel: string }) {
  return (
    <section className="rounded-[1.35rem] border border-emerald-950/10 bg-card/96 p-4 shadow-[0_12px_34px_rgba(28,35,30,0.055)] md:p-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-emerald-950/10 bg-emerald-600/10 text-emerald-950">
              Guided verifier lab
            </Badge>
            <Badge variant="outline">
              {decoderLabel}
            </Badge>
          </div>
          <div>
            <h1 className="max-w-4xl text-2xl font-semibold leading-tight text-foreground md:text-4xl">
              Generate, scan, and verify one QR scenario at a time.
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
              The lab is a teaching workbench for professors, educators, and
              developers. Start with the scenario builder, check the user-facing
              scanner result, then use the evidence panels for discussion.
            </p>
          </div>
        </div>

        <div className="rounded-[1rem] border border-emerald-950/10 bg-emerald-600/8 p-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-950/70">
            <ListChecks className="size-4" />
            Recommended path
          </div>
          <ol className="mt-3 grid gap-2">
            {proofSteps.map((step, index) => (
              <li key={step.title} className="flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-emerald-950/10 bg-card text-xs font-semibold text-emerald-950">
                  {index + 1}
                </span>
                <div className="text-sm font-semibold text-foreground">
                  {step.title}
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-3 rounded-xl border border-emerald-950/10 bg-card/70 p-3 text-sm leading-5 text-muted-foreground">
            <div className="flex items-start gap-2">
              <ScanLine className="size-4" />
              <span>
                Use the in-app scanner. Native camera apps open links directly
                and do not prove the verifier result.
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default LabHeroSection
