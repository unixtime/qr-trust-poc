export const locales = ["en", "es"] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = "en"

/** Bumped only if the stored value's shape ever changes. */
const storageKey = "qrtrust.locale"

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value)
}

/** Primary subtag of a BCP 47 tag: "es-419" and "es-ES" both yield "es". */
function primarySubtag(tag: string) {
  return tag.toLowerCase().split("-")[0] ?? ""
}

function storedLocale(): Locale | null {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return isLocale(raw) ? raw : null
  } catch {
    // Safari in private mode throws on localStorage rather than returning
    // null. No stored preference is a normal state, not an error.
    return null
  }
}

function browserLocale(): Locale | null {
  // `navigator.languages` is the ordered preference list; `navigator.language`
  // is only the top entry. Walking the full list means a browser set to
  // [fr, es, en] still lands on Spanish rather than falling through to the
  // default.
  const tags = navigator.languages?.length
    ? navigator.languages
    : [navigator.language]

  for (const tag of tags) {
    const primary = primarySubtag(tag ?? "")
    if (isLocale(primary)) return primary
  }
  return null
}

/**
 * An explicit choice always wins over the browser's preference — once someone
 * picks a language they keep it on the next visit, even on a machine whose
 * system language says otherwise.
 */
export function detectLocale(): Locale {
  if (typeof window === "undefined") return defaultLocale
  return storedLocale() ?? browserLocale() ?? defaultLocale
}

let currentLocale: Locale = detectLocale()

const listeners = new Set<() => void>()

export function getLocale(): Locale {
  return currentLocale
}

/**
 * Kept separate from `getLocale` so `useSyncExternalStore` has a stable
 * server snapshot; the store is read during render by module-level content
 * builders that are not React components.
 */
export function getServerLocale(): Locale {
  return defaultLocale
}

export function subscribeToLocale(onStoreChange: () => void) {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

/**
 * Keeps `<html lang>` in step with the store. Screen readers switch voice on
 * this attribute, so it has to move with the copy rather than stay at the
 * value baked into index.html.
 */
export function syncDocumentLanguage() {
  if (typeof document === "undefined") return
  document.documentElement.lang = currentLocale
}

export function setLocale(next: Locale) {
  if (next === currentLocale) return
  currentLocale = next

  try {
    window.localStorage.setItem(storageKey, next)
  } catch {
    // A rejected write only costs the preference on the next visit; the
    // switch itself has already happened in memory.
  }

  syncDocumentLanguage()
  for (const listener of listeners) listener()
}
