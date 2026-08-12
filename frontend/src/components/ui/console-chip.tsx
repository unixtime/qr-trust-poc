import * as React from "react"

import { cn } from "@/lib/utils"
import type { TrustTone } from "@/routes/lab/trust-tone"

const toneClass: Record<TrustTone, string> = {
  green: "border-trust-green/40 bg-trust-green/10 text-trust-green",
  amber: "border-trust-amber/40 bg-trust-amber/10 text-trust-amber",
  red: "border-trust-red/40 bg-trust-red/10 text-trust-red",
}

/**
 * The site's console pill: a small mono, rounded-full chip whose border,
 * ground and text all derive from one tone. Without a `tone` it renders
 * the neutral variant used by the compare toggles.
 */
function ConsoleChip({
  tone,
  pressed = false,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  tone?: TrustTone
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      data-slot="console-chip"
      className={cn(
        "rounded-full border px-3 py-1 font-mono text-xs tracking-[0.06em] transition-colors",
        tone
          ? toneClass[tone]
          : pressed
            ? "border-primary bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
        className,
      )}
      {...props}
    />
  )
}

export { ConsoleChip }
