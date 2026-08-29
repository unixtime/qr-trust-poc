import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useT, type MessageKey } from "@/i18n"
import { cn } from "@/lib/utils"
import AccessControlSection from "@/routes/operator/components/AccessControlSection"
import ManagementWorkflowSection from "@/routes/operator/components/ManagementWorkflowSection"
import RuntimeMetric from "@/routes/operator/components/RuntimeMetric"
import RuntimePostureSection from "@/routes/operator/components/RuntimePostureSection"
import TrustStoreSection from "@/routes/operator/components/TrustStoreSection"
import { useOperatorController } from "@/routes/operator/useOperatorController"

type OperatorPageProps = {
  onNavigate: (path: string) => void
}

type OperatorTab = "access" | "management" | "runtime"

// `id` is the tab's identity — it reaches the `?focus=` query parameter and the
// test ids, so it stays an English identifier no matter what the label says.
const TABS: Array<{ id: OperatorTab; labelKey: MessageKey }> = [
  { id: "access", labelKey: "operator.tabs.access" },
  { id: "management", labelKey: "operator.tabs.management" },
  { id: "runtime", labelKey: "operator.tabs.runtime" },
]

function parseOperatorFocus(): OperatorTab {
  if (typeof window === "undefined") return "runtime"
  const focus = new URLSearchParams(window.location.search).get("focus")
  if (focus === "access" || focus === "management") return focus
  return "runtime"
}

function compactCount(value: boolean): MessageKey {
  return value ? "operator.value.enabled" : "operator.value.disabled"
}

function OperatorPage({ onNavigate }: OperatorPageProps) {
  const t = useT()
  const controller = useOperatorController()
  const [activeTab, setActiveTab] = useState<OperatorTab>(() =>
    parseOperatorFocus(),
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="aurora-text text-3xl font-bold tracking-tight">
              {t("operator.title")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t("operator.subtitle")}
            </p>
          </div>
          <Button
            variant="outline"
            data-testid="operator-open-workflow"
            onClick={() => onNavigate("/")}
          >
            {t("operator.backToWorkflow")}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <RuntimeMetric
            label={t("operator.metric.verifierAuth")}
            value={t(
              controller.runtimeStatus
                ? compactCount(controller.runtimeStatus.api_key_auth_enabled)
                : "operator.value.loading",
            )}
            emphasis
          />
          <RuntimeMetric
            label={t("operator.metric.adminFlow")}
            value={t(
              controller.runtimeStatus
                ? compactCount(
                    controller.runtimeStatus.admin_api_key_management_enabled,
                  )
                : "operator.value.loading",
            )}
            emphasis
          />
          <RuntimeMetric
            label={t("operator.metric.sharedLabKey")}
            value={t(
              controller.sharedLabKey
                ? "operator.value.present"
                : "operator.value.empty",
            )}
            emphasis
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("operator.read.title")}</CardTitle>
            <CardDescription>{t(controller.runtimeSummaryKey)}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              data-testid="operator-refresh-runtime"
              onClick={() => void controller.loadRuntimeStatus()}
              disabled={controller.isLoadingStatus}
            >
              {controller.isLoadingStatus
                ? t("operator.refreshing")
                : t("operator.refresh")}
            </Button>
          </CardContent>
        </Card>
      </header>

      <div
        role="tablist"
        aria-label={t("operator.tabs.label")}
        className="mt-8 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-white/8 bg-white/3 p-1"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            data-testid={`operator-tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              activeTab === tab.id
                ? "bg-primary/12 text-primary shadow-[0_0_16px_-6px_rgba(69,212,131,0.5)]"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
            )}
          >
            {activeTab === tab.id ? (
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_rgba(69,212,131,0.9)]"
              />
            ) : null}
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {activeTab === "runtime" ? (
          <section role="tabpanel" data-testid="operator-panel-runtime">
            <RuntimePostureSection
              runtimeStatus={controller.runtimeStatus}
              statusMessage={controller.statusMessage}
              isLoadingStatus={controller.isLoadingStatus}
              apiKeyHeader={controller.apiKeyHeader}
              adminHeader={controller.adminHeader}
              onRefresh={() => void controller.loadRuntimeStatus()}
            />
            <TrustStoreSection
              trustStore={controller.trustStore}
              message={controller.trustStoreMessage}
              isLoading={controller.isLoadingTrustStore}
              onRefresh={() => void controller.loadTrustStore()}
            />
          </section>
        ) : activeTab === "access" ? (
          <section role="tabpanel" data-testid="operator-panel-access">
            <AccessControlSection
              credentials={{
                runtimeStatus: controller.runtimeStatus,
                adminToken: controller.adminToken,
                apiKeyLabel: controller.apiKeyLabel,
                managementKeyLabel: controller.managementKeyLabel,
                managementKeyScopes: controller.managementKeyScopes,
              }}
              verifierKeys={{
                records: controller.apiKeys,
                latestIssuedKey: controller.latestIssuedKey,
                sharedLabKey: controller.sharedLabKey,
                isRefreshing: controller.isRefreshingKeys,
                isIssuing: controller.isIssuingKey,
                isCopying: controller.isCopyingKey,
              }}
              managementKeys={{
                records: controller.managementKeys,
                latestIssuedKey: controller.latestIssuedManagementKey,
                isRefreshing: controller.isRefreshingManagementKeys,
                isIssuing: controller.isIssuingManagementKey,
                isCopying: controller.isCopyingManagementKey,
                revokingKeyId: controller.revokingManagementKeyId,
              }}
              accessMessage={controller.accessMessage}
              actions={{
                onAdminTokenChange: controller.setAdminToken,
                onApiKeyLabelChange: controller.setApiKeyLabel,
                onManagementKeyLabelChange: controller.setManagementKeyLabel,
                onManagementKeyScopesChange: controller.setManagementKeyScopes,
                onIssueKey: () => void controller.issueKey(),
                onRefreshKeys: () => void controller.refreshKeys(),
                onIssueManagementKey: () => void controller.issueManagementKey(),
                onRefreshManagementKeys: () =>
                  void controller.refreshManagementKeys(),
                onCopyCurrentManagementKey: () =>
                  void controller.copyCurrentManagementKey(),
                onRevokeManagementKey: (keyId) =>
                  void controller.revokeManagementKey(keyId),
                onCopyCurrentKey: () => void controller.copyCurrentKey(),
                onClearSharedKey: controller.clearSharedKey,
                onNavigateLab: () => onNavigate("/"),
              }}
            />
          </section>
        ) : (
          <section role="tabpanel" data-testid="operator-panel-management">
            <ManagementWorkflowSection
              outbox={controller.managementOutbox}
              audit={controller.managementAudit}
              runtimeProviders={controller.runtimeProviders}
              message={controller.managementMessage}
              isLoading={controller.isLoadingManagementEvidence}
              isSubmitting={controller.isSubmittingManagementWorkflow}
              submittingWorkflowId={controller.submittingManagementWorkflowId}
              onRefresh={() => void controller.loadManagementEvidence()}
              onSubmitWorkflow={(workflowId, payload) =>
                void controller.submitManagementWorkflow(workflowId, payload)
              }
            />
          </section>
        )}
      </div>
    </div>
  )
}

export default OperatorPage
