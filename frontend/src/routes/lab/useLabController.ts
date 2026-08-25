import { useEffect, useEffectEvent, useRef, useState } from "react"

import {
  clearStoredVerifierApiKey,
  type DemoMaterialsResponse,
  fileToBase64,
  type ManagementApiKeyIssueResponse,
  qrImageDataUrl,
  readStoredVerifierApiKey,
  requestJson,
  type ScanActivity,
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
import { scenarioLabelKeys, usagePolicyLabelKeys } from "@/domain/scenarios"
// The plain `t()`, not `useT()`: these strings are built inside async
// handlers, where reading the live locale beats a value captured at render.
import { t, type MessageKey } from "@/i18n"
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

const staleStoredKeyMessage = () => t("lab.error.staleStoredKey")

const cameraDeviceStorageKey = "verifier-react-camera-device"
const scannerKnownHostsStorageKey = "qr-trust-scanner-known-hosts"
const nativeScanIntervalMs = 180
const fallbackScanIntervalMs = 1500
// Key-less tabs share one IP-based rate bucket (60 requests/minute) behind the
// compose proxy, so the status poll must stay well under that budget even with
// a few tabs open.
const scannerDecisionStatusPollMs = 5000
const scanActivityPollMs = 5000
// A function, not a const: a module-level string would freeze whichever locale
// happened to be active when this module was first imported.
const idleCameraOverlay = () => t("lab.camera.overlay.idle")

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

// Why the camera is unusable is a fact about the browser, not a sentence. The
// reason travels as a code so `secureContextBlocked` below can compare against
// an identifier instead of searching prose that changes with the language.
type CameraBlockReason =
  | "serverRendering"
  | "insecureContext"
  | "noMediaDevices"
  | "noGetUserMedia"

function cameraBlockReason(): CameraBlockReason | null {
  if (typeof window === "undefined") return "serverRendering"
  if (typeof navigator.mediaDevices?.getUserMedia === "function") return null
  if (!window.isSecureContext) return "insecureContext"
  if (!navigator.mediaDevices) return "noMediaDevices"
  return "noGetUserMedia"
}

const cameraBlockKeys: Record<CameraBlockReason, MessageKey> = {
  serverRendering: "lab.camera.blocked.serverRendering",
  insecureContext: "lab.camera.blocked.insecureContext",
  noMediaDevices: "lab.camera.blocked.noMediaDevices",
  noGetUserMedia: "lab.camera.blocked.noGetUserMedia",
}

function cameraBlockText(reason: CameraBlockReason | null) {
  return reason ? t(cameraBlockKeys[reason]) : ""
}

function buildCameraMessage(reason: CameraBlockReason | null): MessageState {
  return {
    title: reason
      ? t("lab.camera.unsupported.title")
      : t("lab.camera.idle.title"),
    body: reason ? t(cameraBlockKeys[reason]) : t("lab.camera.idle.body"),
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
  const initialCameraBlock = cameraBlockReason()
  const [hasNativeDetector] = useState(() => {
    if (typeof window === "undefined") return false
    return Boolean((window as WindowWithBarcodeDetector).BarcodeDetector)
  })

  const [runtimeStatus, setRuntimeStatus] = useState<VerifierStatus | null>(null)
  const [scenario, setScenario] = useState<ScenarioKey>(() => parseInitialScenarioParam())
  const [compareScenario, setCompareScenario] = useState<ScenarioKey | null>(() =>
    parseInitialCompareScenarioParam(),
  )
  const [nonceMode, setNonceMode] = useState<NonceMode>(() => parseInitialNonceMode())
  const [usagePolicy, setUsagePolicy] = useState<UsagePolicy>(() =>
    parseInitialUsagePolicy(),
  )
  const [apiKey, setApiKey] = useState(() => readStoredVerifierApiKey())
  const [demo, setDemo] = useState<DemoMaterialsResponse | null>(null)
  // Keyed by nonce so a regenerated demo never shows the previous code's scans.
  const [scanActivityState, setScanActivityState] = useState<{
    nonce: string
    activity: ScanActivity | null
    error: string | null
  } | null>(null)
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
      t("lab.history.initial.title"),
      t("lab.history.initial.body"),
      "neutral",
    ),
  ])
  const [scanMessage, setScanMessage] = useState<MessageState | null>(null)
  const [cameraMessage, setCameraMessage] = useState<MessageState | null>(() =>
    buildCameraMessage(initialCameraBlock),
  )
  const [cameraOverlay, setCameraOverlay] = useState(
    () => cameraBlockText(initialCameraBlock) || idleCameraOverlay(),
  )
  const [cameraDevices, setCameraDevices] = useState<CameraDevice[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState(() => getInitialCameraDeviceId())
  // The reason itself is the state, not a bare `supported` boolean — both
  // `cameraSupported` and `secureContextBlocked` are derived from it below.
  const [cameraBlock, setCameraBlock] = useState(initialCameraBlock)
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
    ? t("lab.decoder.native")
    : t("lab.decoder.fallback")
  const cameraSupported = cameraBlock === null
  // Was a substring search through `cameraMessage.body` for "secure context" —
  // program behaviour that silently broke the moment the copy was translated.
  const secureContextBlocked = cameraBlock === "insecureContext"
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
    const staged = qrPayload.trim().length > 0
    setScanMessage({
      title: t(staged ? "lab.payload.changed.title" : "lab.payload.cleared.title"),
      body: t(staged ? "lab.payload.changed.body" : "lab.payload.cleared.body"),
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
    const reason = cameraBlockReason()
    setCameraBlock(reason)
    setCameraOverlay(cameraBlockText(reason) || idleCameraOverlay())
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
        title: t("lab.runtimeStatus.failed.title"),
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

  const demoNonce = demo?.verify_request.envelope.claims.nonce ?? null
  const demoUsagePolicy = demo?.verify_request.envelope.claims.usage_policy ?? null

  // Phone-scan feedback for the sealed QR: poll the verifier's per-nonce
  // activity while a demo is on screen. Keyed on the nonce, not the demo
  // object, so a re-verify of the same code does not restart the poll.
  useEffect(() => {
    if (!demoNonce) return
    const nonce = demoNonce
    let cancelled = false
    let inFlight = false

    async function loadScanActivity() {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const params = new URLSearchParams({ nonce })
        if (demoUsagePolicy) params.set("usage_policy", demoUsagePolicy)
        const activity = await requestJson<ScanActivity>(
          `/verifier/scan-activity?${params.toString()}`,
          {
            apiKey: apiKeyRef.current.trim() || undefined,
            apiKeyHeader: apiKeyHeaderRef.current,
          },
        )
        if (!cancelled) setScanActivityState({ nonce, activity, error: null })
      } catch (error) {
        // Keep the last good snapshot but surface the error: a dead poll
        // must never read as "no scans yet".
        if (!cancelled) {
          setScanActivityState((previous) => ({
            nonce,
            activity: previous?.nonce === nonce ? previous.activity : null,
            error: summariseError(error),
          }))
        }
      } finally {
        inFlight = false
      }
    }

    void loadScanActivity()
    const timer = window.setInterval(() => {
      if (document.hidden) return
      void loadScanActivity()
    }, scanActivityPollMs)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [demoNonce, demoUsagePolicy])

  const scanActivity =
    scanActivityState?.nonce === demoNonce ? scanActivityState.activity : null
  const scanActivityError =
    scanActivityState?.nonce === demoNonce ? scanActivityState.error : null

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
  ): Promise<boolean> {
    stopCamera()
    setIsGenerating(true)
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
        title: t("lab.generate.ready.title"),
        body: t("lab.generate.ready.body", {
          scenario: t(scenarioLabelKeys[nextScenario]),
          policy: t(usagePolicyLabelKeys[nextUsagePolicy]),
          nonce: response.verify_request.envelope.claims.nonce,
        }),
        tone: "success",
      })
      setCameraMessage({
        title: t("lab.camera.ready.title"),
        body: t("lab.camera.ready.body", { decoder: decoderLabel }),
        tone: "neutral",
      })
      setCameraOverlay(
        t("lab.camera.overlay.generated", { decoder: decoderLabel }),
      )
      pushHistory(
        t("lab.history.generated.title"),
        t("lab.history.generated.body", {
          scenario: t(scenarioLabelKeys[nextScenario]),
          policy: t(usagePolicyLabelKeys[nextUsagePolicy]),
          nonce: response.verify_request.envelope.claims.nonce,
        }),
        "neutral",
      )
      return true
    } catch (error) {
      const staleKey = isStaleStoredKeyError(error)
      if (staleKey) {
        clearLabKey()
      }
      const message = staleKey ? staleStoredKeyMessage() : summariseError(error)
      setDemo(null)
      setGeneratedScenario(null)
      setGeneratedNonceMode(null)
      setScannerDecision(null)
      setScannerDecisionError(null)
      setScannedPayload("")
      setGenerationError(message)
      setScanMessage({
        title: staleKey
          ? t("lab.verify.staleKey.title")
          : t("lab.generate.failed.title"),
        body: message,
        tone: "blocked",
      })
      return false
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

  // Load B, then make the old A the new B: the pair becomes a toggle the
  // verdict can flip back and forth without going through the scenario step.
  async function generateComparisonDemo() {
    if (!compareScenario) return
    const previous = scenario
    const generated = await generateDemoFor(compareScenario, nonceMode, usagePolicy)
    if (generated) setCompareScenario(previous)
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
      pushHistory(
        t("lab.uxEvent.notRecorded"),
        summariseError(error),
        "neutral",
      )
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
        title: t("lab.open.noDestination.title"),
        body: t("lab.open.noDestination.body"),
        tone: "blocked",
      })
      return
    }

    const popup = window.open(destinationUrl, "_blank", "noopener,noreferrer")
    if (!popup) {
      void recordScannerUxEvent("cancel", decision, elapsedMs)
      setScanMessage({
        title: t("lab.open.blocked.title"),
        body: t("lab.open.blocked.body"),
        tone: "blocked",
      })
      return
    }
    void recordScannerUxEvent("open", decision, elapsedMs)
    rememberScannerKnownHost(destinationUrl)
    // `primary_action` is the scanner decision's own wording; only the fallback
    // for a decision that omits it belongs to the catalogue.
    pushHistory(
      t("lab.history.openSelected"),
      `${decision.scanner_ux?.primary_action ?? t("lab.open.defaultAction")}: ${destinationUrl}`,
      scannerTone(decision),
    )
  }

  function cancelScannerDestination(
    decision: ScannerDecisionResponse,
    elapsedMs: number | null = null,
  ) {
    void recordScannerUxEvent("cancel", decision, elapsedMs)
    setScanMessage({
      title: t("lab.open.cancelled.title"),
      body: t("lab.open.cancelled.body"),
      tone: "neutral",
    })
    pushHistory(
      t("lab.history.openCancelled"),
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
        title: t("lab.noDemo.title"),
        body: t("lab.noDemo.scannerDecision"),
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
        source: t("lab.source.generatedQr"),
        qrPayload: demo.qr_payload,
        imageBase64: generatedScenarioMeta?.artifactProfile
          ? demo.qr_png_base64
          : null,
      })
    } catch (error) {
      const message = summariseError(error)
      setScannerDecisionError(message)
      setScanMessage({
        title: t("lab.scan.decisionFailed.title"),
        body: message,
        tone: "blocked",
      })
    } finally {
      setIsCheckingScannerDecision(false)
    }
  }

  async function runScannerDecision({
    source,
    qrPayload,
    imageBase64 = null,
    cameraDriven = false,
  }: {
    // Already-translated name of where the payload came from; it is substituted
    // into the history sentence rather than concatenated in front of it.
    source: string
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
      title: t("lab.scan.decisionReady.title"),
      body,
      tone,
    })
    if (cameraDriven) {
      setCameraMessage({
        title: t("lab.camera.checked.title"),
        body,
        tone,
      })
    }
    pushHistory(t("lab.history.scannerDecision", { source }), body, tone)
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
    source,
    qrPayload,
    cameraDriven = false,
  }: {
    source: string
    qrPayload: string
    cameraDriven?: boolean
  }) {
    const activeDemo = demoRef.current
    if (!activeDemo) {
      setScanMessage({
        title: t("lab.noDemo.title"),
        body: t("lab.noDemo.verifyPayload"),
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
      title: t(
        response.allowed ? "lab.scan.accepted.title" : "lab.scan.rejected.title",
      ),
      body,
      tone,
    })
    if (cameraDriven) {
      setCameraMessage({
        title: t(
          response.allowed
            ? "lab.camera.accepted.title"
            : "lab.camera.rejected.title",
        ),
        body,
        tone,
      })
    }
    pushHistory(
      t(response.allowed ? "lab.history.accepted" : "lab.history.rejected", {
        source,
      }),
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
      throw new Error(t("lab.camera.canvasUnavailable"))
    }
    const width = videoElement.videoWidth || 1280
    const height = videoElement.videoHeight || 720
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) {
      throw new Error(t("lab.camera.canvasNoContext"))
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
          title: t("lab.camera.captured.title"),
          // The ref, not the render-time value: this runs inside a timer
          // callback that outlives the render that scheduled it.
          body: t("lab.camera.captured.body", {
            decoder: decoderLabelRef.current,
          }),
          tone: "success",
        })
        setScanMessage({
          title: t("lab.scan.captured.title"),
          body: t("lab.scan.captured.body", {
            decoder: decoderLabelRef.current,
          }),
          tone: "success",
        })
        await emitCaptureFeedback()
        stopCamera({ preserveMessage: true })
        await runScannerDecision({
          source: t("lab.source.cameraScan"),
          qrPayload,
          imageBase64,
          cameraDriven: true,
        })
        return
      }
    } catch (error) {
      if (error instanceof VerifierApiError && error.status === 429) {
        const retryAfterSeconds = error.retryAfterSeconds ?? 1
        const pausedMessage: MessageState = {
          title: t("lab.camera.paused.title"),
          body: t("lab.camera.paused.body", { seconds: retryAfterSeconds }),
          tone: "blocked",
        }
        setCameraMessage(pausedMessage)
        setScanMessage(pausedMessage)
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

      const failure: MessageState = {
        title: t("lab.camera.scanFailed.title"),
        body: summariseError(error),
        tone: "blocked",
      }
      flashFrame("blocked")
      setCameraMessage(failure)
      setScanMessage(failure)
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
    const reason = cameraBlockReason()
    if (reason) {
      setCameraBlock(reason)
      setCameraMessage(buildCameraMessage(reason))
      setCameraOverlay(cameraBlockText(reason))
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
        throw new Error(t("lab.camera.notMounted"))
      }
      videoElement.srcObject = stream
      await videoElement.play()
      await refreshCameraOptions()
      setIsCameraRunning(true)
      setCameraOverlay(
        t("lab.camera.overlay.active", { decoder: decoderLabel }),
      )
      setCameraMessage({
        title: t("lab.camera.active.title"),
        body: t("lab.camera.active.body", { decoder: decoderLabel }),
        tone: "neutral",
      })
      scheduleNextScan(
        detectorRef.current ? nativeScanIntervalMs : fallbackScanIntervalMs,
      )
    } catch (error) {
      const failure: MessageState = {
        title: t("lab.camera.accessFailed.title"),
        body: summariseError(error),
        tone: "blocked",
      }
      flashFrame("blocked")
      setCameraMessage(failure)
      setScanMessage(failure)
      stopCamera({ preserveMessage: true })
    } finally {
      setIsStartingCamera(false)
    }
  }

  async function verifyCurrent() {
    if (!demo) {
      setScanMessage({
        title: t("lab.noDemo.title"),
        body: t("lab.noDemo.verifyCurrent"),
        tone: "blocked",
      })
      return
    }

    setIsVerifyingCurrent(true)
    try {
      setScannedPayload(demo.qr_payload)
      await runScannedVerifier({
        source: t("lab.history.directVerify.label", {
          scenario: t(scenarioLabelKeys[scenario]),
        }),
        qrPayload: demo.qr_payload,
      })
    } catch (error) {
      const staleKey = isStaleStoredKeyError(error)
      if (staleKey) {
        clearLabKey()
      }
      setScanMessage({
        title: t(
          staleKey ? "lab.verify.staleKey.title" : "lab.verify.signedFailed.title",
        ),
        body: staleKey
          ? staleStoredKeyMessage()
          : summariseSignedVerifierError(error),
        tone: "blocked",
      })
    } finally {
      setIsVerifyingCurrent(false)
    }
  }

  async function verifyScannedPayload() {
    if (!scannedPayload.trim()) {
      setScanMessage({
        title: t("lab.scan.payloadMissing.title"),
        body: t("lab.scan.payloadMissing.body"),
        tone: "blocked",
      })
      return
    }

    setIsVerifyingScanned(true)
    try {
      await runScannerDecision({
        source: t("lab.source.scannedQr"),
        qrPayload: scannedPayload.trim(),
      })
    } catch (error) {
      setScanMessage({
        title: t("lab.scan.decisionFailed.title"),
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
          throw new Error(t("lab.scan.noPayloadInImage"))
        }
      } else {
        decodedPayload = await decodeImageBase64ThroughVerifier(imageBase64)
      }

      stageScannedPayload(decodedPayload)
      flashFrame("success")
      setCameraMessage({
        title: t("lab.scan.imageDecoded.title"),
        body: t("lab.scan.imageDecoded.body", { decoder: decoderLabel }),
        tone: "success",
      })
      setScanMessage({
        title: t("lab.scan.imageChecking.title"),
        body: t("lab.scan.imageChecking.body", { decoder: decoderLabel }),
        tone: "success",
      })
      await emitCaptureFeedback()
      await runScannerDecision({
        source: t("lab.source.uploadedQr"),
        qrPayload: decodedPayload,
        imageBase64,
      })
    } catch (error) {
      const message = summariseError(error)
      if (decodedPayload) {
        setScannerDecisionError(message)
      }
      // A payload that decoded but failed the decision is a different event
      // from an image that never decoded — the titles distinguish them.
      setScanMessage({
        title: t(
          decodedPayload
            ? "lab.scan.decisionFailed.title"
            : "lab.scan.qrDecodeFailed.title",
        ),
        body: message,
        tone: "blocked",
      })
      setCameraMessage({
        title: t(
          decodedPayload
            ? "lab.scan.imageCheckFailed.title"
            : "lab.scan.imageDecodeFailed.title",
        ),
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
        title: t("lab.copy.copied.title"),
        body: t(kind === "qr" ? "lab.copy.copied.qr" : "lab.copy.copied.decoded"),
        tone: "success",
      })
    } catch {
      setScanMessage({
        title: t("lab.copy.blocked.title"),
        body: t("lab.copy.blocked.body"),
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
        error instanceof Error
          ? error.message
          : t("lab.qrDisplay.fullscreenBlocked"),
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
        title: t("lab.labKey.issued.title"),
        body: t("lab.labKey.issued.body"),
        tone: "success",
      })
      pushHistory(
        t("lab.labKey.issued.title"),
        t("lab.labKey.issued.history"),
        "success",
      )
    } catch (error) {
      setScanMessage({
        title: t("lab.labKey.failed.title"),
        // The verifier's own error leads, so `{error}` is a placeholder rather
        // than a prefix glued on in English word order.
        body: t("lab.labKey.failed.body", { error: summariseError(error) }),
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
    scanActivity,
    scanActivityError,
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
    setCompareScenario,
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
