import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { HistoryEntry, Tone } from "@/routes/lab/types"

function toneBadgeVariant(tone: Tone): "secondary" | "destructive" | "outline" {
  if (tone === "success") return "secondary"
  if (tone === "blocked") return "destructive"
  return "outline"
}

export function HistorySection({ history }: { history: HistoryEntry[] }) {
  return (
    <Card data-testid="history-section">
      <CardHeader>
        <CardTitle className="text-base">Recent verifier history</CardTitle>
        <CardDescription>
          The latest generate, accept, block, and admin events stay visible
          here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events yet.</p>
        ) : (
          <ScrollArea className="max-h-72">
            <ul className="flex flex-col gap-3">
              {history.map((entry) => (
                <li key={entry.id} className="rounded-md border p-3">
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
