import { KeyRound, RefreshCw } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useLocale, useT, type Locale, type MessageKey } from "@/i18n"
import type { TrustStoreResponse } from "@/lib/verifier-client"
import StatusBanner from "@/routes/operator/components/StatusBanner"
import type { MessageState } from "@/routes/operator/types"

// Built per locale on each render of a timestamp cell. The table is small
// (one demo issuer, a handful of keys), so there is nothing to cache yet; a
// language switch re-renders every cell with the new locale.
function formatTimestamp(value: string, locale: Locale) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

const headerCell = "px-2 py-1.5 text-left text-[11px] tracking-[0.14em] text-muted-foreground uppercase"
const bodyCell = "px-2 py-1.5 align-top text-foreground/90"

type TrustStoreSectionProps = {
  trustStore: TrustStoreResponse | null
  message: MessageState | null
  isLoading: boolean
  onRefresh: () => void
}

function TrustStoreSection({ trustStore, message, isLoading, onRefresh }: TrustStoreSectionProps) {
  const t = useT()
  const locale = useLocale()
  const isEmpty = trustStore !== null && trustStore.issuers.length === 0 && trustStore.keys.length === 0

  return (
    <Card data-testid="operator-trust-store" className="mt-6">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden="true" />
            {t("operator.trustStore.title")}
          </CardTitle>
          <CardDescription>{t("operator.trustStore.description")}</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={isLoading}>
          <RefreshCw className="size-4" aria-hidden="true" />
          {t(isLoading ? "operator.trustStore.refreshing" : "operator.trustStore.refresh")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <StatusBanner message={message} />
        {trustStore ? (
          <p className="text-xs text-muted-foreground">
            {t("operator.trustStore.generatedAt", {
              when: formatTimestamp(trustStore.generated_at, locale),
            })}
          </p>
        ) : null}
        {isEmpty ? (
          <p data-testid="trust-store-empty" className="text-sm text-muted-foreground">
            {t("operator.trustStore.empty")}
          </p>
        ) : null}

        {trustStore && trustStore.issuers.length > 0 ? (
          <section aria-label={t("operator.trustStore.issuers")}>
            <h3 className="mb-2 text-sm font-medium">{t("operator.trustStore.issuers")}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={headerCell}>{t("operator.trustStore.column.issuer")}</th>
                    <th className={headerCell}>{t("operator.trustStore.column.root")}</th>
                    <th className={headerCell}>{t("operator.trustStore.column.status")}</th>
                    <th className={headerCell}>{t("operator.trustStore.column.issuedAt")}</th>
                    <th className={headerCell}>{t("operator.trustStore.column.expiresAt")}</th>
                    <th className={headerCell}>{t("operator.trustStore.column.domains")}</th>
                  </tr>
                </thead>
                <tbody>
                  {trustStore.issuers.map((issuer) => (
                    <tr key={issuer.issuer_id} data-testid="trust-store-issuer-row" className="border-t border-border/60">
                      <td className={bodyCell}>
                        <div>{issuer.issuer_name}</div>
                        <code className="text-xs text-muted-foreground">{issuer.issuer_id}</code>
                      </td>
                      <td className={bodyCell}><code className="text-xs">{issuer.root_id}</code></td>
                      <td className={bodyCell}>
                        {t(`operator.trustStore.status.${issuer.status}` as MessageKey)}
                      </td>
                      <td className={bodyCell}>{formatTimestamp(issuer.issued_at, locale)}</td>
                      <td className={bodyCell}>
                        {issuer.expires_at
                          ? formatTimestamp(issuer.expires_at, locale)
                          : t("operator.trustStore.noExpiry")}
                      </td>
                      <td className={bodyCell}>
                        {issuer.verified_domains.join(", ")}
                        {issuer.allow_subdomains ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({t("operator.trustStore.subdomains")})
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {trustStore && trustStore.keys.length > 0 ? (
          <section aria-label={t("operator.trustStore.keys")}>
            <h3 className="mb-2 text-sm font-medium">{t("operator.trustStore.keys")}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={headerCell}>{t("operator.trustStore.column.keyRef")}</th>
                    <th className={headerCell}>{t("operator.trustStore.column.issuer")}</th>
                    <th className={headerCell}>{t("operator.trustStore.column.algorithm")}</th>
                    <th className={headerCell}>{t("operator.trustStore.column.state")}</th>
                    <th className={headerCell}>{t("operator.trustStore.column.notBefore")}</th>
                    <th className={headerCell}>{t("operator.trustStore.column.notAfter")}</th>
                    <th className={headerCell}>{t("operator.trustStore.column.revokedAt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {trustStore.keys.map((key) => (
                    <tr key={key.key_ref} data-testid="trust-store-key-row" data-state={key.state} className="border-t border-border/60">
                      <td className={bodyCell}><code className="text-xs">{key.key_ref}</code></td>
                      <td className={bodyCell}><code className="text-xs">{key.issuer_id}</code></td>
                      <td className={bodyCell}>{key.algorithm_id}</td>
                      <td className={bodyCell}>
                        {t(`operator.trustStore.state.${key.state}` as MessageKey)}
                      </td>
                      <td className={bodyCell}>{formatTimestamp(key.not_before, locale)}</td>
                      <td className={bodyCell}>
                        {key.not_after
                          ? formatTimestamp(key.not_after, locale)
                          : t("operator.trustStore.noExpiry")}
                      </td>
                      <td className={bodyCell}>
                        {key.revoked_at ? (
                          <>
                            <div>{formatTimestamp(key.revoked_at, locale)}</div>
                            {key.revocation_reason ? (
                              <div className="text-xs text-muted-foreground">{key.revocation_reason}</div>
                            ) : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default TrustStoreSection
