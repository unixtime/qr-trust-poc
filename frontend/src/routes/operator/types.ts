type Tone = "neutral" | "success" | "blocked"

export type MessageState = {
  title: string
  body: string
  tone: Tone
}
