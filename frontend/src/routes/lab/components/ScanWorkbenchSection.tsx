import { type ChangeEvent, useEffect, useRef, useState } from "react"
import {
  Camera,
  CameraOff,
  CircleAlert,
  Copy,
  ExternalLink,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Eyebrow } from "@/components/ui/eyebrow"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useT, type MessageKey } from "@/i18n"
import { cn } from "@/lib/utils"
import DecisionPanel from "@/routes/lab/components/DecisionPanel"
import StatusPanel from "@/routes/lab/components/StatusPanel"
import { trustStatusTone } from "@/routes/lab/trust-tone"
import type { ScanWorkbenchSectionProps } from "@/routes/lab/types"

type ScanDecision = NonNullable<
  ScanWorkbenchSectionProps["workbench"]["scannerDecision"]
>
type ScannerRiskLevel = "green" | "amber" | "red"

function scannerContractRiskLevel(decision: ScanDecision): ScannerRiskLevel | undefined {
  const color = decision.contract?.decision_color
  if (color === "orange") return "amber"
  return color
}

function scannerFallbackRiskLevel(decision: ScanDecision): ScannerRiskLevel {
  if (decision.decision_state === "verified_issuer") return "green"
  if (decision.decision_state === "blocked") return "red"
  return "amber"
}

function scannerRiskLevel(decision: ScanDecision): ScannerRiskLevel {
  return (
    decision.scanner_ux?.risk_level ??
    scannerContractRiskLevel(decision) ??
    scannerFallbackRiskLevel(decision)
  )
}

function scannerDecisionTone(decision: ScanDecision) {
  const riskLevel = scannerRiskLevel(decision)
  if (riskLevel === "green") return "success"
  if (riskLevel === "red") return "blocked"
  return "neutral"
}

// These helpers run at module scope, so they must return catalog keys rather
// than translated strings — a string resolved here would be fixed at import
// time and never follow a locale change.
function scannerDecisionLabelKey(decision: ScanDecision): MessageKey {
  const riskLevel = scannerRiskLevel(decision)
  if (riskLevel === "green") return "lab.scanner.verdict.verified"
  if (riskLevel === "red") return "lab.scanner.verdict.blocked"
  return "lab.scanner.verdict.caution"
}

function formatDecisionValue(value: string) {
  return value.replaceAll("_", " ")
}

function formatReasonCode(value: string) {
  return value.replaceAll("_", " ")
}

// The record keys are verifier reason codes off the wire and never change with
// locale; only the label and detail they point at do.
const reasonCopy = {
  caption_domain_mismatch: {
    labelKey: "lab.reason.captionDomainMismatch.label",
    detailKey: "lab.reason.captionDomainMismatch.detail",
  },
  destination_mismatch: {
    labelKey: "lab.reason.destinationMismatch.label",
    detailKey: "lab.reason.destinationMismatch.detail",
  },
  embedded_credentials: {
    labelKey: "lab.reason.embeddedCredentials.label",
    detailKey: "lab.reason.embeddedCredentials.detail",
  },
  https_absent: {
    labelKey: "lab.reason.httpsAbsent.label",
    detailKey: "lab.reason.httpsAbsent.detail",
  },
  issuer_unknown: {
    labelKey: "lab.reason.issuerUnknown.label",
    detailKey: "lab.reason.issuerUnknown.detail",
  },
  known_bad_domain: {
    labelKey: "lab.reason.knownBadDomain.label",
    detailKey: "lab.reason.knownBadDomain.detail",
  },
  net_new_domain: {
    labelKey: "lab.reason.netNewDomain.label",
    detailKey: "lab.reason.netNewDomain.detail",
  },
  newly_registered_domain: {
    labelKey: "lab.reason.newlyRegisteredDomain.label",
    detailKey: "lab.reason.newlyRegisteredDomain.detail",
  },
  one_time_used: {
    labelKey: "lab.reason.oneTimeUsed.label",
    detailKey: "lab.reason.oneTimeUsed.detail",
  },
  plain_url: {
    labelKey: "lab.reason.plainUrl.label",
    detailKey: "lab.reason.plainUrl.detail",
  },
  redirect_chain: {
    labelKey: "lab.reason.redirectChain.label",
    detailKey: "lab.reason.redirectChain.detail",
  },
  redirect_policy_block: {
    labelKey: "lab.reason.redirectPolicyBlock.label",
    detailKey: "lab.reason.redirectPolicyBlock.detail",
  },
  runtime_blocked: {
    labelKey: "lab.reason.runtimeBlocked.label",
    detailKey: "lab.reason.runtimeBlocked.detail",
  },
  runtime_risky: {
    labelKey: "lab.reason.runtimeRisky.label",
    detailKey: "lab.reason.runtimeRisky.detail",
  },
  signature_invalid: {
    labelKey: "lab.reason.signatureInvalid.label",
    detailKey: "lab.reason.signatureInvalid.detail",
  },
  stale_trust_state: {
    labelKey: "lab.reason.staleTrustState.label",
    detailKey: "lab.reason.staleTrustState.detail",
  },
  suspicious_tld: {
    labelKey: "lab.reason.suspiciousTld.label",
    detailKey: "lab.reason.suspiciousTld.detail",
  },
  trust_cache_unavailable: {
    labelKey: "lab.reason.trustCacheUnavailable.label",
    detailKey: "lab.reason.trustCacheUnavailable.detail",
  },
  unreadable_payload: {
    labelKey: "lab.reason.unreadablePayload.label",
    detailKey: "lab.reason.unreadablePayload.detail",
  },
} satisfies Record<string, { labelKey: MessageKey; detailKey: MessageKey }>

// Resolves rather than returning keys, because the fallback label is the wire
// reason code itself — a value, not prose, so it has no catalog entry to name.
function reasonCodeCopy(code: string, t: (key: MessageKey) => string) {
  const entry = reasonCopy[code as keyof typeof reasonCopy]
  if (!entry) {
    return { label: formatReasonCode(code), detail: t("lab.reason.unknown.detail") }
  }
  return { label: t(entry.labelKey), detail: t(entry.detailKey) }
}

function riskStripeLabelKey(
  level: "green" | "amber" | "red" | undefined,
): MessageKey {
  if (level === "green") return "lab.scanner.risk.low"
  if (level === "red") return "lab.scanner.risk.high"
  return "lab.scanner.risk.medium"
}

// `null` means the verifier's own `primary_message` is the best summary we
// have. That string arrives from the backend already composed, so it stays out
// of the frontend catalog and the caller renders it verbatim.
function scannerPreviewSummaryKey(decision: ScanDecision): MessageKey | null {
  const reasons = decision.scanner_ux?.reason_codes ?? []
  const riskLevel = scannerRiskLevel(decision)
  if (riskLevel === "green") {
    return "lab.scanner.summary.verified"
  }
  if (riskLevel === "red") {
    if (reasons.includes("one_time_used")) {
      return "lab.scanner.summary.oneTimeUsed"
    }
    if (reasons.includes("destination_mismatch")) {
      return "lab.scanner.summary.destinationMismatch"
    }
    return "lab.scanner.summary.blocked"
  }
  if (reasons.includes("plain_url")) {
    return "lab.scanner.summary.plainUrl"
  }
  return null
}

function riskStripeClass(level: "green" | "amber" | "red"): string {
  if (level === "green") return "bg-trust-green"
  if (level === "red") return "bg-trust-red"
  return "bg-trust-amber"
}

function riskPillClass(level: "green" | "amber" | "red"): string {
  if (level === "green") {
    return "border-trust-green/25 bg-trust-green/10 text-trust-green"
  }
  if (level === "red") {
    return "border-trust-red/25 bg-trust-red/10 text-trust-red"
  }
  return "border-trust-amber/25 bg-trust-amber/10 text-trust-amber"
}

function scannerDestinationUrl(decision: ScanDecision) {
  return (
    decision.contract?.destination.final_url ||
    decision.contract?.destination.resolver_url ||
    decision.contract?.destination.url ||
    decision.destination.final_url ||
    decision.destination.resolver_url ||
    decision.destination.display_url ||
    ""
  )
}

function scannerTrustPath(decision: ScanDecision) {
  if (decision.contract) {
    const { trust_path: trustPath } = decision.contract
    return [
      trustPath.issuer_legitimacy,
      trustPath.destination_binding,
      trustPath.runtime_safety,
      trustPath.scanner_decision,
    ]
  }

  return decision.signals.slice(0, 4).map((signal) => ({
    status: signal.state,
    label: formatDecisionValue(signal.layer),
    message: signal.message,
    reason_codes: [] as string[],
  }))
}

function HoldToOpenButton({
  decision,
  holdMs,
  onHoldStart,
  onHoldCancel,
  onHoldComplete,
}: {
  decision: ScanDecision
  holdMs: number
  onHoldStart: (decision: ScanDecision) => void
  onHoldCancel: (decision: ScanDecision, elapsedMs: number) => void
  onHoldComplete: (decision: ScanDecision, elapsedMs: number) => void
}) {
  const t = useT()
  const [isHolding, setIsHolding] = useState(false)
  const startedAtRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)

  function clearHoldTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function startHold() {
    if (timerRef.current !== null) return
    startedAtRef.current = window.performance.now()
    setIsHolding(true)
    onHoldStart(decision)
    timerRef.current = window.setTimeout(() => {
      const elapsedMs = startedAtRef.current
        ? Math.round(window.performance.now() - startedAtRef.current)
        : holdMs
      clearHoldTimer()
      startedAtRef.current = null
      setIsHolding(false)
      onHoldComplete(decision, elapsedMs)
    }, holdMs)
  }

  function cancelHold() {
    if (timerRef.current === null) return
    const elapsedMs = startedAtRef.current
      ? Math.round(window.performance.now() - startedAtRef.current)
      : 0
    clearHoldTimer()
    startedAtRef.current = null
    setIsHolding(false)
    onHoldCancel(decision, elapsedMs)
  }

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    },
    [],
  )

  return (
    <Button
      type="button"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        startHold()
      }}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onKeyDown={(event) => {
        if (event.repeat) return
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault()
          startHold()
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault()
          cancelHold()
        }
      }}
      aria-pressed={isHolding}
      className="min-w-[12rem]"
    >
      <ExternalLink data-icon="inline-start" />
      {isHolding
        ? t("lab.scanner.hold.inProgress")
        : t("lab.scanner.hold.prompt", { ms: holdMs })}
    </Button>
  )
}

function ScannerDecisionPanel({
  decision,
  onOpenDestination,
  onCancelOpen,
  onHoldStart,
  onHoldCancel,
  onHoldComplete,
}: {
  decision: ScanDecision
  onOpenDestination: (decision: ScanDecision, elapsedMs?: number | null) => void
  onCancelOpen: (decision: ScanDecision, elapsedMs?: number | null) => void
  onHoldStart: (decision: ScanDecision) => void
  onHoldCancel: (decision: ScanDecision, elapsedMs: number) => void
  onHoldComplete: (decision: ScanDecision, elapsedMs: number) => void
}) {
  const t = useT()
  const tone = scannerDecisionTone(decision)
  const scannerUx = decision.scanner_ux
  const destinationUrl = scannerDestinationUrl(decision)
  const destination =
    scannerUx?.destination_display ||
    decision.contract?.destination.display_host ||
    decision.destination.host ||
    decision.destination.display_url ||
    t("lab.scanner.noDestination")
  const indicatorClass =
    scannerUx?.risk_stripe !== undefined
      ? riskStripeClass(scannerUx.risk_stripe)
      : tone === "success"
        ? "bg-trust-green"
        : tone === "blocked"
          ? "bg-trust-red"
          : "bg-trust-amber"
  const cardClass =
    tone === "success"
      ? "border-trust-green/25 bg-trust-green/10 text-trust-green"
      : tone === "blocked"
        ? "border-destructive/20 bg-destructive/10 text-destructive"
        : "border-trust-amber/25 bg-trust-amber/10 text-trust-amber"
  const riskLevel = scannerRiskLevel(decision)
  const reasonCodes = scannerUx?.reason_codes ?? decision.contract?.reason_codes ?? []
  const fingerprint =
    decision.contract?.destination.fingerprint ||
    scannerUx?.destination_fingerprint ||
    destination
  // The first two branches are verifier-authored action text; only the last
  // resort is ours to translate.
  const finalAction =
    scannerUx?.primary_action ??
    decision.actions[0]?.label ??
    t(
      decision.open_allowed
        ? "lab.scanner.action.openAvailable"
        : "lab.scanner.action.openNotAdvised",
    )
  const holdToOpen = decision.contract?.hold_to_open
  const holdRequired = scannerUx?.hold_required ?? holdToOpen?.required ?? false
  const holdMs = scannerUx?.hold_ms ?? holdToOpen?.duration_ms ?? 0
  const holdCopy = holdRequired
    ? t("lab.scanner.hold.required", { ms: holdMs })
    : t("lab.scanner.hold.notRequired")
  const trustPath = scannerTrustPath(decision)
  const summaryKey = scannerPreviewSummaryKey(decision)

  return (
    <div
      className={`overflow-hidden rounded-lg border ${cardClass}`}
    >
      <div
        className={cn("h-2 w-full", riskStripeClass(scannerUx?.risk_stripe ?? riskLevel))}
        aria-label={t("lab.scanner.riskStripe.label", {
          level: t(riskStripeLabelKey(riskLevel)),
        })}
      />
      <div className="grid gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`inline-flex size-2.5 rounded-full ${indicatorClass}`} />
            <Eyebrow as="div" tone="current">
              {t("lab.scanner.preview")}
            </Eyebrow>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge
              variant="outline"
              className={cn("capitalize", riskPillClass(riskLevel))}
            >
              {t(riskStripeLabelKey(riskLevel))}
              {scannerUx ? ` · ${scannerUx.risk_score}/100` : ""}
            </Badge>
            <Badge variant={tone === "blocked" ? "destructive" : "outline"}>
              {t(scannerDecisionLabelKey(decision))}
            </Badge>
          </div>
        </div>

        <div className="grid gap-3 rounded-[1.35rem] border border-current/10 bg-background/50 p-4">
          <div className="text-3xl font-black tracking-[-0.055em]">
            {t(scannerDecisionLabelKey(decision))}
          </div>
          <p className="text-sm leading-6 text-current/76">
            {summaryKey ? t(summaryKey) : decision.primary_message}
          </p>
        </div>

        <div className="rounded-[1.35rem] border border-current/10 bg-background/52 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Eyebrow as="div" tone="current">
                {t("lab.scanner.fingerprint")}
              </Eyebrow>
              <div className="mt-2 break-all text-xl font-black tracking-[-0.045em] text-current">
                {fingerprint}
              </div>
            </div>
            <QrCode className="mt-1 size-5 shrink-0 text-current/45" />
          </div>
          <p className="mt-2 text-xs leading-5 text-current/64">
            {t("lab.scanner.fingerprint.note")}
          </p>
          {destinationUrl ? (
            <details className="mt-3 rounded-[1rem] border border-current/10 bg-background/35 px-3 py-2 text-xs text-current/68">
              <summary className="cursor-pointer select-none font-semibold">
                {t("lab.scanner.showFullUrl")}
              </summary>
              <div className="mt-2 break-all leading-5">{destinationUrl}</div>
            </details>
          ) : null}
        </div>

        {reasonCodes.length ? (
          <div className="rounded-[1.35rem] border border-current/10 bg-background/42 p-4">
            <Eyebrow as="div" tone="current">
              {t("lab.scanner.whyThisResult")}
            </Eyebrow>
            <div className="mt-3 grid gap-2">
              {reasonCodes.map((code) => {
                const copy = reasonCodeCopy(code, t)
                return (
                  <div
                    key={code}
                    className="rounded-[1rem] border border-current/10 bg-background/45 p-3"
                  >
                    <div className="text-sm font-semibold text-current">
                      {copy.label}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-current/64">
                      {copy.detail}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {trustPath.length ? (
          <div className="rounded-[1.35rem] border border-current/10 bg-background/35 p-4">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow as="div" tone="current">
                {t("lab.scanner.trustPath")}
              </Eyebrow>
              <Eyebrow as="div" tone="current">
                {t("lab.scanner.trustPath.note")}
              </Eyebrow>
            </div>
            <div className="mt-3 grid gap-2">
              {trustPath.map((step, index) => (
                <div
                  key={`${step.label}:${step.status}`}
                  className={`rounded-[1rem] border p-3 ${riskPillClass(trustStatusTone(step.status))}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Eyebrow as="div" tone="current">
                        {t("lab.scanner.layer", { index: index + 1 })}
                      </Eyebrow>
                      <div className="mt-1 text-sm font-semibold">
                        {step.label}
                      </div>
                    </div>
                    <span className="rounded-full bg-background/55 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-current/76">
                      {formatDecisionValue(step.status)}
                    </span>
                  </div>
                  {step.message ? (
                    <p className="mt-2 text-xs leading-5 text-current/70">
                      {step.message}
                    </p>
                  ) : null}
                  {step.reason_codes.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {step.reason_codes.map((code) => (
                        <span
                          key={code}
                          className="rounded-full border border-current/10 bg-background/45 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-current/62"
                        >
                          {formatReasonCode(code)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-[1.35rem] border border-current/10 bg-background/42 p-4">
          <Eyebrow as="div" tone="current">
            {t("lab.scanner.userAction")}
          </Eyebrow>
          <div className="mt-2 text-sm font-semibold text-current">
            {finalAction}
          </div>
          <div className="mt-1 text-xs leading-5 text-current/64">
            {holdCopy}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {decision.open_allowed && destinationUrl ? (
              holdRequired ? (
                <HoldToOpenButton
                  decision={decision}
                  holdMs={holdMs}
                  onHoldStart={onHoldStart}
                  onHoldCancel={onHoldCancel}
                  onHoldComplete={onHoldComplete}
                />
              ) : (
                <Button onClick={() => onOpenDestination(decision)}>
                  <ExternalLink data-icon="inline-start" />
                  {t("lab.scanner.openDestination")}
                </Button>
              )
            ) : null}
            <Button variant="outline" onClick={() => onCancelOpen(decision)}>
              {t("lab.scanner.dismiss")}
            </Button>
          </div>
          <details className="mt-3 rounded-[1rem] border border-current/10 bg-background/35 px-3 py-2 text-xs text-current/66">
            <summary className="cursor-pointer select-none font-semibold">
              {t("lab.scanner.technicalDetails")}
            </summary>
            <div className="mt-2 grid gap-1.5">
              <div>
                <span className="font-semibold">
                  {t("lab.scanner.field.decisionState")}
                </span>{" "}
                {formatDecisionValue(decision.decision_state)}
              </div>
              <div>
                <span className="font-semibold">
                  {t("lab.scanner.field.verifierStage")}
                </span>{" "}
                {formatDecisionValue(decision.verifier_stage)}
              </div>
              <div>
                <span className="font-semibold">
                  {t("lab.scanner.field.verifierReason")}
                </span>{" "}
                {decision.verifier_reason}
              </div>
              {decision.request_id ? (
                <div>
                  <span className="font-semibold">
                    {t("lab.scanner.field.requestId")}
                  </span>{" "}
                  {decision.request_id}
                </div>
              ) : null}
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}

export function ScanWorkbenchSection({
  workbench,
  camera,
  decoder,
  scanStatus,
  refs,
  actions,
}: ScanWorkbenchSectionProps) {
  const t = useT()
  const {
    scannedPayload,
    scannerDecision,
    result,
    isDecodingImage,
    isVerifyingScanned,
  } = workbench
  const {
    message: cameraMessage,
    overlay: cameraOverlay,
    secureContextBlocked,
    devices: cameraDevices,
    selectedDeviceId: selectedCameraId,
    supported: cameraSupported,
    isStarting: isStartingCamera,
    isRunning: isCameraRunning,
    isRefreshing: isRefreshingCameras,
    frameFlashTone,
  } = camera
  const { hasNativeDetector, label: decoderLabel } = decoder
  const { videoRef, canvasRef, imageInputRef } = refs
  const {
    startCamera,
    stopCamera,
    refreshCameras,
    openImagePicker,
    handleImageSelection,
    setSelectedCameraId,
    setScannedPayload,
    verifyScannedPayload,
    copyDecodedPayload,
    openScannerDestination,
    cancelScannerDestination,
    startScannerHold,
    completeScannerHold,
  } = actions
  const [isCameraPanelOpen, setIsCameraPanelOpen] = useState(false)

  function toggleCameraPanel() {
    if (isCameraPanelOpen && isCameraRunning) {
      stopCamera()
    }
    setIsCameraPanelOpen(!isCameraPanelOpen)
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border/60 bg-card/72">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border/70 bg-card px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {t("lab.workbench.eyebrow")}
              </span>
            </div>
            <CardTitle className="mt-3 text-2xl font-black tracking-[-0.03em] md:text-3xl">
              {t("lab.workbench.title")}
            </CardTitle>
            <CardDescription className="mt-2 max-w-2xl leading-6">
              {t("lab.workbench.description")}
            </CardDescription>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/72 px-3 py-2 text-sm leading-6 text-muted-foreground">
            <span className="font-medium text-foreground">
              {t("lab.workbench.decoderLabel")}
            </span>{" "}
            {decoderLabel}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-4 md:p-5">
        {secureContextBlocked ? (
          <Alert>
            <CircleAlert />
            <AlertTitle>{t("lab.workbench.secureContext.title")}</AlertTitle>
            <AlertDescription>
              {t("lab.workbench.secureContext.body")}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-primary/8 p-4">
              <Button disabled={isDecodingImage} onClick={openImagePicker}>
                <Upload data-icon="inline-start" />
                {isDecodingImage
                  ? t("lab.workbench.upload.checking")
                  : t("lab.workbench.upload.action")}
              </Button>
              <p className="text-sm leading-6 text-muted-foreground">
                {t("lab.workbench.upload.note")}
              </p>
            </div>

            <FieldGroup className="rounded-[1rem] border border-border/60 bg-card/72 p-4">
              <Field>
                <FieldLabel htmlFor="decoded-payload">
                  {t("lab.workbench.payload.label")}
                </FieldLabel>
                <Textarea
                  id="decoded-payload"
                  value={scannedPayload}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setScannedPayload(event.target.value)}
                  placeholder={t("lab.workbench.payload.placeholder")}
                  className="min-h-[220px] bg-background/85"
                />
                <FieldDescription>
                  {t("lab.workbench.payload.description")}
                </FieldDescription>
              </Field>
            </FieldGroup>

            <div className="flex flex-wrap gap-3 rounded-lg border border-border/60 bg-primary/8 p-3">
              <Button
                onClick={verifyScannedPayload}
                disabled={!scannedPayload.trim() || isVerifyingScanned}
              >
                <ShieldCheck data-icon="inline-start" />
                {isVerifyingScanned
                  ? t("lab.workbench.check.checking")
                  : t("lab.workbench.check.action")}
              </Button>
              <Button variant="outline" onClick={copyDecodedPayload} disabled={!scannedPayload.trim()}>
                <Copy data-icon="inline-start" />
                {t("lab.workbench.copyPayload")}
              </Button>
            </div>

            <div className="grid gap-4 rounded-[1rem] border border-border/60 bg-card/72 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  data-testid="camera-panel-toggle"
                  aria-expanded={isCameraPanelOpen}
                  onClick={toggleCameraPanel}
                >
                  <Camera data-icon="inline-start" />
                  {isCameraPanelOpen
                    ? t("lab.workbench.cameraPanel.hide")
                    : t("lab.workbench.cameraPanel.show")}
                </Button>
                <p className="text-sm leading-6 text-muted-foreground">
                  {t("lab.workbench.cameraPanel.note")}
                </p>
              </div>

              {/* Hidden with CSS, not unmounted: the controller hook owns
                  videoRef and expects the element to stay in the DOM. */}
              <div className={isCameraPanelOpen ? "grid gap-4" : "hidden"}>
                <div
                  className={cn(
                    "relative overflow-hidden rounded-lg border bg-background",
                    frameFlashTone === "success"
                      ? "border-trust-green shadow-(--glow)"
                      : frameFlashTone === "blocked"
                        ? "border-destructive shadow-[0_0_24px_rgba(242,95,92,0.15)]"
                        : "border-border/70",
                  )}
                >
                  <video
                    ref={videoRef}
                    className={`aspect-video w-full object-cover ${isCameraRunning ? "block" : "hidden"}`}
                    muted
                    playsInline
                    autoPlay
                  />
                  <canvas ref={canvasRef} className="hidden" />
                  <div
                    className={`flex aspect-video w-full items-center justify-center px-8 text-center text-sm leading-7 text-foreground ${
                      isCameraRunning ? "absolute inset-0 bg-black/10" : ""
                    }`}
                  >
                    <div className="max-w-md">
                      <div className="mx-auto mb-4 grid size-16 place-items-center rounded-lg border border-border bg-muted/40">
                        <QrCode className="size-7 text-primary" />
                      </div>
                      {cameraOverlay}
                    </div>
                  </div>
                  {/* Scanner corner brackets — decorative only. These are siblings of the
                      <video> and the placeholder, never a new parent: the controller hook
                      owns videoRef and requires that element to stay in the DOM. */}
                  <div aria-hidden className="pointer-events-none absolute inset-3 z-10">
                    <span className="absolute left-0 top-0 size-6 rounded-tl border-l-2 border-t-2 border-primary/70" />
                    <span className="absolute right-0 top-0 size-6 rounded-tr border-r-2 border-t-2 border-primary/70" />
                    <span className="absolute bottom-0 left-0 size-6 rounded-bl border-b-2 border-l-2 border-primary/70" />
                    <span className="absolute bottom-0 right-0 size-6 rounded-br border-b-2 border-r-2 border-primary/70" />
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 rounded-lg border border-border/60 bg-primary/8 p-3">
                  <Button
                    onClick={startCamera}
                    disabled={!cameraSupported || isStartingCamera || isCameraRunning}
                  >
                    <Camera data-icon="inline-start" />
                    {isStartingCamera
                      ? t("lab.workbench.camera.starting")
                      : t("lab.workbench.camera.start")}
                  </Button>
                  <Button variant="outline" onClick={stopCamera} disabled={!isCameraRunning}>
                    <CameraOff data-icon="inline-start" />
                    {t("lab.workbench.camera.stop")}
                  </Button>
                  <Button variant="outline" onClick={refreshCameras} disabled={isRefreshingCameras}>
                    <RefreshCw data-icon="inline-start" />
                    {isRefreshingCameras
                      ? t("lab.workbench.camera.refreshing")
                      : t("lab.workbench.camera.refresh")}
                  </Button>
                </div>

                <div className="grid gap-4 rounded-[1rem] border border-border/60 bg-card/72 p-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="camera-source">
                      {t("lab.workbench.cameraSource.label")}
                    </FieldLabel>
                    {cameraDevices.length ? (
                      <Select value={selectedCameraId} onValueChange={(value: string | null) => setSelectedCameraId(value || "")}>
                        <SelectTrigger id="camera-source" className="w-full">
                          <SelectValue
                            placeholder={t("lab.workbench.cameraSource.default")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {cameraDevices.map((camera) => (
                              <SelectItem key={camera.deviceId} value={camera.deviceId}>
                                {camera.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id="camera-source"
                        disabled
                        value={t(
                          cameraSupported
                            ? "lab.workbench.cameraSource.default"
                            : "lab.workbench.cameraSource.unavailable",
                        )}
                      />
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="decoder-mode">
                      {t("lab.workbench.decoderMode.label")}
                    </FieldLabel>
                    <Input id="decoder-mode" disabled value={decoderLabel} />
                    <FieldDescription>
                      {t(
                        hasNativeDetector
                          ? "lab.workbench.decoderMode.native"
                          : "lab.workbench.decoderMode.fallback",
                      )}
                    </FieldDescription>
                  </Field>
                </div>
              </div>
            </div>

            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const file = event.target.files?.[0]
                if (file) {
                  handleImageSelection(file)
                }
              }}
            />
          </div>

          <div className="grid content-start gap-3">
            {scannerDecision ? (
              <ScannerDecisionPanel
                decision={scannerDecision}
                onOpenDestination={openScannerDestination}
                onCancelOpen={cancelScannerDestination}
                onHoldStart={startScannerHold}
                onHoldCancel={cancelScannerDestination}
                onHoldComplete={completeScannerHold}
              />
            ) : (
              <DecisionPanel result={result} />
            )}
            {isCameraPanelOpen ? (
              <StatusPanel
                label={t("lab.workbench.cameraState")}
                message={cameraMessage}
              />
            ) : null}
            <StatusPanel label={t("lab.workbench.scanStatus")} message={scanStatus} />
            <div className="rounded-[1.4rem] border border-border bg-background/80 p-4">
              <Eyebrow as="div" className="flex items-center gap-2">
                <QrCode className="size-4" />
                {t("lab.workbench.secondScreen.title")}
              </Eyebrow>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {t("lab.workbench.secondScreen.body")}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
