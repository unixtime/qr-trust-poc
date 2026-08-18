import { useCallback, useSyncExternalStore } from "react"

import { en, type MessageKey } from "@/i18n/catalog/en"
import { es } from "@/i18n/catalog/es"
import {
  getLocale,
  getServerLocale,
  subscribeToLocale,
  type Locale,
} from "@/i18n/locale"

export type { Locale, MessageKey }
export {
  defaultLocale,
  detectLocale,
  isLocale,
  locales,
  setLocale,
  syncDocumentLanguage,
} from "@/i18n/locale"

const catalogs: Record<Locale, Record<MessageKey, string>> = { en, es }

export type MessageValues = Record<string, string | number>

export type Translate = (key: MessageKey, values?: MessageValues) => string

const placeholderPattern = /\{(\w+)\}/g

function interpolate(message: string, values: MessageValues) {
  return message.replace(placeholderPattern, (match, name: string) =>
    name in values ? String(values[name]) : match
  )
}

/**
 * `es` is typed against `en`'s keys, so a missing entry is a compile error
 * rather than a runtime hole. The `??` is the belt to that braces: a catalog
 * regenerated against a stale `en` still renders English instead of a raw key.
 */
export function translate(
  locale: Locale,
  key: MessageKey,
  values?: MessageValues
) {
  const message = catalogs[locale][key] ?? en[key] ?? key
  return values ? interpolate(message, values) : message
}

/**
 * Locale-current translate for module code that runs outside React — the
 * scenario and console copy tables are plain functions, not components.
 * Anything using this must be called *during* render, not at import time, or
 * it freezes the language at whichever locale won the first page load.
 */
export function t(key: MessageKey, values?: MessageValues) {
  return translate(getLocale(), key, values)
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeToLocale, getLocale, getServerLocale)
}

export function useT(): Translate {
  const locale = useLocale()
  return useCallback(
    (key: MessageKey, values?: MessageValues) =>
      translate(locale, key, values),
    [locale]
  )
}
