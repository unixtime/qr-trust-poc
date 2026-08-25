import { useEffect, useRef, useState, type ReactNode } from "react"
import { Menu, X } from "lucide-react"

import { LanguageToggle } from "@/app/LanguageToggle"
import { useT, type MessageKey } from "@/i18n"
import { requestJson, type VerifierStatus } from "@/lib/verifier-client"
import { cn } from "@/lib/utils"

type ProbeState = "checking" | "operational" | "offline"

const statusLabelKeys: Record<ProbeState, MessageKey> = {
  checking: "shell.status.checking",
  operational: "shell.status.operational",
  offline: "shell.status.offline",
}

// The halo shadow doubles as the state signal: a soft ring plus a glow when
// the verifier answers, red when it does not, and no glow at all while the
// first probe is still in flight — a pill that never claims what it has not
// yet observed.
const statusTone: Record<ProbeState, { pill: string; dot: string }> = {
  checking: {
    pill: "border-white/10 bg-white/4 text-muted-foreground",
    dot: "bg-white/30",
  },
  operational: {
    pill: "border-[rgba(69,212,131,0.3)] bg-[rgba(69,212,131,0.08)] text-trust-green",
    dot: "bg-trust-green shadow-[0_0_0_3px_rgba(69,212,131,0.18),0_0_10px_rgba(69,212,131,0.8)]",
  },
  offline: {
    pill: "border-[rgba(242,95,92,0.3)] bg-[rgba(242,95,92,0.08)] text-trust-red",
    dot: "bg-trust-red shadow-[0_0_0_3px_rgba(242,95,92,0.18),0_0_10px_rgba(242,95,92,0.8)]",
  },
}

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
  const [menuOpen, setMenuOpen] = useState(false)
  const [probeState, setProbeState] = useState<ProbeState>("checking")

  // Same probe FlowPage runs for its status panel, but on the shell's own
  // cadence: one check at mount, then once a minute. The response body is
  // ignored — reachability alone decides the pill, so a degraded-but-answering
  // verifier still reads as operational here and the nuance stays on the
  // status panel where there is room for it.
  useEffect(() => {
    let cancelled = false
    const probe = () => {
      requestJson<VerifierStatus>("/verifier/status")
        .then(() => {
          if (!cancelled) setProbeState("operational")
        })
        .catch(() => {
          if (!cancelled) setProbeState("offline")
        })
    }
    probe()
    const interval = window.setInterval(probe, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  // The inline link row can still scroll at tablet widths (the Spanish labels
  // are the widest), so landing on /about could hide its own active pill off
  // the right edge. `inline: "nearest"` only moves the nav's horizontal
  // scroll; `block: "nearest"` is a no-op because the sticky header is always
  // in view.
  const activeNavRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeNavRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" })
  }, [activePath])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [menuOpen])

  const navigate = (path: string) => {
    setMenuOpen(false)
    onNavigate(path)
  }

  // No `bg-background` on the wrapper below. The token layer paints the aurora
  // ground on <body> along with its hairline grid; an opaque background on a
  // full-height wrapper renders that texture and then covers it, which is why
  // the page read as flat navy.
  return (
    <div className="flex min-h-screen flex-col text-foreground">
      <div className="border-b border-white/5 bg-[rgba(5,10,18,0.6)]">
        <div className="mx-auto flex h-[34px] w-full max-w-6xl items-center justify-between gap-4 px-4 font-mono text-[10px] tracking-[0.14em] uppercase text-[rgba(143,160,181,0.75)]">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-2 text-primary/90">
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(69,212,131,0.9)]"
              />
              {/* Brand designation, deliberately hardcoded like the wordmark. */}
              QRTRUST CORE
            </span>
            <span className="hidden sm:inline">{t("shell.microbar.protocol")}</span>
          </div>
          <span className="hidden md:inline">{t("shell.microbar.build")}</span>
        </div>
      </div>
      <header className="sticky top-0 z-40 px-4 pt-3 pb-2">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 rounded-full border border-white/8 bg-linear-180 from-[rgba(15,25,39,0.88)] to-[rgba(9,16,26,0.88)] pl-3 pr-2 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-[18px] sm:h-[60px] sm:pl-5 sm:pr-3">
          <div className="flex shrink-0 items-center gap-2">
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
          {/* Inline pills from `sm` up. `min-w-0` + `overflow-x-auto` stay as
              a safety net: the Spanish labels ("Flujo de trabajo") are wide
              enough to graze the pill at the narrow end of the tablet range,
              and a scrolling row degrades better than a clipped one. The
              scrollbar is hidden — the pill is a capsule, not a pane. */}
          <div className="hidden min-w-0 flex-1 items-center justify-end gap-3 sm:flex">
            <nav
              aria-label={t("shell.nav.label")}
              className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {navItems.map((item) => {
                const active = activePath === item.path
                return (
                  <button
                    key={item.path}
                    type="button"
                    ref={active ? activeNavRef : undefined}
                    data-testid={item.testId}
                    aria-current={active ? "page" : undefined}
                    onClick={() => navigate(item.path)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                      active && "bg-primary/12 text-foreground"
                    )}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(69,212,131,0.9)]"
                      />
                    )}
                    {t(item.labelKey)}
                  </button>
                )
              })}
            </nav>
            {/* `hidden lg:flex`: the tablet range is already tight once the
                Spanish nav labels are in play; the pill is ambient status, so
                it is the first thing to yield. */}
            <span
              data-testid="verifier-status-pill"
              className={cn(
                "hidden shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] font-semibold tracking-[0.14em] uppercase lg:flex",
                statusTone[probeState].pill
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "size-[7px] rounded-full",
                  statusTone[probeState].dot
                )}
              />
              {t(statusLabelKeys[probeState])}
            </span>
            <LanguageToggle className="shrink-0" />
          </div>
          {/* Below `sm` the links move into a dropdown; the language toggle
              stays in the header so someone stranded in the wrong language
              never has to find it behind a menu icon. */}
          <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
            <LanguageToggle />
            <button
              type="button"
              data-testid="nav-menu"
              aria-label={t("shell.nav.menu")}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpen((open) => !open)}
              className={cn(
                "flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
                menuOpen && "bg-primary/12 text-foreground"
              )}
            >
              {menuOpen ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <>
            {/* Click-away layer. `fixed` still spans the viewport from inside
                the sticky header, and both layers sit in the header's z-40
                stacking context, so z-10/z-20 here beat all page content. */}
            <div
              aria-hidden
              className="fixed inset-0 z-10 sm:hidden"
              onClick={() => setMenuOpen(false)}
            />
            <div
              id="mobile-nav"
              className="absolute inset-x-4 top-full z-20 mt-1 rounded-3xl border border-white/8 bg-linear-180 from-[rgba(15,25,39,0.97)] to-[rgba(9,16,26,0.97)] p-2 shadow-[0_24px_48px_-24px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-[18px] sm:hidden"
            >
              <nav aria-label={t("shell.nav.label")} className="flex flex-col gap-0.5">
                {navItems.map((item) => {
                  const active = activePath === item.path
                  return (
                    <button
                      key={item.path}
                      type="button"
                      data-testid={`${item.testId}-mobile`}
                      aria-current={active ? "page" : undefined}
                      onClick={() => navigate(item.path)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-2xl px-4 py-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                        active && "bg-primary/12 text-foreground"
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 rounded-full",
                          active
                            ? "bg-primary shadow-[0_0_8px_rgba(69,212,131,0.9)]"
                            : "bg-white/15"
                        )}
                      />
                      {t(item.labelKey)}
                    </button>
                  )
                })}
              </nav>
            </div>
          </>
        )}
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <footer className="mt-8 border-t border-transparent [border-image:linear-gradient(90deg,transparent,rgba(69,212,131,0.35),transparent)_1]">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-3 px-4 py-5 font-mono text-[10px] tracking-[0.14em] uppercase text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="text-primary/80">QR TRUST CORE</span>
            {" — "}
            {t("shell.footer.tagline")}
          </span>
          <nav aria-label={t("shell.nav.label")} className="flex items-center gap-4">
            {navItems.map((item) => (
              <button
                key={item.path}
                type="button"
                onClick={() => onNavigate(item.path)}
                className="tracking-[0.14em] uppercase transition-colors hover:text-foreground"
              >
                {t(item.labelKey)}
              </button>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  )
}

export default AppShell
