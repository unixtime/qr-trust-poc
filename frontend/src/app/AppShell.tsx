import {
  BookOpen,
  FlaskConical,
  LockKeyhole,
  Route,
  ShieldEllipsis,
} from "lucide-react"
import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type NavItem = {
  path: string
  label: string
  summary: string
  detail: string
  icon: ReactNode
}

const navItems: NavItem[] = [
  {
    path: "/lab",
    label: "Lab",
    summary: "Working verifier demo for engineers",
    detail: "Generate, scan, mutate, and verify implementation-backed QR scenarios.",
    icon: <FlaskConical className="size-4" />,
  },
  {
    path: "/operator",
    label: "Operator",
    summary: "Runtime posture and access controls",
    detail: "Inspect replay posture, runtime health, and controlled operator surfaces.",
    icon: <ShieldEllipsis className="size-4" />,
  },
  {
    path: "/learn",
    label: "Learn",
    summary: "Guided paper companion",
    detail: "Walk the paper model through diagrams, case studies, and live lab handoffs.",
    icon: <BookOpen className="size-4" />,
  },
]

type AppShellProps = {
  activePath: string
  onNavigate: (path: string) => void
  children: ReactNode
}

function AppShell({ activePath, onNavigate, children }: AppShellProps) {
  const normalizedPath = activePath === "/" ? "/lab" : activePath
  const activeItem =
    navItems.find((item) => item.path === normalizedPath) ?? navItems[0]

  return (
    <div className="trust-grid-bg min-h-screen bg-[#f6f0e3]">
      <header className="sticky top-0 z-40 border-b border-emerald-950/10 bg-[#fbf8ef]/95 shadow-[0_8px_24px_rgba(24,32,26,0.06)] backdrop-blur-xl">
        <div className="mx-auto grid max-w-[1500px] gap-3 px-3 py-2.5 sm:px-4 md:px-6 xl:grid-cols-[minmax(320px,0.66fr)_minmax(560px,1fr)] xl:items-center xl:px-8">
          <div className="flex min-w-0 items-start gap-3">
            <div className="brand-mark brand-mark--shell mt-1" aria-hidden="true">
              <span>QRT</span>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-emerald-950/10 bg-emerald-600/10 text-emerald-950">
                  QR Trust PoC
                </Badge>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/78 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <Route className="size-3" />
                  {normalizedPath}
                </span>
                <span className="hidden items-center gap-1.5 rounded-full border border-amber-500/18 bg-amber-100/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900 md:inline-flex">
                  <LockKeyhole className="size-3" />
                  scanner-visible trust
                </span>
              </div>
              <h1 className="mt-1 truncate text-lg font-semibold tracking-[-0.035em] text-foreground md:text-xl">
                {activeItem.summary}
              </h1>
              <p className="hidden max-w-3xl text-sm leading-5 text-muted-foreground lg:block">
                {activeItem.detail}
              </p>
            </div>
          </div>

          <nav aria-label="Primary product modes" className="grid grid-cols-3 gap-2">
            {navItems.map((item) => {
              const active = normalizedPath === item.path
              return (
                <button
                  key={item.path}
                  type="button"
                  aria-label={`${item.label}: ${item.summary}`}
                  aria-current={active ? "page" : undefined}
                  onClick={() => onNavigate(item.path)}
                  className={cn(
                    "group relative flex min-h-12 items-center justify-center gap-1.5 overflow-hidden rounded-[0.9rem] border px-1.5 py-2 text-left transition-[background-color,border-color,color,box-shadow,transform] duration-200 sm:justify-start sm:gap-3 sm:px-3",
                    active
                      ? "border-emerald-800/20 bg-emerald-700 text-white shadow-[0_12px_28px_rgba(20,122,87,0.18)]"
                      : "border-border/70 bg-card/80 text-muted-foreground shadow-[0_6px_16px_rgba(28,35,30,0.035)] hover:-translate-y-0.5 hover:border-emerald-900/16 hover:bg-card hover:text-foreground hover:shadow-[0_12px_26px_rgba(28,35,30,0.06)]",
                  )}
                >
                  {active ? (
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(255,255,255,0.22),transparent_30%),linear-gradient(120deg,rgba(255,255,255,0.12),transparent_44%)]" />
                  ) : null}
                  <div
                    className={cn(
                      "relative grid size-7 shrink-0 place-items-center rounded-[0.75rem] border sm:size-9 sm:rounded-[0.9rem]",
                      active
                        ? "border-white/16 bg-white/12 text-white"
                        : "border-border/70 bg-background/76 text-muted-foreground group-hover:text-emerald-800",
                    )}
                  >
                    {item.icon}
                  </div>
                  <div className="relative min-w-0">
                    <div className="truncate text-center text-xs font-black tracking-[-0.01em] sm:text-left sm:text-sm">
                      {item.label}
                    </div>
                    <div
                      className={cn(
                        "mt-0.5 hidden truncate text-xs leading-5 sm:block",
                        active ? "text-white/76" : "text-muted-foreground",
                      )}
                    >
                      {item.summary}
                    </div>
                  </div>
                </button>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="relative">{children}</main>

      <footer className="border-t border-emerald-950/10 bg-[#fbf8ef]/70 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-5 text-sm text-muted-foreground md:px-6 xl:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-emerald-700/10 p-2 text-emerald-800">
              <LockKeyhole className="size-4" />
            </div>
            <div>
              <div className="font-semibold text-foreground">
                Reference verifier, not a passive QR reader.
              </div>
              <div className="mt-0.5">
                Keep the implementation runnable, then use guided mode to explain
                why each technical result becomes a user-visible decision.
              </div>
            </div>
          </div>
          <Button variant="outline" className="rounded-full" onClick={() => onNavigate("/lab")}>
            Return to lab
          </Button>
        </div>
      </footer>
    </div>
  )
}

export default AppShell
