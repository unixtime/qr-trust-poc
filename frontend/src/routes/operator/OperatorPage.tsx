import { ArrowRight } from "lucide-react"
import { useEffect, useMemo } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import AccessControlSection from "@/routes/operator/components/AccessControlSection"
import ManagementWorkflowSection from "@/routes/operator/components/ManagementWorkflowSection"
import OperatorEntrySection, {
  type OperatorEntryContext,
} from "@/routes/operator/components/OperatorEntrySection"
import RuntimeMetric from "@/routes/operator/components/RuntimeMetric"
import RuntimePostureSection from "@/routes/operator/components/RuntimePostureSection"
import { useOperatorController } from "@/routes/operator/useOperatorController"
import { buildLabLink, type LearnScenarioKey } from "@/routes/learn/content"

type OperatorPageProps = {
  onNavigate: (path: string) => void
}

function compactCount(value: boolean) {
  return value ? "enabled" : "disabled"
}

function isLearnScenarioKey(value: string | null): value is LearnScenarioKey {
  return (
    value === "valid" ||
    value === "expired" ||
    value === "revoked" ||
    value === "subdomain-allowed" ||
    value === "subdomain-blocked" ||
    value === "payload-mismatch" ||
    value === "redirect-approved" ||
    value === "redirect-final-mismatch" ||
    value === "redirect-too-many-hops" ||
    value === "redirect-nested-shortener" ||
    value === "runtime-risky" ||
    value === "runtime-blocked" ||
    value === "stale-cache" ||
    value === "unknown-issuer" ||
    value === "artifact-quiet-zone" ||
    value === "artifact-mismatch"
  )
}

function parseOperatorEntryContext(): OperatorEntryContext {
  if (typeof window === "undefined") {
    return {
      focus: "runtime",
      source: null,
      scenario: null,
      compareScenario: null,
      recommendedLabPath: "/lab",
    }
  }

  const params = new URLSearchParams(window.location.search)
  const focus = params.get("focus") === "access" ? "access" : "runtime"
  const scenario = params.get("scenario")
  const compareScenario = params.get("compare")
  const nonceMode = params.get("nonce") === "timestamped" ? "timestamped" : "fixed"
  const source = params.get("source")

  const recommendedLabPath = isLearnScenarioKey(scenario)
    ? `${buildLabLink(scenario, nonceMode)}${
        compareScenario ? `&compare=${compareScenario}` : ""
      }`
    : "/lab"

  return {
    focus,
    source,
    scenario,
    compareScenario,
    recommendedLabPath,
  }
}

function OperatorPage({ onNavigate }: OperatorPageProps) {
  const controller = useOperatorController()
  const entryContext = useMemo(() => parseOperatorEntryContext(), [])

  useEffect(() => {
    const targetId =
      entryContext.focus === "access" ? "operator-access-control" : "operator-runtime-posture"
    const target = document.getElementById(targetId)
    if (!target) return

    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }, [entryContext.focus])

  return (
    <div className="min-h-[calc(100vh-5rem)] px-4 py-6 md:px-6 xl:px-8">
      <div className="mx-auto grid max-w-[118rem] gap-6">
        <section className="grid gap-4 rounded-[2rem] border border-border/70 bg-card/90 p-6 shadow-[0_18px_60px_rgba(22,29,24,0.08)] backdrop-blur md:p-8">
          <Badge variant="outline" className="w-fit">
            Operator Surface
          </Badge>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_360px] lg:items-end">
            <div className="grid gap-4">
              <h1 className="font-serif text-4xl leading-[0.96] tracking-[-0.05em] text-foreground md:text-6xl">
                Separate runtime posture from the act of scanning.
              </h1>
              <p className="max-w-3xl text-base leading-7 text-muted-foreground">
                The lab should stay focused on generate, scan, decode, and verify.
                This route owns the runtime facts and access-control flows that
                engineers need to inspect before they trust the lab results.
              </p>
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
            </div>

            <Card className="border-border/70 bg-background/80 shadow-none">
              <CardHeader>
                <CardTitle className="text-base">Current operator read</CardTitle>
                <CardDescription>{controller.runtimeSummary}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Button onClick={() => onNavigate("/lab")} className="w-full">
                  Return to working lab
                  <ArrowRight className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void controller.loadRuntimeStatus()}
                  disabled={controller.isLoadingStatus}
                  className="w-full"
                >
                  {controller.isLoadingStatus
                    ? "Refreshing runtime…"
                    : "Refresh runtime posture"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        <OperatorEntrySection
          context={entryContext}
          onNavigate={onNavigate}
          onJumpToRuntime={() => {
            document
              .getElementById("operator-runtime-posture")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }}
          onJumpToAccess={() => {
            document
              .getElementById("operator-access-control")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }}
        />

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

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
          <section id="operator-runtime-posture" className="min-w-0">
            <RuntimePostureSection
              runtimeStatus={controller.runtimeStatus}
              statusMessage={controller.statusMessage}
              isLoadingStatus={controller.isLoadingStatus}
              apiKeyHeader={controller.apiKeyHeader}
              adminHeader={controller.adminHeader}
              onRefresh={() => void controller.loadRuntimeStatus()}
            />
          </section>
          <aside id="operator-access-control" className="min-w-0 xl:self-start">
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
                onNavigateLab: () => onNavigate(entryContext.recommendedLabPath),
              }}
            />
          </aside>
        </section>
      </div>
    </div>
  )
}

export default OperatorPage
