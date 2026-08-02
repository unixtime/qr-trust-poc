import { useEffect, useEffectEvent, useRef, useState } from "react"

import {
  clearStoredVerifierApiKey,
  type DemoMaterialsResponse,
  fileToBase64,
  type ManagementApiKeyIssueResponse,
  qrImageDataUrl,
  readStoredVerifierApiKey,
  requestJson,
  type ScannerDecisionRequest,
  type ScannerDecisionResponse,
  type ScannerUXEventRequest,
  type ScannerUXEventType,
  type ScannedVerifierRequest,
  storeVerifierApiKey,
  VerifierApiError,
  type VerifierDecision,
  type VerifierStatus,
} from "@/lib/verifier-client"
import {
  buildScenarioRequest,
  fixedNonces,
  parseInitialCompareScenarioParam,
  parseInitialNonceMode,
  parseInitialScenarioParam,
  parseInitialUsagePolicy,
  scenarioMeta,
  shouldAutogenerateFromRoute,
} from "@/routes/lab/content"
import { buildOperatorLink } from "@/domain/links"
import type {
  CameraDevice,
  HistoryEntry,
  MessageState,
  NonceMode,
  ScenarioKey,
  Tone,
  UsagePolicy,
} from "@/routes/lab/types"
import {
  dataUrlToBase64,
  summariseError,
  summariseSignedVerifierError,
  toHistoryEntry,
  toneForDecision,
} from "@/routes/lab/utils"

type DetectorCode = { rawValue?: string }
type BarcodeDetectorLike = {
  detect(source: ImageBitmapSource): Promise<DetectorCode[]>
}
type WindowWithBarcodeDetector = Window &
  typeof globalThis & {
    BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike
  }
type WindowWithAudioContext = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext
  }

const staleStoredKeyMessage =
  "The verifier rejected the API key saved in this browser, which happens when the key store is rebuilt. The stale key was cleared. Issue a new lab key, then try again."

const cameraDeviceStorageKey = "verifier-react-camera-device"
const scannerKnownHostsStorageKey = "qr-trust-scanner-known-hosts"
const nativeScanIntervalMs = 180
const fallbackScanIntervalMs = 1500
// Key-less tabs share one IP-based rate bucket (60 requests/minute) behind the
// compose proxy, so the status poll must stay well under that budget even with
// a few tabs open.
const scannerDecisionStatusPollMs = 5000
const idleCameraOverlay =
  "Camera idle. Point the lens at a generated, printed, or external QR code."

function normaliseScannerHost(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null

  try {
    return new URL(trimmed).hostname.toLowerCase().replace(/\.$/, "") || null
  } catch {
    return trimmed.toLowerCase().replace(/\.$/, "") || null
  }
}

function readScannerKnownHosts() {
  if (typeof window === "undefined") return []

  try {
    const rawValue = window.localStorage.getItem(scannerKnownHostsStorageKey)
    const parsed: unknown = rawValue ? JSON.parse(rawValue) : []
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => normaliseScannerHost(item))
      .filter((item): item is string => Boolean(item))
      .slice(0, 100)
  } catch {
    return []
  }
}

function rememberScannerKnownHost(value: string) {
  if (typeof window === "undefined") return

  const host = normaliseScannerHost(value)
  if (!host) return

  const current = readScannerKnownHosts()
  const next = [host, ...current.filter((item) => item !== host)].slice(0, 100)
  try {
    window.localStorage.setItem(scannerKnownHostsStorageKey, JSON.stringify(next))
  } catch {
    // Private browsing and storage quotas should not break scanner decisions.
  }
}

function createNativeDetector() {
  if (typeof window === "undefined") return null
  const detectorCtor = (window as WindowWithBarcodeDetector).BarcodeDetector
  return detectorCtor ? new detectorCtor({ formats: ["qr_code"] }) : null
}

function cameraUnavailableReason() {
  if (typeof window === "undefined") {
    return "Camera capture is not available during server rendering."
  }
  if (typeof navigator.mediaDevices?.getUserMedia === "function") {
    return ""
  }
  if (!window.isSecureContext) {
    return "Camera capture is unavailable because this page is not running in a secure context. Use HTTPS or localhost, or fall back to image upload."
  }
  if (!navigator.mediaDevices) {
    return "Camera capture is unavailable because navigator.mediaDevices is not exposed in this browser."
  }
  return "Camera capture is unavailable because getUserMedia is not exposed in this browser."
}

function buildCameraMessage(reason: string): MessageState {
  return {
    title: reason ? "Camera unsupported" : "Camera idle",
    body: reason || "No QR captured yet.",
    tone: reason ? "blocked" : "neutral",
  }
}

function getInitialCameraDeviceId() {
  if (typeof window === "undefined") return ""
  return window.localStorage.getItem(cameraDeviceStorageKey) || ""
}

async function playTone({
  frequency,
  durationMs,
}: {
  frequency: number
  durationMs: number
}) {
  const audioWindow = window as WindowWithAudioContext
  const AudioContextCtor =
    audioWindow.AudioContext ?? audioWindow.webkitAudioContext
  if (!AudioContextCtor) return

  const audioContext = new AudioContextCtor()
  try {
    if (audioContext.state === "suspended") {
      await audioContext.resume()
    }

    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()
    oscillator.type = "sine"
    oscillator.frequency.value = frequency
    gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02)
    gainNode.gain.exponentialRampToValueAtTime(
      0.0001,
      audioContext.currentTime + durationMs / 1000,
    )
    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start()
    oscillator.stop(audioContext.currentTime + durationMs / 1000)
    await new Promise((resolve) => window.setTimeout(resolve, durationMs + 40))
  } catch {
    // Visual feedback remains primary.
  } finally {
    await audioContext.close().catch(() => {})
  }
}

function vibrateIfSupported(pattern: number | number[]) {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(pattern)
    }
  } catch {
    // Ignore unsupported vibration attempts.
  }
}

async function emitCaptureFeedback() {
  vibrateIfSupported([60])
  await playTone({ frequency: 880, durationMs: 100 })
}

async function emitVerificationFeedback(allowed: boolean) {
  vibrateIfSupported(allowed ? [40] : [35, 35, 35])
  await playTone({
    frequency: allowed ? 1046 : 392,
    durationMs: allowed ? 95 : 130,
  })
}

export function useLabController() {
  const initialCameraReason = cameraUnavailableReason()
  const [hasNativeDetector] = useState(() => {
    if (typeof window === "undefined") return false
    return Boolean((window as WindowWithBarcodeDetector).BarcodeDetector)
  })

  const [runtimeStatus, setRuntimeStatus] = useState<VerifierStatus | null>(null)
  const [scenario, setScenario] = useState<ScenarioKey>(() => parseInitialScenarioParam())
  const [compareScenario] = useState<ScenarioKey | null>(() =>
    parseInitialCompareScenarioParam(),
  )
  const [nonceMode, setNonceMode] = useState<NonceMode>(() => parseInitialNonceMode())
  const [usagePolicy, setUsagePolicy] = useState<UsagePolicy>(() =>
    parseInitialUsagePolicy(),
  )
  const [apiKey, setApiKey] = useState(() => readStoredVerifierApiKey())
  const [demo, setDemo] = useState<DemoMaterialsResponse | null>(null)
  const [generatedScenario, setGeneratedScenario] = useState<ScenarioKey | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [generatedNonceMode, setGeneratedNonceMode] = useState<NonceMode | null>(null)
  const [scannerDecision, setScannerDecision] = useState<ScannerDecisionResponse | null>(
    null,
  )
  const [scannerDecisionError, setScannerDecisionError] = useState<string | null>(null)
  const [scannedPayload, setScannedPayload] = useState("")
  const [result, setResult] = useState<VerifierDecision | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([
    toHistoryEntry(
      "Waiting",
      "Issue a key, generate a QR, and the verifier decisions will appear here.",
      "neutral",
    ),
  ])
  const [scanMessage, setScanMessage] = useState<MessageState | null>(null)
  const [cameraMessage, setCameraMessage] = useState<MessageState | null>(() =>
    buildCameraMessage(initialCameraReason),
  )
  const [cameraOverlay, setCameraOverlay] = useState(
    initialCameraReason || idleCameraOverlay,
  )
  const [cameraDevices, setCameraDevices] = useState<CameraDevice[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState(() => getInitialCameraDeviceId())
  const [cameraSupported, setCameraSupported] = useState(!initialCameraReason)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isIssuingLabKey, setIsIssuingLabKey] = useState(false)
  const [isCheckingScannerDecision, setIsCheckingScannerDecision] = useState(false)
  const [isVerifyingCurrent, setIsVerifyingCurrent] = useState(false)
  const [isVerifyingScanned, setIsVerifyingScanned] = useState(false)
  const [isDecodingImage, setIsDecodingImage] = useState(false)
  const [isRefreshingCameras, setIsRefreshingCameras] = useState(false)
  const [isStartingCamera, setIsStartingCamera] = useState(false)
  const [isCameraRunning, setIsCameraRunning] = useState(false)
  const [frameFlashTone, setFrameFlashTone] = useState<Tone | null>(null)
  const [showOptionGuide, setShowOptionGuide] = useState(false)
  const [qrDisplayOpen, setQrDisplayOpen] = useState(false)
  const [qrDisplayShowMetadata, setQrDisplayShowMetadata] = useState(true)
  const [qrDisplayHighContrast, setQrDisplayHighContrast] = useState(false)
  const [qrDisplayError, setQrDisplayError] = useState<string | null>(null)

  const detectorRef = useRef<BarcodeDetectorLike | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanLoopIdRef = useRef<number | null>(null)
  const scanPendingRef = useRef(false)
  const frameFlashTimerRef = useRef<number | null>(null)
  const qrDisplayFrameRef = useRef<HTMLDivElement | null>(null)
  const routeAutogenerateRef = useRef(shouldAutogenerateFromRoute())

  const currentScenario = scenarioMeta[scenario]
  const generatedScenarioMeta = generatedScenario ? scenarioMeta[generatedScenario] : null
  const comparisonScenario = compareScenario ? scenarioMeta[compareScenario] : null
  const apiKeyHeader = runtimeStatus?.api_key_header ?? "X-API-Key"
  const adminHeader = runtimeStatus?.admin_header ?? "X-Admin-Token"
  const apiAuthEnabled = Boolean(runtimeStatus?.api_key_auth_enabled)
  const adminFlowEnabled = Boolean(runtimeStatus?.admin_api_key_management_enabled)
  const decoderLabel = hasNativeDetector
    ? "native browser decoder"
    : "bundled verifier fallback"
  const secureContextBlocked =
    cameraMessage?.tone === "blocked" &&
    cameraMessage.body.toLowerCase().includes("secure context")
  const artifactUsagePolicy = demo?.verify_request.envelope.claims.usage_policy ?? null
  const generatorSettingsChanged = Boolean(
    demo &&
      (generatedScenario !== scenario ||
        generatedNonceMode !== nonceMode ||
        artifactUsagePolicy !== usagePolicy),
  )
  const fixedReplayVisible =
    result?.stage === "replay_guard" &&
    generatedNonceMode === "fixed" &&
    artifactUsagePolicy === "one_time" &&
    generatedScenario !== null &&
    demo?.verify_request.envelope.claims.nonce === fixedNonces[generatedScenario]
  const demoRef = useRef<DemoMaterialsResponse | null>(null)
  const apiKeyRef = useRef("")
  const apiKeyHeaderRef = useRef(apiKeyHeader)
  const runtimeStatusRef = useRef<VerifierStatus | null>(null)
  const runtimeStatusInFlightRef = useRef(false)
  const runtimeStatusRequestSeqRef = useRef(0)
  const decoderLabelRef = useRef(decoderLabel)
  const selectedCameraIdRef = useRef(selectedCameraId)

  useEffect(() => {
    demoRef.current = demo
  }, [demo])

  useEffect(() => {
    apiKeyRef.current = apiKey
    if (apiKey.trim()) {
      storeVerifierApiKey(apiKey)
      return
    }
    clearStoredVerifierApiKey()
  }, [apiKey])

  useEffect(() => {
    apiKeyHeaderRef.current = apiKeyHeader
  }, [apiKeyHeader])

  useEffect(() => {
    runtimeStatusRef.current = runtimeStatus
  }, [runtimeStatus])

  useEffect(() => {
    decoderLabelRef.current = decoderLabel
  }, [decoderLabel])

  // A 403 for a request that carried a stored key means the key store no
  // longer knows the key (e.g. the backend database was rebuilt), so the
  // stored key can never work again and must be cleared.
  function isStaleStoredKeyError(error: unknown) {
    return (
      error instanceof VerifierApiError &&
      error.status === 403 &&
      error.message.includes("verifier API key") &&
      Boolean(apiKeyRef.current.trim())
    )
  }

  function pushHistory(title: string, body: string, tone: Tone) {
    setHistory((current) => [toHistoryEntry(title, body, tone), ...current].slice(0, 10))
  }

  function stageScannedPayload(qrPayload: string) {
    setScannedPayload(qrPayload)
    setScannerDecision(null)
    setScannerDecisionError(null)
    setResult(null)
  }

  function updateScannedPayload(qrPayload: string) {
    stageScannedPayload(qrPayload)
    setScanMessage({
      title: qrPayload.trim() ? "Payload changed" : "Payload cleared",
      body: qrPayload.trim()
        ? "The previous result was cleared. Check the scanned QR to refresh the scanner-visible decision."
        : "Capture, upload, or paste a QR payload before checking it.",
      tone: "neutral",
    })
  }

  function flashFrame(tone: Tone) {
    setFrameFlashTone(tone)
    if (frameFlashTimerRef.current) {
      window.clearTimeout(frameFlashTimerRef.current)
    }
    frameFlashTimerRef.current = window.setTimeout(() => {
      setFrameFlashTone(null)
      frameFlashTimerRef.current = null
    }, 900)
  }

  function clearActiveStream() {
    if (scanLoopIdRef.current) {
      window.clearTimeout(scanLoopIdRef.current)
      scanLoopIdRef.current = null
    }
    scanPendingRef.current = false
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  function stopCamera({
    preserveMessage = false,
  }: {
    preserveMessage?: boolean
  } = {}) {
    clearActiveStream()
    setIsCameraRunning(false)
    const reason = cameraUnavailableReason()
    setCameraSupported(!reason)
    setCameraOverlay(reason || idleCameraOverlay)
    if (!preserveMessage) {
      setCameraMessage(buildCameraMessage(reason))
    }
  }

  async function refreshCameraOptions() {
    const canEnumerate =
      typeof navigator.mediaDevices?.enumerateDevices === "function"
    if (!canEnumerate) {
      setCameraDevices([])
      return
    }

    setIsRefreshingCameras(true)
    try {
      const remembered =
        window.localStorage.getItem(cameraDeviceStorageKey) ||
        selectedCameraIdRef.current
      const devices = await navigator.mediaDevices.enumerateDevices()
      const cameras: CameraDevice[] = []
      let cameraIndex = 0
      for (const device of devices) {
        if (device.kind !== "videoinput") continue
        cameraIndex += 1
        cameras.push({
          deviceId: device.deviceId,
          label: device.label || `Camera ${cameraIndex}`,
        })
      }
      setCameraDevices(cameras)

      if (remembered && cameras.some((camera) => camera.deviceId === remembered)) {
        setSelectedCameraId(remembered)
      } else if (!selectedCameraIdRef.current && cameras[0]) {
        setSelectedCameraId(cameras[0].deviceId)
      }
    } finally {
      setIsRefreshingCameras(false)
    }
  }

  async function loadRuntimeStatus({ reportErrors = true } = {}) {
    if (runtimeStatusInFlightRef.current) return
    runtimeStatusInFlightRef.current = true
    const requestSeq = runtimeStatusRequestSeqRef.current + 1
    runtimeStatusRequestSeqRef.current = requestSeq
    try {
      const status = await requestJson<VerifierStatus>("/verifier/status", {
        apiKey: apiKeyRef.current.trim() || undefined,
        apiKeyHeader: apiKeyHeaderRef.current,
      })
      if (requestSeq !== runtimeStatusRequestSeqRef.current) return
      setRuntimeStatus(status)
    } catch (error) {
      if (requestSeq !== runtimeStatusRequestSeqRef.current) return
      if (!reportErrors) return

      setScanMessage({
        title: "Runtime status failed",
        body: summariseError(error),
        tone: "blocked",
      })
    } finally {
      if (requestSeq === runtimeStatusRequestSeqRef.current) {
        runtimeStatusInFlightRef.current = false
      }
    }
  }

  useEffect(() => {
    detectorRef.current = createNativeDetector()

    void loadRuntimeStatus()
    const runtimeStatusTimer = window.setInterval(() => {
      if (document.hidden) return
      void loadRuntimeStatus({ reportErrors: false })
    }, scannerDecisionStatusPollMs)
    const cameraOptionsTimer = window.setTimeout(() => {
      void refreshCameraOptions()
    }, 0)

    return () => {
      window.clearInterval(runtimeStatusTimer)
      window.clearTimeout(cameraOptionsTimer)
      if (frameFlashTimerRef.current) {
        window.clearTimeout(frameFlashTimerRef.current)
        frameFlashTimerRef.current = null
      }
      clearActiveStream()
    }
  }, [])

  useEffect(() => {
    selectedCameraIdRef.current = selectedCameraId
    if (selectedCameraId) {
      window.localStorage.setItem(cameraDeviceStorageKey, selectedCameraId)
    } else {
      window.localStorage.removeItem(cameraDeviceStorageKey)
    }
  }, [selectedCameraId])

  function navigateTo(path: string) {
    if (typeof window === "undefined") return
    if (window.location.pathname === path) return
    window.history.pushState({}, "", path)
    window.scrollTo({ top: 0, behavior: "smooth" })
    window.dispatchEvent(new PopStateEvent("popstate"))
  }

  async function generateDemoFor(
    nextScenario: ScenarioKey,
    nextNonceMode: NonceMode,
    nextUsagePolicy: UsagePolicy,
  ) {
    stopCamera()
    setIsGenerating(true)
    const nextScenarioMeta = scenarioMeta[nextScenario]
    const request = buildScenarioRequest(nextScenario, nextNonceMode, nextUsagePolicy)
    setGenerationError(null)
    try {
      const response = await requestJson<DemoMaterialsResponse>(
        "/verifier/demo-materials",
        {
          method: "POST",
          apiKey: apiKey.trim() || undefined,
          apiKeyHeader,
          body: request,
        },
      )
      setScenario(nextScenario)
      setNonceMode(nextNonceMode)
      setUsagePolicy(nextUsagePolicy)
      setDemo(response)
      setGeneratedScenario(nextScenario)
      setGenerationError(null)
      setGeneratedNonceMode(nextNonceMode)
      setScannerDecision(null)
      setScannerDecisionError(null)
      setScannedPayload(response.qr_payload)
      setResult(null)
      setScanMessage({
        title: "Demo QR ready",
        body: `Generated ${nextScenarioMeta.label.toLowerCase()} as ${nextUsagePolicy.replaceAll("_", " ")} with nonce ${response.verify_request.envelope.claims.nonce}.`,
        tone: "success",
      })
      setCameraMessage({
        title: "Camera ready",
        body: `Point the camera at the generated QR on another screen. Active decoder: ${decoderLabel}.`,
        tone: "neutral",
      })
      setCameraOverlay(
        `Point the lens at the generated QR. Active decoder: ${decoderLabel}.`,
      )
      pushHistory(
        "QR generated",
        `${nextScenarioMeta.label}. Usage ${nextUsagePolicy}. Nonce ${response.verify_request.envelope.claims.nonce}.`,
        "neutral",
      )
    } catch (error) {
      const staleKey = isStaleStoredKeyError(error)
      if (staleKey) {
        clearLabKey()
      }
      const message = staleKey ? staleStoredKeyMessage : summariseError(error)
      setDemo(null)
      setGeneratedScenario(null)
      setGeneratedNonceMode(null)
      setScannerDecision(null)
      setScannerDecisionError(null)
      setScannedPayload("")
      setGenerationError(message)
      setScanMessage({
        title: staleKey ? "Stored verifier key rejected" : "Demo generation failed",
        body: message,
        tone: "blocked",
      })
    } finally {
      setIsGenerating(false)
    }
  }

  async function generateDemo() {
    await generateDemoFor(scenario, nonceMode, usagePolicy)
  }

  async function generateFreshValidDemo() {
    await generateDemoFor("valid", "timestamped", usagePolicy)
  }

  async function generateComparisonDemo() {
    if (!compareScenario) return
    await generateDemoFor(compareScenario, nonceMode, usagePolicy)
  }

  function scannerDestinationUrl(decision: ScannerDecisionResponse) {
    return (
      decision.destination.final_url ||
      decision.destination.resolver_url ||
      decision.destination.display_url ||
      ""
    )
  }

  function scannerContractRisk(decision: ScannerDecisionResponse) {
    const color = decision.contract?.decision_color
    if (color === "orange") return "amber"
    return color
  }

  function scannerFallbackRisk(decision: ScannerDecisionResponse) {
    if (decision.decision_state === "verified_issuer") return "green"
    if (decision.decision_state === "blocked") return "red"
    return "amber"
  }

  function scannerRiskLevel(decision: ScannerDecisionResponse) {
    return (
      decision.scanner_ux?.risk_level ??
      scannerContractRisk(decision) ??
      scannerFallbackRisk(decision)
    )
  }

  function scannerTone(decision: ScannerDecisionResponse): Tone {
    const riskLevel = scannerRiskLevel(decision)
    if (riskLevel === "green") return "success"
    if (riskLevel === "red") return "blocked"
    return "neutral"
  }

  function buildScannerUxEvent(
    eventType: ScannerUXEventType,
    decision: ScannerDecisionResponse,
    elapsedMs: number | null = null,
  ): ScannerUXEventRequest {
    const scannerUx = decision.scanner_ux
    const riskLevel = scannerRiskLevel(decision)
    return {
      event_type: eventType,
      request_id: decision.request_id,
      decision_id: decision.contract?.decision_id ?? null,
      decision_state: decision.decision_state,
      risk_score:
        scannerUx?.risk_score ??
        decision.contract?.risk_score ??
        (riskLevel === "green" ? 0 : riskLevel === "red" ? 75 : 35),
      risk_level: riskLevel,
      reason_codes: scannerUx?.reason_codes ?? decision.contract?.reason_codes ?? [],
      hold_required:
        scannerUx?.hold_required ?? decision.contract?.hold_to_open.required ?? false,
      hold_ms: scannerUx?.hold_ms ?? decision.contract?.hold_to_open.duration_ms ?? 0,
      destination_display:
        scannerUx?.destination_display ??
        decision.contract?.destination.display_host ??
        decision.destination.host ??
        null,
      destination_url: scannerDestinationUrl(decision) || null,
      elapsed_ms: elapsedMs,
      client: {
        platform: "browser_lab",
        app_version: "react-poc",
      },
    }
  }

  async function recordScannerUxEvent(
    eventType: ScannerUXEventType,
    decision: ScannerDecisionResponse,
    elapsedMs: number | null = null,
  ) {
    try {
      await requestJson("/scanner/ux-events", {
        method: "POST",
        body: buildScannerUxEvent(eventType, decision, elapsedMs),
      })
    } catch (error) {
      pushHistory("Scanner UX event was not recorded", summariseError(error), "neutral")
    }
  }

  function openScannerDestination(
    decision: ScannerDecisionResponse,
    elapsedMs: number | null = null,
  ) {
    const destinationUrl = scannerDestinationUrl(decision)
    if (!destinationUrl) {
      void recordScannerUxEvent("cancel", decision, elapsedMs)
      setScanMessage({
        title: "No destination to open",
        body: "The scanner decision did not expose a destination URL.",
        tone: "blocked",
      })
      return
    }

    const popup = window.open(destinationUrl, "_blank", "noopener,noreferrer")
    if (!popup) {
      void recordScannerUxEvent("cancel", decision, elapsedMs)
      setScanMessage({
        title: "Open was blocked by the browser",
        body: "The open did not complete. Allow popups or copy the destination if you need to continue.",
        tone: "blocked",
      })
      return
    }
    void recordScannerUxEvent("open", decision, elapsedMs)
    rememberScannerKnownHost(destinationUrl)
    pushHistory(
      "Scanner open selected",
      `${decision.scanner_ux?.primary_action ?? "Open destination"}: ${destinationUrl}`,
      scannerTone(decision),
    )
  }

  function cancelScannerDestination(
    decision: ScannerDecisionResponse,
    elapsedMs: number | null = null,
  ) {
    void recordScannerUxEvent("cancel", decision, elapsedMs)
    setScanMessage({
      title: "Scanner open cancelled",
      body: "The result stayed in the lab and no destination was opened.",
      tone: "neutral",
    })
    pushHistory(
      "Scanner open cancelled",
      `${decision.decision_state}: ${decision.primary_message}`,
      "neutral",
    )
  }

  function startScannerHold(decision: ScannerDecisionResponse) {
    void recordScannerUxEvent("hold_start", decision)
  }

  function completeScannerHold(
    decision: ScannerDecisionResponse,
    elapsedMs: number,
  ) {
    void recordScannerUxEvent("hold_complete", decision, elapsedMs)
    openScannerDestination(decision, elapsedMs)
  }

  async function checkScannerDecision() {
    if (!demo) {
      setScanMessage({
        title: "No demo QR",
        body: "Generate a demo QR before asking the scanner decision endpoint to evaluate it.",
        tone: "blocked",
      })
      return
    }

    setIsCheckingScannerDecision(true)
    setScannerDecisionError(null)
    try {
      // Artifact scenarios tamper with the rendered image, not the payload,
      // so the scanner must see the image to notice anything is wrong.
      await runScannerDecision({
        label: "Generated QR",
        qrPayload: demo.qr_payload,
        imageBase64: generatedScenarioMeta?.artifactProfile
          ? demo.qr_png_base64
          : null,
      })
    } catch (error) {
      const message = summariseError(error)
      setScannerDecisionError(message)
      setScanMessage({
        title: "Scanner decision failed",
        body: message,
        tone: "blocked",
      })
    } finally {
      setIsCheckingScannerDecision(false)
    }
  }

  async function runScannerDecision({
    label,
    qrPayload,
    imageBase64 = null,
    cameraDriven = false,
  }: {
    label: string
    qrPayload: string
    imageBase64?: string | null
    cameraDriven?: boolean
  }) {
    const response = await requestJson<ScannerDecisionResponse>("/scanner/decisions", {
      method: "POST",
      body: {
        qr_payload: qrPayload,
        image_base64: imageBase64,
        prior_opened_hosts: readScannerKnownHosts(),
        client: {
          platform: "browser_lab",
          app_version: "react-poc",
          verifier_profile_state:
            runtimeStatusRef.current?.verifier_profile_state ?? "active",
        },
      } satisfies ScannerDecisionRequest,
    })
    const tone = scannerTone(response)
    const body = `${response.decision_state}: ${response.primary_message}`

    setScannerDecision(response)
    setScannerDecisionError(null)
    setResult(null)
    setScanMessage({
      title: "Scanner decision ready",
      body,
      tone,
    })
    if (cameraDriven) {
      setCameraMessage({
        title: "Camera scan checked",
        body,
        tone,
      })
    }
    pushHistory(`${label} scanner decision`, body, tone)
    if (tone === "success") {
      await emitVerificationFeedback(true)
    } else if (tone === "blocked") {
      await emitVerificationFeedback(false)
    }
    void recordScannerUxEvent("preview", response)
    void loadRuntimeStatus({ reportErrors: false })
    return response
  }

  const generateRouteDemo = useEffectEvent(
    (
      nextScenario: ScenarioKey,
      nextNonceMode: NonceMode,
      nextUsagePolicy: UsagePolicy,
    ) => {
      void generateDemoFor(nextScenario, nextNonceMode, nextUsagePolicy)
    },
  )

  async function runScannedVerifier({
    label,
    qrPayload,
    cameraDriven = false,
  }: {
    label: string
    qrPayload: string
    cameraDriven?: boolean
  }) {
    const activeDemo = demoRef.current
    if (!activeDemo) {
      setScanMessage({
        title: "No demo QR",
        body: "Generate a demo QR before asking the verifier to evaluate a payload.",
        tone: "blocked",
      })
      return
    }

    const response = await requestJson<VerifierDecision>("/verifier/verify-scanned", {
      method: "POST",
      apiKey: apiKeyRef.current.trim() || undefined,
      apiKeyHeader: apiKeyHeaderRef.current,
      body: {
        qr_payload: qrPayload,
        certificate: activeDemo.certificate,
        issuer_state: activeDemo.issuer_state,
        reservation_ttl_seconds: activeDemo.verify_request.reservation_ttl_seconds,
        consumed_ttl_seconds: activeDemo.verify_request.consumed_ttl_seconds,
      } satisfies ScannedVerifierRequest,
    })

    setScannerDecision(null)
    setScannerDecisionError(null)
    setResult(response)
    const tone = toneForDecision(response)
    const body = `${response.stage}: ${response.reason}`
    setScanMessage({
      title: response.allowed ? "Verifier accepted payload" : "Verifier blocked payload",
      body,
      tone,
    })
    if (cameraDriven) {
      setCameraMessage({
        title: response.allowed ? "Camera scan accepted" : "Camera scan blocked",
        body,
        tone,
      })
    }
    pushHistory(
      response.allowed ? `${label} accepted` : `${label} blocked`,
      body,
      tone,
    )
    await emitVerificationFeedback(response.allowed)
  }

  async function decodeImageBase64ThroughVerifier(imageBase64: string) {
    const response = await requestJson<{ qr_payload: string }>("/verifier/decode-image", {
      method: "POST",
      apiKey: apiKeyRef.current.trim() || undefined,
      apiKeyHeader: apiKeyHeaderRef.current,
      body: { image_base64: imageBase64 },
    })
    return response.qr_payload
  }

  function scheduleNextScan(delayMs: number) {
    if (scanLoopIdRef.current) {
      window.clearTimeout(scanLoopIdRef.current)
    }
    scanLoopIdRef.current = window.setTimeout(() => {
      void scanCameraFrame()
    }, delayMs)
  }

  function captureCameraFrameBase64(videoElement: HTMLVideoElement) {
    const canvas = canvasRef.current
    if (!canvas) {
      throw new Error("Camera canvas is not available.")
    }
    const width = videoElement.videoWidth || 1280
    const height = videoElement.videoHeight || 720
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) {
      throw new Error("Camera canvas could not create a 2D context.")
    }
    context.drawImage(videoElement, 0, 0, width, height)
    return dataUrlToBase64(canvas.toDataURL("image/png"))
  }

  async function decodeCurrentCameraFrame(): Promise<{
    qrPayload: string
    imageBase64: string | null
  }> {
    const videoElement = videoRef.current
    if (!videoElement) return { qrPayload: "", imageBase64: null }

    if (detectorRef.current) {
      const codes = await detectorRef.current.detect(videoElement)
      if (!codes.length || !codes[0]?.rawValue) {
        return { qrPayload: "", imageBase64: null }
      }
      return {
        qrPayload: codes[0].rawValue,
        imageBase64: captureCameraFrameBase64(videoElement),
      }
    }

    const imageBase64 = captureCameraFrameBase64(videoElement)
    return {
      qrPayload: await decodeImageBase64ThroughVerifier(imageBase64),
      imageBase64,
    }
  }

  async function scanCameraFrame() {
    if (!streamRef.current || scanPendingRef.current) {
      return
    }

    scanPendingRef.current = true
    try {
      const { qrPayload, imageBase64 } = await decodeCurrentCameraFrame()
      if (qrPayload) {
        stageScannedPayload(qrPayload)
        flashFrame("success")
        setCameraMessage({
          title: "QR captured",
          body: `The live camera decoded a QR payload using the ${decoderLabelRef.current}.`,
          tone: "success",
        })
        setScanMessage({
          title: "Camera scan captured",
          body: `Decoded payload from the live camera using the ${decoderLabelRef.current}.`,
          tone: "success",
        })
        await emitCaptureFeedback()
        stopCamera({ preserveMessage: true })
        await runScannerDecision({
          label: "Camera scan",
          qrPayload,
          imageBase64,
          cameraDriven: true,
        })
        return
      }
    } catch (error) {
      if (error instanceof VerifierApiError && error.status === 429) {
        const retryAfterSeconds = error.retryAfterSeconds ?? 1
        setCameraMessage({
          title: "Camera scan paused",
          body: `Decode rate limit reached. The client will retry in ${retryAfterSeconds}s.`,
          tone: "blocked",
        })
        setScanMessage({
          title: "Camera scan paused",
          body: `Decode rate limit reached. The client will retry in ${retryAfterSeconds}s.`,
          tone: "blocked",
        })
        scheduleNextScan(retryAfterSeconds * 1000)
        return
      }

      if (
        error instanceof VerifierApiError &&
        error.status === 400 &&
        error.message.includes("No QR payload")
      ) {
        scheduleNextScan(
          detectorRef.current ? nativeScanIntervalMs : fallbackScanIntervalMs,
        )
        return
      }

      const message = summariseError(error)
      flashFrame("blocked")
      setCameraMessage({
        title: "Camera scan failed",
        body: message,
        tone: "blocked",
      })
      setScanMessage({
        title: "Camera scan failed",
        body: message,
        tone: "blocked",
      })
      stopCamera({ preserveMessage: true })
      return
    } finally {
      scanPendingRef.current = false
    }

    scheduleNextScan(
      detectorRef.current ? nativeScanIntervalMs : fallbackScanIntervalMs,
    )
  }

  async function startCamera() {
    const reason = cameraUnavailableReason()
    if (reason) {
      setCameraMessage({
        title: "Camera unsupported",
        body: reason,
        tone: "blocked",
      })
      setCameraOverlay(reason)
      return
    }

    setIsStartingCamera(true)
    try {
      const constraints = selectedCameraId
        ? { deviceId: { exact: selectedCameraId } }
        : { facingMode: { ideal: "environment" } }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: constraints,
        audio: false,
      })
      streamRef.current = stream

      const videoElement = videoRef.current
      if (!videoElement) {
        throw new Error("Camera preview is not mounted.")
      }
      videoElement.srcObject = stream
      await videoElement.play()
      await refreshCameraOptions()
      setIsCameraRunning(true)
      setCameraOverlay(`Point the camera at a QR code. Active decoder: ${decoderLabel}.`)
      setCameraMessage({
        title: "Camera active",
        body: `Waiting for a QR on another screen or on paper. Decoder: ${decoderLabel}.`,
        tone: "neutral",
      })
      scheduleNextScan(
        detectorRef.current ? nativeScanIntervalMs : fallbackScanIntervalMs,
      )
    } catch (error) {
      flashFrame("blocked")
      setCameraMessage({
        title: "Camera access failed",
        body: summariseError(error),
        tone: "blocked",
      })
      setScanMessage({
        title: "Camera access failed",
        body: summariseError(error),
        tone: "blocked",
      })
      stopCamera({ preserveMessage: true })
    } finally {
      setIsStartingCamera(false)
    }
  }

  async function verifyCurrent() {
    if (!demo) {
      setScanMessage({
        title: "No demo QR",
        body: "Generate a demo QR before asking the verifier to evaluate the current payload.",
        tone: "blocked",
      })
      return
    }

    setIsVerifyingCurrent(true)
    try {
      setScannedPayload(demo.qr_payload)
      await runScannedVerifier({
        label: `${currentScenario.label} direct verify`,
        qrPayload: demo.qr_payload,
      })
    } catch (error) {
      const staleKey = isStaleStoredKeyError(error)
      if (staleKey) {
        clearLabKey()
      }
      setScanMessage({
        title: staleKey ? "Stored verifier key rejected" : "Signed-verifier proof failed",
        body: staleKey ? staleStoredKeyMessage : summariseSignedVerifierError(error),
        tone: "blocked",
      })
    } finally {
      setIsVerifyingCurrent(false)
    }
  }

  async function verifyScannedPayload() {
    if (!scannedPayload.trim()) {
      setScanMessage({
        title: "Scanned payload missing",
        body: "Upload, capture, or paste a QR payload before verifying it.",
        tone: "blocked",
      })
      return
    }

    setIsVerifyingScanned(true)
    try {
      await runScannerDecision({
        label: "Scanned QR",
        qrPayload: scannedPayload.trim(),
      })
    } catch (error) {
      setScanMessage({
        title: "Scanner decision failed",
        body: summariseError(error),
        tone: "blocked",
      })
    } finally {
      setIsVerifyingScanned(false)
    }
  }

  async function handleImageSelection(file: File) {
    setIsDecodingImage(true)
    let decodedPayload = ""
    try {
      const imageBase64 = await fileToBase64(file)
      if (detectorRef.current) {
        const bitmap = await createImageBitmap(file)
        const codes = await detectorRef.current.detect(bitmap)
        decodedPayload = codes[0]?.rawValue || ""
        if (!decodedPayload) {
          throw new Error("No QR payload could be decoded from the selected image.")
        }
      } else {
        decodedPayload = await decodeImageBase64ThroughVerifier(imageBase64)
      }

      stageScannedPayload(decodedPayload)
      flashFrame("success")
      setCameraMessage({
        title: "Image decoded",
        body: `The QR payload was decoded from the uploaded image using the ${decoderLabel}. The scanner decision is running now.`,
        tone: "success",
      })
      setScanMessage({
        title: "QR image decoded; checking",
        body: `Decoded with the ${decoderLabel}. The scanner-visible decision endpoint is evaluating the payload now.`,
        tone: "success",
      })
      await emitCaptureFeedback()
      await runScannerDecision({
        label: "Uploaded QR",
        qrPayload: decodedPayload,
        imageBase64,
      })
    } catch (error) {
      const message = summariseError(error)
      if (decodedPayload) {
        setScannerDecisionError(message)
      }
      setScanMessage({
        title: decodedPayload ? "Scanner decision failed" : "QR decode failed",
        body: message,
        tone: "blocked",
      })
      setCameraMessage({
        title: decodedPayload ? "Image check failed" : "Image decode failed",
        body: message,
        tone: "blocked",
      })
    } finally {
      setIsDecodingImage(false)
      if (imageInputRef.current) {
        imageInputRef.current.value = ""
      }
    }
  }

  async function copyPayload(kind: "qr" | "decoded") {
    const value = kind === "qr" ? demo?.qr_payload : scannedPayload
    if (!value) return

    try {
      await navigator.clipboard.writeText(value)
      setScanMessage({
        title: "Payload copied",
        body:
          kind === "qr"
            ? "The generated QR payload is in your clipboard."
            : "The decoded payload is in your clipboard.",
        tone: "success",
      })
    } catch {
      setScanMessage({
        title: "Clipboard blocked",
        body: "The browser denied clipboard access. Copy the payload manually from the text field.",
        tone: "blocked",
      })
    }
  }

  function downloadQrImage() {
    if (!demo) return

    const anchor = document.createElement("a")
    anchor.href = qrImageDataUrl(demo.qr_png_base64)
    anchor.download = `${scenario}-verifier-qr.png`
    anchor.click()
  }

  function openQrFullscreen() {
    if (!demo) return

    setQrDisplayError(null)
    setQrDisplayOpen(true)
    setQrDisplayShowMetadata(true)
    setQrDisplayHighContrast(false)
  }

  function closeQrDisplay() {
    setQrDisplayOpen(false)
  }

  function toggleQrDisplayMetadata() {
    setQrDisplayShowMetadata((value) => !value)
  }

  function toggleQrDisplayHighContrast() {
    setQrDisplayHighContrast((value) => !value)
  }

  async function enterQrDisplayFullscreen() {
    if (!qrDisplayFrameRef.current) return

    try {
      await qrDisplayFrameRef.current.requestFullscreen()
      setQrDisplayError(null)
    } catch (error) {
      setQrDisplayError(
        error instanceof Error ? error.message : "The browser blocked fullscreen mode.",
      )
    }
  }

  function openOperator() {
    navigateTo(
      buildOperatorLink({
        focus: "runtime",
        source: "lab",
        scenario,
        compareScenario: compareScenario ?? undefined,
        nonceMode,
      }),
    )
  }

  function clearLabKey() {
    setApiKey("")
    clearStoredVerifierApiKey()
  }

  async function issueLocalLabKey() {
    setIsIssuingLabKey(true)
    try {
      const response = await requestJson<ManagementApiKeyIssueResponse>(
        "/admin/verifier-clients/api-keys/issue",
        {
          method: "POST",
          adminToken: "local-lab-admin",
          adminHeader,
          body: { label: "lab-local-compose" },
        },
      )
      setApiKey(response.plaintext_key)
      setScanMessage({
        title: "Local lab key issued",
        body: "The key is stored in browser storage for this local verifier workbench.",
        tone: "success",
      })
      pushHistory(
        "Local lab key issued",
        "The lab can now generate demo QR material against the protected verifier API.",
        "success",
      )
    } catch (error) {
      setScanMessage({
        title: "Local lab key failed",
        body: `${summariseError(error)} Open operator mode if this runtime does not use the local compose admin token.`,
        tone: "blocked",
      })
    } finally {
      setIsIssuingLabKey(false)
    }
  }

  function toggleOptionGuide() {
    setShowOptionGuide((value) => !value)
  }

  function openImagePicker() {
    imageInputRef.current?.click()
  }

  useEffect(() => {
    if (!routeAutogenerateRef.current) return
    routeAutogenerateRef.current = false
    generateRouteDemo(scenario, nonceMode, usagePolicy)
  }, [scenario, nonceMode, usagePolicy])

  return {
    runtimeStatus,
    scenario,
    nonceMode,
    usagePolicy,
    apiKey,
    demo,
    scannedPayload,
    result,
    history,
    scanMessage,
    cameraMessage,
    cameraOverlay,
    cameraDevices,
    selectedCameraId,
    hasNativeDetector,
    cameraSupported,
    isGenerating,
    isIssuingLabKey,
    isCheckingScannerDecision,
    isVerifyingCurrent,
    isVerifyingScanned,
    isDecodingImage,
    isRefreshingCameras,
    isStartingCamera,
    isCameraRunning,
    frameFlashTone,
    showOptionGuide,
    qrDisplayOpen,
    qrDisplayShowMetadata,
    qrDisplayHighContrast,
    qrDisplayError,
    currentScenario,
    generatedScenario: generatedScenarioMeta,
    compareScenario,
    comparisonScenario,
    apiKeyHeader,
    apiAuthEnabled,
    adminFlowEnabled,
    decoderLabel,
    secureContextBlocked,
    generatorSettingsChanged,
    fixedReplayVisible,
    scannerDecision,
    scannerDecisionError,
    generationError,
    imageInputRef,
    videoRef,
    canvasRef,
    qrDisplayFrameRef,
    setScenario,
    setNonceMode,
    setUsagePolicy,
    setApiKey,
    setSelectedCameraId,
    setScannedPayload: updateScannedPayload,
    toggleOptionGuide,
    openOperator,
    issueLocalLabKey,
    clearLabKey,
    generateDemo,
    generateFreshValidDemo,
    generateComparisonDemo,
    checkScannerDecision,
    openQrFullscreen,
    verifyCurrent,
    downloadQrImage,
    copyPayload,
    startCamera,
    stopCamera,
    refreshCameraOptions,
    openImagePicker,
    handleImageSelection,
    verifyScannedPayload,
    recordScannerUxEvent,
    openScannerDestination,
    cancelScannerDestination,
    startScannerHold,
    completeScannerHold,
    closeQrDisplay,
    toggleQrDisplayMetadata,
    toggleQrDisplayHighContrast,
    enterQrDisplayFullscreen,
  }
}
