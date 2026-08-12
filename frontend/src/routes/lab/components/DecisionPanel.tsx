import { Badge } from "@/components/ui/badge"
import { Eyebrow } from "@/components/ui/eyebrow"
import type { VerifierDecision } from "@/lib/verifier-client"
import {
  badgeVariantForTone,
  toneClasses,
  toneForDecision,
} from "@/routes/lab/utils"

function DecisionPanel({
  result,
}: {
  result: VerifierDecision | null
}) {
  const tone = result ? toneForDecision(result) : "neutral"
  const title = result ? (result.allowed ? "Accepted" : "Blocked") : "Verification Result"
  const body = result
    ? `${result.stage}: ${result.reason}`
    : "Run a verifier action to inspect the latest result."
  const indicatorClass =
    tone === "success"
      ? "bg-trust-green"
      : tone === "blocked"
        ? "bg-trust-red"
        : "bg-muted-foreground/40"

  return (
    <div className={`overflow-hidden rounded-lg border ${toneClasses(tone)}`}>
      <div className="flex items-center justify-between gap-3 border-b border-current/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex size-2.5 rounded-full ${indicatorClass}`} />
          <Eyebrow as="div" tone="current">
            Verification result
          </Eyebrow>
        </div>
        {result ? <Badge variant={badgeVariantForTone(tone)}>{result.stage}</Badge> : null}
      </div>
      <div className="p-4">
        <div className="text-3xl font-black tracking-[-0.055em]">{title}</div>
        <p className="mt-3 text-sm leading-6 text-current/74">{body}</p>
        {result?.matched_rule ? (
          <p className="mt-3 rounded-lg border border-current/10 bg-background/35 px-3 py-2 text-xs text-current/72">
            Matched rule:{" "}
            <span className="font-semibold text-current">{result.matched_rule}</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}

export default DecisionPanel
