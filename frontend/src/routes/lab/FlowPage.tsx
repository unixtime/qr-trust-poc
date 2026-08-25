import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ToastNotification, type ToastMessage, type ToastTone } from "@/components/ui/toast"
import { buildLabLink } from "@/domain/links"
import { scenarioLabelKeys } from "@/domain/scenarios"
import { useT } from "@/i18n"
import { requestJson, type ScannerDecisionRecent, type VerifierStatus } from "@/lib/verifier-client"
import { FlowStepper } from "@/routes/lab/components/FlowStepper"
import QrDisplayModal from "@/routes/lab/components/QrDisplayModal"
import { shouldAutogenerateFromRoute } from "@/routes/lab/content"
import { deriveFlowState, type FlowStepId } from "@/routes/lab/deriveFlowStep"
import GenerateStep from "@/routes/lab/steps/GenerateStep"
import { ScanStep } from "@/routes/lab/steps/ScanStep"
import ScenarioStep from "@/routes/lab/steps/ScenarioStep"
import { VerdictStep } from "@/routes/lab/steps/VerdictStep"
import type { MessageState } from "@/routes/lab/types"
import { useLabController } from "@/routes/lab/useLabController"

const scanToastDismissMs = 6000

function isScanToastMessage(message: MessageState) {
  return (
    message.title.includes("Scanner") ||
    message.title.includes("Camera scan") ||
    message.title.startsWith("QR ") ||
    message.title.startsWith("Image ") ||
    message.title === "No demo QR" ||
    message.title === "No destination to open" ||
    message.title === "Open was blocked by the browser"
  )
}

function scanToastTitle(message: MessageState) {
  if (message.title === "Scanner decision ready") {
    if (message.body.startsWith("verified_issuer:")) return "QR scan verified"
    if (message.body.startsWith("blocked:")) return "QR scan blocked"
    return "QR scan needs review"
  }

  return message.title
}

function scanToastTone(message: MessageState): ToastTone {
  if (message.title === "Scanner decision ready" && message.tone === "neutral") {
    return "warning"
  }

  return message.tone
}

function scanToastId(message: MessageState) {
  return `${Date.now()}-${message.title}-${message.body}`
}

function observedDecisionToastTitle(decision: ScannerDecisionRecent) {
  if (decision.decision_color === "green") return "QR scan verified"
  if (decision.decision_color === "red") return "QR scan blocked"
  return "QR scan needs review"
}

function observedDecisionToastTone(decision: ScannerDecisionRecent): ToastTone {
  if (decision.decision_color === "green") return "success"
  if (decision.decision_color === "red") return "blocked"
  return "warning"
}

function observedDecisionToastBody(decision: ScannerDecisionRecent) {
  const destination = decision.destination_fingerprint ?? "destination"
  const riskScore =
    decision.risk_score === null ? "" : ` · risk ${decision.risk_score}/100`
  const holdCopy = decision.hold_to_open_required ? " · hold to open" : ""

  return `${destination} · ${decision.decision_state.replaceAll("_", " ")}${riskScore}${holdCopy}`
}

type FlowPageProps = {
  onNavigate: (path: string) => void
}

type ProbeState = "pending" | "ok" | "failed"

export default function FlowPage({ onNavigate }: FlowPageProps) {
  const lab = useLabController()
  const t = useT()
  const [activeStep, setActiveStep] = useState<FlowStepId>(() =>
    shouldAutogenerateFromRoute() ? 2 : 1,
  )
  const [visitedSteps, setVisitedSteps] = useState<ReadonlySet<FlowStepId>>(
    () => new Set<FlowStepId>([shouldAutogenerateFromRoute() ? 2 : 1]),
  )
  const [probeState, setProbeState] = useState<ProbeState>("pending")

  const [dismissedScanToastId, setDismissedScanToastId] = useState<string | null>(null)
  const [observedDecisionToast, setObservedDecisionToast] =
    useState<ToastMessage | null>(null)
  const seenScannerDecisionIdsRef = useRef<Set<string>>(new Set())
  const scannerDecisionBaselineReadyRef = useRef(false)

  const scanToast = useMemo<ToastMessage | null>(() => {
    const message = lab.scanMessage
    if (!message || !isScanToastMessage(message)) return null

    return {
      id: scanToastId(message),
      title: scanToastTitle(message),
      body: message.body,
      tone: scanToastTone(message),
    }
  }, [lab.scanMessage])

  useEffect(() => {
    if (!scanToast) return

    const timeout = window.setTimeout(() => {
      setDismissedScanToastId(scanToast.id)
    }, scanToastDismissMs)

    return () => window.clearTimeout(timeout)
  }, [scanToast])

  const visibleScanToast =
    scanToast?.id === dismissedScanToastId ? null : scanToast
  const visibleToast = visibleScanToast ?? observedDecisionToast

  useEffect(() => {
    const recentDecisions =
      lab.runtimeStatus?.scanner_decisions.report?.recent_decisions ?? []

    if (!scannerDecisionBaselineReadyRef.current) {
      for (const decision of recentDecisions) {
        seenScannerDecisionIdsRef.current.add(decision.decision_id)
      }
      scannerDecisionBaselineReadyRef.current = true
      return
    }

    const newDecision = recentDecisions.find(
      (decision) => !seenScannerDecisionIdsRef.current.has(decision.decision_id),
    )
    if (!newDecision) return
    seenScannerDecisionIdsRef.current.add(newDecision.decision_id)

    const toast = {
      id: `observed-${newDecision.decision_id}`,
      title: observedDecisionToastTitle(newDecision),
      body: observedDecisionToastBody(newDecision),
      tone: observedDecisionToastTone(newDecision),
    }
    setObservedDecisionToast(toast)
  }, [lab.runtimeStatus])

  useEffect(() => {
    if (!observedDecisionToast) return

    const timeout = window.setTimeout(() => {
      setObservedDecisionToast(null)
    }, scanToastDismissMs)

    return () => window.clearTimeout(timeout)
  }, [observedDecisionToast])

  const runProbe = useCallback(() => {
    return requestJson<VerifierStatus>("/verifier/status")
      .then(() => setProbeState("ok"))
      .catch(() => setProbeState("failed"))
  }, [])

  useEffect(() => {
    void runProbe()
  }, [runProbe])

  const goToStep = useCallback((step: FlowStepId) => {
    setActiveStep(step)
    setVisitedSteps((prev) => {
      if (prev.has(step)) return prev
      const next = new Set(prev)
      next.add(step)
      return next
    })
  }, [])

  const flow = deriveFlowState(lab)

  return (
    <>
      <div className="flex flex-col gap-6 lg:flex-row lg:gap-10">
        <aside className="lg:w-60 lg:shrink-0">
          <FlowStepper
            activeStep={activeStep}
            flow={flow}
            visitedSteps={visitedSteps}
            onSelectStep={goToStep}
          />
        </aside>
        <section className="min-w-0 flex-1">
          {probeState === "failed" ? (
            <VerifierUnreachablePanel
              onRetry={() => {
                setProbeState("pending")
                void runProbe()
              }}
            />
          ) : activeStep === 1 ? (
            <ScenarioStep
              scenario={lab.scenario}
              compareScenario={lab.compareScenario}
              onSelectScenario={lab.setScenario}
              onSelectCompare={(compare) =>
                onNavigate(
                  buildLabLink(lab.scenario, lab.nonceMode, lab.usagePolicy, {
                    compare: compare ?? undefined,
                    autogenerate: false,
                  }),
                )
              }
              onNext={() => goToStep(2)}
            />
          ) : activeStep === 2 ? (
            <GenerateStep
              scenarioLabel={t(scenarioLabelKeys[lab.scenario])}
              demo={lab.demo}
              isGenerating={lab.isGenerating}
              generationError={lab.generationError}
              isVerifyingCurrent={lab.isVerifyingCurrent}
              nonceMode={lab.nonceMode}
              usagePolicy={lab.usagePolicy}
              showKeyIssue={lab.apiAuthEnabled && lab.adminFlowEnabled && !lab.apiKey.trim()}
              isIssuingLabKey={lab.isIssuingLabKey}
              latestActivity={lab.history[0] ?? null}
              result={lab.result}
              onGenerate={() => void lab.generateDemo()}
              onVerifyCurrent={() => void lab.verifyCurrent()}
              onIssueLabKey={() => void lab.issueLocalLabKey()}
              onNonceModeChange={lab.setNonceMode}
              onUsagePolicyChange={lab.setUsagePolicy}
              onOpenFullscreen={lab.openQrFullscreen}
              onBack={() => goToStep(1)}
              onNext={() => goToStep(3)}
            />
          ) : activeStep === 3 ? (
            <ScanStep lab={lab} onBack={() => goToStep(2)} onNext={() => goToStep(4)} />
          ) : (
            <VerdictStep lab={lab} onGoToScan={() => goToStep(3)} />
          )}
        </section>
      </div>
      <QrDisplayModal
        demo={lab.demo}
        open={lab.qrDisplayOpen}
        currentScenarioLabel={t(scenarioLabelKeys[lab.scenario])}
        highContrast={lab.qrDisplayHighContrast}
        showMetadata={lab.qrDisplayShowMetadata}
        error={lab.qrDisplayError}
        frameRef={lab.qrDisplayFrameRef}
        onClose={lab.closeQrDisplay}
        onToggleMetadata={lab.toggleQrDisplayMetadata}
        onToggleHighContrast={lab.toggleQrDisplayHighContrast}
        onEnterFullscreen={() => void lab.enterQrDisplayFullscreen()}
      />
      <ToastNotification
        toast={visibleToast}
        onDismiss={() => {
          if (visibleScanToast && scanToast) {
            setDismissedScanToastId(scanToast.id)
          } else if (observedDecisionToast) {
            setObservedDecisionToast(null)
          }
        }}
      />
    </>
  )
}

function VerifierUnreachablePanel({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 py-8">
        <h2 className="text-lg font-semibold">Verifier not reachable</h2>
        <p className="text-sm text-muted-foreground">
          The workflow needs the local verifier API. Start the stack, then retry:
        </p>
        <code className="rounded-lg border border-white/10 bg-[rgba(5,10,18,0.45)] px-2.5 py-1.5 font-mono text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
          docker compose up --build
        </code>
        <Button data-testid="verifier-retry" onClick={onRetry}>
          Retry connection
        </Button>
      </CardContent>
    </Card>
  )
}
