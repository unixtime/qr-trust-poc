import { Eyebrow } from "@/components/ui/eyebrow"
import { useT } from "@/i18n"
import type { MessageState } from "@/routes/lab/types"
import { toneClasses } from "@/routes/lab/utils"

function StatusPanel({
  label,
  message,
}: {
  // `label` and the message contents arrive already-translated from the
  // controller; only the two empty-state fallbacks are this file's copy.
  label: string
  message: MessageState | null
}) {
  const t = useT()

  return (
    <div className={`rounded-2xl border p-3 ${toneClasses(message?.tone ?? "neutral")}`}>
      <Eyebrow as="div">
        {label}
      </Eyebrow>
      <div className="mt-2 text-sm font-medium">
        {message?.title ?? t("lab.status.waiting")}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">
        {message?.body ?? t("lab.status.noEvent")}
      </div>
    </div>
  )
}

export default StatusPanel
