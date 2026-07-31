import type { ChangeEvent } from "react"
import {
  CircleAlert,
  Copy,
  Download,
  Expand,
  FileJson,
  GitBranch,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldCheck,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { qrImageDataUrl } from "@/lib/verifier-client"
import type { ScenarioGeneratorSectionProps } from "@/routes/lab/types"
import { cn } from "@/lib/utils"

function formatUsagePolicy(value: string | null | undefined) {
  if (!value) return "legacy QR with no embedded usage policy"
  return value.replaceAll("_", " ")
}

function expectedOutcomeClasses(tone: "green" | "amber" | "red") {
  if (tone === "green") {
    return {
      shell: "border-emerald-600/16 bg-emerald-500/10 text-emerald-950",
      dot: "bg-emerald-600",
      pill: "border-emerald-600/16 bg-emerald-100 text-emerald-950",
    }
  }

  if (tone === "red") {
    return {
      shell: "border-red-500/18 bg-red-500/8 text-red-950",
      dot: "bg-red-600",
      pill: "border-red-500/18 bg-red-100 text-red-950",
    }
  }

  return {
    shell: "border-amber-500/20 bg-amber-500/10 text-amber-950",
    dot: "bg-amber-500",
    pill: "border-amber-500/20 bg-amber-100 text-amber-950",
  }
}

type RedirectEvidence = {
  resolverUrl: string
  finalUrl: string
  finalHost: string
  hopCount: string
  policyState: "approved" | "blocked" | "review"
  policyLabel: string
}

function redirectEvidenceFromPayload(payload: string): RedirectEvidence | null {
  try {
    const parsed = new URL(payload)
    if (parsed.hostname !== "qr.acme.example") {
      return null
    }

    const finalUrl = parsed.searchParams.get("final")
    if (!finalUrl) {
      return null
    }

    const hopCount = parsed.searchParams.get("hops") ?? "1"
    const final = new URL(finalUrl)
    const nestedShortener = parsed.searchParams.get("nested") === "1"
    const hopLimitExceeded = Number.parseInt(hopCount, 10) > 1
    const finalHostMismatch = final.hostname !== "acme.example"
    const policyState =
      nestedShortener || hopLimitExceeded || finalHostMismatch ? "blocked" : "approved"
    const policyLabel = nestedShortener
      ? "Nested shortener blocked"
      : hopLimitExceeded
        ? "Hop limit exceeded"
        : finalHostMismatch
          ? "Final host mismatch"
          : "Resolver flow approved"

    return {
      resolverUrl: `${parsed.origin}${parsed.pathname}`,
      finalUrl,
      finalHost: final.hostname,
      hopCount,
      policyState,
      policyLabel,
    }
  } catch {
    return null
  }
}

function LocalLabKeyIssue({
  pending,
  onIssue,
}: {
  pending: boolean
  onIssue: () => void
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onIssue}
        disabled={pending}
      >
        <ShieldCheck data-icon="inline-start" />
        {pending ? "Issuing key..." : "Issue local lab key"}
      </Button>
      <div className="max-w-[34rem] text-xs leading-5 text-muted-foreground">
        Uses the default local compose admin token. For shared or non-local runtimes,
        issue a key from operator mode instead.
      </div>
    </div>
  )
}

type ScenarioFieldsProps = Pick<
  ScenarioGeneratorSectionProps,
  | "scenario"
  | "nonceMode"
  | "usagePolicy"
  | "apiKey"
  | "currentScenario"
  | "scenarioMeta"
  | "apiAuthEnabled"
  | "localKeyIssue"
  | "onScenarioChange"
  | "onNonceModeChange"
  | "onUsagePolicyChange"
  | "onApiKeyChange"
>

function ScenarioFields({
  scenario,
  nonceMode,
  usagePolicy,
  apiKey,
  currentScenario,
  scenarioMeta,
  apiAuthEnabled,
  localKeyIssue,
  onScenarioChange,
  onNonceModeChange,
  onUsagePolicyChange,
  onApiKeyChange,
}: ScenarioFieldsProps) {
  const expectedOutcome = currentScenario.expectedOutcome
  const expectedClasses = expectedOutcomeClasses(expectedOutcome.tone)

  return (
    <FieldGroup className="rounded-[1.15rem] border border-emerald-950/10 bg-white/78 p-4">
      <FieldGroup className="grid gap-4 lg:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="scenario-select">Scenario</FieldLabel>
          <Select
            value={scenario}
            onValueChange={(value: string | null) => {
              if (value) {
                onScenarioChange(value as typeof scenario)
              }
            }}
          >
            <SelectTrigger id="scenario-select" className="w-full">
              <SelectValue placeholder="Select a verifier scenario" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Object.entries(scenarioMeta).map(([key, meta]) => (
                  <SelectItem key={key} value={key}>
                    {meta.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>{currentScenario.note}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="usage-policy-select">Usage policy</FieldLabel>
          <Select
            value={usagePolicy}
            onValueChange={(value: string | null) => {
              if (value) {
                onUsagePolicyChange(value as typeof usagePolicy)
              }
            }}
          >
            <SelectTrigger id="usage-policy-select" className="w-full">
              <SelectValue placeholder="Select usage policy" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="reusable_public">Reusable public QR</SelectItem>
                <SelectItem value="one_time">One-time QR</SelectItem>
                <SelectItem value="time_limited">Time-limited QR</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            Printed and shared QR codes should be reusable. Login, payment, or
            ticket QR codes should be one-time.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="nonce-mode-select">Nonce label</FieldLabel>
          <Select
            value={nonceMode}
            onValueChange={(value: string | null) => {
              if (value) {
                onNonceModeChange(value as typeof nonceMode)
              }
            }}
          >
            <SelectTrigger id="nonce-mode-select" className="w-full">
              <SelectValue placeholder="Select nonce mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="fixed">Fixed nonce per scenario</SelectItem>
                <SelectItem value="timestamped">Timestamped nonce</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>
            Fixed nonce makes repeat scans visible. Replay blocks only when the
            usage policy is one-time.
          </FieldDescription>
        </Field>
      </FieldGroup>
      <Field>
        <FieldLabel htmlFor="api-key">Verifier API key</FieldLabel>
        <Input
          id="api-key"
          value={apiKey}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onApiKeyChange(event.target.value)
          }
          placeholder="Paste an issued verifier key or leave blank when auth is disabled"
        />
        <FieldDescription>
          {apiAuthEnabled
            ? "This runtime expects a verifier API key. Manage issuance in /operator, or paste an existing key here."
            : "Verifier auth is currently disabled on this runtime, so the field can stay blank."}
        </FieldDescription>
        {localKeyIssue.visible ? (
          <LocalLabKeyIssue
            pending={localKeyIssue.pending}
            onIssue={localKeyIssue.onIssue}
          />
        ) : null}
      </Field>
      <div
        className={cn(
          "rounded-[1rem] border p-4",
          expectedClasses.shell,
        )}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "mt-1 size-3 shrink-0 rounded-full",
                expectedClasses.dot,
              )}
            />
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-current/62">
                Expected scanner result
              </div>
              <div className="mt-1 text-base font-black tracking-[-0.03em]">
                {expectedOutcome.label}
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-current/74">
                {expectedOutcome.summary}
              </p>
            </div>
          </div>
          <span
            className={cn(
              "w-fit shrink-0 rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[0.13em]",
              expectedClasses.pill,
            )}
          >
            {expectedOutcome.layer}
          </span>
        </div>
      </div>
    </FieldGroup>
  )
}

type OptionGuidePanelProps = Pick<
  ScenarioGeneratorSectionProps,
  | "scenario"
  | "nonceMode"
  | "usagePolicy"
  | "scenarioGuide"
  | "nonceGuide"
  | "usagePolicyGuide"
  | "showOptionGuide"
  | "onToggleOptionGuide"
>

function OptionGuidePanel({
  scenario,
  nonceMode,
  usagePolicy,
  scenarioGuide,
  nonceGuide,
  usagePolicyGuide,
  showOptionGuide,
  onToggleOptionGuide,
}: OptionGuidePanelProps) {
  return (
    <div className="rounded-[1.45rem] border border-border/70 bg-white/62 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Option guide
          </div>
          <div className="mt-2 text-sm leading-6 text-muted-foreground">
            Use this only when you need help choosing a scenario, usage policy,
            or nonce mode. The selected option is summarized directly under its field.
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onToggleOptionGuide}>
          {showOptionGuide ? "Hide option guide" : "Show option guide"}
        </Button>
      </div>

      {showOptionGuide ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          <GuideColumn
            title="Scenario options"
            items={scenarioGuide}
            selectedKey={scenario}
          />
          <GuideColumn
            title="Usage policies"
            items={usagePolicyGuide}
            selectedKey={usagePolicy}
          />
          <GuideColumn
            title="Nonce modes"
            items={nonceGuide}
            selectedKey={nonceMode}
          />
        </div>
      ) : null}
    </div>
  )
}

function GuideColumn({
  title,
  items,
  selectedKey,
}: {
  title: string
  items: Array<{ key: string; title: string; summary: string }>
  selectedKey: string
}) {
  return (
    <div className="rounded-[1.2rem] border border-border/70 bg-card/70 p-4">
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </div>
      <div className="mt-3 grid gap-3">
        {items.map((item) => (
          <div
            key={item.key}
            className={cn(
              "rounded-xl border p-3",
              item.key === selectedKey
                ? "border-foreground/15 bg-foreground/5"
                : "border-border/70 bg-card/80",
            )}
          >
            <div className="text-sm font-medium text-foreground">
              {item.title}
            </div>
            <div className="mt-1 text-sm leading-6 text-muted-foreground">
              {item.summary}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

type GeneratorActionsProps = Pick<
  ScenarioGeneratorSectionProps,
  | "demo"
  | "generatorSettingsChanged"
  | "isGenerating"
  | "scannerDecisionPending"
  | "isVerifyingCurrent"
  | "onGenerateDemo"
  | "onGenerateFreshValidDemo"
  | "onCheckScannerDecision"
  | "onOpenQrFullscreen"
  | "onVerifyCurrent"
>

function GeneratorActions({
  demo,
  generatorSettingsChanged,
  isGenerating,
  scannerDecisionPending,
  isVerifyingCurrent,
  onGenerateDemo,
  onGenerateFreshValidDemo,
  onCheckScannerDecision,
  onOpenQrFullscreen,
  onVerifyCurrent,
}: GeneratorActionsProps) {
  return (
    <div className="grid gap-3">
      <div className="rounded-[1.1rem] border border-emerald-900/10 bg-emerald-600/8 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-900/65">
              Primary lab action
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Generate a QR, then check the same green, orange, or red decision
              an end user should see.
            </p>
          </div>
          <span className="rounded-full border border-emerald-700/15 bg-white/70 px-3 py-1 text-xs font-semibold text-emerald-950">
            recommended first
          </span>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={onGenerateDemo} disabled={isGenerating}>
            <ShieldCheck data-icon="inline-start" />
            {isGenerating ? "Generating..." : "Generate demo QR"}
          </Button>
          <Button
            variant="outline"
            onClick={onGenerateFreshValidDemo}
            disabled={isGenerating}
          >
            <RefreshCw data-icon="inline-start" />
            Fresh valid QR
          </Button>
          <Button
            variant="outline"
            onClick={onCheckScannerDecision}
            disabled={!demo || generatorSettingsChanged || scannerDecisionPending}
          >
            <ScanLine data-icon="inline-start" />
            {scannerDecisionPending
              ? "Checking..."
              : "Check user-facing result"}
          </Button>
          <Button
            variant="outline"
            onClick={onOpenQrFullscreen}
            disabled={!demo || generatorSettingsChanged}
          >
            <Expand data-icon="inline-start" />
            Show fullscreen QR
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1rem] border border-dashed border-border/80 bg-card/70 p-3">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <FileJson className="size-4" aria-hidden="true" />
            Advanced signed-verifier proof
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Use this lower-level contract only when you need replay, signature,
            or schema evidence.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={onVerifyCurrent}
          disabled={!demo || generatorSettingsChanged || isVerifyingCurrent}
        >
          <ScanLine data-icon="inline-start" />
          {isVerifyingCurrent ? "Verifying..." : "Run verifier proof"}
        </Button>
      </div>
    </div>
  )
}

type ScannerDecisionPreviewProps = Pick<
  ScenarioGeneratorSectionProps,
  "scannerDecision" | "scannerDecisionError" | "scannerDecisionPending"
>
type ScannerDecision = NonNullable<ScannerDecisionPreviewProps["scannerDecision"]>
type ScannerRiskLevel = "green" | "amber" | "red"

function formatDecisionValue(value: string) {
  return value.replaceAll("_", " ")
}

function formatReasonCode(value: string) {
  return value.replaceAll("_", " ")
}

function riskStripeClass(level: "green" | "amber" | "red" | undefined) {
  if (level === "green") return "bg-emerald-500"
  if (level === "red") return "bg-red-500"
  return "bg-amber-500"
}

function riskPillClass(level: "green" | "amber" | "red" | undefined) {
  if (level === "green") {
    return "border-emerald-600/18 bg-emerald-500/10 text-emerald-950"
  }
  if (level === "red") {
    return "border-red-500/18 bg-red-500/10 text-red-950"
  }
  return "border-amber-500/22 bg-amber-500/12 text-amber-950"
}

function scannerContractRiskLevel(
  scannerDecision: ScannerDecision | null | undefined,
): ScannerRiskLevel | undefined {
  const color = scannerDecision?.contract?.decision_color
  if (color === "orange") return "amber"
  return color
}

function scannerFallbackRiskLevel(
  scannerDecision: ScannerDecision | null | undefined,
): ScannerRiskLevel | undefined {
  if (!scannerDecision) return undefined
  if (scannerDecision.decision_state === "verified_issuer") return "green"
  if (scannerDecision.decision_state === "blocked") return "red"
  return "amber"
}

function scannerRiskLevel(
  scannerDecision: ScannerDecision | null | undefined,
): ScannerRiskLevel | undefined {
  return (
    scannerDecision?.scanner_ux?.risk_level ??
    scannerContractRiskLevel(scannerDecision) ??
    scannerFallbackRiskLevel(scannerDecision)
  )
}

function scannerDecisionClasses(
  scannerDecision: ScannerDecision | null | undefined,
) {
  const riskLevel = scannerRiskLevel(scannerDecision)
  if (riskLevel === "green") {
    return "border-emerald-200 bg-emerald-50 text-emerald-950"
  }
  if (riskLevel === "red") {
    return "border-red-200 bg-red-50 text-red-950"
  }
  if (riskLevel === "amber") {
    return "border-amber-200 bg-amber-50 text-amber-950"
  }
  return "border-border/70 bg-card/72 text-foreground"
}

function ScannerDecisionPreview({
  scannerDecision,
  scannerDecisionError,
  scannerDecisionPending,
}: ScannerDecisionPreviewProps) {
  const scannerUx = scannerDecision?.scanner_ux
  const holdCopy = scannerUx?.hold_required
    ? `${scannerUx.hold_ms} ms hold required`
    : "no hold required"

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[1.4rem] border",
        scannerDecisionClasses(scannerDecision),
      )}
    >
      {scannerUx ? (
        <div className={cn("h-1.5 w-full", riskStripeClass(scannerUx.risk_stripe))} />
      ) : null}
      <div className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase text-current/62">
              Scanner-visible outcome
            </div>
            <h3 className="mt-2 text-xl font-semibold tracking-[-0.035em]">
              {scannerDecision
                ? scannerUx?.primary_action ??
                  formatDecisionValue(scannerDecision.decision_state)
                : scannerDecisionPending
                  ? "Checking scanner path"
                  : "Not checked yet"}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-current/74">
              {scannerDecision
                ? scannerDecision.primary_message
                : scannerDecisionError
                  ? scannerDecisionError
                  : "This calls the end-user scanner endpoint, not just the engineering verifier. For one-time QR codes, this is a real scan and may consume the nonce."}
            </p>
          </div>
          {scannerDecision ? (
            <div className="flex flex-wrap gap-2 lg:justify-end">
              {scannerUx ? (
                <div
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold capitalize tabular-nums",
                    riskPillClass(scannerUx.risk_level),
                  )}
                >
                  {scannerUx.risk_level} · {scannerUx.risk_score}/100
                </div>
              ) : null}
              <div className="rounded-full border border-current/12 bg-background/40 px-3 py-1.5 text-xs font-semibold tabular-nums text-current/78">
                {scannerDecision.open_allowed ? "open allowed" : "open blocked"} ·{" "}
                {scannerDecision.verifier_stage}
              </div>
            </div>
          ) : null}
        </div>

        {scannerUx ? (
          <div className="mt-4 grid gap-3 rounded-[1rem] border border-current/10 bg-background/36 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-current/58">
                Friction layer
              </div>
              <div className="mt-1 text-sm font-semibold">
                {holdCopy}
                {scannerUx.destination_fingerprint
                  ? ` · ${scannerUx.destination_fingerprint}`
                  : ""}
              </div>
            </div>
            {scannerUx.reason_codes.length ? (
              <div className="flex flex-wrap gap-2 md:justify-end">
                {scannerUx.reason_codes.map((code) => (
                  <span
                    key={code}
                    className="rounded-full border border-current/10 bg-background/45 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-current/68"
                  >
                    {formatReasonCode(code)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {scannerDecision ? (
          <div className="mt-4 grid gap-2 md:grid-cols-4">
            {scannerDecision.signals.map((signal) => (
              <div
                key={`${signal.layer}:${signal.state}`}
                className="rounded-[1rem] border border-current/10 bg-background/42 p-3"
              >
                <div className="text-[10px] font-semibold uppercase text-current/58">
                  {formatDecisionValue(signal.layer)}
                </div>
                <div className="mt-2 text-sm font-semibold">
                  {formatDecisionValue(signal.state)}
                </div>
                {signal.message ? (
                  <p className="mt-2 text-xs leading-5 text-current/68">
                    {signal.message}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

type QrArtifactPanelProps = Pick<
  ScenarioGeneratorSectionProps,
  | "demo"
  | "currentScenario"
  | "generatedScenario"
  | "generationError"
  | "generatorSettingsChanged"
  | "onDownloadQrImage"
  | "onCopyQrPayload"
>

function QrArtifactPanel({
  demo,
  currentScenario,
  generatedScenario,
  generationError,
  generatorSettingsChanged,
  onDownloadQrImage,
  onCopyQrPayload,
}: QrArtifactPanelProps) {
  return (
    <div className="qr-scan-surface rounded-[1.35rem] border border-stone-950/10 bg-[#111812] p-4 text-stone-50 shadow-[0_16px_40px_rgba(17,24,18,0.18)]">
      {demo ? (
        <div className="grid gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-100/70">
              Generated artifact
            </p>
            <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-stone-50">
              QR ready for evidence capture
            </h3>
          </div>
          <div className="rounded-[1.1rem] border border-stone-100/10 bg-stone-50/8 p-3">
            <img
              src={qrImageDataUrl(demo.qr_png_base64)}
              alt="Generated verifier QR"
              className="aspect-square w-full rounded-[0.9rem] border border-stone-950/10 bg-stone-50 p-4"
            />
          </div>
          <QrArtifactMetadata
            demo={demo}
            currentScenario={currentScenario}
            generatedScenario={generatedScenario}
          />
          <RedirectEvidenceCard
            payload={demo.verify_request.envelope.claims.payload}
          />
          <Separator className="bg-stone-100/10" />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-emerald-200/30 bg-emerald-200 text-emerald-950 hover:bg-emerald-100 hover:text-emerald-950"
              onClick={onDownloadQrImage}
              disabled={generatorSettingsChanged}
            >
              <Download data-icon="inline-start" />
              Download
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-stone-100/18 bg-stone-100/10 text-stone-50 hover:bg-stone-100/18 hover:text-stone-50"
              onClick={onCopyQrPayload}
              disabled={generatorSettingsChanged}
            >
              <Copy data-icon="inline-start" />
              Copy payload
            </Button>
          </div>
        </div>
      ) : (
        <QrArtifactEmptyState generationError={generationError} />
      )}
    </div>
  )
}

function QrArtifactMetadata({
  demo,
  currentScenario,
  generatedScenario,
}: Pick<
  ScenarioGeneratorSectionProps,
  "demo" | "currentScenario" | "generatedScenario"
>) {
  if (!demo) {
    return null
  }

  const artifactScenario = generatedScenario ?? currentScenario
  const artifactUsagePolicy = demo.verify_request.envelope.claims.usage_policy
  const governance = demo.governance

  return (
    <div className="grid gap-2 text-sm">
      <QrArtifactDatum label="Generated scenario" value={artifactScenario.label} />
      <QrArtifactDatum
        label="Embedded usage policy"
        value={formatUsagePolicy(artifactUsagePolicy)}
      />
      <QrArtifactDatum
        label="Nonce"
        value={demo.verify_request.envelope.claims.nonce}
      />
      <QrArtifactDatum
        label="Payload"
        value={demo.verify_request.envelope.claims.payload}
      />
      {governance ? (
        <>
          {governance.cache_freshness_state !== "fresh" ? (
            <div className="rounded-[1rem] border border-amber-300/30 bg-amber-300/12 p-3 text-amber-50">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                Scanner downgrade
              </div>
              <p className="mt-1 text-sm leading-5 text-amber-50/85">
                This QR can still pass signature and payload checks, but a scanner
                should not show a positive trust state while required cache state is{" "}
                {formatGovernanceValue(governance.cache_freshness_state)}.
              </p>
            </div>
          ) : null}
          <QrArtifactDatum
            label="Issuer namespace"
            value={governance.issuer_namespace_label}
          />
          <QrArtifactDatum
            label="Assurance tier"
            value={formatGovernanceValue(governance.assurance_tier)}
          />
          <QrArtifactDatum
            label="Verifier cache"
            value={`${formatGovernanceValue(governance.cache_freshness_state)} · ${governance.cache_entry_id}`}
          />
          <QrArtifactDatum
            label="Cache expires"
            value={governance.cache_expires_at}
          />
        </>
      ) : null}
    </div>
  )
}

function formatGovernanceValue(value: string) {
  return value.replaceAll("_", " ")
}

function QrArtifactDatum({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.16em] text-stone-400">
        {label}
      </div>
      <div className="mt-1 break-all font-medium text-stone-50">{value}</div>
    </div>
  )
}

function RedirectEvidenceCard({ payload }: { payload: string }) {
  const evidence = redirectEvidenceFromPayload(payload)

  if (!evidence) {
    return null
  }

  const toneClasses =
    evidence.policyState === "approved"
      ? "border-emerald-200/20 bg-emerald-300/10 text-emerald-50"
      : "border-red-200/20 bg-red-300/10 text-red-50"

  return (
    <div className={cn("rounded-[1.15rem] border p-3", toneClasses)}>
      <div className="flex items-start gap-2">
        <GitBranch className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-70">
            Resolver evidence
          </div>
          <div className="mt-1 text-sm font-semibold">{evidence.policyLabel}</div>
          <div className="mt-3 grid gap-2 text-xs leading-5 opacity-85">
            <RedirectEvidenceDatum label="Resolver" value={evidence.resolverUrl} />
            <RedirectEvidenceDatum
              label="Final target"
              value={`${evidence.finalHost} · ${evidence.finalUrl}`}
            />
            <RedirectEvidenceDatum label="Observed hops" value={evidence.hopCount} />
          </div>
        </div>
      </div>
    </div>
  )
}

function RedirectEvidenceDatum({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div>
      <span className="font-semibold opacity-90">{label}: </span>
      <span className="break-all">{value}</span>
    </div>
  )
}

function QrArtifactEmptyState({
  generationError,
}: {
  generationError?: string | null
}) {
  if (generationError) {
    return (
      <div className="grid min-h-[22rem] place-items-center rounded-[1.1rem] border border-red-200/20 bg-red-500/[0.08] p-6 text-center text-sm text-red-50">
        <div className="max-w-sm">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl border border-red-100/18 bg-red-100/12">
            <CircleAlert className="size-6 text-red-100" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-100/70">
            Generation failed
          </p>
          <h3 className="mt-2 text-xl font-semibold tracking-[-0.04em] text-stone-50">
            No QR was produced
          </h3>
          <p className="mt-3 leading-6 text-red-50/80">
            {generationError}
          </p>
          <p className="mt-4 text-xs leading-5 text-red-50/60">
            The previous artifact was cleared so you do not accidentally scan
            stale QR material. Check the API key, runtime status, and selected
            scenario, then generate again.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid min-h-[22rem] place-items-center rounded-[1.1rem] border border-dashed border-stone-100/18 bg-stone-50/[0.045] p-6 text-center text-sm text-stone-300">
      <div className="max-w-xs">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl border border-stone-100/10 bg-stone-50/[0.06]">
          <QrCode className="size-6 text-emerald-200" />
        </div>
        Generate demo materials to get a QR image, a signed envelope, and an
        issuer state snapshot.
      </div>
    </div>
  )
}

function ScenarioGeneratorSection({
  scenario,
  nonceMode,
  usagePolicy,
  apiKey,
  currentScenario,
  scenarioMeta,
  scenarioGuide,
  nonceGuide,
  usagePolicyGuide,
  demo,
  generatedScenario,
  scannerDecision,
  scannerDecisionPending,
  scannerDecisionError,
  generationError,
  generatorSettingsChanged,
  apiAuthEnabled,
  localKeyIssue,
  showOptionGuide,
  isGenerating,
  isVerifyingCurrent,
  fixedReplayVisible,
  onScenarioChange,
  onNonceModeChange,
  onUsagePolicyChange,
  onApiKeyChange,
  onToggleOptionGuide,
  onGenerateDemo,
  onGenerateFreshValidDemo,
  onCheckScannerDecision,
  onOpenQrFullscreen,
  onVerifyCurrent,
  onDownloadQrImage,
  onCopyQrPayload,
}: ScenarioGeneratorSectionProps) {
  return (
    <Card className="security-card overflow-hidden rounded-[1.35rem] bg-[#fdfaf2]/96">
      <CardHeader className="border-b border-emerald-950/10 bg-card/72">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-700 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
                Step 1
              </span>
              <span className="rounded-full border border-border/70 bg-card px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Scenario builder
              </span>
            </div>
            <CardTitle className="mt-3 text-2xl font-black tracking-[-0.03em] md:text-3xl">
              Build the verifier packet
            </CardTitle>
            <CardDescription className="mt-2 max-w-2xl leading-6">
              Choose the scenario and generate one QR artifact. The scanner
              result below is the teaching surface.
            </CardDescription>
          </div>
          <div className="rounded-xl border border-emerald-950/10 bg-white/72 px-3 py-2 text-sm leading-6 text-muted-foreground">
            <span className="font-medium text-foreground">
              Current scenario:
            </span>{" "}
            {currentScenario.label} · {formatUsagePolicy(usagePolicy)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 p-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-4">
          <ScenarioFields
            scenario={scenario}
            nonceMode={nonceMode}
            usagePolicy={usagePolicy}
            apiKey={apiKey}
            currentScenario={currentScenario}
            scenarioMeta={scenarioMeta}
            apiAuthEnabled={apiAuthEnabled}
            localKeyIssue={localKeyIssue}
            onScenarioChange={onScenarioChange}
            onNonceModeChange={onNonceModeChange}
            onUsagePolicyChange={onUsagePolicyChange}
            onApiKeyChange={onApiKeyChange}
          />

          <OptionGuidePanel
            scenario={scenario}
            nonceMode={nonceMode}
            usagePolicy={usagePolicy}
            scenarioGuide={scenarioGuide}
            nonceGuide={nonceGuide}
            usagePolicyGuide={usagePolicyGuide}
            showOptionGuide={showOptionGuide}
            onToggleOptionGuide={onToggleOptionGuide}
          />

          <GeneratorActions
            demo={demo}
            generatorSettingsChanged={generatorSettingsChanged}
            isGenerating={isGenerating}
            scannerDecisionPending={scannerDecisionPending}
            isVerifyingCurrent={isVerifyingCurrent}
            onGenerateDemo={onGenerateDemo}
            onGenerateFreshValidDemo={onGenerateFreshValidDemo}
            onCheckScannerDecision={onCheckScannerDecision}
            onOpenQrFullscreen={onOpenQrFullscreen}
            onVerifyCurrent={onVerifyCurrent}
          />

          {generationError ? (
            <Alert className="border-red-200/80 bg-red-50/80 text-red-950">
              <CircleAlert />
              <AlertTitle>Demo QR could not be generated</AlertTitle>
              <AlertDescription>
                {generationError}. The artifact panel was cleared so you do not
                accidentally scan stale QR material.
              </AlertDescription>
            </Alert>
          ) : null}

          <ScannerDecisionPreview
            scannerDecision={scannerDecision}
            scannerDecisionPending={scannerDecisionPending}
            scannerDecisionError={scannerDecisionError}
          />

          {generatorSettingsChanged ? (
            <Alert>
              <CircleAlert />
              <AlertTitle>Generate a new QR before scanning</AlertTitle>
              <AlertDescription>
                The controls changed after this QR was created. The artifact
                card still contains{" "}
                <strong>
                  {formatUsagePolicy(
                    demo?.verify_request.envelope.claims.usage_policy,
                  )}
                </strong>
                . Click <strong>Generate demo QR</strong> so the phone scans the
                selected policy instead of an older QR.
              </AlertDescription>
            </Alert>
          ) : null}

          {fixedReplayVisible ? (
            <Alert>
              <CircleAlert />
              <AlertTitle>This one-time fixed nonce is already consumed</AlertTitle>
              <AlertDescription>
                The current QR is a one-time credential and already succeeded
                once, so the verifier is correctly blocking it at{" "}
                <code>replay_guard</code>. Printed or shared QR codes should use{" "}
                <strong>Reusable public QR</strong>; login, payment, or ticket
                flows should use <strong>Fresh valid QR</strong> or{" "}
                <strong>Timestamped nonce</strong>.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <QrArtifactPanel
          demo={demo}
          currentScenario={currentScenario}
          generatedScenario={generatedScenario}
          generationError={generationError}
          generatorSettingsChanged={generatorSettingsChanged}
          onDownloadQrImage={onDownloadQrImage}
          onCopyQrPayload={onCopyQrPayload}
        />
      </CardContent>
    </Card>
  )
}

export default ScenarioGeneratorSection
