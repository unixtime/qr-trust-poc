import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useT } from "@/i18n"
import { ScanWorkbenchSection } from "@/routes/lab/components/ScanWorkbenchSection"
import type { LabState } from "@/routes/lab/deriveFlowStep"

type ScanStepProps = {
  lab: LabState
  onBack: () => void
  onNext: () => void
}

export function ScanStep({ lab, onBack, onNext }: ScanStepProps) {
  const hasScanEvidence = lab.result !== null || lab.scannerDecision !== null
  const t = useT()

  return (
    <div className="flex flex-col gap-6" data-testid="scan-step">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">
          {t("lab.scan.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("lab.scan.subtitle")}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("lab.scan.simulated.title")}
          </CardTitle>
          <CardDescription>
            {t("lab.scan.simulated.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <Button
            data-testid="check-scanner-decision"
            disabled={lab.demo === null || lab.isCheckingScannerDecision}
            onClick={() => void lab.checkScannerDecision()}
          >
            {lab.isCheckingScannerDecision
              ? t("lab.scan.checkingDecision")
              : t("lab.scan.checkDecision")}
          </Button>
          {lab.demo === null ? (
            <p className="text-sm text-muted-foreground">
              {t("lab.scan.needsQr")}
            </p>
          ) : null}
          {lab.scannerDecisionError ? (
            <p className="text-sm text-trust-red" role="alert">
              {lab.scannerDecisionError}
            </p>
          ) : null}
        </CardContent>
      </Card>

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

      <footer className="flex items-center justify-between">
        <Button variant="outline" data-testid="scan-back" onClick={onBack}>
          {t("lab.common.back")}
        </Button>
        <Button data-testid="scan-next" disabled={!hasScanEvidence} onClick={onNext}>
          {t("lab.scan.next")}
        </Button>
      </footer>
    </div>
  )
}
