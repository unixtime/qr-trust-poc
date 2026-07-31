import type { MessageState } from "@/routes/lab/types"
import { toneClasses } from "@/routes/lab/utils"

function StatusPanel({
  label,
  message,
}: {
  label: string
  message: MessageState | null
}) {
  return (
    <div className={`rounded-2xl border p-3 ${toneClasses(message?.tone ?? "neutral")}`}>
      <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium">{message?.title ?? "Waiting"}</div>
      <div className="mt-1 text-sm text-muted-foreground">
        {message?.body ?? "No event has been recorded yet."}
      </div>
    </div>
  )
}

export default StatusPanel
