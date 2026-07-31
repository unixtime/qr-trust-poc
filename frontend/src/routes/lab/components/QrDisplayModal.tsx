import { CircleAlert, Expand, QrCode } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { qrImageDataUrl } from "@/lib/verifier-client"
import type { QrDisplayModalProps } from "@/routes/lab/types"
import { cn } from "@/lib/utils"

function QrDisplayModal({
  demo,
  open,
  currentScenarioLabel,
  highContrast,
  showMetadata,
  error,
  frameRef,
  onClose,
  onToggleMetadata,
  onToggleHighContrast,
  onEnterFullscreen,
}: QrDisplayModalProps) {
  if (!open || !demo) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm">
      <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
        <div
          ref={frameRef}
          className={cn(
            "grid max-h-[95vh] w-full max-w-6xl gap-5 overflow-auto rounded-[2rem] border border-border/70 p-5 shadow-[0_28px_80px_rgba(0,0,0,0.28)] md:p-8 lg:grid-cols-[minmax(0,1fr)_320px]",
            highContrast ? "bg-white text-black" : "bg-card text-card-foreground",
          )}
        >
          <div className="grid content-start gap-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Fullscreen QR display
                </div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">
                  Use this as the display surface only. Scan it from a second device running the verifier workbench.
                </div>
              </div>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>

            <img
              src={qrImageDataUrl(demo.qr_png_base64)}
              alt="Fullscreen verifier QR"
              className={cn(
                "aspect-square w-full rounded-[2rem] border p-4 md:p-6",
                highContrast
                  ? "border-black bg-white shadow-none"
                  : "border-border/70 bg-white shadow-[0_20px_60px_rgba(0,0,0,0.08)]",
              )}
            />

            {showMetadata ? (
              <div className="grid gap-4 rounded-[1.4rem] border border-border/70 bg-background/80 p-5 md:grid-cols-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    Scenario
                  </div>
                  <div className="mt-2 text-lg font-medium text-foreground">
                    {currentScenarioLabel}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    Nonce
                  </div>
                  <div className="mt-2 break-all text-sm font-medium text-foreground">
                    {demo.verify_request.envelope.claims.nonce}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    Payload
                  </div>
                  <div className="mt-2 break-all text-sm font-medium text-foreground">
                    {demo.verify_request.envelope.claims.payload}
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid content-start gap-4">
            <Card className="border-border/70 bg-background/80 shadow-none">
              <CardHeader>
                <CardTitle className="text-base">Display controls</CardTitle>
                <CardDescription>
                  Reduce noise and push the QR container into fullscreen when the browser allows it.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Button variant="outline" onClick={onToggleMetadata}>
                  <QrCode data-icon="inline-start" />
                  {showMetadata ? "Hide metadata" : "Show metadata"}
                </Button>
                <Button variant="outline" onClick={onToggleHighContrast}>
                  <CircleAlert data-icon="inline-start" />
                  {highContrast ? "Disable high contrast" : "Enable high contrast"}
                </Button>
                <Button onClick={onEnterFullscreen}>
                  <Expand data-icon="inline-start" />
                  Enter fullscreen
                </Button>
                {error ? (
                  <Alert>
                    <CircleAlert />
                    <AlertTitle>Fullscreen request failed</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-background/80 shadow-none">
              <CardHeader>
                <CardTitle className="text-base">Second-screen rule</CardTitle>
                <CardDescription>
                  This overlay only displays the QR. The verifier still runs in the main workbench on the other device.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

export default QrDisplayModal
