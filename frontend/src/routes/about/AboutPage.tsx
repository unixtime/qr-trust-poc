import { ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Eyebrow } from "@/components/ui/eyebrow"
import { useT, type MessageKey } from "@/i18n"

// `id` is what React keys on. Keying on the label instead — as this did —
// makes every card unmount and remount the moment the language changes,
// because the key itself is the thing being translated.
const trustChecks: {
  id: string
  labelKey: MessageKey
  detailKey: MessageKey
}[] = [
  {
    id: "issuer",
    labelKey: "about.check.issuer.label",
    detailKey: "about.check.issuer.detail",
  },
  {
    id: "destination",
    labelKey: "about.check.destination.label",
    detailKey: "about.check.destination.detail",
  },
  {
    id: "runtime",
    labelKey: "about.check.runtime.label",
    detailKey: "about.check.runtime.detail",
  },
  {
    id: "decision",
    labelKey: "about.check.decision.label",
    detailKey: "about.check.decision.detail",
  },
]

const docLinks: { labelKey: MessageKey; href: string }[] = [
  {
    labelKey: "about.link.readme",
    href: "https://github.com/unixtime/qr-trust-poc#readme",
  },
  {
    labelKey: "about.link.runGuide",
    href: "https://github.com/unixtime/qr-trust-poc/blob/main/docs/public/RUN_GUIDE.md",
  },
]

type AboutPageProps = {
  onNavigate: (path: string) => void
}

export default function AboutPage({ onNavigate }: AboutPageProps) {
  const t = useT()

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="aurora-text text-3xl font-bold tracking-tight">
          {t("about.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("about.subtitle")}</p>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-stretch sm:gap-2">
          {trustChecks.map((check, index) => (
            <div key={check.id} className="flex flex-1 items-center gap-2">
              <div className="flex flex-1 flex-col gap-1 rounded-2xl border border-white/8 bg-white/3 p-3">
                <Eyebrow tone="primary">
                  {index + 1}
                </Eyebrow>
                <span className="text-sm font-medium">{t(check.labelKey)}</span>
                <span className="text-xs text-muted-foreground">
                  {t(check.detailKey)}
                </span>
              </div>
              {index < trustChecks.length - 1 ? (
                <ArrowRight className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4 text-sm leading-6 text-foreground">
        <p>{t("about.body.problem")}</p>
        <p>{t("about.body.checks")}</p>
        <p>{t("about.body.verdicts")}</p>
        <p>{t("about.body.tour")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          data-testid="about-open-workflow"
          onClick={() => onNavigate("/")}
        >
          {t("about.cta.workflow")}
        </Button>
        {docLinks.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t(link.labelKey)}
          </a>
        ))}
      </div>
    </div>
  )
}
