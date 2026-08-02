const THEME_STORAGE_KEY = "qr-poc-theme"

export type ThemePreference = "light" | "dark"

function systemPrefersDark() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  )
}

export function resolveTheme(): ThemePreference {
  if (typeof window === "undefined") return "light"
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === "light" || stored === "dark") return stored
  return systemPrefersDark() ? "dark" : "light"
}

export function applyTheme(theme: ThemePreference) {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

export function setTheme(theme: ThemePreference) {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  applyTheme(theme)
}

export function initTheme() {
  applyTheme(resolveTheme())
}
