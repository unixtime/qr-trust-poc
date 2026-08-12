import { Eyebrow } from "@/components/ui/eyebrow"
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
    <div className={`rounded-lg border p-3 ${toneClasses(message?.tone ?? "neutral")}`}>
      <Eyebrow as="div">
        {label}
      </Eyebrow>
      <div className="mt-2 text-sm font-medium">{message?.title ?? "Waiting"}</div>
      <div className="mt-1 text-sm text-muted-foreground">
        {message?.body ?? "No event has been recorded yet."}
      </div>
    </div>
  )
}

export default StatusPanel
