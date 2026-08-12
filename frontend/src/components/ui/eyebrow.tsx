import * as React from "react"

import { cn } from "@/lib/utils"

type EyebrowTone = "muted" | "current" | "primary"

const toneClass: Record<EyebrowTone, string> = {
  muted: "text-muted-foreground",
  current: "text-current/68",
  primary: "text-primary",
}

/**
 * The mono, uppercase, wide-tracked label the site uses above section
 * headings and beside console readouts. One tracking value, one weight,
 * replacing the hand-rolled variants that drifted across both.
 */
function Eyebrow({
  as: Component = "span",
  tone = "muted",
  className,
  ...props
}: React.ComponentPropsWithoutRef<"span"> & {
  as?: "span" | "div" | "legend" | "h2" | "p"
  tone?: EyebrowTone
}) {
  return (
    <Component
      data-slot="eyebrow"
      className={cn(
        "font-mono text-[11px] font-semibold uppercase tracking-[0.16em]",
        toneClass[tone],
        className,
      )}
      {...props}
    />
  )
}

export { Eyebrow, type EyebrowTone }
