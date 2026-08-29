import { useSyncExternalStore } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT, type MessageKey } from "@/i18n"
import { useTNodes } from "@/i18n/nodes"
import {
  qrImageDataUrl,
  type DemoMaterialsResponse,
  type ScanActivity,
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
  lifetimeMinutesFor,
  scenarioMeta,
  type ExpiryProblem,
} from "@/routes/lab/content"
import type { HistoryEntry, ScenarioKey } from "@/routes/lab/types"
import { formatLocalDateTime } from "@/routes/lab/utils"

const expiryProblemKeys: Record<ExpiryProblem, MessageKey> = {
  past: "lab.generate.expiry.error.past",
  tooFar: "lab.generate.expiry.error.tooFar",
  invalid: "lab.generate.expiry.error.invalid",
}

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
  scenario: ScenarioKey
  scenarioLabel: string
  demo: DemoMaterialsResponse | null
  isGenerating: boolean
  generationError: string | null
  isVerifyingCurrent: boolean
  // The validity-window picker value (datetime-local); null keeps the
  // scenario's own window, which the picker shows so the operator sees what
  // will be sealed either way.
  expiresAt: string | null
  showKeyIssue: boolean
  isIssuingLabKey: boolean
  latestActivity: HistoryEntry | null
  scanActivity: ScanActivity | null
  scanActivityError: string | null
  result: VerifierDecision | null
  onGenerate: () => void
  onVerifyCurrent: () => void
  onIssueLabKey: () => void
  onExpiresAtChange: (value: string | null) => void
  onOpenFullscreen: () => void
  onBack: () => void
  onNext: () => void
}

// A numbered section: the step reads top to bottom as validity window ->
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

export default function GenerateStep({
  scenario,
  scenarioLabel,
  demo,
  isGenerating,
  generationError,
  isVerifyingCurrent,
  expiresAt,
  showKeyIssue,
  isIssuingLabKey,
  latestActivity,
  scanActivity,
  scanActivityError,
  result,
  onGenerate,
  onVerifyCurrent,
  onIssueLabKey,
  onExpiresAtChange,
  onOpenFullscreen,
  onBack,
  onNext,
}: GenerateStepProps) {
  const t = useT()
  const tNodes = useTNodes()

  const now = useSyncExternalStore(subscribeMinute, minuteNow, minuteNow)
  // The expired scenario seals a window that closed before the artifact
  // existed; there is nothing for the operator to pick, so the field is off
  // and its own pick can never be the reason the scan fails.
  const sealsExpired = scenarioMeta[scenario].expiresOffsetMinutes <= 0
  const expiryProblem = sealsExpired ? null : expiryValidation(expiresAt, now)
  // Same helper the request builder uses, so the hint cannot drift from what
  // is actually sealed: an expired scenario still wins over a custom pick.
  const lifetimeMinutes = lifetimeMinutesFor(
    scenarioMeta[scenario],
    customExpiryMinutes(expiresAt, now),
  )
  const pickedIso =
    expiresAt && !expiryProblem && lifetimeMinutes > 0
      ? new Date(Date.parse(expiresAt)).toISOString()
      : null
  const expiryInput = expiresAt ?? expiryInputValue(now + lifetimeMinutes * MINUTE_MS)

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

      <StepSection
        number="01"
        title={t("lab.generate.validity.title")}
        testId="generate-validity"
      >
        <p className="text-sm text-muted-foreground">
          {t("lab.generate.validity.description")}
        </p>
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
            disabled={sealsExpired}
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
            <p
              id="generate-expiry-help"
              data-testid="expiry-note"
              className="text-xs text-muted-foreground"
            >
              {sealsExpired
                ? t("lab.generate.expiry.expiredNote")
                : t("lab.generate.expiry.help")}
            </p>
          )}
        </div>
      </StepSection>

      <StepSection number="02" title={t("lab.generate.generate")} testId="generate-section">
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
                    {t("lab.qrModal.meta.envelope")}
                  </dt>
                  <dd data-testid="sealed-envelope" className="truncate text-foreground/90">
                    <code>{demo.envelope_id.slice(0, 16)}…</code>
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
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 tracking-[0.14em] text-muted-foreground uppercase">
                    {t("lab.generate.sealed.keyRef")}
                  </dt>
                  <dd data-testid="sealed-key-ref" className="truncate text-foreground/90">
                    <code>{demo.trust.key_ref}</code>
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 tracking-[0.14em] text-muted-foreground uppercase">
                    {t("lab.generate.sealed.keyState")}
                  </dt>
                  <dd data-testid="sealed-key-state" className="truncate text-foreground/90">
                    {t(`lab.generate.sealed.keyState.${demo.trust.key_state}` as MessageKey)}
                  </dd>
                </div>
                {demo.trust.retired_key_refs.length > 0 ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 tracking-[0.14em] text-muted-foreground uppercase">
                      {t("lab.generate.sealed.retiredKeys")}
                    </dt>
                    <dd data-testid="sealed-retired-keys" className="truncate text-foreground/90">
                      {t("lab.generate.sealed.retiredKeys.count", {
                        count: demo.trust.retired_key_refs.length,
                      })}
                    </dd>
                  </div>
                ) : null}
                <ScanFeedbackRows
                  activity={scanActivity}
                  error={scanActivityError}
                  issuerName={demo.verify_request.certificate.issuer_name}
                  verifiedDomains={demo.verify_request.issuer_state.verified_domains}
                />
              </dl>
              <div className="mt-3">
                <ScanFeedbackNote activity={scanActivity} error={scanActivityError} />
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
