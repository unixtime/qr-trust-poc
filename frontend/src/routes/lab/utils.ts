import { t } from "@/i18n"
import { VerifierApiError, type VerifierDecision } from "@/lib/verifier-client"
import type { HistoryEntry, Tone } from "@/routes/lab/types"

function clockTimestamp() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/** `HH:MM:SS` on the viewer's local 24-hour clock; null for a missing stamp. */
export function formatLocalClock(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
}

/**
 * `YYYY-MM-DD HH:MM:SS` in the viewer's local time, so the ISSUED row and the
 * scan rows on the sealed-QR card read on one clock.
 */
export function formatLocalDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, "0")
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${day} ${formatLocalClock(iso)}`
}

export function toneForDecision(result: VerifierDecision): Tone {
  return result.allowed ? "success" : "blocked"
}

export function toneClasses(tone: Tone) {
  if (tone === "success") {
    return "border-trust-green/35 bg-trust-green/10 text-trust-green shadow-[0_0_28px_-12px_rgba(69,212,131,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]"
  }
  if (tone === "blocked") {
    return "border-destructive/35 bg-destructive/10 text-destructive shadow-[0_0_28px_-12px_rgba(242,95,92,0.45),inset_0_1px_0_rgba(255,255,255,0.05)]"
  }
  return "border-white/10 bg-white/3 text-card-foreground"
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
    timestamp: clockTimestamp(),
  }
}

export function summariseError(error: unknown) {
  if (error instanceof VerifierApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return t("lab.error.requestFailed")
}

export function summariseSignedVerifierError(error: unknown) {
  if (
    error instanceof VerifierApiError &&
    error.status === 400 &&
    (error.message.includes("valid JSON") ||
      error.message.includes("QR payload") ||
      error.message.includes("signed"))
  ) {
    return t("lab.error.signedProofOnly")
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
