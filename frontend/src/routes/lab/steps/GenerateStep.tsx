import { useSyncExternalStore } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Eyebrow } from "@/components/ui/eyebrow"
import { Input } from "@/components/ui/input"
import { usagePolicyLabelKeys, type NonceMode } from "@/domain/scenarios"
import { useT, type MessageKey } from "@/i18n"
import { useTNodes } from "@/i18n/nodes"
import { cn } from "@/lib/utils"
import {
  qrImageDataUrl,
  type DemoMaterialsResponse,
  type ScanActivity,
  type UsagePolicy,
  type VerifierDecision,
} from "@/lib/verifier-client"
import {
  ClaimExpiryRow,
  ScanFeedbackFrame,
  ScanFeedbackNote,
  ScanFeedbackRows,
} from "@/routes/lab/components/ScanFeedback"
import {
  MAX_LIFETIME_MINUTES,
  customExpiryMinutes,
  expiryInputValue,
  expiryValidation,
  type ExpiryProblem,
} from "@/routes/lab/content"
import type { HistoryEntry } from "@/routes/lab/types"
import { formatLocalDateTime } from "@/routes/lab/utils"

const nonceModeLabelKeys: Record<NonceMode, MessageKey> = {
  fixed: "lab.generate.nonce.fixed",
  timestamped: "lab.generate.nonce.timestamped",
}

const nonceModeHelpKeys: Record<NonceMode, MessageKey> = {
  fixed: "lab.generate.nonce.help.fixed",
  timestamped: "lab.generate.nonce.help.timestamped",
}

const nonceModeOrder: NonceMode[] = ["fixed", "timestamped"]

// The labels live in `usagePolicyLabelKeys` beside the wire values; this array
// only fixes the order the options appear in.
const usagePolicyOrder: UsagePolicy[] = [
  "reusable_public",
  "one_time",
  "time_limited",
]

const usagePolicyHelpKeys: Record<UsagePolicy, MessageKey> = {
  reusable_public: "lab.generate.usagePolicy.help.reusable_public",
  one_time: "lab.generate.usagePolicy.help.one_time",
  time_limited: "lab.generate.usagePolicy.help.time_limited",
}

const expiryProblemKeys: Record<ExpiryProblem, MessageKey> = {
  past: "lab.generate.expiry.error.past",
  tooFar: "lab.generate.expiry.error.tooFar",
  invalid: "lab.generate.expiry.error.invalid",
}

const DEFAULT_TIME_LIMITED_MINUTES = 60
const MINUTE_MS = 60_000

// The picker's bounds and default depend on "now", which render must not read
// directly (React purity). A minute-quantized external store gives every
// render a stable snapshot and re-renders once a minute while mounted.
function subscribeMinute(onChange: () => void) {
  const id = window.setInterval(onChange, MINUTE_MS)
  return () => window.clearInterval(id)
}

const minuteNow = () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS

type GenerateStepProps = {
  scenarioLabel: string
  demo: DemoMaterialsResponse | null
  isGenerating: boolean
  generationError: string | null
  isVerifyingCurrent: boolean
  nonceMode: NonceMode
  usagePolicy: UsagePolicy
  // The `time_limited` picker value (datetime-local); null means the policy
  // default, which the picker shows as a live "+60 minutes" so the operator
  // sees what will be sealed either way.
  expiresAt: string | null
  // Minutes the next generated QR will stay valid; non-positive means the
  // scenario seals an already-expired code. Computed by the caller from the
  // same helper that builds the request, so the hint cannot drift from it.
  lifetimeMinutes: number
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
  onExpiresAtChange: (value: string | null) => void
  onOpenFullscreen: () => void
  onBack: () => void
  onNext: () => void
}

// A numbered section: the step reads top to bottom as configure -> options ->
// generate, so a first-time operator never has to guess what to press first.
function StepSection({
  number,
  title,
  children,
  testId,
}: {
  number: string
  title: string
  children: React.ReactNode
  testId: string
}) {
  return (
    <section
      data-testid={testId}
      className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/2 p-4"
    >
      <h2 className="flex items-center gap-2.5 text-sm font-semibold">
        <span className="font-mono text-[11px] tracking-[0.16em] text-trust-green">
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

// One selectable option with its explanation always visible: the explanation
// is the point of the guided layout, so it is never hidden behind a hover.
function OptionCard({
  pressed,
  label,
  help,
  testId,
  onSelect,
}: {
  pressed: boolean
  label: string
  help: string
  testId: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      onClick={onSelect}
      className={cn(
        "w-full rounded-xl border p-3 text-left transition-colors",
        pressed
          ? "border-trust-green/40 bg-trust-green/8"
          : "border-white/8 bg-white/3 hover:border-white/20",
      )}
    >
      <span className={cn("block text-sm font-medium", pressed ? "text-trust-green" : "")}>
        {label}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{help}</span>
    </button>
  )
}

export default function GenerateStep({
  scenarioLabel,
  demo,
  isGenerating,
  generationError,
  isVerifyingCurrent,
  nonceMode,
  usagePolicy,
  expiresAt,
  lifetimeMinutes,
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
  onExpiresAtChange,
  onOpenFullscreen,
  onBack,
  onNext,
}: GenerateStepProps) {
  const t = useT()
  const tNodes = useTNodes()

  const timeLimited = usagePolicy === "time_limited"
  const now = useSyncExternalStore(subscribeMinute, minuteNow, minuteNow)
  const expiryProblem = timeLimited ? expiryValidation(expiresAt, now) : null
  const pickedMinutes = timeLimited && !expiryProblem ? customExpiryMinutes(expiresAt, now) : null
  // An expired scenario still wins over a custom pick, so the hint only
  // promises a custom expiry when the caller's lifetime is positive.
  const pickedIso =
    pickedMinutes !== null && expiresAt && lifetimeMinutes > 0
      ? new Date(Date.parse(expiresAt)).toISOString()
      : null
  const expiryInput = expiresAt ?? expiryInputValue(now + DEFAULT_TIME_LIMITED_MINUTES * MINUTE_MS)

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

      <StepSection number="01" title={t("lab.generate.configure")} testId="generate-configure">
        <fieldset className="flex flex-col gap-2">
          <Eyebrow as="legend" className="mb-1.5">
            {t("lab.generate.usagePolicyLegend")}
          </Eyebrow>
          {usagePolicyOrder.map((value) => (
            <OptionCard
              key={value}
              testId={`usage-${value}`}
              pressed={usagePolicy === value}
              label={t(usagePolicyLabelKeys[value])}
              help={t(usagePolicyHelpKeys[value])}
              onSelect={() => onUsagePolicyChange(value)}
            />
          ))}
        </fieldset>
        {timeLimited ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="generate-expiry" className="text-sm font-medium">
              {t("lab.generate.expiry.label")}
            </label>
            <Input
              id="generate-expiry"
              data-testid="expiry-input"
              className="[color-scheme:dark]"
              type="datetime-local"
              value={expiryInput}
              min={expiryInputValue(now + MINUTE_MS)}
              max={expiryInputValue(now + MAX_LIFETIME_MINUTES * MINUTE_MS)}
              aria-invalid={expiryProblem !== null}
              aria-describedby={expiryProblem ? "generate-expiry-error" : "generate-expiry-help"}
              onChange={(event) => onExpiresAtChange(event.target.value || null)}
            />
            {expiryProblem ? (
              <p
                id="generate-expiry-error"
                data-testid="expiry-error"
                role="alert"
                className="text-xs text-trust-red"
              >
                {t(expiryProblemKeys[expiryProblem], {
                  days: MAX_LIFETIME_MINUTES / (24 * 60),
                })}
              </p>
            ) : (
              <p id="generate-expiry-help" className="text-xs text-muted-foreground">
                {t("lab.generate.expiry.help")}
              </p>
            )}
          </div>
        ) : null}
      </StepSection>

      <StepSection number="02" title={t("lab.generate.options")} testId="generate-options">
        <fieldset className="flex flex-col gap-2">
          <Eyebrow as="legend" className="mb-1.5">
            {t("lab.generate.nonceMode")}
          </Eyebrow>
          {nonceModeOrder.map((value) => (
            <OptionCard
              key={value}
              testId={`nonce-${value}`}
              pressed={nonceMode === value}
              label={t(nonceModeLabelKeys[value])}
              help={t(nonceModeHelpKeys[value])}
              onSelect={() => onNonceModeChange(value)}
            />
          ))}
        </fieldset>
      </StepSection>

      <StepSection number="03" title={t("lab.generate.generate")} testId="generate-section">
        <p data-testid="generate-lifetime" className="text-xs text-muted-foreground">
          {pickedIso
            ? t("lab.generate.lifetime.until", { when: formatLocalDateTime(pickedIso) })
            : lifetimeMinutes > 0
              ? t("lab.generate.lifetime.fresh", { minutes: lifetimeMinutes })
              : t("lab.generate.lifetime.expired")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="generate-demo"
            disabled={isGenerating || expiryProblem !== null}
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
            <ScanFeedbackFrame
              className="p-3"
              activity={scanActivity}
              error={scanActivityError}
              usagePolicy={demo.verify_request.envelope.claims.usage_policy}
            >
              {/* Corner brackets follow the frame's text colour: sealed green
                  until a verdict, then the verdict tone. */}
              <span
                aria-hidden
                className="absolute top-0 left-0 size-[18px] border-t-2 border-l-2 border-current opacity-80"
              />
              <span
                aria-hidden
                className="absolute top-0 right-0 size-[18px] border-t-2 border-r-2 border-current opacity-80"
              />
              <span
                aria-hidden
                className="absolute bottom-0 left-0 size-[18px] border-b-2 border-l-2 border-current opacity-80"
              />
              <span
                aria-hidden
                className="absolute right-0 bottom-0 size-[18px] border-r-2 border-b-2 border-current opacity-80"
              />
              <img
                src={qrImageDataUrl(demo.qr_png_base64)}
                alt={t("lab.generate.qrAlt")}
                className="aspect-square w-full rounded-2xl bg-white p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_24px_48px_-20px_rgba(69,212,131,0.3)]"
              />
            </ScanFeedbackFrame>
            {/* Closed by default: the QR and its glow are the point of the
                card; the sealed claims are there for whoever wants them. */}
            <details data-testid="sealed-details" className="group">
              <summary className="cursor-pointer font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                {t("lab.generate.sealed.details")}
              </summary>
              <dl className="mt-3 flex flex-col gap-1.5 font-mono text-[11px]">
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
              <div className="mt-3">
                <ScanFeedbackNote
                  activity={scanActivity}
                  error={scanActivityError}
                  usagePolicy={demo.verify_request.envelope.claims.usage_policy}
                />
              </div>
            </details>
          </div>
        ) : null}
      </StepSection>

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
