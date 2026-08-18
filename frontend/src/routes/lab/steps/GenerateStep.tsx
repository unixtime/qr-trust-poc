import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ConsoleChip } from "@/components/ui/console-chip"
import { Eyebrow } from "@/components/ui/eyebrow"
import { usagePolicyLabelKeys, type NonceMode } from "@/domain/scenarios"
import { useT, type MessageKey } from "@/i18n"
import { useTNodes } from "@/i18n/nodes"
import {
  qrImageDataUrl,
  type DemoMaterialsResponse,
  type UsagePolicy,
  type VerifierDecision,
} from "@/lib/verifier-client"
import type { HistoryEntry } from "@/routes/lab/types"

const nonceModeLabelKeys: Record<NonceMode, MessageKey> = {
  fixed: "lab.generate.nonce.fixed",
  timestamped: "lab.generate.nonce.timestamped",
}

const nonceModeOrder: NonceMode[] = ["fixed", "timestamped"]

// The labels live in `usagePolicyLabelKeys` beside the wire values; this array
// only fixes the order the chips appear in.
const usagePolicyOrder: UsagePolicy[] = [
  "reusable_public",
  "one_time",
  "time_limited",
]

type GenerateStepProps = {
  scenarioLabel: string
  demo: DemoMaterialsResponse | null
  isGenerating: boolean
  generationError: string | null
  isVerifyingCurrent: boolean
  nonceMode: NonceMode
  usagePolicy: UsagePolicy
  showKeyIssue: boolean
  isIssuingLabKey: boolean
  latestActivity: HistoryEntry | null
  result: VerifierDecision | null
  onGenerate: () => void
  onVerifyCurrent: () => void
  onIssueLabKey: () => void
  onNonceModeChange: (mode: NonceMode) => void
  onUsagePolicyChange: (policy: UsagePolicy) => void
  onOpenFullscreen: () => void
  onBack: () => void
  onNext: () => void
}

export default function GenerateStep({
  scenarioLabel,
  demo,
  isGenerating,
  generationError,
  isVerifyingCurrent,
  nonceMode,
  usagePolicy,
  showKeyIssue,
  isIssuingLabKey,
  latestActivity,
  result,
  onGenerate,
  onVerifyCurrent,
  onIssueLabKey,
  onNonceModeChange,
  onUsagePolicyChange,
  onOpenFullscreen,
  onBack,
  onNext,
}: GenerateStepProps) {
  const t = useT()
  const tNodes = useTNodes()

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold">{t("lab.generate.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tNodes("lab.generate.scenarioLine", {
            scenario: (
              <span className="font-medium text-foreground">
                {scenarioLabel}
              </span>
            ),
          })}
        </p>
      </header>

      {showKeyIssue ? (
        <div className="rounded-md border border-border p-3">
          <p className="text-sm text-muted-foreground">
            {t("lab.generate.keyRequired")}
          </p>
          <Button
            data-testid="issue-lab-key"
            className="mt-2"
            variant="outline"
            disabled={isIssuingLabKey}
            onClick={onIssueLabKey}
          >
            {isIssuingLabKey
              ? t("lab.generate.issuingKey")
              : t("lab.generate.issueKey")}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="generate-demo"
          disabled={isGenerating}
          onClick={onGenerate}
        >
          {isGenerating
            ? t("lab.generate.generating")
            : t("lab.generate.generate")}
        </Button>
        <Button
          data-testid="verify-current"
          variant="outline"
          disabled={demo === null || isVerifyingCurrent}
          onClick={onVerifyCurrent}
        >
          {isVerifyingCurrent
            ? t("lab.generate.verifying")
            : t("lab.generate.verifyCurrent")}
        </Button>
      </div>

      {generationError ? (
        <Alert variant="destructive">
          <AlertDescription>{generationError}</AlertDescription>
        </Alert>
      ) : null}

      {demo ? (
        <div className="flex flex-col items-start gap-2">
          <img
            src={qrImageDataUrl(demo.qr_png_base64)}
            alt={t("lab.generate.qrAlt")}
            className="aspect-square w-full max-w-72 rounded-lg border border-border bg-white p-4"
          />
          <Button
            data-testid="qr-fullscreen"
            variant="ghost"
            size="sm"
            onClick={onOpenFullscreen}
          >
            {t("lab.generate.fullscreen")}
          </Button>
        </div>
      ) : null}

      {latestActivity ? (
        <div
          data-testid="latest-activity"
          className="rounded-md border border-border bg-muted/40 p-3 text-sm"
        >
          <p className="font-medium">{latestActivity.title}</p>
          <p className="mt-0.5 text-muted-foreground">{latestActivity.body}</p>
        </div>
      ) : null}

      {result ? (
        <p className="text-xs text-muted-foreground">
          {t("lab.generate.verifierReason")}{" "}
          <code
            data-testid="verifier-reason"
            className="rounded bg-muted px-1 py-0.5"
          >
            {result.reason}
          </code>
        </p>
      ) : null}

      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
          {t("lab.generate.advanced")}
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <fieldset>
            <Eyebrow as="legend" className="mb-1.5">
              {t("lab.generate.nonceMode")}
            </Eyebrow>
            <div className="flex flex-wrap gap-2">
              {nonceModeOrder.map((value) => (
                <ConsoleChip
                  key={value}
                  data-testid={`nonce-${value}`}
                  pressed={nonceMode === value}
                  aria-pressed={nonceMode === value}
                  onClick={() => onNonceModeChange(value)}
                >
                  {t(nonceModeLabelKeys[value])}
                </ConsoleChip>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <Eyebrow as="legend" className="mb-1.5">
              {t("lab.generate.usagePolicyLegend")}
            </Eyebrow>
            <div className="flex flex-wrap gap-2">
              {usagePolicyOrder.map((value) => (
                <ConsoleChip
                  key={value}
                  data-testid={`usage-${value}`}
                  pressed={usagePolicy === value}
                  aria-pressed={usagePolicy === value}
                  onClick={() => onUsagePolicyChange(value)}
                >
                  {t(usagePolicyLabelKeys[value])}
                </ConsoleChip>
              ))}
            </div>
          </fieldset>
        </div>
      </details>

      <div className="flex justify-between border-t border-border pt-4">
        <Button variant="ghost" data-testid="generate-back" onClick={onBack}>
          {t("lab.common.back")}
        </Button>
        <Button
          data-testid="generate-next"
          disabled={demo === null}
          onClick={onNext}
        >
          {t("lab.generate.next")}
        </Button>
      </div>
    </div>
  )
}
