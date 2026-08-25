import { useEffect, useState } from "react"

import { useT, type MessageKey } from "@/i18n"
import type {
  ScanActivity,
  ScanActivityReplayState,
  ScanDestinationOutcome,
  UsagePolicy,
} from "@/lib/verifier-client"
import { cn } from "@/lib/utils"

/**
 * Phone-scan feedback for the demo QR, fed by `GET /verifier/scan-activity`.
 *
 * Every state here is grounded in what the verifier actually recorded: the
 * pill only says "scanned" once a decision row for this nonce exists, and
 * when the evidence store cannot answer it says so instead of implying
 * "no scans yet". The one-time "Used" stamp comes from the live replay
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

type PillState =
  | "checking"
  | "offline"
  | "unavailable"
  | "waiting"
  | "green"
  | "orange"
  | "red"

const pillClassName: Record<PillState, string> = {
  checking: "border-white/15 bg-[rgba(5,10,18,0.82)] text-muted-foreground",
  offline: "border-trust-amber/40 bg-[rgba(5,10,18,0.82)] text-trust-amber",
  unavailable: "border-white/15 bg-[rgba(5,10,18,0.82)] text-muted-foreground",
  waiting: "border-white/20 bg-[rgba(5,10,18,0.82)] text-foreground/80",
  green: "border-trust-green/60 bg-[rgba(5,10,18,0.9)] text-trust-green",
  orange: "border-trust-amber/60 bg-[rgba(5,10,18,0.9)] text-trust-amber",
  red: "border-trust-red/60 bg-[rgba(5,10,18,0.9)] text-trust-red",
}

const dotClassName: Record<PillState, string> = {
  checking: "bg-muted-foreground/60",
  offline: "bg-trust-amber",
  unavailable: "bg-muted-foreground/60",
  waiting: "bg-foreground/70 animate-pulse",
  green: "bg-trust-green shadow-[0_0_8px_rgba(69,212,131,0.9)]",
  orange: "bg-trust-amber",
  red: "bg-trust-red",
}

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

function formatScanClock(iso: string | null | undefined) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  // 24-hour clock so it reads alongside the ISSUED row (`HH:MM:SS`) rather
  // than as a second, differently formatted time base on the same card.
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
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

function pillStateFor({ activity, error }: ScanFeedbackProps): PillState {
  if (!activity) return error ? "offline" : "checking"
  if (activity.persistence_state !== "observable") return "unavailable"
  if (activity.scan_count === 0 || !activity.latest) return "waiting"
  return activity.latest.decision_color
}

function isOneTimeConsumed({ activity, usagePolicy }: ScanFeedbackProps) {
  return (
    usagePolicy === "one_time" &&
    activity?.replay_guard.applies === true &&
    activity.replay_guard.state === "consumed"
  )
}

/**
 * Absolutely positioned; the parent must be `relative`. The pill straddles
 * the image's bottom edge so it sits on the white quiet-zone padding and
 * never over the modules — a "waiting" pill must not make the code harder
 * to scan. The "Used" stamp deliberately does cover the modules: a consumed
 * one-time code only ever verifies red again.
 */
export function ScanFeedbackOverlay(props: ScanFeedbackProps) {
  const t = useT()
  const state = pillStateFor(props)
  const consumed = isOneTimeConsumed(props)
  const time = formatScanClock(props.activity?.last_scanned_at)

  const label =
    state === "green" || state === "orange" || state === "red"
      ? t(scannedKeys[state], { time: time ?? "" }).trim()
      : state === "waiting"
        ? t("lab.scanFeedback.waiting")
        : state === "unavailable"
          ? t("lab.scanFeedback.unavailable")
          : state === "offline"
            ? t("lab.scanFeedback.offline")
            : t("lab.scanFeedback.checking")

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
      <div className="pointer-events-none absolute inset-x-3 bottom-1 flex justify-center">
        <span
          data-testid="scan-feedback-pill"
          data-state={state}
          role="status"
          aria-live="polite"
          className={cn(
            "flex max-w-full items-center gap-2 rounded-full border px-3 py-1 font-mono text-[11px] tracking-[0.1em] uppercase backdrop-blur-md",
            pillClassName[state],
          )}
        >
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 rounded-full", dotClassName[state])}
          />
          <span className="truncate">{label}</span>
        </span>
      </div>
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
    activity.scan_count > 1 ? formatScanClock(activity.first_scanned_at) : null

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
  const guardExpiry = formatScanClock(guard.expires_at)
  const usedAt = formatScanClock(activity.first_verified_at)
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
        value={formatScanClock(activity.last_scanned_at) ?? t("lab.scanFeedback.value.none")}
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
