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
import { Eyebrow } from "@/components/ui/eyebrow"
import { useT } from "@/i18n"
import { qrImageDataUrl } from "@/lib/verifier-client"
import { ScanFeedbackOverlay } from "@/routes/lab/components/ScanFeedback"
import type { QrDisplayModalProps } from "@/routes/lab/types"
import { cn } from "@/lib/utils"

function QrDisplayModal({
  demo,
  scanActivity,
  scanActivityError,
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
  // Before the early return: a hook after a conditional `return` runs on some
  // renders and not others, which is the one thing the hook rules forbid.
  const t = useT()

  if (!open || !demo) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm">
      <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
        <div
          ref={frameRef}
          className={cn(
            "grid max-h-[95vh] w-full max-w-6xl gap-5 overflow-auto rounded-[2rem] border border-border/70 p-5 md:p-8 lg:grid-cols-[minmax(0,1fr)_320px]",
            highContrast ? "bg-white text-black" : "bg-card text-card-foreground",
          )}
        >
          <div className="grid content-start gap-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Eyebrow as="div">{t("lab.qrModal.eyebrow")}</Eyebrow>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">
                  {t("lab.qrModal.subtitle")}
                </div>
              </div>
              <Button variant="outline" onClick={onClose}>
                {t("lab.qrModal.close")}
              </Button>
            </div>

            <div className="relative p-3">
              <img
                src={qrImageDataUrl(demo.qr_png_base64)}
                alt={t("lab.qrModal.qrAlt")}
                className={cn(
                  "aspect-square w-full rounded-[2rem] border p-4 md:p-6",
                  highContrast
                    ? "border-black bg-white shadow-none"
                    : "border-border/70 bg-white",
                )}
              />
              <ScanFeedbackOverlay
                activity={scanActivity}
                error={scanActivityError}
                usagePolicy={demo.verify_request.envelope.claims.usage_policy}
              />
            </div>

            {showMetadata ? (
              <div className="grid gap-4 rounded-[1.4rem] border border-border/70 bg-background/80 p-5 md:grid-cols-3">
                <div>
                  <Eyebrow as="div">{t("lab.qrModal.meta.scenario")}</Eyebrow>
                  <div className="mt-2 text-lg font-medium text-foreground">
                    {currentScenarioLabel}
                  </div>
                </div>
                <div>
                  <Eyebrow as="div">{t("lab.qrModal.meta.nonce")}</Eyebrow>
                  <div className="mt-2 break-all text-sm font-medium text-foreground">
                    {demo.verify_request.envelope.claims.nonce}
                  </div>
                </div>
                <div>
                  <Eyebrow as="div">{t("lab.qrModal.meta.payload")}</Eyebrow>
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
                <CardTitle className="text-base">
                  {t("lab.qrModal.controls.title")}
                </CardTitle>
                <CardDescription>
                  {t("lab.qrModal.controls.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Button variant="outline" onClick={onToggleMetadata}>
                  <QrCode data-icon="inline-start" />
                  {showMetadata
                    ? t("lab.qrModal.controls.hideMetadata")
                    : t("lab.qrModal.controls.showMetadata")}
                </Button>
                <Button variant="outline" onClick={onToggleHighContrast}>
                  <CircleAlert data-icon="inline-start" />
                  {highContrast
                    ? t("lab.qrModal.controls.disableHighContrast")
                    : t("lab.qrModal.controls.enableHighContrast")}
                </Button>
                <Button onClick={onEnterFullscreen}>
                  <Expand data-icon="inline-start" />
                  {t("lab.qrModal.controls.enterFullscreen")}
                </Button>
                {error ? (
                  <Alert>
                    <CircleAlert />
                    <AlertTitle>{t("lab.qrModal.controls.failed")}</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-background/80 shadow-none">
              <CardHeader>
                <CardTitle className="text-base">
                  {t("lab.qrModal.secondScreen.title")}
                </CardTitle>
                <CardDescription>
                  {t("lab.qrModal.secondScreen.description")}
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
