import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useT } from "@/i18n"
import type { HistoryEntry, Tone } from "@/routes/lab/types"

function toneBadgeVariant(tone: Tone): "secondary" | "destructive" | "outline" {
  if (tone === "success") return "secondary"
  if (tone === "blocked") return "destructive"
  return "outline"
}

export function HistorySection({ history }: { history: HistoryEntry[] }) {
  const t = useT()

  return (
    <Card data-testid="history-section">
      <CardHeader>
        <CardTitle className="text-base">{t("lab.history.title")}</CardTitle>
        <CardDescription>{t("lab.history.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("lab.history.empty")}
          </p>
        ) : (
          <ScrollArea className="max-h-72">
            <ul className="flex flex-col gap-3">
              {history.map((entry) => (
                <li key={entry.id} className="rounded-2xl border border-white/8 bg-white/3 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{entry.title}</p>
                    <Badge variant={toneBadgeVariant(entry.tone)}>
                      {entry.timestamp}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {entry.body}
                  </p>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
