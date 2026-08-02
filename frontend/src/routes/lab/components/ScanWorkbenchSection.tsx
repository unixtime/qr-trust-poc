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
import { cn } from "@/lib/utils"
import DecisionPanel from "@/routes/lab/components/DecisionPanel"
import StatusPanel from "@/routes/lab/components/StatusPanel"
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

function scannerDecisionLabel(decision: ScanDecision) {
  const riskLevel = scannerRiskLevel(decision)
  if (riskLevel === "green") return "Verified QR"
  if (riskLevel === "red") return "Blocked QR"
  return "Use caution"
}

function formatDecisionValue(value: string) {
  return value.replaceAll("_", " ")
}

function formatReasonCode(value: string) {
  return value.replaceAll("_", " ")
}

const reasonCopy: Record<string, { label: string; detail: string }> = {
  caption_domain_mismatch: {
    label: "Caption mismatch",
    detail: "The visible text names a different domain than the QR destination.",
  },
  destination_mismatch: {
    label: "Destination changed",
    detail: "The QR points outside the destination policy approved by the issuer.",
  },
  embedded_credentials: {
    label: "Embedded credentials",
    detail: "The URL includes account-like text before the host, which can hide the real destination.",
  },
  https_absent: {
    label: "No HTTPS",
    detail: "The destination is not using HTTPS, so transport protection is absent.",
  },
  issuer_unknown: {
    label: "Unknown issuer",
    detail: "A signed QR was found, but this verifier does not recognize the issuer.",
  },
  known_bad_domain: {
    label: "Known-bad domain",
    detail: "The destination matched a local or provider-supplied bad-domain hint.",
  },
  net_new_domain: {
    label: "New destination",
    detail: "This domain has not been seen on this device during the current demo.",
  },
  newly_registered_domain: {
    label: "New domain",
    detail: "The destination matched a new-domain hint or a very recent domain age.",
  },
  one_time_used: {
    label: "One-time QR used",
    detail: "This QR appears to be a one-time code that has already been consumed.",
  },
  plain_url: {
    label: "Normal link",
    detail: "The QR contains a plain URL without a recognized QR Trust envelope.",
  },
  redirect_chain: {
    label: "Redirect chain",
    detail: "The QR uses more than one redirect hop before the final destination.",
  },
  redirect_policy_block: {
    label: "Redirect policy block",
    detail: "The final redirect target is outside the issuer-approved policy.",
  },
  runtime_blocked: {
    label: "Runtime block",
    detail: "Present-time safety checks blocked this destination.",
  },
  runtime_risky: {
    label: "Runtime risk",
    detail: "The issuer is recognized, but current safety checks reported risk.",
  },
  signature_invalid: {
    label: "Signature failed",
    detail: "The signed QR envelope could not be verified as authentic.",
  },
  stale_trust_state: {
    label: "Stale trust state",
    detail: "The verifier cache is too old for a confident decision.",
  },
  suspicious_tld: {
    label: "Suspicious domain ending",
    detail: "The domain uses an ending commonly abused in QR phishing demos.",
  },
  trust_cache_unavailable: {
    label: "Trust cache unavailable",
    detail: "The verifier could not use its local issuer trust state.",
  },
  unreadable_payload: {
    label: "Unreadable QR",
    detail: "The payload could not be interpreted as a URL or QR Trust envelope.",
  },
}

function reasonCodeCopy(code: string) {
  return (
    reasonCopy[code] ?? {
      label: formatReasonCode(code),
      detail: "This condition contributed to the scanner-visible result.",
    }
  )
}

function riskStripeLabel(level: "green" | "amber" | "red" | undefined) {
  if (level === "green") return "Low risk"
  if (level === "red") return "High risk"
  return "Medium risk"
}

function scannerPreviewSummary(decision: ScanDecision) {
  const reasons = decision.scanner_ux?.reason_codes ?? []
  const riskLevel = scannerRiskLevel(decision)
  if (riskLevel === "green") {
    return "The issuer and destination checks line up, so this QR can be opened from the scanner preview."
  }
  if (riskLevel === "red") {
    if (reasons.includes("one_time_used")) {
      return "This one-time QR appears to have already been used. Ask for a fresh QR before continuing."
    }
    if (reasons.includes("destination_mismatch")) {
      return "The destination no longer matches the issuer-approved policy. Do not open it from this scan."
    }
    return "The verifier found a blocking condition. Do not open this QR from the scanner preview."
  }
  if (reasons.includes("plain_url")) {
    return "This is a normal link QR without a recognized trust signal. Continue only if you trust where it came from."
  }
  return decision.primary_message
}

function riskStripeClass(level: "green" | "amber" | "red"): string {
  if (level === "green") return "bg-(--trust-green)"
  if (level === "red") return "bg-(--trust-red)"
  return "bg-(--trust-amber)"
}

function riskPillClass(level: "green" | "amber" | "red"): string {
  if (level === "green") {
    return "border-(--trust-green)/25 bg-(--trust-green)/10 text-(--trust-green)"
  }
  if (level === "red") {
    return "border-(--trust-red)/25 bg-(--trust-red)/10 text-(--trust-red)"
  }
  return "border-(--trust-amber)/25 bg-(--trust-amber)/10 text-(--trust-amber)"
}

function signalClasses(state: string): string {
  const value = state.toLowerCase()
  if (
    value.includes("blocked") ||
    value.includes("mismatch") ||
    value.includes("revoked") ||
    value.includes("expired") ||
    value.includes("risky")
  ) {
    return "border-(--trust-red)/25 bg-(--trust-red)/10 text-(--trust-red)"
  }
  if (
    value.includes("unknown") ||
    value.includes("unverified") ||
    value.includes("not") ||
    value.includes("secondary")
  ) {
    return "border-(--trust-amber)/25 bg-(--trust-amber)/10 text-(--trust-amber)"
  }
  if (
    value.includes("verified") ||
    value.includes("pass") ||
    value.includes("ok") ||
    value.includes("allowed") ||
    value.includes("green") ||
    value.includes("fresh") ||
    value.includes("valid")
  ) {
    return "border-(--trust-green)/25 bg-(--trust-green)/10 text-(--trust-green)"
  }
  return "border-(--trust-amber)/25 bg-(--trust-amber)/10 text-(--trust-amber)"
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
      {isHolding ? "Keep holding…" : `Hold ${holdMs} ms to open`}
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
  const tone = scannerDecisionTone(decision)
  const scannerUx = decision.scanner_ux
  const destinationUrl = scannerDestinationUrl(decision)
  const destination =
    scannerUx?.destination_display ||
    decision.contract?.destination.display_host ||
    decision.destination.host ||
    decision.destination.display_url ||
    "No destination"
  const indicatorClass =
    scannerUx?.risk_stripe !== undefined
      ? riskStripeClass(scannerUx.risk_stripe)
      : tone === "success"
        ? "bg-emerald-500"
        : tone === "blocked"
          ? "bg-red-500"
          : "bg-amber-500"
  const cardClass =
    tone === "success"
      ? "border-(--trust-green)/25 bg-(--trust-green)/10 text-(--trust-green)"
      : tone === "blocked"
        ? "border-destructive/20 bg-destructive/10 text-destructive"
        : "border-(--trust-amber)/25 bg-(--trust-amber)/10 text-(--trust-amber)"
  const riskLevel = scannerRiskLevel(decision)
  const reasonCodes = scannerUx?.reason_codes ?? decision.contract?.reason_codes ?? []
  const fingerprint =
    decision.contract?.destination.fingerprint ||
    scannerUx?.destination_fingerprint ||
    destination
  const finalAction =
    scannerUx?.primary_action ??
    decision.actions[0]?.label ??
    (decision.open_allowed ? "Opening is available" : "Opening is not advised")
  const holdToOpen = decision.contract?.hold_to_open
  const holdRequired = scannerUx?.hold_required ?? holdToOpen?.required ?? false
  const holdMs = scannerUx?.hold_ms ?? holdToOpen?.duration_ms ?? 0
  const holdCopy = holdRequired
    ? `Requires ${holdMs} ms hold before opening.`
    : "No hold gate required for this scan."
  const trustPath = scannerTrustPath(decision)

  return (
    <div
      className={`overflow-hidden rounded-[1.8rem] border shadow-[0_18px_48px_rgba(28,35,30,0.08)] ${cardClass}`}
    >
      <div
        className={cn("h-2 w-full", riskStripeClass(scannerUx?.risk_stripe ?? riskLevel))}
        aria-label={`${riskStripeLabel(riskLevel)} scanner risk stripe`}
      />
      <div className="grid gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`inline-flex size-2.5 rounded-full ${indicatorClass}`} />
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-current/68">
              Scanner preview
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Badge
              variant="outline"
              className={cn("capitalize", riskPillClass(riskLevel))}
            >
              {riskStripeLabel(riskLevel)}
              {scannerUx ? ` · ${scannerUx.risk_score}/100` : ""}
            </Badge>
            <Badge variant={tone === "blocked" ? "destructive" : "outline"}>
              {scannerDecisionLabel(decision)}
            </Badge>
          </div>
        </div>

        <div className="grid gap-3 rounded-[1.35rem] border border-current/10 bg-background/50 p-4">
          <div className="text-3xl font-black tracking-[-0.055em]">
            {scannerDecisionLabel(decision)}
          </div>
          <p className="text-sm leading-6 text-current/76">
            {scannerPreviewSummary(decision)}
          </p>
        </div>

        <div className="rounded-[1.35rem] border border-current/10 bg-background/52 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-current/58">
                Domain fingerprint
              </div>
              <div className="mt-2 break-all text-xl font-black tracking-[-0.045em] text-current">
                {fingerprint}
              </div>
            </div>
            <QrCode className="mt-1 size-5 shrink-0 text-current/45" />
          </div>
          <p className="mt-2 text-xs leading-5 text-current/64">
            The scanner shows a short destination identity first. The full URL
            stays available below, but it is not the default decision surface.
          </p>
          {destinationUrl ? (
            <details className="mt-3 rounded-[1rem] border border-current/10 bg-background/35 px-3 py-2 text-xs text-current/68">
              <summary className="cursor-pointer select-none font-semibold">
                Show full destination URL
              </summary>
              <div className="mt-2 break-all leading-5">{destinationUrl}</div>
            </details>
          ) : null}
        </div>

        {reasonCodes.length ? (
          <div className="rounded-[1.35rem] border border-current/10 bg-background/42 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-current/58">
              Why this result
            </div>
            <div className="mt-3 grid gap-2">
              {reasonCodes.map((code) => {
                const copy = reasonCodeCopy(code)
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
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-current/58">
                Trust path
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-current/54">
                first weak layer explains result
              </div>
            </div>
            <div className="mt-3 grid gap-2">
              {trustPath.map((step, index) => (
                <div
                  key={`${step.label}:${step.status}`}
                  className={`rounded-[1rem] border p-3 ${signalClasses(step.status)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-current/58">
                        Layer {index + 1}
                      </div>
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
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-current/58">
            User action
          </div>
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
                  Open destination
                </Button>
              )
            ) : null}
            <Button variant="outline" onClick={() => onCancelOpen(decision)}>
              Dismiss result
            </Button>
          </div>
          <details className="mt-3 rounded-[1rem] border border-current/10 bg-background/35 px-3 py-2 text-xs text-current/66">
            <summary className="cursor-pointer select-none font-semibold">
              Technical verifier details
            </summary>
            <div className="mt-2 grid gap-1.5">
              <div>
                <span className="font-semibold">Decision state:</span>{" "}
                {formatDecisionValue(decision.decision_state)}
              </div>
              <div>
                <span className="font-semibold">Verifier stage:</span>{" "}
                {formatDecisionValue(decision.verifier_stage)}
              </div>
              <div>
                <span className="font-semibold">Verifier reason:</span>{" "}
                {decision.verifier_reason}
              </div>
              {decision.request_id ? (
                <div>
                  <span className="font-semibold">Request ID:</span>{" "}
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
                Capture and verify
              </span>
            </div>
            <CardTitle className="mt-3 text-2xl font-black tracking-[-0.03em] md:text-3xl">
              Scan console
            </CardTitle>
            <CardDescription className="mt-2 max-w-2xl leading-6">
              Upload an image or paste a payload — the result panel is the
              source of truth for the scan. A live camera scan is available as
              a secondary path for second-screen demos.
            </CardDescription>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/72 px-3 py-2 text-sm leading-6 text-muted-foreground">
            <span className="font-medium text-foreground">Decoder:</span>{" "}
            {decoderLabel}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-4 md:p-5">
        {secureContextBlocked ? (
          <Alert>
            <CircleAlert />
            <AlertTitle>HTTPS is required for Safari camera capture</AlertTitle>
            <AlertDescription>
              This browser is not giving the workbench a secure context for `getUserMedia`. Use the upload path, direct verify, or run the frontend with local HTTPS and a trusted mkcert certificate.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-3 rounded-[1rem] border border-border/60 bg-emerald-600/8 p-4">
              <Button disabled={isDecodingImage} onClick={openImagePicker}>
                <Upload data-icon="inline-start" />
                {isDecodingImage ? "Checking…" : "Upload and check QR"}
              </Button>
              <p className="text-sm leading-6 text-muted-foreground">
                Uploaded screenshots and photos are decoded and checked
                automatically.
              </p>
            </div>

            <FieldGroup className="rounded-[1rem] border border-border/60 bg-card/72 p-4">
              <Field>
                <FieldLabel htmlFor="decoded-payload">Decoded QR payload</FieldLabel>
                <Textarea
                  id="decoded-payload"
                  value={scannedPayload}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setScannedPayload(event.target.value)}
                  placeholder="The decoded QR payload will appear here after upload or live capture."
                  className="min-h-[220px] bg-background/85"
                />
                <FieldDescription>
                  Camera captures and uploaded images are checked automatically.
                  Paste a payload here only when testing manually, then use
                  Check scanned QR.
                </FieldDescription>
              </Field>
            </FieldGroup>

            <div className="flex flex-wrap gap-3 rounded-[1rem] border border-border/60 bg-emerald-600/8 p-3">
              <Button
                onClick={verifyScannedPayload}
                disabled={!scannedPayload.trim() || isVerifyingScanned}
              >
                <ShieldCheck data-icon="inline-start" />
                {isVerifyingScanned ? "Checking…" : "Check scanned QR"}
              </Button>
              <Button variant="outline" onClick={copyDecodedPayload} disabled={!scannedPayload.trim()}>
                <Copy data-icon="inline-start" />
                Copy decoded payload
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
                    ? "Hide live camera scan"
                    : "Try a live camera scan"}
                </Button>
                <p className="text-sm leading-6 text-muted-foreground">
                  Secondary path for second-screen demos: show the QR on one
                  device and scan it here from another.
                </p>
              </div>

              {/* Hidden with CSS, not unmounted: the controller hook owns
                  videoRef and expects the element to stay in the DOM. */}
              <div className={isCameraPanelOpen ? "grid gap-4" : "hidden"}>
                <div
                  className={cn(
                    "relative overflow-hidden rounded-lg border bg-zinc-950",
                    frameFlashTone === "success"
                      ? "border-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.22)]"
                      : frameFlashTone === "blocked"
                        ? "border-destructive shadow-[0_0_0_3px_rgba(239,68,68,0.18)]"
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
                    className={`flex aspect-video w-full items-center justify-center px-8 text-center text-sm leading-7 text-stone-200 ${
                      isCameraRunning ? "absolute inset-0 bg-black/10" : ""
                    }`}
                  >
                    <div className="max-w-md">
                      <div className="mx-auto mb-4 grid size-16 place-items-center rounded-3xl border border-stone-100/10 bg-stone-50/[0.06]">
                        <QrCode className="size-7 text-emerald-200" />
                      </div>
                      {cameraOverlay}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 rounded-[1rem] border border-border/60 bg-emerald-600/8 p-3">
                  <Button
                    onClick={startCamera}
                    disabled={!cameraSupported || isStartingCamera || isCameraRunning}
                  >
                    <Camera data-icon="inline-start" />
                    {isStartingCamera ? "Starting…" : "Start camera scan"}
                  </Button>
                  <Button variant="outline" onClick={stopCamera} disabled={!isCameraRunning}>
                    <CameraOff data-icon="inline-start" />
                    Stop camera
                  </Button>
                  <Button variant="outline" onClick={refreshCameras} disabled={isRefreshingCameras}>
                    <RefreshCw data-icon="inline-start" />
                    {isRefreshingCameras ? "Refreshing…" : "Refresh cameras"}
                  </Button>
                </div>

                <div className="grid gap-4 rounded-[1rem] border border-border/60 bg-card/72 p-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="camera-source">Camera source</FieldLabel>
                    {cameraDevices.length ? (
                      <Select value={selectedCameraId} onValueChange={(value: string | null) => setSelectedCameraId(value || "")}>
                        <SelectTrigger id="camera-source" className="w-full">
                          <SelectValue placeholder="Environment-facing camera" />
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
                        value={cameraSupported ? "Environment-facing camera" : "Camera capture unavailable"}
                      />
                    )}
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="decoder-mode">Decoder mode</FieldLabel>
                    <Input id="decoder-mode" disabled value={decoderLabel} />
                    <FieldDescription>
                      {hasNativeDetector
                        ? "Native browser decode is active. The backend fallback is available if capture moves to upload."
                        : "The browser has no native QR detector, so the backend fallback will decode uploads and camera frames."}
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
              <StatusPanel label="Camera capture state" message={cameraMessage} />
            ) : null}
            <StatusPanel label="Scan status" message={scanStatus} />
            <div className="rounded-[1.4rem] border border-border bg-background/80 p-4">
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                <QrCode className="size-4" />
                Second-screen rule
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Use the fullscreen QR on one device and the camera on another. Native phone camera apps still
                open the embedded URL directly and bypass verifier behavior.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
