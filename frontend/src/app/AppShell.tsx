import { useState, type ReactNode } from "react"
import { Moon, Sun } from "lucide-react"

import { cn } from "@/lib/utils"
import { resolveTheme, setTheme, type ThemePreference } from "@/lib/theme"

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
  const [theme, setThemeState] = useState<ThemePreference>(() => resolveTheme())

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark"
    setTheme(next)
    setThemeState(next)
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
              QR
            </span>
            <span className="text-sm font-semibold tracking-tight">
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
          <button
            type="button"
            data-testid="theme-toggle"
            aria-label={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            onClick={toggleTheme}
            className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground"
          >
            {theme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}

export default AppShell
