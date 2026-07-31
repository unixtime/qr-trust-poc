import { CircleAlert } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import type { MessageState } from "@/routes/operator/types"

function StatusBanner({ message }: { message: MessageState | null }) {
  if (!message) return null

  return (
    <Alert variant={message.tone === "blocked" ? "destructive" : "default"}>
      <CircleAlert />
      <AlertTitle>{message.title}</AlertTitle>
      <AlertDescription>{message.body}</AlertDescription>
    </Alert>
  )
}

export default StatusBanner
