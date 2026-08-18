import { type ReactNode } from "react"

import { LanguageToggle } from "@/app/LanguageToggle"
import { useT, type MessageKey } from "@/i18n"
import { cn } from "@/lib/utils"

type NavItem = {
  path: string
  labelKey: MessageKey
  testId: string
}

// `labelKey` rather than `label`: this table is a module-level constant, so a
// translated string baked in here would freeze at whichever locale won the
// first page load. The key is stable; only its rendering changes.
const navItems: NavItem[] = [
  { path: "/", labelKey: "shell.nav.workflow", testId: "nav-workflow" },
  { path: "/operator", labelKey: "shell.nav.operator", testId: "nav-operator" },
  { path: "/about", labelKey: "shell.nav.about", testId: "nav-about" },
]

type AppShellProps = {
  activePath: string
  onNavigate: (path: string) => void
  children: ReactNode
}

export function AppShell({ activePath, onNavigate, children }: AppShellProps) {
  const t = useT()


  // No `bg-background` on the wrapper below. The token layer paints the ground
  // on <body> along with the 32px grid the presentation site uses; an opaque
  // background on a full-height wrapper renders that texture and then covers
  // it, which is why the page read as flat navy.
  return (
    <div className="min-h-screen text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-6 px-4">
          <div className="flex items-center gap-2">
            {/* The presentation site's brand pair, same paths and same glyph:
                the bare mark rides the page ground here, and the tab gets
                favicon.svg — the same glyph on a filled tile, because a
                hairline stroke on transparent disappears at 16px against
                browser chrome. Keep both in step with qrtrust-site/public. */}
            <img src="/brand/mark.svg" alt="" width={24} height={24} className="h-6 w-6" />
            <span className="text-sm font-semibold tracking-tight">
              QR <span className="text-primary">Trust</span>{" "}
              <span className="text-muted-foreground">PoC</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <nav
              aria-label={t("shell.nav.label")}
              className="flex items-center gap-1"
            >
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
                    {t(item.labelKey)}
                  </button>
                )
              })}
            </nav>
            <LanguageToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}

export default AppShell
