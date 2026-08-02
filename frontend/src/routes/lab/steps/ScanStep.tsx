import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScanWorkbenchSection } from "@/routes/lab/components/ScanWorkbenchSection"
import type { LabState } from "@/routes/lab/deriveFlowStep"

type ScanStepProps = {
  lab: LabState
  onBack: () => void
  onNext: () => void
}

export function ScanStep({ lab, onBack, onNext }: ScanStepProps) {
  const hasScanEvidence = lab.result !== null || lab.scannerDecision !== null

  return (
    <div className="flex flex-col gap-6" data-testid="scan-step">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">Scan</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a QR image, paste a decoded payload, or run the scanner
          pipeline directly against the QR from step 2. A live camera scan is
          available for second-screen demos.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Simulated scan</CardTitle>
          <CardDescription>
            Runs the full scanner decision against the current demo QR — no
            camera required.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <Button
            data-testid="check-scanner-decision"
            disabled={lab.demo === null || lab.isCheckingScannerDecision}
            onClick={() => void lab.checkScannerDecision()}
          >
            {lab.isCheckingScannerDecision
              ? "Checking scanner decision…"
              : "Check scanner decision"}
          </Button>
          {lab.demo === null ? (
            <p className="text-sm text-muted-foreground">
              Generate a QR in step 2 first.
            </p>
          ) : null}
          {lab.scannerDecisionError ? (
            <p className="text-sm text-(--trust-red)" role="alert">
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
          Back
        </Button>
        <Button data-testid="scan-next" disabled={!hasScanEvidence} onClick={onNext}>
          Next: Verdict &amp; evidence
        </Button>
      </footer>
    </div>
  )
}
