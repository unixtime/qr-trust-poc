import { useState } from "react"
import { Activity, Radar, RefreshCw, ScanLine } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useLocale, useT, type Locale, type MessageKey } from "@/i18n"
import type {
  NetworkOutboxOperatorStatus,
  RuntimeSafetyObservationOperatorStatus,
  ScannerDecisionOperatorStatus,
  VerifierStatus,
} from "@/lib/verifier-client"
import StatusBanner from "@/routes/operator/components/StatusBanner"
import RuntimeMetric from "@/routes/operator/components/RuntimeMetric"
import type { MessageState } from "@/routes/operator/types"

// A single module-level `Intl.DateTimeFormat` would bind its locale once at
// import and keep it for the life of the tab, so a language switch would leave
// English month names beside Spanish labels. Formatters are built per locale
// and cached instead — construction is the expensive part, not the lookup.
const timestampFormatters = new Map<Locale, Intl.DateTimeFormat>()

function timestampFormatter(locale: Locale) {
  const cached = timestampFormatters.get(locale)
  if (cached) return cached

  const formatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  timestampFormatters.set(locale, formatter)
  return formatter
}

// The status itself is a wire value, but this table is display copy authored
// here — so the badge text goes through the catalog while `className` does not.
const OPERATOR_STATUS_COPY = {
  healthy: {
    labelKey: "operator.runtime.status.healthy",
    className: "border-trust-green/40 bg-trust-green/10 text-trust-green",
  },
  degraded: {
    labelKey: "operator.runtime.status.degraded",
    className: "border-trust-amber/40 bg-trust-amber/10 text-trust-amber",
  },
  blocked: {
    labelKey: "operator.runtime.status.blocked",
    className: "border-trust-red/40 bg-trust-red/10 text-trust-red",
  },
  unavailable: {
    labelKey: "operator.runtime.status.unavailable",
    className: "border-border bg-muted text-muted-foreground",
  },
} as const satisfies Record<string, { labelKey: MessageKey; className: string }>

type RuntimePostureSectionProps = {
  runtimeStatus: VerifierStatus | null
  statusMessage: MessageState | null
  isLoadingStatus: boolean
  apiKeyHeader: string
  adminHeader: string
  onRefresh: () => void
}

type RuntimeObservationStatus = VerifierStatus["runtime_observations"]["status"]
type ScannerDecisionStatus = VerifierStatus["scanner_decisions"]["status"]
type OperatorEvidenceTab = "scanner" | "runtime"

type OperatorActionTone = "amber" | "green" | "red" | "stone"

// The note factories below run at module scope, where `t()` would freeze the
// locale at import time. They return keys and let `OperatorActionNote`
// translate at render. `command` is the exception: it holds a shell invocation
// an operator copies verbatim, so it stays a literal string.
type OperatorActionNoteProps = {
  eyebrowKey: MessageKey
  titleKey: MessageKey
  bodyKey: MessageKey
  command?: string
  actionKey?: MessageKey
  tone?: OperatorActionTone
}

const RUNTIME_OBSERVATION_INTERPRETATION: Record<RuntimeObservationStatus, MessageKey> = {
  healthy: "operator.runtime.interpretation.healthy",
  degraded: "operator.runtime.interpretation.degraded",
  blocked: "operator.runtime.interpretation.blocked",
  unavailable: "operator.runtime.interpretation.unavailable",
}

function compactCount(value: boolean): MessageKey {
  return value ? "operator.value.enabled" : "operator.value.disabled"
}

// Returns `null` when there is no lag at all, so the caller supplies the
// translated word rather than this formatter mixing prose with a duration.
function formatLag(milliseconds: number) {
  if (milliseconds <= 0) return null
  if (milliseconds < 1000) return `${milliseconds}ms`
  return `${Math.round(milliseconds / 1000)}s`
}

function formatReasonLabel(value: string) {
  return value.replaceAll("_", " ")
}

function formatWindow(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds / 3600)}h`
}

function formatTimestamp(value: string, locale: Locale) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return timestampFormatter(locale).format(date)
}

function hostVerdictClassName(verdict: string) {
  if (verdict === "blocked") return "border-trust-red/40 bg-trust-red/10 text-trust-red"
  if (verdict === "risky") return "border-trust-amber/40 bg-trust-amber/10 text-trust-amber"
  if (verdict === "unavailable") return "border-border bg-muted text-muted-foreground"
  return "border-trust-green/40 bg-trust-green/10 text-trust-green"
}

function decisionColorClassName(color: string) {
  if (color === "red") return "border-trust-red/40 bg-trust-red/10 text-trust-red"
  if (color === "orange") return "border-trust-amber/40 bg-trust-amber/10 text-trust-amber"
  return "border-trust-green/40 bg-trust-green/10 text-trust-green"
}

function evidenceTabClassName(isActive: boolean) {
  return [
    "min-w-0 rounded-2xl border p-3 text-left transition",
    isActive
      ? "border-(--border-accent) bg-card shadow-(--glow)"
      : "border-white/8 bg-white/3 hover:border-primary/40 hover:bg-white/6",
  ].join(" ")
}

function observationPanelClassName(status: RuntimeObservationStatus) {
  if (status === "blocked") return "border-trust-red/30 bg-trust-red/10 text-foreground"
  if (status === "degraded") return "border-trust-amber/30 bg-trust-amber/10 text-foreground"
  if (status === "unavailable") return "border-border/70 bg-muted/40 text-foreground"
  return "border-trust-green/30 bg-trust-green/10 text-foreground"
}

const OPERATOR_ACTION_TONE_CLASS: Record<
  OperatorActionTone,
  { box: string; eyebrow: string; chip: string }
> = {
  amber: {
    box: "border-trust-amber/30 bg-trust-amber/10 text-foreground",
    eyebrow: "text-trust-amber",
    chip: "border-trust-amber/40 bg-trust-amber/20 text-trust-amber",
  },
  green: {
    box: "border-trust-green/30 bg-trust-green/10 text-foreground",
    eyebrow: "text-trust-green",
    chip: "border-trust-green/40 bg-trust-green/20 text-trust-green",
  },
  red: {
    box: "border-trust-red/30 bg-trust-red/10 text-foreground",
    eyebrow: "text-trust-red",
    chip: "border-trust-red/40 bg-trust-red/20 text-trust-red",
  },
  stone: {
    box: "border-border/70 bg-muted/40 text-foreground",
    eyebrow: "text-muted-foreground",
    chip: "border-border bg-muted text-muted-foreground",
  },
}

function OperatorActionNote({
  eyebrowKey,
  titleKey,
  bodyKey,
  command,
  actionKey,
  tone = "amber",
}: OperatorActionNoteProps) {
  const t = useT()
  const toneClass = OPERATOR_ACTION_TONE_CLASS[tone]

  return (
    <div className={`mt-4 rounded-2xl border p-3 ${toneClass.box}`}>
      <div
        className={`font-mono text-[11px] font-semibold uppercase tracking-[0.16em] ${toneClass.eyebrow}`}
      >
        {t(eyebrowKey)}
      </div>
      <p className="mt-2 text-sm font-semibold">{t(titleKey)}</p>
      <p className="mt-1 text-xs leading-5 opacity-80">{t(bodyKey)}</p>
      {command || actionKey ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {command ? (
            <span
              className={`max-w-full rounded-[0.8rem] border px-3 py-1 font-mono text-[11px] break-all ${toneClass.chip}`}
            >
              {command}
            </span>
          ) : null}
          {actionKey ? (
            <span
              className={`rounded-full border px-3 py-1 text-[11px] font-medium ${toneClass.chip}`}
            >
              {t(actionKey)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function scannerDecisionPanelClassName(status: ScannerDecisionStatus) {
  if (status === "blocked") return "border-trust-red/30 bg-trust-red/10 text-foreground"
  if (status === "degraded") return "border-trust-amber/30 bg-trust-amber/10 text-foreground"
  if (status === "unavailable") return "border-border/70 bg-muted/40 text-foreground"
  return "border-trust-green/30 bg-trust-green/10 text-foreground"
}

function hasReason(reasons: string[], reason: string) {
  return reasons.includes(reason)
}

function networkOutboxActionNote(
  outbox: NetworkOutboxOperatorStatus,
): OperatorActionNoteProps | null {
  const metrics = outbox.metrics

  if (outbox.status === "unavailable") {
    return {
      eyebrowKey: "operator.runtime.note.outboxUnavailable.eyebrow",
      titleKey: "operator.runtime.note.outboxUnavailable.title",
      bodyKey: "operator.runtime.note.outboxUnavailable.body",
      actionKey: "operator.runtime.note.outboxUnavailable.action",
      tone: "stone",
    }
  }

  if (
    hasReason(outbox.reasons, "quarantined_rows") ||
    (metrics?.quarantined_count ?? 0) > 0
  ) {
    return {
      eyebrowKey: "operator.runtime.note.outboxQuarantined.eyebrow",
      titleKey: "operator.runtime.note.outboxQuarantined.title",
      bodyKey: "operator.runtime.note.outboxQuarantined.body",
      command:
        "./backend/.venv/bin/python backend/scripts/qrtrustctl.py --base-url https://127.0.0.1:8444 --admin-token local-lab-admin --insecure-tls outbox-status",
      tone: "red",
    }
  }

  if (hasReason(outbox.reasons, "failed_rows") || (metrics?.failed_count ?? 0) > 0) {
    return {
      eyebrowKey: "operator.runtime.note.outboxFailed.eyebrow",
      titleKey: "operator.runtime.note.outboxFailed.title",
      bodyKey: "operator.runtime.note.outboxFailed.body",
      command: "make check-network-worker-drill",
      tone: "red",
    }
  }

  if (
    hasReason(outbox.reasons, "pending_lag") ||
    ((metrics?.pending_count ?? 0) > 0 && (metrics?.published_count ?? 0) === 0)
  ) {
    return {
      eyebrowKey: "operator.runtime.note.outboxPending.eyebrow",
      titleKey: "operator.runtime.note.outboxPending.title",
      bodyKey: "operator.runtime.note.outboxPending.body",
      command: "make up-https-admin-shared-infra-nats",
      actionKey: "operator.runtime.note.outboxPending.action",
      tone: "amber",
    }
  }

  if (outbox.status === "healthy") {
    return {
      eyebrowKey: "operator.runtime.note.outboxReady.eyebrow",
      titleKey: "operator.runtime.note.outboxReady.title",
      bodyKey: "operator.runtime.note.outboxReady.body",
      actionKey: "operator.runtime.note.outboxReady.action",
      tone: "green",
    }
  }

  return null
}

function scannerDecisionActionNote(
  decisions: ScannerDecisionOperatorStatus,
): OperatorActionNoteProps | null {
  const report = decisions.report

  if (decisions.status === "unavailable") {
    return {
      eyebrowKey: "operator.runtime.note.decisionsUnavailable.eyebrow",
      titleKey: "operator.runtime.note.decisionsUnavailable.title",
      bodyKey: "operator.runtime.note.decisionsUnavailable.body",
      actionKey: "operator.runtime.note.decisionsUnavailable.action",
      tone: "stone",
    }
  }

  if (hasReason(decisions.reasons, "no_scanner_decisions") || report?.total_count === 0) {
    return {
      eyebrowKey: "operator.runtime.note.decisionsEmpty.eyebrow",
      titleKey: "operator.runtime.note.decisionsEmpty.title",
      bodyKey: "operator.runtime.note.decisionsEmpty.body",
      actionKey: "operator.runtime.note.decisionsEmpty.action",
      tone: "amber",
    }
  }

  if (decisions.status === "healthy") {
    return {
      eyebrowKey: "operator.runtime.note.decisionsReady.eyebrow",
      titleKey: "operator.runtime.note.decisionsReady.title",
      bodyKey: "operator.runtime.note.decisionsReady.body",
      actionKey: "operator.runtime.note.decisionsReady.action",
      tone: "green",
    }
  }

  return null
}

function runtimeObservationActionNote(
  observations: RuntimeSafetyObservationOperatorStatus,
): OperatorActionNoteProps | null {
  const report = observations.report

  if (observations.status === "unavailable") {
    return {
      eyebrowKey: "operator.runtime.note.observationsUnavailable.eyebrow",
      titleKey: "operator.runtime.note.observationsUnavailable.title",
      bodyKey: "operator.runtime.note.observationsUnavailable.body",
      actionKey: "operator.runtime.note.observationsUnavailable.action",
      tone: "stone",
    }
  }

  if (hasReason(observations.reasons, "no_runtime_observations") || report?.total_count === 0) {
    return {
      eyebrowKey: "operator.runtime.note.observationsEmpty.eyebrow",
      titleKey: "operator.runtime.note.observationsEmpty.title",
      bodyKey: "operator.runtime.note.observationsEmpty.body",
      actionKey: "operator.runtime.note.observationsEmpty.action",
      tone: "amber",
    }
  }

  if (observations.status === "blocked") {
    return {
      eyebrowKey: "operator.runtime.note.observationsBlocked.eyebrow",
      titleKey: "operator.runtime.note.observationsBlocked.title",
      bodyKey: "operator.runtime.note.observationsBlocked.body",
      actionKey: "operator.runtime.note.observationsBlocked.action",
      tone: "red",
    }
  }

  if (observations.status === "healthy") {
    return {
      eyebrowKey: "operator.runtime.note.observationsReady.eyebrow",
      titleKey: "operator.runtime.note.observationsReady.title",
      bodyKey: "operator.runtime.note.observationsReady.body",
      actionKey: "operator.runtime.note.observationsReady.action",
      tone: "green",
    }
  }

  return null
}

function NetworkOutboxPanel({ runtimeStatus }: { runtimeStatus: VerifierStatus | null }) {
  // Hooks come before the loading guard — React requires the same hook order
  // on every render, and the guard must not skip them.
  const t = useT()
  const outbox = runtimeStatus?.network_outbox

  if (!runtimeStatus || !outbox) {
    return (
      <div className="min-w-0 rounded-2xl border border-white/8 bg-white/3 p-4">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {t("operator.runtime.outbox.eyebrow")}
        </div>
        <p className="mt-2 text-sm font-medium text-foreground">
          {t("operator.runtime.outbox.loading")}
        </p>
      </div>
    )
  }

  const statusCopy = OPERATOR_STATUS_COPY[outbox.status]
  const metrics = outbox.metrics
  const actionNote = networkOutboxActionNote(outbox)

  return (
    <div className="min-w-0 rounded-2xl border border-white/8 bg-white/3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t("operator.runtime.outbox.eyebrow")}
          </div>
          <h3 className="mt-2 text-base font-semibold text-foreground">
            {t("operator.runtime.outbox.title")}
          </h3>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${statusCopy.className}`}
        >
          {t(statusCopy.labelKey)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{outbox.summary}</p>
      {actionNote ? <OperatorActionNote {...actionNote} /> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        <RuntimeMetric
          label={t("operator.runtime.metric.supervisor")}
          value={outbox.supervisor_state.replaceAll("_", " ")}
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.networkDb")}
          value={
            outbox.database_dsn_label ??
            t(
              outbox.database_configured
                ? "operator.value.configured"
                : "operator.value.notConfigured",
            )
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.pending")}
          value={
            metrics
              ? String(metrics.pending_count)
              : t("operator.value.unavailable")
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.published")}
          value={
            metrics
              ? String(metrics.published_count)
              : t("operator.value.unavailable")
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.failed")}
          value={
            metrics ? String(metrics.failed_count) : t("operator.value.unavailable")
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.quarantined")}
          value={
            metrics
              ? String(metrics.quarantined_count)
              : t("operator.value.unavailable")
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.oldestLag")}
          value={
            metrics
              ? (formatLag(metrics.oldest_pending_age_ms) ??
                t("operator.value.none"))
              : t("operator.value.unavailable")
          }
        />
      </div>
      {outbox.reasons.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {outbox.reasons.map((reason) => (
            <span
              key={reason}
              className="rounded-full border border-white/8 bg-white/3 px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              {formatReasonLabel(reason)}
            </span>
          ))}
        </div>
      ) : null}
      {outbox.error ? (
        <p className="mt-3 rounded-2xl border border-white/10 bg-[rgba(5,10,18,0.35)] p-3 text-xs leading-5 text-muted-foreground">
          {outbox.error}
        </p>
      ) : null}
    </div>
  )
}

function ScannerDecisionsPanel({ runtimeStatus }: { runtimeStatus: VerifierStatus | null }) {
  const t = useT()
  const locale = useLocale()
  const decisions = runtimeStatus?.scanner_decisions

  if (!runtimeStatus || !decisions) {
    return (
      <div className="min-w-0 rounded-2xl border border-white/8 bg-white/3 p-4">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {t("operator.runtime.decisions.eyebrow")}
        </div>
        <p className="mt-2 text-sm font-medium text-foreground">
          {t("operator.runtime.decisions.loading")}
        </p>
      </div>
    )
  }

  const statusCopy = OPERATOR_STATUS_COPY[decisions.status]
  const report = decisions.report
  const recentDecisions = report?.recent_decisions ?? []
  const actionNote = scannerDecisionActionNote(decisions)

  return (
    <div className="min-w-0 rounded-2xl border border-white/8 bg-white/3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-full border border-white/10 bg-white/5 p-2 text-muted-foreground">
            <ScanLine className="size-4" />
          </div>
          <div>
            <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t("operator.runtime.decisions.eyebrow")}
            </div>
            <h3 className="mt-2 text-base font-semibold text-foreground">
              {t("operator.runtime.decisions.title")}
            </h3>
          </div>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${statusCopy.className}`}
        >
          {t(statusCopy.labelKey)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{decisions.summary}</p>
      {actionNote ? <OperatorActionNote {...actionNote} /> : null}
      <div
        className={`mt-4 rounded-2xl border p-3 ${scannerDecisionPanelClassName(decisions.status)}`}
      >
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
          {t("operator.runtime.decisions.whyTitle")}
        </div>
        <p className="mt-2 text-sm leading-6">
          {t("operator.runtime.decisions.whyBody")}
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        <RuntimeMetric
          label={t("operator.runtime.metric.persistenceState")}
          value={decisions.persistence_state.replaceAll("_", " ")}
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.networkDb")}
          value={
            decisions.database_dsn_label ??
            t(
              decisions.database_configured
                ? "operator.value.configured"
                : "operator.value.notConfigured",
            )
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.evidenceWindow")}
          value={
            report
              ? formatWindow(report.lookback_seconds)
              : t("operator.value.unavailable")
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.totalDecisions")}
          value={
            report ? String(report.total_count) : t("operator.value.unavailable")
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.decisionColors")}
          value={
            report
              ? `${report.green_count} / ${report.orange_count} / ${report.red_count}`
              : t("operator.value.unavailable")
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.holdToOpen")}
          value={
            report
              ? String(report.hold_required_count)
              : t("operator.value.unavailable")
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.highestRisk")}
          value={
            report
              ? String(report.highest_risk_score)
              : t("operator.value.unavailable")
          }
        />
      </div>
      {report && recentDecisions.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-white/12 bg-white/2 p-4">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t("operator.runtime.decisions.empty.eyebrow")}
          </div>
          <p className="mt-2 text-sm font-medium text-foreground">
            {t("operator.runtime.decisions.empty.title")}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("operator.runtime.decisions.empty.body")}
          </p>
        </div>
      ) : null}
      {recentDecisions.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-[rgba(5,10,18,0.35)] p-3">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t("operator.runtime.decisions.recent")}
          </div>
          <div className="mt-3 grid gap-2">
            {recentDecisions.slice(0, 4).map((decision) => (
              <div
                key={`${decision.decision_id}-${decision.created_at}`}
                className="min-w-0 rounded-2xl border border-white/8 bg-white/3 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="break-words text-sm font-semibold text-foreground">
                      {decision.destination_fingerprint ?? decision.decision_id}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatTimestamp(decision.created_at, locale)}
                    </div>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${decisionColorClassName(decision.decision_color)}`}
                  >
                    {decision.decision_color}
                    {decision.risk_score === null ? "" : ` · ${decision.risk_score}`}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {formatReasonLabel(decision.decision_state)}
                  {decision.hold_to_open_required
                    ? ` · ${t("operator.runtime.decisions.hold", {
                        ms: decision.hold_to_open_duration_ms,
                      })}`
                    : ""}
                </p>
                {decision.reason_codes.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {decision.reason_codes.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full border border-white/8 bg-white/3 px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground"
                      >
                        {formatReasonLabel(reason)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {decisions.reasons.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {decisions.reasons.map((reason) => (
            <span
              key={reason}
              className="rounded-full border border-white/8 bg-white/3 px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              {formatReasonLabel(reason)}
            </span>
          ))}
        </div>
      ) : null}
      {decisions.error ? (
        <p className="mt-3 rounded-2xl border border-white/10 bg-[rgba(5,10,18,0.35)] p-3 text-xs leading-5 text-muted-foreground">
          {decisions.error}
        </p>
      ) : null}
    </div>
  )
}

function RuntimeObservationsPanel({ runtimeStatus }: { runtimeStatus: VerifierStatus | null }) {
  const t = useT()
  const locale = useLocale()
  const observations = runtimeStatus?.runtime_observations

  if (!runtimeStatus || !observations) {
    return (
      <div className="min-w-0 rounded-2xl border border-white/8 bg-white/3 p-4">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {t("operator.runtime.observations.eyebrow")}
        </div>
        <p className="mt-2 text-sm font-medium text-foreground">
          {t("operator.runtime.observations.loading")}
        </p>
      </div>
    )
  }

  const statusCopy = OPERATOR_STATUS_COPY[observations.status]
  const report = observations.report
  const topHosts = report?.top_hosts ?? []
  const providerReports = report?.provider_reports ?? []
  const actionNote = runtimeObservationActionNote(observations)

  return (
    <div className="min-w-0 rounded-2xl border border-white/8 bg-white/3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-full border border-white/10 bg-white/5 p-2 text-muted-foreground">
            <Radar className="size-4" />
          </div>
          <div>
            <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t("operator.runtime.observations.eyebrow")}
            </div>
            <h3 className="mt-2 text-base font-semibold text-foreground">
              {t("operator.runtime.observations.title")}
            </h3>
          </div>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${statusCopy.className}`}
        >
          {t(statusCopy.labelKey)}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{observations.summary}</p>
      {actionNote ? <OperatorActionNote {...actionNote} /> : null}
      <div
        className={`mt-4 rounded-2xl border p-3 ${observationPanelClassName(observations.status)}`}
      >
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
          {t("operator.runtime.observations.interpretation")}
        </div>
        <p className="mt-2 text-sm leading-6">
          {t(RUNTIME_OBSERVATION_INTERPRETATION[observations.status])}
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        <RuntimeMetric
          label={t("operator.runtime.metric.observationState")}
          value={observations.observation_state.replaceAll("_", " ")}
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.networkDb")}
          value={
            observations.database_dsn_label ??
            t(
              observations.database_configured
                ? "operator.value.configured"
                : "operator.value.notConfigured",
            )
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.evidenceWindow")}
          value={
            report
              ? formatWindow(report.lookback_seconds)
              : t("operator.value.unavailable")
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.totalObservations")}
          value={
            report ? String(report.total_count) : t("operator.value.unavailable")
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.highestRisk")}
          value={
            report
              ? String(report.highest_risk_score)
              : t("operator.value.unavailable")
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.blocked")}
          value={
            report ? String(report.blocked_count) : t("operator.value.unavailable")
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.risky")}
          value={
            report ? String(report.risky_count) : t("operator.value.unavailable")
          }
        />
        <RuntimeMetric
          label={t("operator.runtime.metric.unknown")}
          value={
            report ? String(report.unknown_count) : t("operator.value.unavailable")
          }
        />
      </div>
      {report && topHosts.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-white/12 bg-white/2 p-4">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t("operator.runtime.observations.empty.eyebrow")}
          </div>
          <p className="mt-2 text-sm font-medium text-foreground">
            {t("operator.runtime.observations.empty.title")}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("operator.runtime.observations.empty.body")}
          </p>
        </div>
      ) : null}
      {topHosts.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-[rgba(5,10,18,0.35)] p-3">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t("operator.runtime.observations.topHosts")}
          </div>
          <div className="mt-3 grid gap-2">
            {topHosts.map((host) => (
              <div
                key={`${host.destination_host}-${host.observed_at}`}
                className="min-w-0 rounded-2xl border border-white/8 bg-white/3 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 break-words text-sm font-semibold text-foreground">
                    {host.destination_host}
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${hostVerdictClassName(host.verdict)}`}
                  >
                    {host.verdict} · {host.risk_score}
                  </span>
                </div>
                {host.final_url ? (
                  <p className="mt-2 break-all text-xs leading-5 text-muted-foreground">
                    {host.final_url}
                  </p>
                ) : null}
                {host.reason_codes.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {host.reason_codes.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full border border-white/8 bg-white/3 px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground"
                      >
                        {formatReasonLabel(reason)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {providerReports.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-[rgba(5,10,18,0.35)] p-3">
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t("operator.runtime.observations.providerCoverage")}
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {providerReports.map((provider) => (
              <div
                key={`${provider.provider_id}-${provider.last_observed_at}`}
                className="rounded-2xl border border-white/8 bg-white/3 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-foreground">
                    {provider.provider_id}
                  </div>
                  <span className="rounded-full border border-white/8 bg-white/3 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {t("operator.runtime.observations.providerReports", {
                      count: provider.total_count,
                    })}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {t("operator.runtime.observations.lastObserved", {
                    time: formatTimestamp(provider.last_observed_at, locale),
                  })}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl border border-trust-amber/40 bg-trust-amber/10 px-2 py-1.5 text-trust-amber">
                    {t("operator.runtime.observations.providerRisky", {
                      count: provider.risky_count,
                    })}
                  </div>
                  <div className="rounded-xl border border-trust-red/40 bg-trust-red/10 px-2 py-1.5 text-trust-red">
                    {t("operator.runtime.observations.providerBlocked", {
                      count: provider.blocked_count,
                    })}
                  </div>
                  <div className="rounded-xl border border-border bg-muted px-2 py-1.5 text-muted-foreground">
                    {t("operator.runtime.observations.providerUnavailable", {
                      count: provider.unavailable_count,
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {observations.reasons.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {observations.reasons.map((reason) => (
            <span
              key={reason}
              className="rounded-full border border-white/8 bg-white/3 px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              {formatReasonLabel(reason)}
            </span>
          ))}
        </div>
      ) : null}
      {observations.error ? (
        <p className="mt-3 rounded-2xl border border-white/10 bg-[rgba(5,10,18,0.35)] p-3 text-xs leading-5 text-muted-foreground">
          {observations.error}
        </p>
      ) : null}
    </div>
  )
}

function EvidenceTabsSection({
  runtimeStatus,
}: {
  runtimeStatus: VerifierStatus | null
}) {
  const t = useT()
  const [activeTab, setActiveTab] = useState<OperatorEvidenceTab>("scanner")
  const scannerStatus: ScannerDecisionStatus =
    runtimeStatus?.scanner_decisions?.status ?? "unavailable"
  const observationStatus: RuntimeObservationStatus =
    runtimeStatus?.runtime_observations?.status ?? "unavailable"
  const scannerCopy = OPERATOR_STATUS_COPY[scannerStatus]
  const observationCopy = OPERATOR_STATUS_COPY[observationStatus]

  return (
    <div className="min-w-0 rounded-[1.5rem] border border-white/8 bg-white/3 p-3">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pb-3">
        <div>
          <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t("operator.runtime.evidence.eyebrow")}
          </div>
          <h3 className="mt-1 text-base font-semibold text-foreground">
            {t("operator.runtime.evidence.title")}
          </h3>
        </div>
        <p className="max-w-xl text-xs leading-5 text-muted-foreground">
          {t("operator.runtime.evidence.body")}
        </p>
      </div>
      <div
        className="grid gap-2 md:grid-cols-2"
        role="tablist"
        aria-label={t("operator.runtime.evidence.tablist")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "scanner"}
          aria-controls="operator-evidence-panel"
          onClick={() => setActiveTab("scanner")}
          className={evidenceTabClassName(activeTab === "scanner")}
        >
          <div className="flex items-start gap-3">
            <div className="rounded-full border border-white/10 bg-white/5 p-2 text-muted-foreground">
              <ScanLine className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {t("operator.runtime.evidence.scanner.label")}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${scannerCopy.className}`}
                >
                  {t(scannerCopy.labelKey)}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {t("operator.runtime.evidence.scanner.body")}
              </p>
            </div>
          </div>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "runtime"}
          aria-controls="operator-evidence-panel"
          onClick={() => setActiveTab("runtime")}
          className={evidenceTabClassName(activeTab === "runtime")}
        >
          <div className="flex items-start gap-3">
            <div className="rounded-full border border-white/10 bg-white/5 p-2 text-muted-foreground">
              <Radar className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {t("operator.runtime.evidence.runtime.label")}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${observationCopy.className}`}
                >
                  {t(observationCopy.labelKey)}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {t("operator.runtime.evidence.runtime.body")}
              </p>
            </div>
          </div>
        </button>
      </div>
      <div id="operator-evidence-panel" role="tabpanel" className="mt-3 min-w-0">
        {activeTab === "scanner" ? (
          <ScannerDecisionsPanel runtimeStatus={runtimeStatus} />
        ) : (
          <RuntimeObservationsPanel runtimeStatus={runtimeStatus} />
        )}
      </div>
    </div>
  )
}

function RuntimePostureSection({
  runtimeStatus,
  statusMessage,
  isLoadingStatus,
  apiKeyHeader,
  adminHeader,
  onRefresh,
}: RuntimePostureSectionProps) {
  const t = useT()

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-white/10 bg-white/5 p-2 text-muted-foreground">
              <Activity className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">
                {t("operator.runtime.title")}
              </CardTitle>
              <CardDescription>{t("operator.runtime.subtitle")}</CardDescription>
            </div>
          </div>
          <Button variant="outline" onClick={onRefresh} disabled={isLoadingStatus}>
            <RefreshCw className="size-4" />
            {t(
              isLoadingStatus ? "operator.refreshing" : "operator.runtime.refresh",
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <StatusBanner message={statusMessage} />
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          <RuntimeMetric
            label={t("operator.runtime.metric.redis")}
            value={t(
              runtimeStatus
                ? compactCount(runtimeStatus.redis_connected)
                : "operator.value.loading",
            )}
          />
          <RuntimeMetric
            label={t("operator.runtime.metric.distributedLimiter")}
            value={t(
              runtimeStatus
                ? compactCount(runtimeStatus.distributed_rate_limiting_enabled)
                : "operator.value.loading",
            )}
          />
          <RuntimeMetric
            label={t("operator.runtime.metric.decodeLimit")}
            value={
              runtimeStatus
                ? `${runtimeStatus.decode_rate_limit_max_requests} / ${runtimeStatus.rate_limit_window_seconds}s`
                : t("operator.value.loading")
            }
          />
          <RuntimeMetric
            label={t("operator.runtime.metric.verifyLimit")}
            value={
              runtimeStatus
                ? `${runtimeStatus.rate_limit_max_requests} / ${runtimeStatus.rate_limit_window_seconds}s`
                : t("operator.value.loading")
            }
          />
          <RuntimeMetric
            label={t("operator.runtime.metric.cameraFallback")}
            value={t(
              runtimeStatus
                ? compactCount(runtimeStatus.decode_image_fallback_enabled)
                : "operator.value.loading",
            )}
          />
          <RuntimeMetric
            label={t("operator.runtime.metric.apiKeyHeader")}
            value={apiKeyHeader}
          />
          <RuntimeMetric
            label={t("operator.runtime.metric.adminHeader")}
            value={adminHeader}
          />
        </div>
        <div className="grid gap-4">
          <NetworkOutboxPanel runtimeStatus={runtimeStatus} />
          <EvidenceTabsSection runtimeStatus={runtimeStatus} />
        </div>
      </CardContent>
    </Card>
  )
}

export default RuntimePostureSection
