import {
  Building2,
  FileCheck2,
  Globe2,
  History,
  KeyRound,
  RadioTower,
  RefreshCw,
  Route,
  Send,
  ShieldCheck,
} from "lucide-react"
import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type {
  ManagementAuditListResponse,
  ManagementAuditRecord,
  ManagementOutboxEventRecord,
  ManagementOutboxStatusResponse,
  ManagementRuntimeProviderRecord,
} from "@/lib/verifier-client"
import ManagementWorkflowForm from "@/routes/operator/components/ManagementWorkflowForms"
import StatusBanner from "@/routes/operator/components/StatusBanner"
import type { MessageState } from "@/routes/operator/types"

type WorkflowState = "ready" | "planned"

type Workflow = {
  id: string
  title: string
  description: string
  endpoint: string
  state: WorkflowState
  operatorRecord: string
  icon: typeof Building2
}

type ManagementWorkflowSectionProps = {
  outbox: ManagementOutboxStatusResponse | null
  audit: ManagementAuditListResponse | null
  runtimeProviders: ManagementRuntimeProviderRecord[]
  message: MessageState | null
  isLoading: boolean
  isSubmitting: boolean
  submittingWorkflowId: string
  onRefresh: () => void
  onSubmitWorkflow: (workflowId: string, payload: Record<string, unknown>) => void
}

const workflows: Workflow[] = [
  {
    id: "authority-setup",
    title: "Authority setup",
    description: "Create the root program and delegated authority that issuer workflows depend on.",
    endpoint: "POST /admin/root-programs",
    state: "ready",
    operatorRecord: "root_program.upserted + delegated_authority.upserted",
    icon: Building2,
  },
  {
    id: "trust-keys",
    title: "Trust keys",
    description: "Manage root and delegated-authority signer keys used to verify governance events.",
    endpoint: "POST /admin/trust-keys",
    state: "ready",
    operatorRecord: "trust_key.upserted + trust_key.status.changed",
    icon: KeyRound,
  },
  {
    id: "issuer-enrollment",
    title: "Issuer enrollment",
    description: "Create a pending issuer record under an accepted root and delegated authority.",
    endpoint: "POST /admin/issuers",
    state: "ready",
    operatorRecord: "issuer.enrollment.requested",
    icon: Building2,
  },
  {
    id: "domain-proof",
    title: "Domain proof",
    description: "Bind issuer identity to DNS, well-known, directory, or manual-review evidence.",
    endpoint: "POST /admin/domain-proofs",
    state: "ready",
    operatorRecord: "domain_proof.upserted",
    icon: Globe2,
  },
  {
    id: "destination-policy",
    title: "Destination policy",
    description: "Approve exact destinations, redirect limits, and runtime-safety policy.",
    endpoint: "POST /admin/destination-policies",
    state: "ready",
    operatorRecord: "destination_policy.upserted",
    icon: Route,
  },
  {
    id: "issuer-status",
    title: "Issuer status",
    description: "Suspend, revoke, expire, or reactivate issuer enrollment state.",
    endpoint: "POST /admin/issuers/status",
    state: "ready",
    operatorRecord: "issuer.status.changed",
    icon: FileCheck2,
  },
  {
    id: "policy-status",
    title: "Policy status",
    description: "Suspend, revoke, expire, or reactivate destination-policy state.",
    endpoint: "POST /admin/destination-policies/status",
    state: "ready",
    operatorRecord: "destination_policy.status.changed",
    icon: FileCheck2,
  },
  {
    id: "runtime-providers",
    title: "Runtime providers",
    description: "Register provider status, TTL, and fail behavior for runtime safety checks.",
    endpoint: "POST /admin/runtime-providers",
    state: "ready",
    operatorRecord: "runtime_provider.upserted",
    icon: ShieldCheck,
  },
  {
    id: "nats-subscribers",
    title: "NATS subscribers",
    description: "Approve subscriber identities and constrain subject families from Postgres.",
    endpoint: "POST /admin/nats/subscribers",
    state: "ready",
    operatorRecord: "subscriber.authorization.changed",
    icon: RadioTower,
  },
  {
    id: "outbox-health",
    title: "Outbox health",
    description: "Inspect pending, failed, and published governance propagation events.",
    endpoint: "GET /admin/outbox",
    state: "ready",
    operatorRecord: "event_outbox",
    icon: Send,
  },
  {
    id: "audit-log",
    title: "Audit log",
    description: "Review who changed governance state, when, and which outbox event followed.",
    endpoint: "GET /admin/audit",
    state: "ready",
    operatorRecord: "governance_audit_log",
    icon: History,
  },
]

function formatTimestamp(value: string | null) {
  if (!value) return "not published"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function outboxStatusVariant(status: string) {
  if (status === "quarantined") return "destructive"
  if (status === "failed") return "destructive"
  if (status === "published") return "default"
  return "outline"
}

function eventLabel(event: ManagementOutboxEventRecord) {
  return `${event.aggregate_type}:${event.aggregate_id}`
}

function auditLabel(row: ManagementAuditRecord) {
  return `${row.target_type}:${row.target_id}`
}

function EmptyEvidence({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-dashed border-border bg-background/75 p-4">
      <div className="grid gap-1">
        <p className="text-sm font-medium text-foreground">No management evidence loaded</p>
        <p className="text-pretty text-sm leading-6 text-muted-foreground">
          Load the current Postgres outbox and audit rows before reviewing this
          runtime as a production-style operator surface.
        </p>
      </div>
      <Button type="button" variant="outline" onClick={onRefresh} className="w-fit">
        <RefreshCw className="size-4" />
        Load evidence
      </Button>
    </div>
  )
}

function OutboxEvidence({
  outbox,
}: {
  outbox: ManagementOutboxStatusResponse
}) {
  const counts = outbox.status_counts
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {(["pending", "publishing", "published", "failed", "quarantined"] as const).map(
          (status) => (
            <div
              key={status}
              className="rounded-2xl border border-border/70 bg-card px-3 py-2"
            >
              <p className="text-xs text-muted-foreground">{status}</p>
              <p className="text-lg font-semibold tabular-nums">
                {counts[status] ?? 0}
              </p>
            </div>
          ),
        )}
      </div>
      <div className="grid gap-2">
        <p className="text-sm font-medium text-foreground">Recent outbox events</p>
        {outbox.recent_events.length > 0 ? (
          <div className="grid gap-2">
            {outbox.recent_events.slice(0, 4).map((event) => (
              <article
                key={event.outbox_id}
                className="grid gap-2 rounded-2xl border border-border/70 bg-background/85 p-3"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-foreground">
                      {event.event_type}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {eventLabel(event)}
                    </p>
                  </div>
                  <Badge variant={outboxStatusVariant(event.publish_status)}>
                    {event.publish_status}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="tabular-nums">attempts {event.attempts}</span>
                  <span>{formatTimestamp(event.created_at)}</span>
                  {event.last_error ? (
                    <span className="line-clamp-1 text-destructive">{event.last_error}</span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-border bg-background/75 p-3 text-sm text-muted-foreground">
            No outbox rows were returned for this management window.
          </p>
        )}
      </div>
    </div>
  )
}

function AuditEvidence({ audit }: { audit: ManagementAuditListResponse }) {
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium text-foreground">Recent audit rows</p>
      {audit.audit_rows.length > 0 ? (
        <div className="grid gap-2">
          {audit.audit_rows.slice(0, 4).map((row) => (
            <article
              key={row.audit_id}
              className="grid gap-2 rounded-2xl border border-border/70 bg-background/85 p-3"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-foreground">{row.action}</p>
                  <p className="truncate text-xs text-muted-foreground">{auditLabel(row)}</p>
                </div>
                <Badge variant="outline">{row.actor_key_id ?? "unknown actor"}</Badge>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{formatTimestamp(row.created_at)}</span>
                {row.idempotency_key ? (
                  <span className="truncate font-mono">idem {row.idempotency_key}</span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border bg-background/75 p-3 text-sm text-muted-foreground">
          No governance audit rows were returned for this management window.
        </p>
      )}
    </div>
  )
}

function RuntimeProviderEvidence({
  providers,
}: {
  providers: ManagementRuntimeProviderRecord[]
}) {
  if (providers.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border bg-background/75 p-3 text-sm text-muted-foreground">
        No runtime providers were returned for this management window.
      </p>
    )
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium text-foreground">Runtime provider registry</p>
      <div className="grid gap-2 md:grid-cols-2">
        {providers.map((provider) => (
          <article
            key={provider.provider_id}
            className="grid gap-2 rounded-2xl border border-border/70 bg-background/85 p-3"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-foreground">
                  {provider.provider_id}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {provider.display_name}
                </p>
              </div>
              <Badge
                variant={
                  provider.status === "active" ? "default" : "destructive"
                }
              >
                {provider.status}
              </Badge>
            </div>
            <div className="grid gap-1 text-xs text-muted-foreground">
              <span className="tabular-nums">
                ttl {provider.verdict_ttl_seconds}s
              </span>
              <span className="truncate">
                stale {provider.stale_behavior}; unavailable{" "}
                {provider.unavailable_behavior}
              </span>
              {provider.base_url ? (
                <span className="truncate font-mono">{provider.base_url}</span>
              ) : (
                <span>local provider</span>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

function ManagementWorkflowSection({
  outbox,
  audit,
  runtimeProviders,
  message,
  isLoading,
  isSubmitting,
  submittingWorkflowId,
  onRefresh,
  onSubmitWorkflow,
}: ManagementWorkflowSectionProps) {
  const [selectedId, setSelectedId] = useState(workflows[0]?.id ?? "")
  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedId) ?? workflows[0],
    [selectedId],
  )
  const hasEvidence = Boolean(outbox || audit || runtimeProviders.length > 0)

  return (
    <section className="grid gap-5 rounded-[1.5rem] border border-border/70 bg-card/90 p-5 shadow-sm md:p-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="grid gap-2">
          <Badge variant="outline" className="w-fit">
            Management plane
          </Badge>
          <div className="grid gap-1">
            <h2 className="text-balance text-2xl font-semibold text-foreground">
              Govern the trust network from one operator surface.
            </h2>
            <p className="max-w-3xl text-pretty text-sm leading-6 text-muted-foreground">
              Production-like workflows write source state to Postgres, append audit
              evidence, and enqueue propagation events before NATS subscribers see
              any update.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onRefresh}
          disabled={isLoading}
          className="w-full xl:w-fit"
        >
          <RefreshCw className="size-4" />
          {isLoading ? "Refreshing..." : "Refresh management evidence"}
        </Button>
      </div>

      <StatusBanner message={message} />

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-2">
          {workflows.map((workflow) => {
            const Icon = workflow.icon
            const isSelected = workflow.id === selectedWorkflow.id
            return (
              <button
                key={workflow.id}
                type="button"
                onClick={() => setSelectedId(workflow.id)}
                className={`grid min-h-32 gap-3 rounded-2xl border p-4 text-left transition-colors ${
                  isSelected
                    ? "border-emerald-300 bg-emerald-50/70 text-emerald-950"
                    : "border-border/70 bg-background/75 hover:bg-muted/50"
                }`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="grid size-9 place-items-center rounded-full border border-current/15 bg-background/70">
                    <Icon className="size-4" />
                  </span>
                  <Badge
                    variant={workflow.state === "ready" ? "default" : "outline"}
                    className="shrink-0"
                  >
                    {workflow.state}
                  </Badge>
                </span>
                <span className="grid gap-1">
                  <span className="text-base font-semibold">{workflow.title}</span>
                  <span className="line-clamp-2 text-sm leading-5 text-muted-foreground">
                    {workflow.description}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div className="grid gap-4 rounded-2xl border border-border/70 bg-background/80 p-4">
          {selectedWorkflow ? (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="grid gap-1">
                  <Badge variant="outline" className="w-fit">
                    Selected workflow
                  </Badge>
                  <h3 className="text-xl font-semibold">{selectedWorkflow.title}</h3>
                </div>
                <Badge
                  variant={selectedWorkflow.state === "ready" ? "default" : "outline"}
                  className="max-w-full truncate"
                  title={selectedWorkflow.endpoint}
                >
                  {selectedWorkflow.endpoint}
                </Badge>
              </div>
              <p className="text-pretty text-sm leading-6 text-muted-foreground">
                {selectedWorkflow.description}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                {selectedWorkflow.operatorRecord}
              </p>
            </div>
          ) : null}

          {selectedWorkflow ? (
            <ManagementWorkflowForm
              workflowId={selectedWorkflow.id}
              isSubmitting={
                isSubmitting && submittingWorkflowId === selectedWorkflow.id
              }
              onSubmit={onSubmitWorkflow}
              onRefreshEvidence={onRefresh}
            />
          ) : null}

          {hasEvidence ? (
            <div className="grid gap-4">
              <RuntimeProviderEvidence providers={runtimeProviders} />
              {outbox ? <OutboxEvidence outbox={outbox} /> : null}
              {audit ? <AuditEvidence audit={audit} /> : null}
            </div>
          ) : (
            <EmptyEvidence onRefresh={onRefresh} />
          )}
        </div>
      </div>
    </section>
  )
}

export default ManagementWorkflowSection
