import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { NonceMode } from "@/domain/scenarios"
import {
  qrImageDataUrl,
  type DemoMaterialsResponse,
  type UsagePolicy,
  type VerifierDecision,
} from "@/lib/verifier-client"
import type { HistoryEntry } from "@/routes/lab/types"

const nonceModes: Array<{ value: NonceMode; label: string }> = [
  { value: "fixed", label: "Fixed nonce" },
  { value: "timestamped", label: "Timestamped nonce" },
]

const usagePolicies: Array<{ value: UsagePolicy; label: string }> = [
  { value: "reusable_public", label: "Reusable public" },
  { value: "one_time", label: "One-time" },
  { value: "time_limited", label: "Time-limited" },
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
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold">Generate the demo QR</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Scenario:{" "}
          <span className="font-medium text-foreground">{scenarioLabel}</span>
        </p>
      </header>

      {showKeyIssue ? (
        <div className="rounded-md border border-border p-3">
          <p className="text-sm text-muted-foreground">
            The verifier requires an API key. Issue a local demo key first.
          </p>
          <Button
            data-testid="issue-lab-key"
            className="mt-2"
            variant="outline"
            disabled={isIssuingLabKey}
            onClick={onIssueLabKey}
          >
            {isIssuingLabKey ? "Issuing key..." : "Issue local lab key"}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          data-testid="generate-demo"
          disabled={isGenerating}
          onClick={onGenerate}
        >
          {isGenerating ? "Generating..." : "Generate demo QR"}
        </Button>
        <Button
          data-testid="verify-current"
          variant="outline"
          disabled={demo === null || isVerifyingCurrent}
          onClick={onVerifyCurrent}
        >
          {isVerifyingCurrent ? "Verifying..." : "Verify current QR"}
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
            alt="Generated verifier QR"
            className="aspect-square w-full max-w-72 rounded-lg border border-border bg-white p-4"
          />
          <Button
            data-testid="qr-fullscreen"
            variant="ghost"
            size="sm"
            onClick={onOpenFullscreen}
          >
            View full screen
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
          Verifier reason:{" "}
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
          Advanced options
        </summary>
        <div className="mt-3 flex flex-col gap-4">
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Nonce mode
            </legend>
            <div className="flex flex-wrap gap-2">
              {nonceModes.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`nonce-${value}`}
                  aria-pressed={nonceMode === value}
                  onClick={() => onNonceModeChange(value)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm transition-colors",
                    nonceMode === value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Usage policy
            </legend>
            <div className="flex flex-wrap gap-2">
              {usagePolicies.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`usage-${value}`}
                  aria-pressed={usagePolicy === value}
                  onClick={() => onUsagePolicyChange(value)}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm transition-colors",
                    usagePolicy === value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
      </details>

      <div className="flex justify-between border-t border-border pt-4">
        <Button variant="ghost" data-testid="generate-back" onClick={onBack}>
          Back
        </Button>
        <Button
          data-testid="generate-next"
          disabled={demo === null}
          onClick={onNext}
        >
          Next: Scan
        </Button>
      </div>
    </div>
  )
}
