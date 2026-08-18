import { setLocale, useLocale, useT, type Locale } from "@/i18n"
import { cn } from "@/lib/utils"

type Option = {
  locale: Locale
  /** Autonym — the language's name in itself. See the catalogue note below. */
  nameKey: "shell.language.en" | "shell.language.es"
  shortKey: "shell.language.enShort" | "shell.language.esShort"
}

const options: Option[] = [
  {
    locale: "en",
    nameKey: "shell.language.en",
    shortKey: "shell.language.enShort",
  },
  {
    locale: "es",
    nameKey: "shell.language.es",
    shortKey: "shell.language.esShort",
  },
]

/**
 * Segmented EN/ES control for the app shell.
 *
 * Two always-visible buttons rather than a dropdown: with exactly two
 * languages a select costs a click to discover what a chip shows outright,
 * and the header has room for both.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const locale = useLocale()
  const t = useT()

  return (
    <div
      role="group"
      aria-label={t("shell.language.label")}
      className={cn(
        "flex items-center gap-0.5 rounded-md border border-border p-0.5",
        className
      )}
    >
      {options.map((option) => {
        const active = option.locale === locale
        return (
          <button
            key={option.locale}
            type="button"
            data-testid={`language-${option.locale}`}
            // `aria-pressed` rather than `aria-current`: this is a pair of
            // toggles over one setting, not navigation between locations.
            aria-pressed={active}
            // The visible text is an abbreviation, so the accessible name
            // carries the full autonym. `lang` on the button makes a screen
            // reader switch voice for it — without it, "Español" is read with
            // English phonemes.
            lang={option.locale}
            aria-label={t(option.nameKey)}
            onClick={() => setLocale(option.locale)}
            className={cn(
              "rounded-[calc(var(--radius-sm)-1px)] px-2 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(option.shortKey)}
          </button>
        )
      })}
    </div>
  )
}

export default LanguageToggle
