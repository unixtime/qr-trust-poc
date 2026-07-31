import { Badge } from "@/components/ui/badge"
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
      ? "bg-emerald-500"
      : tone === "blocked"
        ? "bg-red-500"
        : "bg-muted-foreground/40"

  return (
    <div className={`overflow-hidden rounded-[1.65rem] border shadow-[0_14px_36px_rgba(28,35,30,0.07)] ${toneClasses(tone)}`}>
      <div className="flex items-center justify-between gap-3 border-b border-current/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex size-2.5 rounded-full ${indicatorClass}`} />
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-current/68">
            Verification result
          </div>
        </div>
        {result ? <Badge variant={badgeVariantForTone(tone)}>{result.stage}</Badge> : null}
      </div>
      <div className="p-4">
        <div className="text-3xl font-black tracking-[-0.055em]">{title}</div>
        <p className="mt-3 text-sm leading-6 text-current/74">{body}</p>
        {result?.matched_rule ? (
          <p className="mt-3 rounded-2xl border border-current/10 bg-background/35 px-3 py-2 text-xs text-current/72">
            Matched rule:{" "}
            <span className="font-semibold text-current">{result.matched_rule}</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}

export default DecisionPanel
