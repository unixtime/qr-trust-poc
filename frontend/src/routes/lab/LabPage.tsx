import { useEffect, useMemo, useRef, useState } from "react"

import {
  ToastNotification,
  type ToastMessage,
  type ToastTone,
} from "@/components/ui/toast"
import type { ScannerDecisionRecent } from "@/lib/verifier-client"
import {
  nonceGuide,
  scenarioGuide,
  scenarioMeta,
  usagePolicyGuide,
} from "@/routes/lab/content"
import HistorySection from "@/routes/lab/components/HistorySection"
import LabComparisonStrip from "@/routes/lab/components/LabComparisonStrip"
import LabHeroSection from "@/routes/lab/components/LabHeroSection"
import LabSupportRail from "@/routes/lab/components/LabSupportRail"
import QrDisplayModal from "@/routes/lab/components/QrDisplayModal"
import ScanWorkbenchSection from "@/routes/lab/components/ScanWorkbenchSection"
import ScenarioGeneratorSection from "@/routes/lab/components/ScenarioGeneratorSection"
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

function LabPage() {
  const lab = useLabController()
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

  return (
    <div className="min-h-screen px-3 py-4 sm:px-4 md:px-6 md:py-6 xl:px-8">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
        <LabHeroSection decoderLabel={lab.decoderLabel} />

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
          <div className="grid gap-4">
            <ScenarioGeneratorSection
              scenario={lab.scenario}
              nonceMode={lab.nonceMode}
              usagePolicy={lab.usagePolicy}
              apiKey={lab.apiKey}
              currentScenario={lab.currentScenario}
              scenarioMeta={scenarioMeta}
              scenarioGuide={scenarioGuide}
              nonceGuide={nonceGuide}
              usagePolicyGuide={usagePolicyGuide}
              demo={lab.demo}
              generatedScenario={lab.generatedScenario}
              scannerDecision={lab.scannerDecision}
              scannerDecisionPending={lab.isCheckingScannerDecision}
              scannerDecisionError={lab.scannerDecisionError}
              generationError={lab.generationError}
              generatorSettingsChanged={lab.generatorSettingsChanged}
              apiAuthEnabled={lab.apiAuthEnabled}
              localKeyIssue={{
                visible: lab.apiAuthEnabled && lab.adminFlowEnabled && !lab.apiKey.trim(),
                pending: lab.isIssuingLabKey,
                onIssue: () => void lab.issueLocalLabKey(),
              }}
              showOptionGuide={lab.showOptionGuide}
              isGenerating={lab.isGenerating}
              isVerifyingCurrent={lab.isVerifyingCurrent}
              fixedReplayVisible={lab.fixedReplayVisible}
              onScenarioChange={lab.setScenario}
              onNonceModeChange={lab.setNonceMode}
              onUsagePolicyChange={lab.setUsagePolicy}
              onApiKeyChange={lab.setApiKey}
              onToggleOptionGuide={lab.toggleOptionGuide}
              onGenerateDemo={() => void lab.generateDemo()}
              onGenerateFreshValidDemo={() => void lab.generateFreshValidDemo()}
              onCheckScannerDecision={() => void lab.checkScannerDecision()}
              onOpenQrFullscreen={lab.openQrFullscreen}
              onVerifyCurrent={() => void lab.verifyCurrent()}
              onDownloadQrImage={lab.downloadQrImage}
              onCopyQrPayload={() => void lab.copyPayload("qr")}
            />

            <LabComparisonStrip
              scenario={lab.scenario}
              nonceMode={lab.nonceMode}
              currentScenario={lab.currentScenario}
              compareScenario={lab.compareScenario}
              comparisonScenario={lab.comparisonScenario}
              onGenerateComparisonDemo={() => void lab.generateComparisonDemo()}
            />

            <ScanWorkbenchSection
              workbench={{
                demo: lab.demo,
                scannedPayload: lab.scannedPayload,
                scannerDecision: lab.scannerDecision,
                result: lab.result,
                isDecodingImage: lab.isDecodingImage,
                isVerifyingScanned: lab.isVerifyingScanned,
              }}
              camera={{
                message: lab.cameraMessage,
                overlay: lab.cameraOverlay,
                secureContextBlocked: lab.secureContextBlocked,
                devices: lab.cameraDevices,
                selectedDeviceId: lab.selectedCameraId,
                supported: lab.cameraSupported,
                isStarting: lab.isStartingCamera,
                isRunning: lab.isCameraRunning,
                isRefreshing: lab.isRefreshingCameras,
                frameFlashTone: lab.frameFlashTone,
              }}
              decoder={{
                hasNativeDetector: lab.hasNativeDetector,
                label: lab.decoderLabel,
              }}
              scanStatus={lab.scanMessage}
              refs={{
                videoRef: lab.videoRef,
                canvasRef: lab.canvasRef,
                imageInputRef: lab.imageInputRef,
              }}
              actions={{
                startCamera: () => void lab.startCamera(),
                stopCamera: () => lab.stopCamera(),
                refreshCameras: () => void lab.refreshCameraOptions(),
                openImagePicker: lab.openImagePicker,
                handleImageSelection: (file) => void lab.handleImageSelection(file),
                setSelectedCameraId: lab.setSelectedCameraId,
                setScannedPayload: lab.setScannedPayload,
                verifyScannedPayload: () => void lab.verifyScannedPayload(),
                copyDecodedPayload: () => void lab.copyPayload("decoded"),
                openScannerDestination: (decision, elapsedMs) =>
                  lab.openScannerDestination(decision, elapsedMs ?? null),
                cancelScannerDestination: (decision, elapsedMs) =>
                  lab.cancelScannerDestination(decision, elapsedMs ?? null),
                startScannerHold: lab.startScannerHold,
                completeScannerHold: lab.completeScannerHold,
              }}
            />

            <HistorySection history={lab.history} />
          </div>

          <LabSupportRail
            runtimeStatus={lab.runtimeStatus}
            apiKeyHeader={lab.apiKeyHeader}
            apiKey={lab.apiKey}
            apiAuthEnabled={lab.apiAuthEnabled}
            adminFlowEnabled={lab.adminFlowEnabled}
            currentScenario={lab.currentScenario}
            compareScenario={lab.compareScenario}
            comparisonScenario={lab.comparisonScenario}
            history={lab.history}
            onOpenOperator={lab.openOperator}
            onClearLabKey={lab.clearLabKey}
            onGenerateComparisonDemo={() => void lab.generateComparisonDemo()}
          />
        </section>

        <QrDisplayModal
          demo={lab.demo}
          open={lab.qrDisplayOpen}
          currentScenarioLabel={lab.currentScenario.label}
          highContrast={lab.qrDisplayHighContrast}
          showMetadata={lab.qrDisplayShowMetadata}
          error={lab.qrDisplayError}
          frameRef={lab.qrDisplayFrameRef}
          onClose={lab.closeQrDisplay}
          onToggleMetadata={lab.toggleQrDisplayMetadata}
          onToggleHighContrast={lab.toggleQrDisplayHighContrast}
          onEnterFullscreen={() => void lab.enterQrDisplayFullscreen()}
        />
      </div>
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
    </div>
  )
}

export default LabPage
