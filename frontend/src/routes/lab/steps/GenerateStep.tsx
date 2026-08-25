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
  type ScanActivity,
  type UsagePolicy,
  type VerifierDecision,
} from "@/lib/verifier-client"
import {
  ClaimExpiryRow,
  ScanFeedbackNote,
  ScanFeedbackOverlay,
  ScanFeedbackRows,
} from "@/routes/lab/components/ScanFeedback"
import type { HistoryEntry } from "@/routes/lab/types"
import { formatLocalDateTime } from "@/routes/lab/utils"

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
  scanActivity: ScanActivity | null
  scanActivityError: string | null
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
  scanActivity,
  scanActivityError,
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
        <h1 className="aurora-text text-3xl font-bold tracking-tight">
          {t("lab.generate.title")}
        </h1>
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
        <div className="rounded-2xl border border-white/8 bg-white/3 p-3">
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
        <div className="glass-panel flex w-full max-w-sm flex-col gap-4 rounded-[20px] p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-full border border-trust-green/30 bg-trust-green/8 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.16em] text-trust-green uppercase">
              {t("lab.generate.sealed.badge")}
            </span>
            <Button
              data-testid="qr-fullscreen"
              variant="ghost"
              size="sm"
              onClick={onOpenFullscreen}
            >
              {t("lab.generate.fullscreen")}
            </Button>
          </div>
          <div className="relative p-3">
            <span
              aria-hidden
              className="absolute top-0 left-0 size-[18px] border-t-2 border-l-2 border-[rgba(69,212,131,0.8)]"
            />
            <span
              aria-hidden
              className="absolute top-0 right-0 size-[18px] border-t-2 border-r-2 border-[rgba(69,212,131,0.8)]"
            />
            <span
              aria-hidden
              className="absolute bottom-0 left-0 size-[18px] border-b-2 border-l-2 border-[rgba(69,212,131,0.8)]"
            />
            <span
              aria-hidden
              className="absolute right-0 bottom-0 size-[18px] border-r-2 border-b-2 border-[rgba(69,212,131,0.8)]"
            />
            <img
              src={qrImageDataUrl(demo.qr_png_base64)}
              alt={t("lab.generate.qrAlt")}
              className="aspect-square w-full rounded-2xl bg-white p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_24px_48px_-20px_rgba(69,212,131,0.3)]"
            />
            <ScanFeedbackOverlay
              activity={scanActivity}
              error={scanActivityError}
              usagePolicy={demo.verify_request.envelope.claims.usage_policy}
            />
          </div>
          <dl className="flex flex-col gap-1.5 font-mono text-[11px]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 tracking-[0.14em] text-muted-foreground uppercase">
                {t("lab.generate.sealed.nonce")}
              </dt>
              <dd className="truncate text-foreground/90">
                {demo.verify_request.envelope.claims.nonce}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 tracking-[0.14em] text-muted-foreground uppercase">
                {t("lab.generate.sealed.policy")}
              </dt>
              <dd className="truncate text-foreground/90">
                {t(
                  usagePolicyLabelKeys[
                    demo.verify_request.envelope.claims.usage_policy
                  ],
                )}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 tracking-[0.14em] text-muted-foreground uppercase">
                {t("lab.generate.sealed.issued")}
              </dt>
              <dd className="truncate text-foreground/90">
                {formatLocalDateTime(demo.verify_request.envelope.claims.issued_at)}
              </dd>
            </div>
            <ClaimExpiryRow expiresAt={demo.verify_request.envelope.claims.expires_at} />
            <ScanFeedbackRows
              activity={scanActivity}
              error={scanActivityError}
              usagePolicy={demo.verify_request.envelope.claims.usage_policy}
              issuerName={demo.verify_request.certificate.issuer_name}
              verifiedDomains={demo.verify_request.issuer_state.verified_domains}
            />
          </dl>
          <ScanFeedbackNote
            activity={scanActivity}
            error={scanActivityError}
            usagePolicy={demo.verify_request.envelope.claims.usage_policy}
          />
        </div>
      ) : null}

      {latestActivity ? (
        <div
          data-testid="latest-activity"
          className="rounded-2xl border border-white/8 bg-white/3 p-3 text-sm"
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
            className="rounded border border-white/10 bg-[rgba(5,10,18,0.45)] px-1.5 py-0.5 font-mono"
          >
            {result.reason}
          </code>
        </p>
      ) : null}

      <details className="rounded-2xl border border-white/8 bg-white/2 p-3">
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

      <div className="flex justify-between border-t border-transparent pt-4 [border-image:linear-gradient(90deg,transparent,rgba(69,212,131,0.35),transparent)_1]">
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
