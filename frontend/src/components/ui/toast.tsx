import {
  AlertTriangle,
  CheckCircle2,
  Info,
  ShieldX,
  X,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"

export type ToastTone = "success" | "warning" | "blocked" | "neutral"

export type ToastMessage = {
  id: string
  title: string
  body?: string
  tone: ToastTone
}

const toastToneClass: Record<
  ToastTone,
  { frame: string; icon: string; Icon: LucideIcon }
> = {
  success: {
    frame: "border-trust-green/35 bg-linear-180 from-[rgba(15,25,39,0.92)] to-[rgba(9,16,26,0.94)] text-foreground shadow-[0_24px_48px_-24px_rgba(0,0,0,0.8),0_0_24px_rgba(69,212,131,0.12),inset_0_1px_0_rgba(255,255,255,0.06)]",
    icon: "bg-trust-green/15 text-trust-green",
    Icon: CheckCircle2,
  },
  warning: {
    frame: "border-trust-amber/35 bg-linear-180 from-[rgba(15,25,39,0.92)] to-[rgba(9,16,26,0.94)] text-foreground shadow-[0_24px_48px_-24px_rgba(0,0,0,0.8),0_0_24px_rgba(245,165,36,0.12),inset_0_1px_0_rgba(255,255,255,0.06)]",
    icon: "bg-trust-amber/15 text-trust-amber",
    Icon: AlertTriangle,
  },
  blocked: {
    frame: "border-trust-red/35 bg-linear-180 from-[rgba(15,25,39,0.92)] to-[rgba(9,16,26,0.94)] text-foreground shadow-[0_24px_48px_-24px_rgba(0,0,0,0.8),0_0_24px_rgba(242,95,92,0.12),inset_0_1px_0_rgba(255,255,255,0.06)]",
    icon: "bg-trust-red/15 text-trust-red",
    Icon: ShieldX,
  },
  neutral: {
    frame: "border-white/10 bg-linear-180 from-[rgba(15,25,39,0.92)] to-[rgba(9,16,26,0.94)] text-card-foreground shadow-[0_24px_48px_-24px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.06)]",
    icon: "bg-white/8 text-muted-foreground",
    Icon: Info,
  },
}

export function ToastNotification({
  toast,
  onDismiss,
}: {
  toast: ToastMessage | null
  onDismiss: () => void
}) {
  if (!toast) return null

  const { frame, icon, Icon } = toastToneClass[toast.tone]

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-3 top-24 z-[100] sm:left-auto sm:right-4 sm:w-[min(24rem,calc(100vw-2rem))]"
    >
      <div
        role="status"
        data-testid="scan-status-toast"
        className={cn(
          "pointer-events-auto flex items-start gap-3 rounded-2xl border p-3 backdrop-blur-md",
          frame,
        )}
      >
        <div
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            icon,
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-5">{toast.title}</div>
          {toast.body ? (
            <div className="mt-1 text-sm leading-5 opacity-80">{toast.body}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-current opacity-70 transition hover:bg-current/10 hover:opacity-100"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
