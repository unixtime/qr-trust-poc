import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { HistoryEntry } from "@/routes/lab/types"
import { badgeVariantForTone, toneClasses } from "@/routes/lab/utils"

function HistorySection({ history }: { history: HistoryEntry[] }) {
  return (
    <Card className="security-card rounded-[1.9rem] bg-card/94">
      <CardHeader>
        <CardTitle className="text-lg font-black tracking-[-0.035em]">
          Recent verifier history
        </CardTitle>
        <CardDescription>
          The latest generate, accept, block, and admin events stay visible here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[260px] rounded-[1.2rem] border border-border/70 bg-background/80">
          <div className="grid gap-3 p-3">
            {history.map((entry) => (
              <div key={entry.id} className={`rounded-2xl border p-3 ${toneClasses(entry.tone)}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{entry.title}</div>
                  <Badge variant={badgeVariantForTone(entry.tone)}>{entry.timestamp}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{entry.body}</p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

export default HistorySection
