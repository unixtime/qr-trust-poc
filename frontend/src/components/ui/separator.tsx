"use client"

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 data-horizontal:h-px data-horizontal:w-full data-horizontal:bg-linear-90 data-horizontal:from-transparent data-horizontal:via-white/12 data-horizontal:to-transparent data-vertical:w-px data-vertical:self-stretch data-vertical:bg-white/10",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
