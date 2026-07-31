import { CircleAlert, ExternalLink } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import RuntimeMetric from "@/routes/lab/components/RuntimeMetric"
import type { LabSupportRailProps } from "@/routes/lab/types"
import { compactCount } from "@/routes/lab/utils"

function LabSupportRail({
  runtimeStatus,
  apiKeyHeader,
  apiKey,
  apiAuthEnabled,
  adminFlowEnabled,
  currentScenario,
  compareScenario,
  comparisonScenario,
  onOpenOperator,
  onClearLabKey,
  onGenerateComparisonDemo,
}: LabSupportRailProps) {
  return (
    <div className="grid gap-4 xl:sticky xl:top-24 xl:self-start">
      <Card className="security-card overflow-hidden rounded-[1.35rem] bg-card/96">
        <CardHeader className="border-b border-emerald-950/10 bg-card/72">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-lg font-black tracking-[-0.02em]">
                Runtime and access
              </CardTitle>
              <CardDescription>
                Supporting state for the lab. Use operator mode only when you
                need keys or full runtime posture.
              </CardDescription>
            </div>
            <Badge variant={adminFlowEnabled ? "secondary" : "outline"}>
              {adminFlowEnabled ? "operator ready" : "operator limited"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <RuntimeMetric
              label="Verifier auth"
              value={runtimeStatus ? compactCount(runtimeStatus.api_key_auth_enabled) : "loading"}
            />
            <RuntimeMetric
              label="Redis"
              value={runtimeStatus ? compactCount(runtimeStatus.redis_connected) : "loading"}
            />
            <RuntimeMetric
              label="Lab key"
              value={apiKey.trim() ? "loaded in browser" : "empty"}
            />
            <RuntimeMetric
              label="Camera fallback"
              value={
                runtimeStatus
                  ? compactCount(runtimeStatus.decode_image_fallback_enabled)
                  : "loading"
              }
            />
          </div>

          {apiAuthEnabled ? (
            <Alert>
              <CircleAlert />
              <AlertTitle>Verifier auth is active</AlertTitle>
              <AlertDescription>
                Issue or inspect keys in operator mode, then return here for
                QR generation and scanning.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <CircleAlert />
              <AlertTitle>Verifier auth is disabled</AlertTitle>
              <AlertDescription>
                This runtime can run the lab without a client key.
              </AlertDescription>
            </Alert>
          )}

          <details className="rounded-[1rem] border border-border/70 bg-background/70 p-3 text-sm text-muted-foreground">
            <summary className="cursor-pointer select-none font-semibold text-foreground">
              More runtime details
            </summary>
            <div className="mt-3 grid gap-3">
              <RuntimeMetric
                label="Admin flow"
                value={
                  runtimeStatus
                    ? compactCount(runtimeStatus.admin_api_key_management_enabled)
                    : "loading"
                }
              />
              <RuntimeMetric
                label="Decode limit"
                value={
                  runtimeStatus
                    ? `${runtimeStatus.decode_rate_limit_max_requests} / ${runtimeStatus.rate_limit_window_seconds}s`
                    : "loading"
                }
              />
              <RuntimeMetric
                label="Verify limit"
                value={
                  runtimeStatus
                    ? `${runtimeStatus.rate_limit_max_requests} / ${runtimeStatus.rate_limit_window_seconds}s`
                    : "loading"
                }
              />
              <RuntimeMetric label="API key header" value={apiKeyHeader} />
            </div>
          </details>

          <div className="flex flex-wrap gap-3">
            <Button onClick={onOpenOperator}>
              <ExternalLink data-icon="inline-start" />
              Open operator
            </Button>
            {apiKey.trim() ? (
              <Button variant="outline" onClick={onClearLabKey}>
                Clear staged key
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {comparisonScenario ? (
        <Card className="security-card overflow-hidden rounded-[1.35rem] bg-card/96">
          <CardHeader className="border-b border-emerald-950/10 bg-card/72">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Comparison context</CardTitle>
              <Badge variant="outline">
                {compareScenario}
              </Badge>
            </div>
            <CardDescription>
              This lab launch came from a guided comparison. Keep the contrast visible while you run the working verifier.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="rounded-[1.2rem] border border-border/70 bg-background/80 p-4 text-sm leading-6 text-muted-foreground">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Current proof path
              </div>
              <p className="mt-2">
                <span className="font-medium text-foreground">{currentScenario.label}</span> is
                currently loaded. The paired comparison case is{" "}
                <span className="font-medium text-foreground">{comparisonScenario.label}</span>.
              </p>
              <p className="mt-3">
                Use the current scenario first, then switch to the paired case to
                show what changes when the trust or policy condition flips.
              </p>
            </div>
            <div className="rounded-[1.2rem] border border-border/70 bg-background/80 p-4 text-sm leading-6 text-muted-foreground">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Comparison case note
              </div>
              <p className="mt-2">{comparisonScenario.note}</p>
            </div>
            <Button variant="outline" onClick={onGenerateComparisonDemo}>
              Load comparison scenario into the lab
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

export default LabSupportRail
