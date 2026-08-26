import type { ScanActivity } from "@/lib/verifier-client"

/**
 * What the QR frame knows about scans of the current code, derived from
 * `GET /verifier/scan-activity`. Kept free of React so the smoke script can
 * pin the mapping without a DOM.
 */
export type ScanFeedbackState =
  | "checking"
  | "offline"
  | "unavailable"
  | "waiting"
  | "green"
  | "orange"
  | "red"

/** Frame glow colour; `null` leaves the frame neutral. */
export type ScanFeedbackTone = "green" | "amber" | "red"

export function scanFeedbackStateFor(
  activity: ScanActivity | null,
  error: string | null,
): ScanFeedbackState {
  if (!activity) return error ? "offline" : "checking"
  if (activity.persistence_state !== "observable") return "unavailable"
  if (activity.scan_count === 0 || !activity.latest) return "waiting"
  return activity.latest.decision_color
}

/**
 * Nothing goes on the image until there is something true to say about it:
 * a verdict, which glows the frame in its own colour before the message
 * appears, or an honest "the evidence store cannot answer" pill. Before the
 * first scan the code simply sits in its frame — a "waiting" pill assumed
 * the scanner was a phone and read as an instruction rather than a state.
 */
export function scanFeedbackPresentation(state: ScanFeedbackState): {
  tone: ScanFeedbackTone | null
  pill: boolean
} {
  switch (state) {
    case "green":
      return { tone: "green", pill: true }
    case "orange":
      return { tone: "amber", pill: true }
    case "red":
      return { tone: "red", pill: true }
    case "offline":
    case "unavailable":
      return { tone: null, pill: true }
    case "waiting":
    case "checking":
      return { tone: null, pill: false }
  }
}

/**
 * Identity of the scan the frame should pulse for, or `null` when there is
 * no verdict to pulse. The frame keys its pulse layer on this, so React
 * remounts the layer (and restarts the CSS animation) exactly when a new
 * scan lands: polling the same scan again keeps the key and stays quiet.
 */
export function scanPulseKey(activity: ScanActivity | null): string | null {
  const state = scanFeedbackStateFor(activity, null)
  if (state !== "green" && state !== "orange" && state !== "red") return null
  return `${activity?.scan_count ?? 0}:${activity?.last_scanned_at ?? ""}`
}
