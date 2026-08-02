import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import AccessControlSection from "@/routes/operator/components/AccessControlSection"
import ManagementWorkflowSection from "@/routes/operator/components/ManagementWorkflowSection"
import RuntimeMetric from "@/routes/operator/components/RuntimeMetric"
import RuntimePostureSection from "@/routes/operator/components/RuntimePostureSection"
import { useOperatorController } from "@/routes/operator/useOperatorController"

type OperatorPageProps = {
  onNavigate: (path: string) => void
}

type OperatorTab = "access" | "management" | "runtime"

const TABS: Array<{ id: OperatorTab; label: string }> = [
  { id: "access", label: "Access" },
  { id: "management", label: "Management" },
  { id: "runtime", label: "Runtime" },
]

function parseOperatorFocus(): OperatorTab {
  if (typeof window === "undefined") return "runtime"
  const focus = new URLSearchParams(window.location.search).get("focus")
  if (focus === "access" || focus === "management") return focus
  return "runtime"
}

function compactCount(value: boolean) {
  return value ? "enabled" : "disabled"
}

function OperatorPage({ onNavigate }: OperatorPageProps) {
  const controller = useOperatorController()
  const [activeTab, setActiveTab] = useState<OperatorTab>(() =>
    parseOperatorFocus(),
  )

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Operator console
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Runtime posture, access control, and management workflows — the
              facts an engineer inspects before trusting workflow results.
            </p>
          </div>
          <Button
            variant="outline"
            data-testid="operator-open-workflow"
            onClick={() => onNavigate("/")}
          >
            Back to workflow
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <RuntimeMetric
            label="Verifier auth"
            value={
              controller.runtimeStatus
                ? compactCount(controller.runtimeStatus.api_key_auth_enabled)
                : "loading"
            }
            emphasis
          />
          <RuntimeMetric
            label="Admin flow"
            value={
              controller.runtimeStatus
                ? compactCount(
                    controller.runtimeStatus.admin_api_key_management_enabled,
                  )
                : "loading"
            }
            emphasis
          />
          <RuntimeMetric
            label="Shared lab key"
            value={controller.sharedLabKey ? "present" : "empty"}
            emphasis
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Current operator read</CardTitle>
            <CardDescription>{controller.runtimeSummary}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              data-testid="operator-refresh-runtime"
              onClick={() => void controller.loadRuntimeStatus()}
              disabled={controller.isLoadingStatus}
            >
              {controller.isLoadingStatus
                ? "Refreshing runtime…"
                : "Refresh runtime posture"}
            </Button>
          </CardContent>
        </Card>
      </header>

      <div
        role="tablist"
        aria-label="Operator sections"
        className="mt-8 flex gap-1 border-b"
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
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
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
