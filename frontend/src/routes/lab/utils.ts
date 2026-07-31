import { VerifierApiError, type VerifierDecision } from "@/lib/verifier-client"
import type { HistoryEntry, Tone } from "@/routes/lab/types"

function isoTimestamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function toneForDecision(result: VerifierDecision): Tone {
  return result.allowed ? "success" : "blocked"
}

export function toneClasses(tone: Tone) {
  if (tone === "success") {
    return "border-emerald-600/20 bg-emerald-500/10 text-emerald-950"
  }
  if (tone === "blocked") {
    return "border-destructive/20 bg-destructive/10 text-destructive"
  }
  return "border-border bg-card text-card-foreground"
}

export function badgeVariantForTone(
  tone: Tone,
): "default" | "secondary" | "destructive" | "outline" {
  if (tone === "success") return "secondary"
  if (tone === "blocked") return "destructive"
  return "outline"
}

export function toHistoryEntry(title: string, body: string, tone: Tone): HistoryEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title,
    body,
    tone,
    timestamp: isoTimestamp(),
  }
}

export function compactCount(value: boolean) {
  return value ? "enabled" : "disabled"
}

export function summariseError(error: unknown) {
  if (error instanceof VerifierApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return "The verifier request failed."
}

export function summariseSignedVerifierError(error: unknown) {
  if (
    error instanceof VerifierApiError &&
    error.status === 400 &&
    (error.message.includes("valid JSON") ||
      error.message.includes("QR payload") ||
      error.message.includes("signed"))
  ) {
    return "The signed-verifier proof only accepts generated QR Trust envelopes. Use the scanner-decision check for ordinary web links, camera scans, and user-facing safety results."
  }

  return summariseError(error)
}

export function dataUrlToBase64(dataUrl: string) {
  const [, base64] = dataUrl.split(",", 2)
  if (!base64) {
    throw new Error("The generated frame is not valid base64 image data.")
  }
  return base64
}
