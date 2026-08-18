import { Fragment, type ReactNode } from "react"

import { useLocale } from "@/i18n"
import { type MessageKey } from "@/i18n/catalog/en"
import { translate } from "@/i18n"

const placeholderPattern = /\{(\w+)\}/g

export type NodeValues = Record<string, ReactNode>

/**
 * Substitutes React nodes into a message's `{placeholders}`.
 *
 * Sentences that wrap part of themselves in markup — a bolded route, a linked
 * word — cannot be split into "before" and "after" halves and reassembled,
 * because Spanish puts the clauses in a different order than English. Keeping
 * the whole sentence as one translatable message and letting the translation
 * decide *where* the markup lands is the only arrangement that survives
 * reordering.
 */
export function interpolateNodes(message: string, values: NodeValues) {
  const parts: ReactNode[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  placeholderPattern.lastIndex = 0
  while ((match = placeholderPattern.exec(message)) !== null) {
    const [token, name] = match
    if (!(name in values)) continue

    if (match.index > cursor) parts.push(message.slice(cursor, match.index))
    parts.push(
      <Fragment key={`${name}-${match.index}`}>{values[name]}</Fragment>
    )
    cursor = match.index + token.length
  }

  if (cursor < message.length) parts.push(message.slice(cursor))
  return parts
}

export function useTNodes() {
  const locale = useLocale()
  return (key: MessageKey, values: NodeValues) =>
    interpolateNodes(translate(locale, key), values)
}
