import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { ScannerDecisionResponse } from "@/lib/verifier-client"
import { HistorySection } from "@/routes/lab/components/HistorySection"
import type { LabState } from "@/routes/lab/deriveFlowStep"
import {
  decisionStateTone,
  trustStatusTone,
  type TrustTone,
} from "@/routes/lab/trust-tone"

type TrustRow = {
  status: string
  label: string
  message: string | null
  reason_codes: string[]
}

function trustPathRows(decision: ScannerDecisionResponse): TrustRow[] {
  if (decision.contract) {
    const path = decision.contract.trust_path
    return [
      { ...path.issuer_legitimacy },
      { ...path.destination_binding },
      { ...path.runtime_safety },
      { ...path.scanner_decision },
    ]
  }
  return decision.signals.slice(0, 4).map((signal) => ({
    status: signal.state,
    label: signal.layer.replaceAll("_", " "),
    message: signal.message,
    reason_codes: [],
  }))
}

const toneStyles: Record<
  TrustTone,
  { icon: typeof CheckCircle2; surface: string; text: string }
> = {
  green: {
    icon: CheckCircle2,
    surface: "border-trust-green/25 bg-trust-green/10",
    text: "text-trust-green",
  },
  amber: {
    icon: AlertTriangle,
    surface: "border-trust-amber/25 bg-trust-amber/10",
    text: "text-trust-amber",
  },
  red: {
    icon: XCircle,
    surface: "border-trust-red/25 bg-trust-red/10",
    text: "text-trust-red",
  },
}

type VerdictStepProps = {
  lab: LabState
  onGoToScan: () => void
}

export function VerdictStep({ lab, onGoToScan }: VerdictStepProps) {
  const decision = lab.scannerDecision
  const rows = decision ? trustPathRows(decision) : []
  const reasonCodes = decision
    ? (decision.contract?.reason_codes ?? decision.scanner_ux?.reason_codes ?? [])
    : []
  const decisionTone: TrustTone = decision
    ? decision.contract
      ? decision.contract.decision_color === "green"
        ? "green"
        : decision.contract.decision_color === "red"
          ? "red"
          : "amber"
      : decisionStateTone(decision.decision_state)
    : "amber"

  return (
    <div className="flex flex-col gap-6" data-testid="verdict-step">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">
          Verdict &amp; evidence
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every trust check the scanner ran, with its raw evidence.
        </p>
      </header>

      {lab.result ? (
        <Card data-testid="verifier-result">
          <CardHeader>
            <CardTitle className="text-base">Cryptographic verification</CardTitle>
            <CardDescription>
              Result of verifying the current QR payload against the verifier
              API.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant={lab.result.allowed ? "secondary" : "destructive"}>
                {lab.result.allowed ? "accepted" : "rejected"}
              </Badge>
              <span className="text-muted-foreground">
                stage: {lab.result.stage}
              </span>
            </div>
            <p>{lab.result.reason}</p>
            {lab.result.usage_policy ? (
              <p className="text-muted-foreground">
                usage policy: {lab.result.usage_policy}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {decision === null ? (
        <Card data-testid="verdict-empty">
          <CardContent className="flex flex-col items-start gap-3 py-8">
            <h3 className="text-lg font-semibold">No scanner decision yet</h3>
            <p className="text-sm text-muted-foreground">
              Scan the QR with the camera in step 3, or use the simulated scan
              ("Check scanner decision") there.
            </p>
            <Button variant="outline" data-testid="verdict-back" onClick={onGoToScan}>
              Back to Scan
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card data-testid="verdict-decision">
            <CardContent className="flex flex-col gap-3 py-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={`${toneStyles[decisionTone].surface} ${toneStyles[decisionTone].text} border`}>
                  {decision.decision_state.replaceAll("_", " ")}
                </Badge>
                <p className="text-sm font-medium">{decision.primary_message}</p>
              </div>
              {reasonCodes.length > 0 ? (
                <div
                  className="flex flex-wrap gap-1.5"
                  data-testid="verdict-reason-codes"
                >
                  {reasonCodes.map((code) => (
                    <span
                      key={code}
                      className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs"
                    >
                      {code}
                    </span>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <ul className="flex flex-col gap-3">
            {rows.map((row, index) => {
              const tone = toneStyles[trustStatusTone(row.status)]
              const Icon = tone.icon
              return (
                <li
                  key={`${row.label}-${index}`}
                  className={`rounded-lg border p-4 ${tone.surface}`}
                  data-testid={`trust-row-${index}`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className={`mt-0.5 size-4 shrink-0 ${tone.text}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{row.label}</p>
                      {row.message ? (
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {row.message}
                        </p>
                      ) : null}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-muted-foreground">
                          Raw evidence
                        </summary>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs">
                            {row.status}
                          </span>
                          {row.reason_codes.map((code) => (
                            <span
                              key={code}
                              className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs"
                            >
                              {code}
                            </span>
                          ))}
                        </div>
                      </details>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          <footer>
            <Button variant="outline" data-testid="verdict-back" onClick={onGoToScan}>
              Back
            </Button>
          </footer>
        </>
      )}

      <HistorySection history={lab.history} />
    </div>
  )
}
