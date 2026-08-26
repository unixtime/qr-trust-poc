import { useEffect, useState, type ReactNode } from "react"

import { useT, type MessageKey } from "@/i18n"
import type {
  ScanActivity,
  ScanActivityReplayState,
  ScanDestinationOutcome,
  UsagePolicy,
} from "@/lib/verifier-client"
import { cn } from "@/lib/utils"
import {
  scanFeedbackPresentation,
  scanFeedbackStateFor,
  scanPulseKey,
  type ScanFeedbackState,
  type ScanFeedbackTone,
} from "@/routes/lab/scan-feedback-state"
import { formatLocalClock } from "@/routes/lab/utils"

/**
 * Scan feedback for the demo QR, fed by `GET /verifier/scan-activity`.
 *
 * Every state here is grounded in what the verifier actually recorded: the
 * frame only glows and says "scanned" once a decision row for this nonce
 * exists, and when the evidence store cannot answer it says so instead of
 * implying "no scans yet". Before the first scan the code simply sits in its
 * frame — there is no "waiting" message, because nothing true has been
 * observed yet and a scan can come from any device. The one-time "Used" stamp comes from the live replay
 * guard, so it reflects the verifier's own view of the nonce, not a guess
 * from the scan count. Rows that need data the verifier does not have
 * (a destination outcome the scanner never reported, an issuer before a
 * green verdict) are omitted rather than filled in.
 */

export type ScanFeedbackProps = {
  activity: ScanActivity | null
  /** Last poll error, when the activity endpoint itself could not be reached. */
  error: string | null
  usagePolicy: UsagePolicy | null
  /**
   * Issuer the demo claims were signed for. Only shown once a scan came back
   * green — that is the moment the verifier actually vouched for it.
   */
  issuerName?: string | null
  verifiedDomains?: readonly string[]
}

/** States that put a pill on the image; see `scanFeedbackPresentation`. */
type PillState = Exclude<ScanFeedbackState, "waiting" | "checking">

const pillClassName: Record<PillState, string> = {
  offline: "border-trust-amber/40 bg-[rgba(5,10,18,0.82)] text-trust-amber",
  unavailable: "border-white/15 bg-[rgba(5,10,18,0.82)] text-muted-foreground",
  green: "border-trust-green/60 bg-[rgba(5,10,18,0.9)] text-trust-green",
  orange: "border-trust-amber/60 bg-[rgba(5,10,18,0.9)] text-trust-amber",
  red: "border-trust-red/60 bg-[rgba(5,10,18,0.9)] text-trust-red",
}

const dotClassName: Record<PillState, string> = {
  offline: "bg-trust-amber",
  unavailable: "bg-muted-foreground/60",
  green: "bg-trust-green shadow-[0_0_8px_rgba(69,212,131,0.9)]",
  orange: "bg-trust-amber",
  red: "bg-trust-red",
}

/**
 * Frame tint per verdict tone. Corner brackets use `currentColor`, so the
 * text colour recolours them; `--scan-glow` is the same colour as an RGB
 * triplet for the `scan-pulse` keyframes (see `index.css`). The glow itself
 * is not persistent: the pulse layer flares twice when a scan lands and then
 * leaves only the tint, so an old verdict does not keep a ring on the code.
 */
const frameToneClassName: Record<ScanFeedbackTone, string> = {
  green: "text-trust-green [--scan-glow:69_212_131]",
  amber: "text-trust-amber [--scan-glow:245_165_36]",
  red: "text-trust-red [--scan-glow:242_95_92]",
}

/** Two 900ms pulses: noticed before the pill fades in, gone before it is read. */
const pulseClassName =
  "pointer-events-none absolute inset-0 rounded-[1.6rem] motion-safe:animate-[scan-pulse_900ms_ease-out_2]"

const scannedKeys: Record<"green" | "orange" | "red", MessageKey> = {
  green: "lab.scanFeedback.scanned.green",
  orange: "lab.scanFeedback.scanned.orange",
  red: "lab.scanFeedback.scanned.red",
}

const verdictClassName: Record<"green" | "orange" | "red", string> = {
  green: "text-trust-green",
  orange: "text-trust-amber",
  red: "text-trust-red",
}

const platformKeys: Record<string, MessageKey> = {
  ios: "lab.scanFeedback.platform.ios",
  android: "lab.scanFeedback.platform.android",
  browser_lab: "lab.scanFeedback.platform.browser_lab",
}

const replayStateKeys: Record<
  Exclude<ScanActivityReplayState, "not_applicable">,
  MessageKey
> = {
  unused: "lab.scanFeedback.oneTime.unused",
  reserved: "lab.scanFeedback.oneTime.reserved",
  consumed: "lab.scanFeedback.oneTime.consumed",
}

const destinationKeys: Record<ScanDestinationOutcome, MessageKey> = {
  opened: "lab.scanFeedback.destination.opened",
  cancelled: "lab.scanFeedback.destination.cancelled",
  held: "lab.scanFeedback.destination.held",
  previewed: "lab.scanFeedback.destination.previewed",
  unreported: "lab.scanFeedback.destination.unreported",
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`
  return `${seconds}s`
}

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

function stateFor({ activity, error }: ScanFeedbackProps): ScanFeedbackState {
  return scanFeedbackStateFor(activity, error)
}

function isOneTimeConsumed({ activity, usagePolicy }: ScanFeedbackProps) {
  return (
    usagePolicy === "one_time" &&
    activity?.replay_guard.applies === true &&
    activity.replay_guard.state === "consumed"
  )
}

/**
 * Wraps the QR image (and any decoration such as corner brackets) and owns
 * everything the scan feedback draws on it. On a verdict the whole frame
 * glows in the verdict colour first and the message pill follows a beat
 * later, so the colour is what a viewer notices before they read anything.
 * The frame itself is `relative`; children are positioned against it.
 */
export function ScanFeedbackFrame({
  className,
  children,
  ...props
}: ScanFeedbackProps & { className?: string; children: ReactNode }) {
  const state = stateFor(props)
  const { tone } = scanFeedbackPresentation(state)
  const pulseKey = scanPulseKey(props.activity)
  return (
    <div
      data-testid="scan-feedback-frame"
      data-state={state}
      data-tone={tone ?? "none"}
      className={cn(
        "relative rounded-[1.6rem]",
        tone ? frameToneClassName[tone] : "text-trust-green",
        className,
      )}
    >
      {children}
      {tone && pulseKey ? (
        // Keyed per scan: a new scan remounts the layer and restarts the pulse.
        <span
          key={pulseKey}
          aria-hidden
          data-testid="scan-feedback-pulse"
          className={pulseClassName}
        />
      ) : null}
      <ScanFeedbackOverlay {...props} />
    </div>
  )
}

/**
 * Absolutely positioned inside `ScanFeedbackFrame`. The pill straddles the
 * image's bottom edge so it sits on the white quiet-zone padding and never
 * over the modules — feedback must not make the code harder to scan. The
 * "Used" stamp deliberately does cover the modules: a consumed one-time code
 * only ever verifies red again.
 */
function ScanFeedbackOverlay(props: ScanFeedbackProps) {
  const t = useT()
  const state = stateFor(props)
  const { pill } = scanFeedbackPresentation(state)
  const consumed = isOneTimeConsumed(props)
  const time = formatLocalClock(props.activity?.last_scanned_at)

  const label = (pillState: PillState) =>
    pillState === "green" || pillState === "orange" || pillState === "red"
      ? t(scannedKeys[pillState], { time: time ?? "" }).trim()
      : pillState === "unavailable"
        ? t("lab.scanFeedback.unavailable")
        : t("lab.scanFeedback.offline")

  return (
    <>
      {consumed ? (
        <div
          data-testid="scan-feedback-consumed"
          className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-2xl bg-[rgba(5,10,18,0.58)] backdrop-blur-[1.5px]"
        >
          <span className="-rotate-12 rounded-md border-2 border-trust-amber bg-[rgba(5,10,18,0.7)] px-4 py-1.5 font-mono text-lg font-semibold tracking-[0.3em] text-trust-amber uppercase shadow-[0_0_24px_rgba(0,0,0,0.6)]">
            {t("lab.scanFeedback.consumedStamp")}
          </span>
        </div>
      ) : null}
      {pill && state !== "waiting" && state !== "checking" ? (
        <div className="pointer-events-none absolute inset-x-3 bottom-1 flex justify-center">
          <span
            key={state}
            data-testid="scan-feedback-pill"
            data-state={state}
            role="status"
            aria-live="polite"
            className={cn(
              "flex max-w-full items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] tracking-[0.1em] uppercase backdrop-blur-md",
              "animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-500 [animation-delay:700ms]",
              pillClassName[state],
            )}
          >
            <span
              aria-hidden
              className={cn("size-1.5 shrink-0 rounded-full", dotClassName[state])}
            />
            <span className="truncate">{label(state)}</span>
          </span>
        </div>
      ) : null}
    </>
  )
}

function Row({
  label,
  value,
  testId,
  valueClassName,
}: {
  label: string
  value: string
  testId: string
  valueClassName?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd
        className={cn("truncate text-foreground/90", valueClassName)}
        data-testid={testId}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * Live "expires in / expired ago" row computed from the sealed claims'
 * `expires_at`. Client-side on purpose: the expiry is a signed fact in the
 * claims the QR carries, so counting down to it needs no verifier round
 * trip and is honest for every usage policy — the verifier rejects an
 * expired claim whatever the policy says.
 */
export function ClaimExpiryRow({ expiresAt }: { expiresAt: string }) {
  const t = useT()
  const now = useNow(1000)
  const expires = new Date(expiresAt).getTime()
  if (Number.isNaN(expires)) return null

  const remaining = expires - now
  const expired = remaining <= 0
  const value = expired
    ? t("lab.scanFeedback.expires.ago", { duration: formatDuration(-remaining) })
    : t("lab.scanFeedback.expires.in", { duration: formatDuration(remaining) })

  return (
    <Row
      label={t("lab.scanFeedback.rows.expires")}
      value={value}
      testId="scan-feedback-expires"
      valueClassName={
        expired ? "text-trust-red" : remaining < 60_000 ? "text-trust-amber" : undefined
      }
    />
  )
}

/**
 * `<dl>` rows for the sealed-QR card. Renders inside the caller's `<dl>`;
 * the markup mirrors the NONCE / POLICY / ISSUED rows above it.
 */
export function ScanFeedbackRows({
  activity,
  error,
  usagePolicy,
  issuerName,
  verifiedDomains,
}: ScanFeedbackProps) {
  const t = useT()

  if (!activity || activity.persistence_state !== "observable") {
    return (
      <Row
        label={t("lab.scanFeedback.rows.status")}
        value={
          activity
            ? t("lab.scanFeedback.value.unavailable")
            : error
              ? t("lab.scanFeedback.offline")
              : t("lab.scanFeedback.checking")
        }
        testId="scan-feedback-status"
      />
    )
  }

  const breakdown = [
    activity.green_count > 0
      ? t("lab.scanFeedback.count.verified", { count: activity.green_count })
      : null,
    activity.orange_count > 0
      ? t("lab.scanFeedback.count.review", { count: activity.orange_count })
      : null,
    activity.red_count > 0
      ? t("lab.scanFeedback.count.blocked", { count: activity.red_count })
      : null,
  ].filter((part): part is string => part !== null)
  const scans =
    activity.scan_count === 0
      ? t("lab.scanFeedback.value.none")
      : breakdown.length > 0
        ? `${activity.scan_count} · ${breakdown.join(" · ")}`
        : String(activity.scan_count)

  const latest = activity.latest
  const platform = latest?.client_platform ?? null
  const scanner = !latest
    ? "—"
    : platform && platformKeys[platform]
      ? t(platformKeys[platform])
      : platform && platform !== "unknown"
        ? platform
        : t("lab.scanFeedback.platform.unknown")

  // Same composition as the "observed decision" toast, so the card and the
  // toast never disagree about what the phone was told.
  const verdict = latest
    ? [
        latest.decision_state.replaceAll("_", " "),
        latest.risk_score === null
          ? null
          : t("lab.scanFeedback.verdict.risk", { score: latest.risk_score }),
        latest.hold_to_open_required ? t("lab.scanFeedback.verdict.hold") : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" · ")
    : null

  const destination = activity.destination_outcome
    ? t(destinationKeys[activity.destination_outcome])
    : null

  const vouchedBy =
    latest?.decision_color === "green" && issuerName
      ? [issuerName, verifiedDomains?.[0] ?? null]
          .filter((part): part is string => part !== null)
          .join(" · ")
      : null

  // Only meaningful once there is more than one scan to span.
  const firstScan =
    activity.scan_count > 1 ? formatLocalClock(activity.first_scanned_at) : null

  // Only from a real throttle block: the verifier omits it for one-time
  // codes and the card never guesses a budget.
  const throttle = activity.throttle
    ? t("lab.scanFeedback.throttle.value", {
        cached: activity.throttle.cached_verdicts,
        remaining: activity.throttle.nonce_budget_remaining,
        limit: activity.throttle.nonce_budget_limit,
        window:
          activity.throttle.nonce_budget_window_seconds === 60
            ? t("lab.scanFeedback.throttle.windowMinute")
            : t("lab.scanFeedback.throttle.windowSeconds", {
                seconds: activity.throttle.nonce_budget_window_seconds,
              }),
      })
    : null

  const guard = activity.replay_guard
  const guardExpiry = formatLocalClock(guard.expires_at)
  const usedAt = formatLocalClock(activity.first_verified_at)
  const oneTime =
    usagePolicy === "one_time" && guard.applies && guard.state !== "not_applicable"
      ? guard.state === "consumed" && usedAt
        ? activity.blocked_since_verified > 0
          ? t("lab.scanFeedback.oneTime.usedAtBlocked", {
              time: usedAt,
              count: activity.blocked_since_verified,
            })
          : t("lab.scanFeedback.oneTime.usedAt", { time: usedAt })
        : guardExpiry && guard.state !== "unused"
          ? t("lab.scanFeedback.oneTime.until", {
              state: t(replayStateKeys[guard.state]),
              time: guardExpiry,
            })
          : t(replayStateKeys[guard.state])
      : null

  return (
    <>
      <Row label={t("lab.scanFeedback.rows.scans")} value={scans} testId="scan-feedback-scans" />
      {firstScan ? (
        <Row
          label={t("lab.scanFeedback.rows.firstScan")}
          value={firstScan}
          testId="scan-feedback-first-scan"
        />
      ) : null}
      <Row
        label={t("lab.scanFeedback.rows.lastScan")}
        value={formatLocalClock(activity.last_scanned_at) ?? t("lab.scanFeedback.value.none")}
        testId="scan-feedback-last-scan"
      />
      <Row label={t("lab.scanFeedback.rows.scanner")} value={scanner} testId="scan-feedback-scanner" />
      {verdict && latest ? (
        <Row
          label={t("lab.scanFeedback.rows.verdict")}
          value={verdict}
          testId="scan-feedback-verdict"
          valueClassName={verdictClassName[latest.decision_color]}
        />
      ) : null}
      {destination ? (
        <Row
          label={t("lab.scanFeedback.rows.destination")}
          value={destination}
          testId="scan-feedback-destination"
        />
      ) : null}
      {vouchedBy ? (
        <Row
          label={t("lab.scanFeedback.rows.vouchedBy")}
          value={vouchedBy}
          testId="scan-feedback-vouched-by"
        />
      ) : null}
      {oneTime ? (
        <Row label={t("lab.scanFeedback.rows.oneTime")} value={oneTime} testId="scan-feedback-one-time" />
      ) : null}
      {throttle ? (
        <Row label={t("lab.scanFeedback.rows.throttle")} value={throttle} testId="scan-feedback-throttle" />
      ) : null}
    </>
  )
}

/** Plain-language reason when the rows above say "Unavailable"/"Offline". */
export function ScanFeedbackNote({ activity, error }: ScanFeedbackProps) {
  const t = useT()

  const note = activity
    ? activity.persistence_state === "unconfigured"
      ? t("lab.scanFeedback.note.unconfigured")
      : activity.persistence_state === "unavailable"
        ? t("lab.scanFeedback.note.unavailable", {
            error: activity.error ?? "",
          })
        : null
    : error
      ? t("lab.scanFeedback.note.offline", { error })
      : null

  if (!note) return null
  return (
    <p
      data-testid="scan-feedback-note"
      className="text-[11px] leading-relaxed text-muted-foreground"
    >
      {note}
    </p>
  )
}
