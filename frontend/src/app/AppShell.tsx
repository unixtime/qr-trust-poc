import { type ReactNode } from "react"

import { cn } from "@/lib/utils"

type NavItem = {
  path: string
  label: string
  testId: string
}

const navItems: NavItem[] = [
  { path: "/", label: "Workflow", testId: "nav-workflow" },
  { path: "/operator", label: "Operator", testId: "nav-operator" },
  { path: "/about", label: "About", testId: "nav-about" },
]

type AppShellProps = {
  activePath: string
  onNavigate: (path: string) => void
  children: ReactNode
}

export function AppShell({ activePath, onNavigate, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
          <div className="flex items-center gap-2">
            {/* Same file the browser tab uses, so the two marks cannot drift. */}
            <img src="/brand-mark.svg" alt="" width={28} height={28} className="size-7" />
            <span className="text-sm font-semibold font-mono tracking-[0.14em]">
              QR Trust PoC
            </span>
          </div>
          <nav aria-label="Primary" className="flex flex-1 items-center gap-1">
            {navItems.map((item) => {
              const active = activePath === item.path
              return (
                <button
                  key={item.path}
                  type="button"
                  data-testid={item.testId}
                  aria-current={active ? "page" : undefined}
                  onClick={() => onNavigate(item.path)}
                  className={cn(
                    "relative rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                    active &&
                      "text-foreground after:absolute after:inset-x-3 after:-bottom-[7px] after:h-0.5 after:rounded-full after:bg-primary"
                  )}
                >
                  {item.label}
                </button>
              )
            })}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}

export default AppShell
