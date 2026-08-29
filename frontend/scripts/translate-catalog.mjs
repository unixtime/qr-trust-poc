/**
 * Regenerates `src/i18n/catalog/es.ts` from `en.ts` via the DeepL API.
 *
 * Run with `npm run i18n:translate`, which supplies the two flags this needs:
 * `--env-file-if-exists=../.env` so the key arrives through the environment
 * rather than through this file, and `--experimental-strip-types` so the
 * English catalogue can be imported as the module it is instead of parsed
 * back out of its own source.
 *
 * Translation happens at build time, not in the browser. The alternative —
 * calling DeepL from the running app — would put the API key in a client
 * bundle, bill per page view, and make the Spanish copy unreviewable in diffs.
 *
 * DeepL bills per character, so only keys whose English text actually changed
 * are re-sent; `es.meta.json` records the hash each existing translation was
 * produced from. A no-op run costs nothing.
 */
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const catalogDir = resolve(here, "../src/i18n/catalog")
const enPath = resolve(catalogDir, "en.ts")
const esPath = resolve(catalogDir, "es.ts")
const metaPath = resolve(catalogDir, "es.meta.json")
const overridesPath = resolve(catalogDir, "es.overrides.json")

const targetLang = "ES"
const batchSize = 50

/**
 * Steers register and terminology. DeepL treats this as surrounding context
 * only — it is not translated and not billed.
 */
const translationContext =
  "User interface copy for a QR code security verification console. " +
  "Terms of art: issuer, verifier, envelope, destination binding, runtime " +
  "safety, residual, verdict, revocation."

function fail(message) {
  console.error(`translate-catalog: ${message}`)
  process.exit(1)
}

const authKey = process.env.DEEPL_API_KEY
if (!authKey) {
  fail(
    "DEEPL_API_KEY is not set. Add it to the repository-root .env — " +
      "npm run i18n:translate reads that file."
  )
}

// DeepL issues free-tier keys with a `:fx` suffix and routes them to a
// different host; sending a free key to the Pro host answers 403.
const apiHost = authKey.endsWith(":fx")
  ? "https://api-free.deepl.com"
  : "https://api.deepl.com"

function hashOf(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16)
}

const xmlEscapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;" }

/**
 * `tag_handling: "xml"` means the payload has to *be* valid XML, so literal
 * angle brackets and ampersands in the copy would otherwise be parsed as
 * markup and silently dropped.
 */
function escapeXml(text) {
  return text.replace(/[&<>]/g, (char) => xmlEscapes[char])
}

function unescapeXml(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

/**
 * `{placeholder}` tokens are substituted at render time and must survive
 * translation byte-for-byte. Wrapping them in a tag listed under
 * `ignore_tags` is DeepL's documented mechanism for this; left bare, they get
 * translated, reordered, or have their braces reflowed.
 */
function protectPlaceholders(text) {
  return escapeXml(text).replace(/\{(\w+)\}/g, "<x>{$1}</x>")
}

function restorePlaceholders(text) {
  return unescapeXml(text.replace(/<x>\s*(\{\w+\})\s*<\/x>/g, "$1"))
}

async function translateBatch(texts) {
  const response = await fetch(`${apiHost}/v2/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${authKey}`,
      "Content-Type": "application/json",
      "User-Agent": "qr-trust-poc-i18n/1.0",
    },
    body: JSON.stringify({
      text: texts.map(protectPlaceholders),
      source_lang: "EN",
      target_lang: targetLang,
      context: translationContext,
      formality: "prefer_more",
      tag_handling: "xml",
      tag_handling_version: "v2",
      ignore_tags: ["x"],
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    fail(
      `DeepL responded ${response.status} ${response.statusText}. ${detail}`.trim()
    )
  }

  const payload = await response.json()
  if (!Array.isArray(payload.translations)) {
    fail("DeepL response had no translations array.")
  }
  if (payload.translations.length !== texts.length) {
    fail(
      `DeepL returned ${payload.translations.length} translations for ` +
        `${texts.length} inputs; refusing to write a misaligned catalogue.`
    )
  }

  return payload.translations.map((entry) => restorePlaceholders(entry.text))
}

/**
 * Hand-written Spanish that outranks whatever DeepL returns for the same key.
 *
 * Machine translation is reliably good at prose and reliably bad at this
 * project's terms of art — "residual" came back as "residuos", the word for
 * rubbish. Corrections have to live outside the generated file or the next
 * run silently reverts them, and they have to be keyed rather than global so
 * a term can be fixed in the one sentence that got it wrong.
 */
async function readOverrides() {
  try {
    const raw = JSON.parse(await readFile(overridesPath, "utf8"))
    // JSON has no comments, so `_`-prefixed keys carry the file's own
    // documentation. They are notes, not message keys.
    return Object.fromEntries(
      Object.entries(raw).filter(([key]) => !key.startsWith("_"))
    )
  } catch {
    return {}
  }
}

async function readExisting() {
  try {
    const meta = JSON.parse(await readFile(metaPath, "utf8"))
    const module = await import(pathToFileURL(esPath).href)
    return { meta, translations: module.es ?? {} }
  } catch {
    // No previous run, or a catalogue that no longer parses. Either way the
    // correct recovery is a full translation pass.
    return { meta: {}, translations: {} }
  }
}

function renderCatalog(entries) {
  const body = entries
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
    .join("\n")

  return `/**
 * Generated by \`npm run i18n:translate\` — do not edit by hand.
 *
 * Typed as \`Record<MessageKey, string>\` on purpose: a key added to \`en.ts\`
 * without regenerating this file is a compile error, not a string that
 * silently renders in English.
 *
 * Corrections go in \`es.overrides.json\`, keyed the same way. Editing this
 * file directly works until the next run and then silently reverts.
 */
// A full \`import type\` rather than an inline \`{ type X }\` specifier: the
// former is erased outright by \`node --experimental-strip-types\`, while the
// latter leaves a bare side-effect import that Node cannot resolve through
// Vite's \`@/\` alias when this script reads the file back on the next run.
import type { MessageKey } from "@/i18n/catalog/en"

export const es: Record<MessageKey, string> = {
${body}
}
`
}

async function main() {
  const { en } = await import(pathToFileURL(enPath).href)
  const existing = await readExisting()
  const overrides = await readOverrides()

  const keys = Object.keys(en)
  const stale = keys.filter(
    (key) =>
      existing.translations[key] === undefined ||
      existing.meta[key] !== hashOf(en[key])
  )
  const dropped = Object.keys(existing.translations).filter(
    (key) => !(key in en)
  )

  console.log(
    `translate-catalog: ${keys.length} keys, ${stale.length} to translate, ` +
      `${dropped.length} obsolete, host ${new URL(apiHost).host}`
  )

  // No early return when `stale` is empty. Translation is not the only input:
  // an edit to `es.overrides.json` changes the output with nothing to
  // translate, and returning early would silently ignore it. Rewriting an
  // unchanged file is byte-identical, so an idle run still shows no diff.
  const translations = { ...existing.translations }
  const meta = { ...existing.meta }

  for (let index = 0; index < stale.length; index += batchSize) {
    const chunk = stale.slice(index, index + batchSize)
    const results = await translateBatch(chunk.map((key) => en[key]))

    chunk.forEach((key, position) => {
      translations[key] = results[position]
      meta[key] = hashOf(en[key])
    })

    console.log(
      `translate-catalog: ${Math.min(index + batchSize, stale.length)}/${stale.length}`
    )
  }

  const orphanOverrides = Object.keys(overrides).filter((key) => !(key in en))
  if (orphanOverrides.length > 0) {
    console.warn(
      `translate-catalog: overrides for keys no longer in en.ts: ` +
        orphanOverrides.join(", ")
    )
  }

  // Rebuilt from `en`'s key order so the generated file diffs cleanly and
  // obsolete keys fall out rather than lingering as dead weight.
  const ordered = keys.map((key) => [key, overrides[key] ?? translations[key]])
  const orderedMeta = Object.fromEntries(keys.map((key) => [key, meta[key]]))

  const missing = ordered.filter(([, value]) => typeof value !== "string")
  if (missing.length > 0) {
    fail(`no translation produced for: ${missing.map(([k]) => k).join(", ")}`)
  }

  await writeFile(esPath, renderCatalog(ordered), "utf8")
  await writeFile(metaPath, `${JSON.stringify(orderedMeta, null, 2)}\n`, "utf8")

  const characters = stale.reduce((total, key) => total + en[key].length, 0)
  const overridden = keys.filter((key) => key in overrides).length
  console.log(
    `translate-catalog: wrote ${ordered.length} keys ` +
      `(${overridden} overridden, ${characters} characters billed).`
  )
}

await main()
