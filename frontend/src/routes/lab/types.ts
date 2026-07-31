import type { RefObject } from "react"

import type {
  DemoMaterialsResponse,
  ScannerDecisionResponse,
  UsagePolicy,
  VerifierDecision,
  VerifierStatus,
} from "@/lib/verifier-client"

export type ScenarioKey =
  | "valid"
  | "expired"
  | "revoked"
  | "subdomain-allowed"
  | "subdomain-blocked"
  | "payload-mismatch"
  | "redirect-approved"
  | "redirect-final-mismatch"
  | "redirect-too-many-hops"
  | "redirect-nested-shortener"
  | "runtime-risky"
  | "runtime-blocked"
  | "stale-cache"
  | "unknown-issuer"
  | "artifact-quiet-zone"
  | "artifact-mismatch"

export type NonceMode = "fixed" | "timestamped"
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

export type ScenarioMeta = {
  label: string
  note: string
  payload: string
  verifiedDomains: string[]
  allowSubdomains: boolean
  certificateRevoked: boolean
  certificateRevocationReason: string | null
  issuedOffsetMinutes?: number
  expiresOffsetMinutes: number
  governanceCacheProfile?: "fresh" | "stale" | "expired"
  registerScannerTrust?: boolean
  artifactProfile?: "low-quiet-zone" | "payload-mismatch"
  expectedOutcome: {
    tone: "green" | "amber" | "red"
    label: string
    layer: string
    summary: string
  }
}

export type ScenarioGuideEntry = {
  key: ScenarioKey
  title: string
  summary: string
}

export type NonceGuideEntry = {
  key: NonceMode
  title: string
  summary: string
}

export type UsagePolicyGuideEntry = {
  key: UsagePolicy
  title: string
  summary: string
}

export type ScenarioGeneratorSectionProps = {
  scenario: ScenarioKey
  nonceMode: NonceMode
  usagePolicy: UsagePolicy
  apiKey: string
  currentScenario: ScenarioMeta
  scenarioMeta: Record<ScenarioKey, ScenarioMeta>
  scenarioGuide: ScenarioGuideEntry[]
  nonceGuide: NonceGuideEntry[]
  usagePolicyGuide: UsagePolicyGuideEntry[]
  demo: DemoMaterialsResponse | null
  generatedScenario: ScenarioMeta | null
  scannerDecision: ScannerDecisionResponse | null
  scannerDecisionPending: boolean
  scannerDecisionError: string | null
  generationError: string | null
  generatorSettingsChanged: boolean
  apiAuthEnabled: boolean
  localKeyIssue: {
    visible: boolean
    pending: boolean
    onIssue: () => void
  }
  showOptionGuide: boolean
  isGenerating: boolean
  isVerifyingCurrent: boolean
  fixedReplayVisible: boolean
  onScenarioChange: (value: ScenarioKey) => void
  onNonceModeChange: (value: NonceMode) => void
  onUsagePolicyChange: (value: UsagePolicy) => void
  onApiKeyChange: (value: string) => void
  onToggleOptionGuide: () => void
  onGenerateDemo: () => void
  onGenerateFreshValidDemo: () => void
  onCheckScannerDecision: () => void
  onOpenQrFullscreen: () => void
  onVerifyCurrent: () => void
  onDownloadQrImage: () => void
  onCopyQrPayload: () => void
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

export type LabSupportRailProps = {
  runtimeStatus: VerifierStatus | null
  apiKeyHeader: string
  apiKey: string
  apiAuthEnabled: boolean
  adminFlowEnabled: boolean
  currentScenario: ScenarioMeta
  compareScenario: ScenarioKey | null
  comparisonScenario: ScenarioMeta | null
  history: HistoryEntry[]
  onOpenOperator: () => void
  onClearLabKey: () => void
  onGenerateComparisonDemo: () => void
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
