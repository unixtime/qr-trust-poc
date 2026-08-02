import { ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

const trustChecks = [
  {
    label: "Issuer legitimacy",
    detail: "Is the QR signed by a registered issuer key?",
  },
  {
    label: "Destination binding",
    detail: "Does the destination match the issuer's approved set?",
  },
  {
    label: "Runtime safety",
    detail: "Is the destination safe to visit right now?",
  },
  {
    label: "Scanner decision",
    detail: "Open, hold-to-open, or block — with the evidence attached.",
  },
]

const docLinks = [
  {
    label: "Repository README",
    href: "https://github.com/unixtime/qr-trust-poc#readme",
  },
  {
    label: "Run guide",
    href: "https://github.com/unixtime/qr-trust-poc/blob/main/docs/public/RUN_GUIDE.md",
  },
]

type AboutPageProps = {
  onNavigate: (path: string) => void
}

export default function AboutPage({ onNavigate }: AboutPageProps) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">How it works</h1>
        <p className="text-sm text-muted-foreground">
          A proof of concept for QR codes a scanner can actually verify.
        </p>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-stretch sm:gap-2">
          {trustChecks.map((check, index) => (
            <div key={check.label} className="flex flex-1 items-center gap-2">
              <div className="flex flex-1 flex-col gap-1 rounded-md border border-border bg-muted/40 p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                  {index + 1}
                </span>
                <span className="text-sm font-medium">{check.label}</span>
                <span className="text-xs text-muted-foreground">
                  {check.detail}
                </span>
              </div>
              {index < trustChecks.length - 1 ? (
                <ArrowRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 text-sm leading-6 text-foreground">
        <p>
          An ordinary QR code is an opaque instruction: the scanner decodes a
          URL and opens it, trusting whoever printed the sticker. This proof of
          concept adds a verification step in between. Every demo QR carries a
          signed envelope, and the scanner asks a verifier to check that
          envelope before anything opens.
        </p>
        <p>
          The verifier walks the four checks above in order. Each check either
          passes, fails, or leaves a residual — a condition the cryptography
          alone cannot settle, such as an issuer policy that expired or a
          destination whose runtime reputation degraded after the code was
          printed.
        </p>
        <p>
          Verdicts keep those residuals visible instead of rounding them up to
          green: emerald means accepted, red means rejected or tampered, and
          amber means policy-gated or runtime-degraded. An amber verdict is
          never a positive result — it is the verifier telling you exactly
          which trust question remains open.
        </p>
        <p>
          The workflow on the landing page walks one scenario end to end: pick
          a scenario, generate its QR, scan it, and read the verdict evidence.
          The operator console manages the other side — issuer keys, policy,
          and runtime posture — so you can change the rules and watch the same
          QR produce a different decision.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          data-testid="about-open-workflow"
          onClick={() => onNavigate("/")}
        >
          Open the workflow
        </Button>
        {docLinks.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {link.label}
          </a>
        ))}
      </div>
    </div>
  )
}
