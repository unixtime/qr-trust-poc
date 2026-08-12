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
import type {
  NetworkOutboxOperatorStatus,
  RuntimeSafetyObservationOperatorStatus,
  ScannerDecisionOperatorStatus,
  VerifierStatus,
} from "@/lib/verifier-client"
import StatusBanner from "@/routes/operator/components/StatusBanner"
import RuntimeMetric from "@/routes/operator/components/RuntimeMetric"
import type { MessageState } from "@/routes/operator/types"

const TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

const OPERATOR_STATUS_COPY = {
  healthy: {
    label: "healthy",
    className: "border-trust-green/40 bg-trust-green/10 text-trust-green",
  },
  degraded: {
    label: "degraded",
    className: "border-trust-amber/40 bg-trust-amber/10 text-trust-amber",
  },
  blocked: {
    label: "blocked",
    className: "border-trust-red/40 bg-trust-red/10 text-trust-red",
  },
  unavailable: {
    label: "unavailable",
    className: "border-border bg-muted text-muted-foreground",
  },
} as const

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

type OperatorActionNoteProps = {
  eyebrow: string
  title: string
  body: string
  command?: string
  action?: string
  tone?: OperatorActionTone
}

const RUNTIME_OBSERVATION_INTERPRETATION: Record<RuntimeObservationStatus, string> = {
  healthy:
    "Runtime-safety evidence is available and no active risky or blocked destination evidence is present.",
  degraded:
    "Runtime-safety evidence exists, but an operator should review the warning before treating this as a clear scan-time signal.",
  blocked:
    "At least one observed destination is actively blocked. Scanner decisions should surface this as a red or explicit caution state.",
  unavailable:
    "The provider-evidence bridge cannot be read. Scanner decisions should not claim that runtime safety was evaluated.",
}

function compactCount(value: boolean) {
  return value ? "enabled" : "disabled"
}

function formatLag(milliseconds: number) {
  if (milliseconds <= 0) return "none"
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

function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return TIMESTAMP_FORMATTER.format(date)
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
    "min-w-0 rounded-[1.15rem] border p-3 text-left transition",
    isActive
      ? "border-(--border-accent) bg-card shadow-(--glow)"
      : "border-border/70 bg-card/75 hover:border-primary/40 hover:bg-card/95",
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
  eyebrow,
  title,
  body,
  command,
  action,
  tone = "amber",
}: OperatorActionNoteProps) {
  const toneClass = OPERATOR_ACTION_TONE_CLASS[tone]

  return (
    <div className={`mt-4 rounded-[1.1rem] border p-3 ${toneClass.box}`}>
      <div
        className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${toneClass.eyebrow}`}
      >
        {eyebrow}
      </div>
      <p className="mt-2 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-5 opacity-80">{body}</p>
      {command || action ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {command ? (
            <span
              className={`max-w-full rounded-[0.8rem] border px-3 py-1 font-mono text-[11px] break-all ${toneClass.chip}`}
            >
              {command}
            </span>
          ) : null}
          {action ? (
            <span
              className={`rounded-full border px-3 py-1 text-[11px] font-medium ${toneClass.chip}`}
            >
              {action}
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
      eyebrow: "Infrastructure check",
      title: "Network propagation cannot be inspected",
      body:
        "The operator could not read the outbox database. Keep scanner results local until the persistence path is reachable.",
      action: "Check database connectivity",
      tone: "stone",
    }
  }

  if (
    hasReason(outbox.reasons, "quarantined_rows") ||
    (metrics?.quarantined_count ?? 0) > 0
  ) {
    return {
      eyebrow: "Operator action",
      title: "Some trust events are quarantined",
      body:
        "Quarantined rows are intentionally held out of NATS propagation. Review the management outbox, then retry only after the stale or malformed source event has been corrected.",
      command:
        "./backend/.venv/bin/python backend/scripts/qrtrustctl.py --base-url https://127.0.0.1:8443 --admin-token local-lab-admin --insecure-tls outbox-status",
      tone: "red",
    }
  }

  if (hasReason(outbox.reasons, "failed_rows") || (metrics?.failed_count ?? 0) > 0) {
    return {
      eyebrow: "Operator action",
      title: "Some trust events failed publication",
      body:
        "The scanner can still evaluate local verifier state, but network subscribers may not see the latest trust-state changes until failed rows are retried or repaired.",
      command: "make check-network-worker-drill",
      tone: "red",
    }
  }

  if (
    hasReason(outbox.reasons, "pending_lag") ||
    ((metrics?.pending_count ?? 0) > 0 && (metrics?.published_count ?? 0) === 0)
  ) {
    return {
      eyebrow: "Local stack gap",
      title: "Outbox worker is not publishing yet",
      body:
        "The API is writing trust events, but propagation is queued. In the local shared-infra run this usually means NATS and the outbox worker are not active.",
      command: "make up-https-admin-shared-infra-nats",
      action: "Then run the worker drill",
      tone: "amber",
    }
  }

  if (outbox.status === "healthy") {
    return {
      eyebrow: "Propagation ready",
      title: "Trust events are publishable",
      body:
        "Network subscribers can receive verifier-state updates from the outbox path. Continue watching pending and failed counts during scanner tests.",
      action: "Run a lab scan to produce fresh events",
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
      eyebrow: "Persistence check",
      title: "Scanner decision storage is unavailable",
      body:
        "The scanner can still show a live result, but the operator cannot prove that green, orange, or red decisions were stored as reviewable evidence.",
      action: "Check scanner-decision database path",
      tone: "stone",
    }
  }

  if (hasReason(decisions.reasons, "no_scanner_decisions") || report?.total_count === 0) {
    return {
      eyebrow: "Evidence setup",
      title: "No scanner-visible decisions have been recorded",
      body:
        "This is expected before a lab or iPhone scan. Generate a QR, then use Check scanner decision or scan it from the iOS app to populate this evidence panel.",
      action: "Lab -> Check scanner decision",
      tone: "amber",
    }
  }

  if (decisions.status === "healthy") {
    return {
      eyebrow: "Evidence ready",
      title: "Scanner decisions are being persisted",
      body:
        "The operator can review recent green, orange, and red outcomes with risk scores, hold-to-open flags, and reason codes.",
      action: "Review recent outcomes below",
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
      eyebrow: "Provider evidence check",
      title: "Runtime-safety evidence cannot be read",
      body:
        "Scanner decisions should not claim present-time destination safety until provider observations are reachable.",
      action: "Check runtime observation storage",
      tone: "stone",
    }
  }

  if (hasReason(observations.reasons, "no_runtime_observations") || report?.total_count === 0) {
    return {
      eyebrow: "Evidence setup",
      title: "No runtime-safety observations are in the current window",
      body:
        "Issuer legitimacy and destination binding can still be proven, but runtime safety remains review-needed until a provider emits destination observations.",
      action: "Emit or import provider observations",
      tone: "amber",
    }
  }

  if (observations.status === "blocked") {
    return {
      eyebrow: "Runtime block",
      title: "At least one destination is actively blocked",
      body:
        "Scanner-visible decisions should turn red or show explicit caution when these observations match a scanned destination.",
      action: "Review highest-risk destinations",
      tone: "red",
    }
  }

  if (observations.status === "healthy") {
    return {
      eyebrow: "Runtime feed ready",
      title: "Destination observations are current",
      body:
        "The provider evidence feed can support scan-time safety decisions. Continue reviewing high-risk hosts and provider coverage.",
      action: "Review provider coverage",
      tone: "green",
    }
  }

  return null
}

function NetworkOutboxPanel({ runtimeStatus }: { runtimeStatus: VerifierStatus | null }) {
  const outbox = runtimeStatus?.network_outbox

  if (!runtimeStatus || !outbox) {
    return (
      <div className="min-w-0 rounded-[1.35rem] border border-border/70 bg-background/80 p-4">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Network propagation
        </div>
        <p className="mt-2 text-sm font-medium text-foreground">
          Loading outbox supervisor status.
        </p>
      </div>
    )
  }

  const statusCopy = OPERATOR_STATUS_COPY[outbox.status]
  const metrics = outbox.metrics
  const actionNote = networkOutboxActionNote(outbox)

  return (
    <div className="min-w-0 rounded-[1.35rem] border border-border/70 bg-card/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Network propagation
          </div>
          <h3 className="mt-2 text-base font-semibold text-foreground">
            Event outbox supervisor
          </h3>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${statusCopy.className}`}
        >
          {statusCopy.label}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{outbox.summary}</p>
      {actionNote ? <OperatorActionNote {...actionNote} /> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        <RuntimeMetric
          label="Supervisor"
          value={outbox.supervisor_state.replaceAll("_", " ")}
        />
        <RuntimeMetric
          label="Network DB"
          value={outbox.database_dsn_label ?? (outbox.database_configured ? "configured" : "not configured")}
        />
        <RuntimeMetric
          label="Pending"
          value={metrics ? String(metrics.pending_count) : "unavailable"}
        />
        <RuntimeMetric
          label="Published"
          value={metrics ? String(metrics.published_count) : "unavailable"}
        />
        <RuntimeMetric
          label="Failed"
          value={metrics ? String(metrics.failed_count) : "unavailable"}
        />
        <RuntimeMetric
          label="Quarantined"
          value={metrics ? String(metrics.quarantined_count) : "unavailable"}
        />
        <RuntimeMetric
          label="Oldest lag"
          value={metrics ? formatLag(metrics.oldest_pending_age_ms) : "unavailable"}
        />
      </div>
      {outbox.reasons.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {outbox.reasons.map((reason) => (
            <span
              key={reason}
              className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              {formatReasonLabel(reason)}
            </span>
          ))}
        </div>
      ) : null}
      {outbox.error ? (
        <p className="mt-3 rounded-2xl border border-border/70 bg-background/75 p-3 text-xs leading-5 text-muted-foreground">
          {outbox.error}
        </p>
      ) : null}
    </div>
  )
}

function ScannerDecisionsPanel({ runtimeStatus }: { runtimeStatus: VerifierStatus | null }) {
  const decisions = runtimeStatus?.scanner_decisions

  if (!runtimeStatus || !decisions) {
    return (
      <div className="min-w-0 rounded-[1.35rem] border border-border/70 bg-background/80 p-4">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Scanner decisions
        </div>
        <p className="mt-2 text-sm font-medium text-foreground">
          Loading persisted decision evidence.
        </p>
      </div>
    )
  }

  const statusCopy = OPERATOR_STATUS_COPY[decisions.status]
  const report = decisions.report
  const recentDecisions = report?.recent_decisions ?? []
  const actionNote = scannerDecisionActionNote(decisions)

  return (
    <div className="min-w-0 rounded-[1.35rem] border border-border/70 bg-card/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-full border border-border/70 bg-background/85 p-2 text-muted-foreground">
            <ScanLine className="size-4" />
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Scanner decisions
            </div>
            <h3 className="mt-2 text-base font-semibold text-foreground">
              Persisted scanner-visible outcomes
            </h3>
          </div>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${statusCopy.className}`}
        >
          {statusCopy.label}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{decisions.summary}</p>
      {actionNote ? <OperatorActionNote {...actionNote} /> : null}
      <div
        className={`mt-4 rounded-[1.1rem] border p-3 ${scannerDecisionPanelClassName(decisions.status)}`}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
          Why this matters
        </div>
        <p className="mt-2 text-sm leading-6">
          This is the evidence that the scanner-visible green, orange, or red
          decision was persisted as a reviewable network artifact.
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        <RuntimeMetric
          label="Persistence state"
          value={decisions.persistence_state.replaceAll("_", " ")}
        />
        <RuntimeMetric
          label="Network DB"
          value={
            decisions.database_dsn_label ??
            (decisions.database_configured ? "configured" : "not configured")
          }
        />
        <RuntimeMetric
          label="Evidence window"
          value={report ? formatWindow(report.lookback_seconds) : "unavailable"}
        />
        <RuntimeMetric
          label="Total decisions"
          value={report ? String(report.total_count) : "unavailable"}
        />
        <RuntimeMetric
          label="Green / orange / red"
          value={
            report
              ? `${report.green_count} / ${report.orange_count} / ${report.red_count}`
              : "unavailable"
          }
        />
        <RuntimeMetric
          label="Hold-to-open"
          value={report ? String(report.hold_required_count) : "unavailable"}
        />
        <RuntimeMetric
          label="Highest risk"
          value={report ? String(report.highest_risk_score) : "unavailable"}
        />
      </div>
      {report && recentDecisions.length === 0 ? (
        <div className="mt-4 rounded-[1.1rem] border border-dashed border-border/80 bg-background/70 p-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Decision evidence
          </div>
          <p className="mt-2 text-sm font-medium text-foreground">
            No scanner decisions were found in this evidence window.
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Generate and check a scenario from the lab to populate this panel with
            the latest persisted scanner-visible outcomes.
          </p>
        </div>
      ) : null}
      {recentDecisions.length > 0 ? (
        <div className="mt-4 rounded-[1.1rem] border border-border/70 bg-background/75 p-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Recent scanner-visible outcomes
          </div>
          <div className="mt-3 grid gap-2">
            {recentDecisions.slice(0, 4).map((decision) => (
              <div
                key={`${decision.decision_id}-${decision.created_at}`}
                className="min-w-0 rounded-2xl border border-border/70 bg-card/90 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="break-words text-sm font-semibold text-foreground">
                      {decision.destination_fingerprint ?? decision.decision_id}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatTimestamp(decision.created_at)}
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
                    ? ` · hold ${decision.hold_to_open_duration_ms}ms`
                    : ""}
                </p>
                {decision.reason_codes.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {decision.reason_codes.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
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
              className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              {formatReasonLabel(reason)}
            </span>
          ))}
        </div>
      ) : null}
      {decisions.error ? (
        <p className="mt-3 rounded-2xl border border-border/70 bg-background/75 p-3 text-xs leading-5 text-muted-foreground">
          {decisions.error}
        </p>
      ) : null}
    </div>
  )
}

function RuntimeObservationsPanel({ runtimeStatus }: { runtimeStatus: VerifierStatus | null }) {
  const observations = runtimeStatus?.runtime_observations

  if (!runtimeStatus || !observations) {
    return (
      <div className="min-w-0 rounded-[1.35rem] border border-border/70 bg-background/80 p-4">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Runtime observations
        </div>
        <p className="mt-2 text-sm font-medium text-foreground">
          Loading provider evidence status.
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
    <div className="min-w-0 rounded-[1.35rem] border border-border/70 bg-card/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-full border border-border/70 bg-background/85 p-2 text-muted-foreground">
            <Radar className="size-4" />
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Runtime observations
            </div>
            <h3 className="mt-2 text-base font-semibold text-foreground">
              Provider evidence report
            </h3>
          </div>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${statusCopy.className}`}
        >
          {statusCopy.label}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{observations.summary}</p>
      {actionNote ? <OperatorActionNote {...actionNote} /> : null}
      <div
        className={`mt-4 rounded-[1.1rem] border p-3 ${observationPanelClassName(observations.status)}`}
      >
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
          Operator interpretation
        </div>
        <p className="mt-2 text-sm leading-6">
          {RUNTIME_OBSERVATION_INTERPRETATION[observations.status]}
        </p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        <RuntimeMetric
          label="Observation state"
          value={observations.observation_state.replaceAll("_", " ")}
        />
        <RuntimeMetric
          label="Network DB"
          value={
            observations.database_dsn_label ??
            (observations.database_configured ? "configured" : "not configured")
          }
        />
        <RuntimeMetric
          label="Evidence window"
          value={report ? formatWindow(report.lookback_seconds) : "unavailable"}
        />
        <RuntimeMetric
          label="Total observations"
          value={report ? String(report.total_count) : "unavailable"}
        />
        <RuntimeMetric
          label="Highest risk"
          value={report ? String(report.highest_risk_score) : "unavailable"}
        />
        <RuntimeMetric
          label="Blocked"
          value={report ? String(report.blocked_count) : "unavailable"}
        />
        <RuntimeMetric
          label="Risky"
          value={report ? String(report.risky_count) : "unavailable"}
        />
        <RuntimeMetric
          label="Unknown"
          value={report ? String(report.unknown_count) : "unavailable"}
        />
      </div>
      {report && topHosts.length === 0 ? (
        <div className="mt-4 rounded-[1.1rem] border border-dashed border-border/80 bg-background/70 p-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Destination evidence
          </div>
          <p className="mt-2 text-sm font-medium text-foreground">
            No destination observations were found in this evidence window.
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            This is expected in a fresh local environment. Once runtime providers report
            clear, risky, unavailable, or blocked host evidence, the highest-risk
            destinations will appear here.
          </p>
        </div>
      ) : null}
      {topHosts.length > 0 ? (
        <div className="mt-4 rounded-[1.1rem] border border-border/70 bg-background/75 p-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Highest-risk destinations
          </div>
          <div className="mt-3 grid gap-2">
            {topHosts.map((host) => (
              <div
                key={`${host.destination_host}-${host.observed_at}`}
                className="min-w-0 rounded-2xl border border-border/70 bg-card/90 p-3"
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
                        className="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
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
        <div className="mt-4 rounded-[1.1rem] border border-border/70 bg-background/75 p-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Provider coverage
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {providerReports.map((provider) => (
              <div
                key={`${provider.provider_id}-${provider.last_observed_at}`}
                className="rounded-2xl border border-border/70 bg-card/90 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-foreground">
                    {provider.provider_id}
                  </div>
                  <span className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {provider.total_count} reports
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Last observed {formatTimestamp(provider.last_observed_at)}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl border border-trust-amber/40 bg-trust-amber/10 px-2 py-1.5 text-trust-amber">
                    {provider.risky_count} risky
                  </div>
                  <div className="rounded-xl border border-trust-red/40 bg-trust-red/10 px-2 py-1.5 text-trust-red">
                    {provider.blocked_count} blocked
                  </div>
                  <div className="rounded-xl border border-border bg-muted px-2 py-1.5 text-muted-foreground">
                    {provider.unavailable_count} unavailable
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
              className="rounded-full border border-border/70 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              {formatReasonLabel(reason)}
            </span>
          ))}
        </div>
      ) : null}
      {observations.error ? (
        <p className="mt-3 rounded-2xl border border-border/70 bg-background/75 p-3 text-xs leading-5 text-muted-foreground">
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
  const [activeTab, setActiveTab] = useState<OperatorEvidenceTab>("scanner")
  const scannerStatus: ScannerDecisionStatus =
    runtimeStatus?.scanner_decisions?.status ?? "unavailable"
  const observationStatus: RuntimeObservationStatus =
    runtimeStatus?.runtime_observations?.status ?? "unavailable"
  const scannerCopy = OPERATOR_STATUS_COPY[scannerStatus]
  const observationCopy = OPERATOR_STATUS_COPY[observationStatus]

  return (
    <div className="min-w-0 rounded-[1.45rem] border border-border/70 bg-background/70 p-3 shadow-[0_14px_38px_rgba(22,29,24,0.06)]">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pb-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Evidence focus
          </div>
          <h3 className="mt-1 text-base font-semibold text-foreground">
            Review one evidence lane at a time
          </h3>
        </div>
        <p className="max-w-xl text-xs leading-5 text-muted-foreground">
          Scanner decisions show what users saw. Runtime observations show
          provider destination evidence.
        </p>
      </div>
      <div
        className="grid gap-2 md:grid-cols-2"
        role="tablist"
        aria-label="Operator evidence lanes"
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
            <div className="rounded-full border border-border/70 bg-background/85 p-2 text-muted-foreground">
              <ScanLine className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  Scanner decisions
                </span>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${scannerCopy.className}`}
                >
                  {scannerCopy.label}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                User-visible green, orange, or red outcomes persisted for review.
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
            <div className="rounded-full border border-border/70 bg-background/85 p-2 text-muted-foreground">
              <Radar className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">
                  Runtime observations
                </span>
                <span
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${observationCopy.className}`}
                >
                  {observationCopy.label}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                Provider destination evidence and runtime safety observations.
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
  return (
    <Card className="overflow-hidden border-border/70">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-border/70 p-2 text-muted-foreground">
              <Activity className="size-4" />
            </div>
            <div>
              <CardTitle className="text-base">Runtime posture</CardTitle>
              <CardDescription>
                What the backend is enforcing right now.
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" onClick={onRefresh} disabled={isLoadingStatus}>
            <RefreshCw className="size-4" />
            {isLoadingStatus ? "Refreshing runtime…" : "Refresh runtime"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <StatusBanner message={statusMessage} />
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
          <RuntimeMetric
            label="Redis"
            value={runtimeStatus ? compactCount(runtimeStatus.redis_connected) : "loading"}
          />
          <RuntimeMetric
            label="Distributed limiter"
            value={
              runtimeStatus
                ? compactCount(runtimeStatus.distributed_rate_limiting_enabled)
                : "loading"
            }
          />
          <RuntimeMetric
            label="Decode limit"
            value={
              runtimeStatus
                ? `${runtimeStatus.decode_rate_limit_max_requests} / ${runtimeStatus.rate_limit_window_seconds}s`
                : "loading"
            }
          />
          <RuntimeMetric
            label="Verify limit"
            value={
              runtimeStatus
                ? `${runtimeStatus.rate_limit_max_requests} / ${runtimeStatus.rate_limit_window_seconds}s`
                : "loading"
            }
          />
          <RuntimeMetric
            label="Camera fallback"
            value={
              runtimeStatus
                ? compactCount(runtimeStatus.decode_image_fallback_enabled)
                : "loading"
            }
          />
          <RuntimeMetric
            label="Legacy experimental API"
            value={
              runtimeStatus
                ? compactCount(runtimeStatus.legacy_experimental_api_enabled)
                : "loading"
            }
          />
          <RuntimeMetric label="API key header" value={apiKeyHeader} />
          <RuntimeMetric label="Admin header" value={adminHeader} />
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
