import type { RefObject } from "react"

import type {
  DemoMaterialsResponse,
  ScannerDecisionResponse,
  UsagePolicy,
  VerifierDecision,
} from "@/lib/verifier-client"
import type { NonceMode, ScenarioKey } from "@/domain/scenarios"

export type { NonceMode, ScenarioKey }
export type { UsagePolicy }
export type Tone = "neutral" | "success" | "blocked"

export type MessageState = {
  title: string
  body: string
  tone: Tone
}

export type HistoryEntry = {
  id: string
  title: string
  body: string
  tone: Tone
  timestamp: string
}

export type CameraDevice = {
  deviceId: string
  label: string
}

/**
 * The behavioural half of a scenario: what gets sent to the verifier. The
 * display half — label and note — lives in `@/domain/scenarios` as catalogue
 * keys, so that a scenario's copy can be translated without touching the
 * request it produces.
 */
export type ScenarioMeta = {
  payload: string
  verifiedDomains: string[]
  allowSubdomains: boolean
  certificateRevoked: boolean
  /**
   * Request data, not UI copy: this is sent as
   * `certificate_revocation_reason` and echoed back by the verifier, so it
   * stays in English along with the rest of the wire payload.
   */
  certificateRevocationReason: string | null
  issuedOffsetMinutes?: number
  expiresOffsetMinutes: number
  governanceCacheProfile?: "fresh" | "stale" | "expired"
  registerScannerTrust?: boolean
  artifactProfile?: "low-quiet-zone" | "payload-mismatch"
  /**
   * Documentation of what each scenario is supposed to demonstrate. Nothing
   * renders it — it is not in the message catalogue for that reason. Wire it
   * into the UI and it must be extracted first, or it will show English to a
   * Spanish reader.
   */
  expectedOutcome: {
    tone: "green" | "amber" | "red"
    label: string
    layer: string
    summary: string
  }
}

export type ScanWorkbenchSectionProps = {
  workbench: {
    demo: DemoMaterialsResponse | null
    scannedPayload: string
    scannerDecision: ScannerDecisionResponse | null
    result: VerifierDecision | null
    isDecodingImage: boolean
    isVerifyingScanned: boolean
  }
  camera: {
    message: MessageState | null
    overlay: string
    secureContextBlocked: boolean
    devices: CameraDevice[]
    selectedDeviceId: string
    supported: boolean
    isStarting: boolean
    isRunning: boolean
    isRefreshing: boolean
    frameFlashTone: Tone | null
  }
  decoder: {
    hasNativeDetector: boolean
    label: string
  }
  scanStatus: MessageState | null
  refs: {
    videoRef: RefObject<HTMLVideoElement | null>
    canvasRef: RefObject<HTMLCanvasElement | null>
    imageInputRef: RefObject<HTMLInputElement | null>
  }
  actions: {
    startCamera: () => void
    stopCamera: () => void
    refreshCameras: () => void
    openImagePicker: () => void
    handleImageSelection: (file: File) => void
    setSelectedCameraId: (value: string) => void
    setScannedPayload: (value: string) => void
    verifyScannedPayload: () => void
    copyDecodedPayload: () => void
    openScannerDestination: (
      decision: ScannerDecisionResponse,
      elapsedMs?: number | null,
    ) => void
    cancelScannerDestination: (
      decision: ScannerDecisionResponse,
      elapsedMs?: number | null,
    ) => void
    startScannerHold: (decision: ScannerDecisionResponse) => void
    completeScannerHold: (
      decision: ScannerDecisionResponse,
      elapsedMs: number,
    ) => void
  }
}

export type QrDisplayModalProps = {
  demo: DemoMaterialsResponse | null
  open: boolean
  currentScenarioLabel: string
  highContrast: boolean
  showMetadata: boolean
  error: string | null
  frameRef: RefObject<HTMLDivElement | null>
  onClose: () => void
  onToggleMetadata: () => void
  onToggleHighContrast: () => void
  onEnterFullscreen: () => void
}
