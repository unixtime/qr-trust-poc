import { createHash } from "node:crypto"

type JsonLike =
  | null
  | boolean
  | number
  | string
  | JsonLike[]
  | { readonly [key: string]: JsonLike }

export const canonicalJsonStringify = (value: unknown): string =>
  JSON.stringify(canonicalizeForJson(value))

export const hashJson = (value: unknown): string =>
  createHash("sha256").update(canonicalJsonStringify(value)).digest("hex")

const canonicalizeForJson = (value: unknown): JsonLike => {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map((entry) =>
      typeof entry === "undefined" ? null : canonicalizeForJson(entry),
    )
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => typeof entry !== "undefined")
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeForJson(entry)]),
    )
  }

  return null
}
