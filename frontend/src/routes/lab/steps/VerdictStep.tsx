import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Lock,
  XCircle,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useT, type MessageKey } from "@/i18n"
import { cn } from "@/lib/utils"
import {
  qrImageDataUrl,
  type ResidualCause,
  type ScannerDecisionResponse,
} from "@/lib/verifier-client"
import {
  ComparisonCard,
  ComparisonNudge,
} from "@/routes/lab/components/ComparisonCard"
import { HistorySection } from "@/routes/lab/components/HistorySection"
import type { LabState } from "@/routes/lab/deriveFlowStep"
import {
  decidingFamily,
  residualFamilyOrder,
  residualTierRank,
  residualTone,
  tierRank,
} from "@/routes/lab/residuals"
import {
  decisionStateTone,
  trustStatusTone,
  type TrustTone,
} from "@/routes/lab/trust-tone"

type TrustRow = {
  status: string
  label: string
  message: string | null
  reason_codes: string[]
}

function trustPathRows(decision: ScannerDecisionResponse): TrustRow[] {
  if (decision.contract) {
    const path = decision.contract.trust_path
    return [
      { ...path.issuer_legitimacy },
      { ...path.destination_binding },
      { ...path.runtime_safety },
      { ...path.scanner_decision },
    ]
  }
  return decision.signals.slice(0, 4).map((signal) => ({
    status: signal.state,
    label: signal.layer.replaceAll("_", " "),
    message: signal.message,
    reason_codes: [],
  }))
}

function hostOf(url: string | null): string | null {
  if (url === null) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

// The resolution chain as the wire reports it: displayed host, then the
// resolver, then wherever redirects actually landed. Consecutive duplicates
// collapse so a no-redirect decision shows a single hop, not an echo.
function hostChain(decision: ScannerDecisionResponse): string[] {
  const hops = [
    decision.destination.host ?? hostOf(decision.destination.display_url),
    hostOf(decision.destination.resolver_url),
    hostOf(decision.destination.final_url),
  ].filter((host): host is string => host !== null)
  return hops.filter((host, index) => index === 0 || host !== hops[index - 1])
}

const toneStyles: Record<
  TrustTone,
  {
    icon: typeof CheckCircle2
    surface: string
    text: string
    glyph: string
    dot: string
    headline: string
    ringStops: [string, string]
    ringGlow: string
  }
> = {
  green: {
    icon: CheckCircle2,
    surface: "border-trust-green/25 bg-trust-green/10",
    text: "text-trust-green",
    glyph:
      "border-trust-green/50 bg-trust-green/12 shadow-[0_0_18px_-2px_rgba(69,212,131,0.35)]",
    dot: "bg-trust-green shadow-[0_0_8px_rgba(69,212,131,0.9)]",
    headline: "aurora-text",
    ringStops: ["#45D483", "#3EE0F0"],
    ringGlow: "drop-shadow(0 0 14px rgba(69,212,131,0.45))",
  },
  amber: {
    icon: AlertTriangle,
    surface: "border-trust-amber/25 bg-trust-amber/10",
    text: "text-trust-amber",
    glyph:
      "border-trust-amber/50 bg-trust-amber/12 shadow-[0_0_18px_-2px_rgba(245,165,36,0.35)]",
    dot: "bg-trust-amber shadow-[0_0_8px_rgba(245,165,36,0.9)]",
    headline: "aurora-text-amber",
    ringStops: ["#F5A524", "#F7C948"],
    ringGlow: "drop-shadow(0 0 14px rgba(245,165,36,0.45))",
  },
  red: {
    icon: XCircle,
    surface: "border-trust-red/25 bg-trust-red/10",
    text: "text-trust-red",
    glyph:
      "border-trust-red/50 bg-trust-red/12 shadow-[0_0_18px_-2px_rgba(242,95,92,0.35)]",
    dot: "bg-trust-red shadow-[0_0_8px_rgba(242,95,92,0.9)]",
    headline: "aurora-text-red",
    ringStops: ["#F25F5C", "#FF8A80"],
    ringGlow: "drop-shadow(0 0 14px rgba(242,95,92,0.45))",
  },
}

// Residual pills borrow the verdict tones rather than inventing colours;
// `muted` is the one tone the verdict hero has no use for — a family the
// decision model scored as not-applicable is neutral, not amber.
const residualToneStyles: Record<
  ReturnType<typeof residualTone>,
  { surface: string; text: string; dot: string }
> = {
  green: {
    surface: toneStyles.green.surface,
    text: toneStyles.green.text,
    dot: toneStyles.green.dot,
  },
  amber: {
    surface: toneStyles.amber.surface,
    text: toneStyles.amber.text,
    dot: toneStyles.amber.dot,
  },
  red: {
    surface: toneStyles.red.surface,
    text: toneStyles.red.text,
    dot: toneStyles.red.dot,
  },
  muted: {
    surface: "border-white/12 bg-white/4",
    text: "text-muted-foreground",
    dot: "bg-white/30",
  },
}

// The cause vocabulary this catalogue actually carries. The backend does not
// validate `cause` against it, so anything outside the set renders raw rather
// than as a missing-key string.
const knownCauses = new Set<ResidualCause>([
  "invalid-signature",
  "issuer-suspended",
  "issuer-revoked",
  "record-expired",
  "record-not-yet-valid",
  "key-revoked",
  "key-suspended",
  "key-window-mismatch",
  "trust-state-unavailable",
  "destination-not-authorized",
  "normalization-failure",
  "policy-invalid",
  "object-not-yet-valid",
  "object-expired",
  "nested-shortener",
  "depth-exceeded",
  "resolver-mismatch",
  "resolution-unavailable",
  "verdict-warn",
  "verdict-block",
  "verdict-expired",
  "verdict-stale",
  "provider-unavailable",
  "no-trust-claim",
  "invalid-trust-claim",
  "overlay-suspected",
  "conflicting-symbols",
  "framed-symbol-anomaly",
  "container-mismatch",
])

// The gates ring is drawn on a 232-unit viewBox so the stroke geometry can be
// stated in the same units at any rendered size.
const RING_RADIUS = 98
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

// One dt/dd pair in the console-voice mono lists (destination, crypto
// evidence). The div wrapper is the HTML-sanctioned way to group a pair
// inside a <dl>; `title` keeps the full value reachable once `truncate`
// elides a hash or URL.
function MonoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-foreground/90" title={value}>
        {value}
      </dd>
    </div>
  )
}

// The 14×2px gradient tick every Aurora card header opens with.
function CardTick() {
  return (
    <span
      aria-hidden
      className="block h-0.5 w-3.5 bg-linear-90 from-primary to-transparent"
    />
  )
}

type VerdictStepProps = {
  lab: LabState
  onGoToScan: () => void
  /** Generate the paired (B) scenario and swap the pair. */
  onLoadPaired: () => void
  /** Back to the scenario step to pick a pair. */
  onChoosePaired: () => void
}

export function VerdictStep({
  lab,
  onGoToScan,
  onLoadPaired,
  onChoosePaired,
}: VerdictStepProps) {
  const t = useT()
  const decision = lab.scannerDecision
  const demo = lab.demo
  const rows = decision ? trustPathRows(decision) : []
  const reasonCodes = decision
    ? (decision.contract?.reason_codes ?? decision.scanner_ux?.reason_codes ?? [])
    : []
  const decisionTone: TrustTone = decision
    ? decision.contract
      ? decision.contract.decision_color === "green"
        ? "green"
        : decision.contract.decision_color === "red"
          ? "red"
          : "amber"
      : decisionStateTone(decision.decision_state)
    : "amber"
  const tone = toneStyles[decisionTone]
  // Real figures only: the ring reports how many trust-path rows resolve
  // green through the same tone function that colors the rows themselves.
  const passed = rows.filter((row) => trustStatusTone(row.status) === "green").length
  const total = rows.length
  // The chip's tone is as honest as the ring's count: green only when every
  // gate passes, red the moment any row resolves red, amber for the rest.
  const anyRedGate = rows.some((row) => trustStatusTone(row.status) === "red")
  const gatesTone =
    toneStyles[
      total > 0 && passed === total ? "green" : anyRedGate ? "red" : "amber"
    ]
  // The open CTA only exists when the verifier itself allows the open and
  // supplied a resolved URL — the button is the decision, never a default.
  const openUrl = decision
    ? (decision.destination.final_url ?? decision.destination.display_url)
    : null
  const showOpenCta =
    decision !== null && decision.open_allowed && decisionTone === "green" && openUrl !== null
  const chain = decision ? hostChain(decision) : []
  // The residual vector and the family that decided it, computed once: the
  // strip names the family, the card marks its row.
  const residualVector = decision?.residual_vector ?? null
  const deciding = residualVector ? decidingFamily(residualVector) : null

  return (
    <div className="flex flex-col gap-6" data-testid="verdict-step">
      <header>
        <div className="mb-2 flex items-center gap-3">
          <span
            aria-hidden
            className="size-[7px] shrink-0 rounded-full bg-trust-green shadow-[0_0_10px_rgba(69,212,131,0.9)]"
          />
          <span className="font-mono text-[11px] font-semibold tracking-[0.18em] text-trust-green uppercase">
            {t("lab.verdict.eyebrow")}
          </span>
          {decision?.contract ? (
            <span className="hidden min-w-0 truncate font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase sm:inline">
              {t("lab.verdict.eyebrowDetail", {
                id: decision.contract.decision_id,
                time: decision.contract.decided_at
                  .replace("T", " ")
                  .slice(0, 19),
              })}
            </span>
          ) : null}
          <span
            aria-hidden
            className="h-px flex-1 bg-linear-90 from-[rgba(69,212,131,0.4)] to-transparent"
          />
        </div>
        {decision === null ? (
          <>
            <h2 className="text-xl font-semibold tracking-tight">
              {t("lab.verdict.title")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("lab.verdict.subtitle")}
            </p>
          </>
        ) : null}
      </header>

      {decision === null ? (
        <>
          {lab.result ? (
            <EnvelopeCard lab={lab} t={t} />
          ) : null}
          <Card data-testid="verdict-empty">
            <CardContent className="flex flex-col items-start gap-3 py-8">
              <h3 className="text-lg font-semibold">
                {t("lab.verdict.empty.title")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("lab.verdict.empty.body", {
                  action: t("lab.scan.checkDecision"),
                })}
              </p>
              <Button variant="outline" data-testid="verdict-back" onClick={onGoToScan}>
                {t("lab.verdict.empty.cta")}
              </Button>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* ── Hero: the verdict itself, artboard-scale ─────────────────── */}
          <section
            data-testid="verdict-decision"
            className="flex flex-col items-center gap-10 py-4 lg:flex-row lg:items-center lg:gap-14 lg:py-8"
          >
            <div className="flex min-w-0 flex-1 flex-col items-start gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  aria-hidden
                  className={cn("size-1.5 rounded-full", tone.dot)}
                />
                <Badge
                  className={cn(
                    tone.surface,
                    tone.text,
                    "border font-mono tracking-[0.14em] uppercase",
                  )}
                >
                  {decision.decision_state.replaceAll("_", " ")}
                </Badge>
              </div>
              <p
                className={cn(
                  "text-4xl font-bold tracking-[-0.04em] text-balance sm:text-5xl lg:text-6xl lg:leading-[1.04] xl:text-[68px]",
                  tone.headline,
                )}
              >
                {decision.primary_message}
              </p>
              <p className="max-w-lg text-[15px] leading-relaxed text-muted-foreground sm:text-base">
                {t("lab.verdict.subtitle")}
              </p>
              {reasonCodes.length > 0 ? (
                <div
                  className="flex flex-wrap gap-1.5"
                  data-testid="verdict-reason-codes"
                >
                  {reasonCodes.map((code) => (
                    <span
                      key={code}
                      className={cn(
                        "rounded-full border border-white/8 bg-white/3 px-2 py-0.5 font-mono text-[10px]",
                        tone.text,
                      )}
                    >
                      {code}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-3.5">
                {showOpenCta ? (
                  <a
                    href={openUrl ?? undefined}
                    target="_blank"
                    rel="noreferrer noopener"
                    data-testid="verdict-open-destination"
                    className="inline-flex h-12 items-center gap-2 rounded-full bg-linear-135 from-[#45D483] to-[#2FC9C0] px-6 text-sm font-semibold text-[#04110A] shadow-[0_18px_36px_-16px_rgba(69,212,131,0.55)] transition-transform hover:-translate-y-0.5"
                  >
                    {t("lab.verdict.cta.open")}
                    <ArrowRight aria-hidden className="size-4" />
                  </a>
                ) : null}
                <button
                  type="button"
                  data-testid="verdict-inspect-evidence"
                  onClick={() =>
                    document
                      .getElementById("verdict-gates")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                  className="inline-flex h-12 items-center rounded-full border border-white/12 bg-white/3 px-6 text-sm font-semibold text-foreground/90 transition-colors hover:border-white/25 hover:bg-white/6"
                >
                  {t("lab.verdict.cta.inspect")}
                </button>
              </div>
            </div>

            {total > 0 ? (
              <div className="flex shrink-0 flex-col items-center gap-3">
                <div
                  role="img"
                  aria-label={t("lab.verdict.gates.aria", { passed, total })}
                  className="relative size-44 sm:size-52 lg:size-[232px]"
                >
                  <svg viewBox="0 0 232 232" className="size-full" aria-hidden>
                    <defs>
                      <linearGradient
                        id="verdict-ring-gradient"
                        x1="0%"
                        y1="0%"
                        x2="100%"
                        y2="100%"
                      >
                        <stop offset="0%" stopColor={tone.ringStops[0]} />
                        <stop offset="100%" stopColor={tone.ringStops[1]} />
                      </linearGradient>
                    </defs>
                    <circle
                      cx="116"
                      cy="116"
                      r="82"
                      fill="none"
                      stroke="rgba(255,255,255,0.05)"
                      strokeWidth="1"
                      strokeDasharray="2 6"
                    />
                    <circle
                      cx="116"
                      cy="116"
                      r={RING_RADIUS}
                      fill="none"
                      stroke="rgba(255,255,255,0.06)"
                      strokeWidth="12"
                    />
                    <circle
                      cx="116"
                      cy="116"
                      r={RING_RADIUS}
                      fill="none"
                      stroke="url(#verdict-ring-gradient)"
                      strokeWidth="12"
                      strokeLinecap="round"
                      strokeDasharray={`${(passed / total) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
                      transform="rotate(-90 116 116)"
                      style={{ filter: tone.ringGlow }}
                    />
                  </svg>
                  <div
                    aria-hidden
                    className="absolute inset-0 flex flex-col items-center justify-center"
                  >
                    <span className="text-4xl font-extrabold tracking-tight lg:text-5xl">
                      {passed}/{total}
                    </span>
                    <span className="mt-1.5 font-mono text-[10px] tracking-[0.24em] text-muted-foreground uppercase">
                      {t("lab.verdict.gates.label")}
                    </span>
                  </div>
                </div>
                <p className="max-w-[232px] text-center font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
                  {t("lab.verdict.ring.caption")}
                </p>
              </div>
            ) : null}
          </section>

          {/* ── The decision model's own output, unedited ────────────────── */}
          {decision.model_decision ? (
            <div
              data-testid="verdict-model-decision"
              data-attention={decision.model_decision.attention_level}
              className="flex flex-col gap-2 rounded-xl border border-(--glass-border) bg-white/3 px-4 py-3"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                  {t("lab.verdict.model.primaryState")}
                </span>
                <strong className="font-mono text-sm font-semibold tracking-[0.08em] text-foreground">
                  {decision.model_decision.primary_state}
                </strong>
              </div>
              <span className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                {t("lab.verdict.model.profile")}:{" "}
                <code>{decision.model_decision.profile}</code>
                {" · "}
                {t("lab.verdict.model.attention")}:{" "}
                {decision.model_decision.attention_level}
                {" · "}
                {t("lab.verdict.model.deciding")}:{" "}
                {deciding
                  ? t(`lab.residual.family.${deciding}` as MessageKey)
                  : t("lab.verdict.residuals.none")}
              </span>
              {decision.model_decision.annotations.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {decision.model_decision.annotations.map((annotation) => (
                    <li key={annotation}>
                      <code className="rounded-full border border-white/8 bg-white/3 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {annotation}
                      </code>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {/* ── The six residual families, expanded, in lattice order ────── */}
          <Card
            data-testid="verdict-residuals"
            role="region"
            aria-label={t("lab.verdict.residuals.title")}
          >
            <CardHeader>
              <CardTick />
              <CardTitle className="font-mono text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                {t("lab.verdict.residuals.title")}
              </CardTitle>
              <CardDescription>
                {t("lab.verdict.residuals.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-1">
                {residualFamilyOrder.map((family) => {
                  const entry = residualVector?.[family] ?? {
                    tier: "unknown",
                    cause: null,
                  }
                  const tone = residualTone(entry.tier)
                  const pill = residualToneStyles[tone]
                  const isDeciding = family === deciding
                  const tierKnown = entry.tier in residualTierRank
                  return (
                    <li
                      key={family}
                      data-testid={`residual-${family}`}
                      data-tone={tone}
                      data-rank={tierRank(entry.tier)}
                      aria-current={isDeciding ? "true" : undefined}
                      className={cn(
                        "flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-lg border px-2.5 py-2.5",
                        isDeciding
                          ? "border-white/12 bg-white/4"
                          : "border-transparent",
                      )}
                    >
                      <div className="flex min-w-0 flex-1 basis-52 flex-col gap-0.5">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                          {t(`lab.residual.family.${family}` as MessageKey)}
                          {isDeciding ? (
                            <span className="font-mono text-[10px] font-semibold tracking-[0.14em] text-primary uppercase">
                              {t("lab.verdict.residuals.deciding")}
                            </span>
                          ) : null}
                        </span>
                        <span className="text-[12px] leading-snug text-muted-foreground">
                          {t(`lab.residual.question.${family}` as MessageKey)}
                        </span>
                      </div>
                      <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                        <span
                          data-testid={`residual-${family}-tier`}
                          data-tone={tone}
                          title={tierKnown ? undefined : entry.tier}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            pill.surface,
                            pill.text,
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn("size-1.5 rounded-full", pill.dot)}
                          />
                          {t(
                            tierKnown
                              ? (`lab.residual.tier.${entry.tier}` as MessageKey)
                              : "lab.residual.tier.unknown",
                          )}
                        </span>
                        <span
                          data-testid={`residual-${family}-cause`}
                          className="text-[12px] leading-snug text-muted-foreground sm:text-right"
                        >
                          {entry.cause === null ? (
                            "—"
                          ) : knownCauses.has(entry.cause) ? (
                            t(`lab.residual.cause.${entry.cause}` as MessageKey)
                          ) : (
                            <code>{entry.cause}</code>
                          )}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </CardContent>
          </Card>

          {/* ── Row 1: trust path + sealed artifact ──────────────────────── */}
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
            <Card id="verdict-gates" className="scroll-mt-24 lg:flex-[1.55]">
              <CardHeader>
                <CardTick />
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="font-mono text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                    {t("lab.verdict.gates.label")}
                  </CardTitle>
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-[0.14em] uppercase",
                      gatesTone.surface,
                      gatesTone.text,
                    )}
                  >
                    {t("lab.verdict.gates.chip", { passed, total })}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col">
                  {rows.map((row, index) => {
                    const rowTone = toneStyles[trustStatusTone(row.status)]
                    const Icon = rowTone.icon
                    return (
                      <li key={`${row.label}-${index}`} data-testid={`trust-row-${index}`}>
                        {index > 0 ? (
                          <span
                            aria-hidden
                            className="ml-[17px] block h-5 w-0.5 bg-linear-180 from-primary/50 to-primary/15"
                          />
                        ) : null}
                        <div className="flex items-start gap-3">
                          <span
                            aria-hidden
                            className={cn(
                              "flex size-9 shrink-0 items-center justify-center rounded-full border",
                              rowTone.glyph,
                            )}
                          >
                            <Icon className={cn("size-4", rowTone.text)} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold capitalize">
                              {row.label}
                            </p>
                            {row.message ? (
                              <p className="mt-0.5 text-sm text-muted-foreground">
                                {row.message}
                              </p>
                            ) : null}
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-muted-foreground">
                                {t("lab.verdict.rawEvidence")}
                              </summary>
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                <span className="rounded-md border border-white/8 bg-white/3 px-1.5 py-0.5 font-mono text-xs">
                                  {row.status}
                                </span>
                                {row.reason_codes.map((code) => (
                                  <span
                                    key={code}
                                    className="rounded-md border border-white/8 bg-white/3 px-1.5 py-0.5 font-mono text-xs"
                                  >
                                    {code}
                                  </span>
                                ))}
                              </div>
                            </details>
                          </div>
                          {/* The raw wire status, echoed as a chip from `sm`
                              up; below that the same value stays reachable in
                              the raw-evidence details, so nothing is lost on
                              mobile. */}
                          <span
                            className={cn(
                              "ml-auto hidden shrink-0 rounded-md border border-white/8 bg-white/3 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.12em] uppercase sm:inline",
                              rowTone.text,
                            )}
                          >
                            {row.status}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>

            {/* The artifact this verdict judged — same sealed frame as the
                generate step, fed by the same demo materials. Absent when the
                payload was hand-scanned rather than generated here. */}
            {demo ? (
              <Card data-testid="verdict-artifact" className="lg:w-[360px] lg:shrink-0">
                <CardHeader>
                  <CardTick />
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="font-mono text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                      {t("lab.verdict.sealed.title")}
                    </CardTitle>
                    <span className="rounded-full border border-trust-green/30 bg-trust-green/8 px-2.5 py-1 font-mono text-[10px] font-semibold tracking-[0.16em] text-trust-green uppercase">
                      {t("lab.generate.sealed.badge")}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="relative mx-auto w-full max-w-[248px] p-3">
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
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-3 top-[58%] h-0.5 bg-linear-90 from-transparent via-[rgba(69,212,131,0.9)] to-transparent shadow-[0_0_12px_rgba(69,212,131,0.8)]"
                    />
                  </div>
                  <dl className="flex flex-col gap-1.5 font-mono text-[11px]">
                    <MonoRow
                      label={t("lab.generate.sealed.issued")}
                      value={demo.verify_request.envelope.claims.issued_at
                        .replace("T", " ")
                        .slice(0, 19)}
                    />
                  </dl>
                </CardContent>
              </Card>
            ) : null}
          </div>

          {/* ── Row 2: destination + signed envelope ─────────────────────── */}
          <div className="grid gap-5 lg:grid-cols-2">
            <Card
              data-testid="verdict-destination"
              className={cn(lab.result ? null : "lg:col-span-2")}
            >
              <CardHeader>
                <CardTick />
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="font-mono text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                    {t("lab.verdict.destination.title")}
                  </CardTitle>
                  {/* The binding mode straight off the wire — how the verifier
                      tied this destination to the envelope. */}
                  <span className="rounded-md border border-white/8 bg-white/3 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.12em] text-trust-green/90 uppercase">
                    {decision.destination.binding}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-[30px] shrink-0 items-center justify-center rounded-full border",
                      gatesTone.glyph,
                    )}
                  >
                    <Lock className={cn("size-3.5", gatesTone.text)} />
                  </span>
                  <p
                    className="min-w-0 truncate text-base font-semibold tracking-tight"
                    title={decision.destination.display_url}
                  >
                    {decision.destination.display_url}
                  </p>
                </div>
                {chain.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {chain.map((host, index) => (
                      <span key={`${host}-${index}`} className="flex items-center gap-1.5">
                        {index > 0 ? (
                          <ArrowRight
                            aria-hidden
                            className="size-3 text-muted-foreground/70"
                          />
                        ) : null}
                        <span
                          className={cn(
                            "rounded-md border px-2 py-0.5 font-mono text-[11px]",
                            index === chain.length - 1
                              ? "border-trust-green/30 bg-trust-green/8 text-trust-green"
                              : "border-white/8 bg-white/3 text-foreground/85",
                          )}
                        >
                          {host}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {t("lab.verdict.destination.footnote")}
                </p>
                <dl className="flex flex-col gap-1.5 border-t border-white/6 pt-3 font-mono text-[11px]">
                  <MonoRow
                    label={t("lab.verdict.destination.display")}
                    value={decision.destination.display_url}
                  />
                  {decision.destination.host !== null ? (
                    <MonoRow
                      label={t("lab.verdict.destination.host")}
                      value={decision.destination.host}
                    />
                  ) : null}
                  {decision.destination.resolver_url !== null ? (
                    <MonoRow
                      label={t("lab.verdict.destination.resolver")}
                      value={decision.destination.resolver_url}
                    />
                  ) : null}
                  {decision.destination.final_url !== null ? (
                    <MonoRow
                      label={t("lab.verdict.destination.final")}
                      value={decision.destination.final_url}
                    />
                  ) : null}
                  {decision.destination.redirect_hops !== null ? (
                    <MonoRow
                      label={t("lab.verdict.destination.redirects")}
                      value={String(decision.destination.redirect_hops)}
                    />
                  ) : null}
                  {decision.destination.redirect_policy !== null ? (
                    <MonoRow
                      label={t("lab.verdict.destination.redirectPolicy")}
                      value={decision.destination.redirect_policy}
                    />
                  ) : null}
                  {decision.contract ? (
                    <MonoRow
                      label={t("lab.verdict.destination.fingerprint")}
                      value={decision.contract.destination.fingerprint}
                    />
                  ) : null}
                </dl>
              </CardContent>
            </Card>

            {lab.result ? <EnvelopeCard lab={lab} t={t} /> : null}
          </div>

          {/* ── Row 3: A/B proof ────────────────────────────────────────── */}
          {lab.compareScenario ? (
            <ComparisonCard
              scenario={lab.scenario}
              compareScenario={lab.compareScenario}
              isGenerating={lab.isGenerating}
              onLoadPaired={onLoadPaired}
            />
          ) : (
            <ComparisonNudge onChoosePaired={onChoosePaired} />
          )}

          <footer>
            <Button variant="outline" data-testid="verdict-back" onClick={onGoToScan}>
              {t("lab.common.back")}
            </Button>
          </footer>
        </>
      )}

      <HistorySection history={lab.history} />
    </div>
  )
}

// The cryptographic-verification card — the honest counterpart of the design's
// envelope panel, showing what the verifier actually checked rather than
// static algorithm labels.
function EnvelopeCard({
  lab,
  t,
}: {
  lab: LabState
  t: ReturnType<typeof useT>
}) {
  const result = lab.result
  if (!result) return null
  return (
    <Card data-testid="verifier-result">
      <CardHeader>
        <CardTick />
        <CardTitle className="font-mono text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {t("lab.verdict.crypto.title")}
        </CardTitle>
        <CardDescription>
          {t("lab.verdict.crypto.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-2">
          <Badge variant={result.allowed ? "secondary" : "destructive"}>
            {result.allowed
              ? t("lab.verdict.accepted")
              : t("lab.verdict.rejected")}
          </Badge>
          <span className="text-muted-foreground">
            {t("lab.verdict.stage", { stage: result.stage })}
          </span>
        </div>
        <p>{result.reason}</p>
        {result.canonical_claims_sha256 !== null ||
        result.matched_rule !== null ? (
          <dl className="mt-1 flex flex-col gap-1.5 border-t border-white/6 pt-3 font-mono text-[11px]">
            {result.canonical_claims_sha256 !== null ? (
              <MonoRow
                label={t("lab.verdict.crypto.claimsHash")}
                value={result.canonical_claims_sha256}
              />
            ) : null}
            {result.matched_rule !== null ? (
              <MonoRow
                label={t("lab.verdict.crypto.matchedRule")}
                value={result.matched_rule}
              />
            ) : null}
          </dl>
        ) : null}
      </CardContent>
    </Card>
  )
}
