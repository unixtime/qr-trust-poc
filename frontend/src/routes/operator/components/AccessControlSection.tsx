import {
  ArrowRight,
  Copy,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Trash2,
  WalletCards,
} from "lucide-react"

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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import type {
  ManagementApiKeyRecord,
  VerifierStatus,
} from "@/lib/verifier-client"
import RuntimeMetric from "@/routes/operator/components/RuntimeMetric"
import StatusBanner from "@/routes/operator/components/StatusBanner"
import type { MessageState } from "@/routes/operator/types"

type CredentialState = {
  runtimeStatus: VerifierStatus | null
  adminToken: string
  apiKeyLabel: string
  managementKeyLabel: string
  managementKeyScopes: string
}

type VerifierKeyState = {
  records: ManagementApiKeyRecord[]
  latestIssuedKey: string
  sharedLabKey: string
  isRefreshing: boolean
  isIssuing: boolean
  isCopying: boolean
}

type ManagementKeyState = {
  records: ManagementApiKeyRecord[]
  latestIssuedKey: string
  isRefreshing: boolean
  isIssuing: boolean
  isCopying: boolean
  revokingKeyId: string
}

type AccessControlActions = {
  onAdminTokenChange: (value: string) => void
  onApiKeyLabelChange: (value: string) => void
  onManagementKeyLabelChange: (value: string) => void
  onManagementKeyScopesChange: (value: string) => void
  onIssueKey: () => void
  onRefreshKeys: () => void
  onIssueManagementKey: () => void
  onRefreshManagementKeys: () => void
  onCopyCurrentManagementKey: () => void
  onRevokeManagementKey: (keyId: string) => void
  onCopyCurrentKey: () => void
  onClearSharedKey: () => void
  onNavigateLab: () => void
}

type AccessControlSectionProps = {
  credentials: CredentialState
  verifierKeys: VerifierKeyState
  managementKeys: ManagementKeyState
  accessMessage: MessageState | null
  actions: AccessControlActions
}

function compactCount(value: boolean) {
  return value ? "enabled" : "disabled"
}

function keyPreview(value: string) {
  if (value.length <= 18) return value
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

function AccessControlSection({
  credentials,
  verifierKeys,
  managementKeys,
  accessMessage,
  actions,
}: AccessControlSectionProps) {
  const apiAuthEnabled = Boolean(credentials.runtimeStatus?.api_key_auth_enabled)
  const adminFlowEnabled = Boolean(
    credentials.runtimeStatus?.admin_api_key_management_enabled,
  )
  const adminHeader = credentials.runtimeStatus?.admin_header ?? "X-Admin-Token"

  return (
    <Card className="h-fit min-w-0 border-border/70 bg-card/92 shadow-[0_18px_60px_rgba(22,29,24,0.08)]">
      <CardHeader>
        <AccessHeader adminFlowEnabled={adminFlowEnabled} />
      </CardHeader>
      <CardContent className="grid gap-5">
        <AdminDisabledAlert
          adminFlowEnabled={adminFlowEnabled}
          apiAuthEnabled={apiAuthEnabled}
        />
        <StatusBanner message={accessMessage} />
        <CredentialFields
          credentials={credentials}
          adminFlowEnabled={adminFlowEnabled}
          adminHeader={adminHeader}
          actions={actions}
        />
        <VerifierClientControls
          verifierKeys={verifierKeys}
          adminFlowEnabled={adminFlowEnabled}
          hasAdminCredential={Boolean(credentials.adminToken.trim())}
          actions={actions}
        />
        <VerifierMetrics
          runtimeStatus={credentials.runtimeStatus}
          verifierKeys={verifierKeys}
        />
        <LabHandoff verifierKeys={verifierKeys} actions={actions} />
        <VerifierKeyInventory
          adminFlowEnabled={adminFlowEnabled}
          hasAdminCredential={Boolean(credentials.adminToken.trim())}
          records={verifierKeys.records}
        />
        <ManagementKeyPanel
          credentials={credentials}
          managementKeys={managementKeys}
          actions={actions}
        />
      </CardContent>
    </Card>
  )
}

function AccessHeader({ adminFlowEnabled }: { adminFlowEnabled: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="rounded-full border border-border/70 p-2 text-muted-foreground">
          <WalletCards className="size-4" />
        </div>
        <div>
          <CardTitle className="text-base">Access control</CardTitle>
          <CardDescription>
            Issue, inspect, and hand off scoped credentials without mixing them
            into scanning.
          </CardDescription>
        </div>
      </div>
      <Badge variant={adminFlowEnabled ? "secondary" : "outline"}>
        {adminFlowEnabled ? "admin flow enabled" : "admin flow disabled"}
      </Badge>
    </div>
  )
}

function AdminDisabledAlert({
  adminFlowEnabled,
  apiAuthEnabled,
}: {
  adminFlowEnabled: boolean
  apiAuthEnabled: boolean
}) {
  if (adminFlowEnabled) return null

  return (
    <Alert>
      <AlertTitle>Server-side verifier key management is disabled</AlertTitle>
      <AlertDescription>
        This API instance was started without local bootstrap admin tokens enabled,
        so local token issuance is unavailable. DB-backed management keys may
        still issue or refresh verifier client keys when the token has{" "}
        <code>verifier_clients:write</code> or{" "}
        <code>verifier_clients:read</code>.{" "}
        {apiAuthEnabled
          ? "Paste an existing verifier API key into the lab, or restart local compose with make up-admin."
          : "Verifier auth is off, so the lab can still operate without issuing a key."}
      </AlertDescription>
    </Alert>
  )
}

function CredentialFields({
  credentials,
  adminFlowEnabled,
  adminHeader,
  actions,
}: {
  credentials: CredentialState
  adminFlowEnabled: boolean
  adminHeader: string
  actions: AccessControlActions
}) {
  const canCallManagementApi = adminFlowEnabled || Boolean(credentials.adminToken.trim())
  return (
    <FieldGroup className="grid gap-5 md:grid-cols-2">
      <Field>
        <FieldLabel htmlFor="operator-admin-token">Admin token</FieldLabel>
        <Input
          id="operator-admin-token"
          value={credentials.adminToken}
          onChange={(event) => actions.onAdminTokenChange(event.target.value)}
          placeholder="Verifier admin token"
        />
        <FieldDescription>
          Uses the runtime’s advertised admin header: <code>{adminHeader}</code>.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="operator-key-label">New verifier key label</FieldLabel>
        <Input
          id="operator-key-label"
          value={credentials.apiKeyLabel}
          onChange={(event) => actions.onApiKeyLabelChange(event.target.value)}
          placeholder="lab-client"
          disabled={!canCallManagementApi}
        />
      </Field>
    </FieldGroup>
  )
}

function VerifierClientControls({
  verifierKeys,
  adminFlowEnabled,
  hasAdminCredential,
  actions,
}: {
  verifierKeys: VerifierKeyState
  adminFlowEnabled: boolean
  hasAdminCredential: boolean
  actions: AccessControlActions
}) {
  const canCallManagementApi = adminFlowEnabled || hasAdminCredential
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        onClick={actions.onIssueKey}
        disabled={verifierKeys.isIssuing || !canCallManagementApi}
      >
        <KeyRound className="size-4" />
        {verifierKeys.isIssuing ? "Issuing…" : "Issue verifier key"}
      </Button>
      <Button
        variant="outline"
        onClick={actions.onRefreshKeys}
        disabled={verifierKeys.isRefreshing || !canCallManagementApi}
      >
        <RefreshCw className="size-4" />
        {verifierKeys.isRefreshing ? "Refreshing…" : "Refresh key list"}
      </Button>
      <Button
        variant="outline"
        onClick={actions.onCopyCurrentKey}
        disabled={
          verifierKeys.isCopying ||
          !(verifierKeys.latestIssuedKey || verifierKeys.sharedLabKey)
        }
      >
        <Copy className="size-4" />
        {verifierKeys.isCopying ? "Copying…" : "Copy current key"}
      </Button>
      <Button
        variant="outline"
        onClick={actions.onClearSharedKey}
        disabled={!verifierKeys.sharedLabKey}
      >
        Clear shared lab key
      </Button>
    </div>
  )
}

function VerifierMetrics({
  runtimeStatus,
  verifierKeys,
}: {
  runtimeStatus: VerifierStatus | null
  verifierKeys: VerifierKeyState
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <RuntimeMetric
        label="Active dynamic keys"
        value={String(
          verifierKeys.records.filter((record) => record.status === "active")
            .length,
        )}
      />
      <RuntimeMetric
        label="Configured auth"
        value={runtimeStatus ? compactCount(runtimeStatus.api_key_auth_enabled) : "loading"}
      />
      <RuntimeMetric
        label="Lab preload"
        value={verifierKeys.sharedLabKey ? "ready" : "not loaded"}
      />
    </div>
  )
}

function LabHandoff({
  verifierKeys,
  actions,
}: {
  verifierKeys: VerifierKeyState
  actions: AccessControlActions
}) {
  return (
    <div className="grid gap-3 rounded-[1.2rem] border border-border/70 bg-background/85 p-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold text-foreground">Lab handoff</h3>
        <p className="text-sm leading-6 text-muted-foreground">
          The latest verifier key can be stored in browser storage so the lab
          route can reuse it immediately without exposing it in the URL.
        </p>
      </div>
      <div className="rounded-[1.2rem] border border-border/70 bg-card/80 p-3 text-sm leading-6 text-muted-foreground">
        {verifierKeys.sharedLabKey
          ? "A verifier API key is already staged for the lab. Return to /lab and keep the scan flow moving."
          : "No verifier API key is staged for the lab yet. Issue a key or paste one into the lab manually if auth is enabled."}
      </div>
      <div className="grid min-w-0 gap-3">
        <Button className="w-full min-w-0 justify-center" onClick={actions.onNavigateLab}>
          Open lab with current browser key
          <ArrowRight className="size-4" />
        </Button>
        {verifierKeys.latestIssuedKey ? (
          <div className="min-w-0 rounded-[1.2rem] border border-border/70 bg-card/80 p-3 text-xs leading-6 text-muted-foreground">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Staged lab key
              </div>
              <Badge variant="secondary">browser only</Badge>
            </div>
            <div
              className="mt-2 max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-foreground"
              title={verifierKeys.latestIssuedKey}
            >
              {keyPreview(verifierKeys.latestIssuedKey)}
            </div>
            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Full value stays in browser storage. Use “Copy current key” above
              when you need it.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function VerifierKeyInventory({
  adminFlowEnabled,
  hasAdminCredential,
  records,
}: {
  adminFlowEnabled: boolean
  hasAdminCredential: boolean
  records: ManagementApiKeyRecord[]
}) {
  const canCallManagementApi = adminFlowEnabled || hasAdminCredential
  return (
    <ScrollArea className="h-[300px] rounded-[1.2rem] border border-border/70 bg-background/80">
      <div className="grid gap-3 p-3">
        {!canCallManagementApi ? (
          <InventoryEmptyState>
            Dynamic key inventory is unavailable because the server is not
            exposing verifier key management on this runtime.
          </InventoryEmptyState>
        ) : records.length === 0 ? (
          <InventoryEmptyState>
            No dynamic keys loaded yet. Issue or refresh to populate the verifier
            key inventory.
          </InventoryEmptyState>
        ) : (
          records.map((record) => <VerifierKeyRow key={record.key_id} record={record} />)
        )}
      </div>
    </ScrollArea>
  )
}

function VerifierKeyRow({ record }: { record: ManagementApiKeyRecord }) {
  const isActive = record.status === "active"
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-card/90 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 truncate font-medium text-foreground">
          {record.label}
        </div>
        <Badge variant={isActive ? "secondary" : "outline"}>
          {record.status}
        </Badge>
      </div>
      <div className="mt-2 break-all text-xs leading-5 text-muted-foreground">
        {record.key_id}
      </div>
      <div className="mt-2 break-all text-[11px] leading-5 text-muted-foreground">
        Postgres management · {record.created_at}
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        {record.scopes.map((scope) => (
          <Badge key={scope} variant="outline" className="max-w-full">
            <span className="truncate">{scope}</span>
          </Badge>
        ))}
      </div>
    </div>
  )
}

function ManagementKeyPanel({
  credentials,
  managementKeys,
  actions,
}: {
  credentials: CredentialState
  managementKeys: ManagementKeyState
  actions: AccessControlActions
}) {
  return (
    <div className="grid gap-4 rounded-[1.2rem] border border-border/70 bg-background/85 p-4">
      <ManagementKeyHeader />
      <ManagementKeyFields credentials={credentials} actions={actions} />
      <ManagementKeyActions
        adminToken={credentials.adminToken}
        managementKeys={managementKeys}
        actions={actions}
      />
      <ManagementPlaintextNotice plaintextKey={managementKeys.latestIssuedKey} />
      <ManagementKeyInventory
        credentials={credentials}
        managementKeys={managementKeys}
        actions={actions}
      />
    </div>
  )
}

function ManagementKeyHeader() {
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald-700" />
          <h3 className="text-sm font-semibold text-foreground">
            Management API keys
          </h3>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Issue scoped operator credentials for the management API. These keys
          are audited, revocable, and separate from lab verifier keys.
        </p>
      </div>
      <Badge variant="outline">Postgres authority</Badge>
    </div>
  )
}

function ManagementKeyFields({
  credentials,
  actions,
}: {
  credentials: CredentialState
  actions: AccessControlActions
}) {
  return (
    <FieldGroup className="grid gap-4 md:grid-cols-2">
      <Field>
        <FieldLabel htmlFor="operator-management-key-label">
          Management key label
        </FieldLabel>
        <Input
          id="operator-management-key-label"
          value={credentials.managementKeyLabel}
          onChange={(event) => actions.onManagementKeyLabelChange(event.target.value)}
          placeholder="operator-audit"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="operator-management-key-scopes">Scopes</FieldLabel>
        <Input
          id="operator-management-key-scopes"
          value={credentials.managementKeyScopes}
          onChange={(event) => actions.onManagementKeyScopesChange(event.target.value)}
          placeholder="audit:read, outbox:read"
        />
        <FieldDescription>
          Comma-separated. Verifier client scope is intentionally rejected.
        </FieldDescription>
      </Field>
    </FieldGroup>
  )
}

function ManagementKeyActions({
  adminToken,
  managementKeys,
  actions,
}: {
  adminToken: string
  managementKeys: ManagementKeyState
  actions: AccessControlActions
}) {
  const hasAdminToken = Boolean(adminToken.trim())
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        type="button"
        onClick={actions.onIssueManagementKey}
        disabled={managementKeys.isIssuing || !hasAdminToken}
      >
        <ShieldCheck className="size-4" />
        {managementKeys.isIssuing ? "Issuing…" : "Issue management key"}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={actions.onRefreshManagementKeys}
        disabled={managementKeys.isRefreshing || !hasAdminToken}
      >
        <RefreshCw className="size-4" />
        {managementKeys.isRefreshing ? "Refreshing…" : "Refresh management keys"}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={actions.onCopyCurrentManagementKey}
        disabled={managementKeys.isCopying || !managementKeys.latestIssuedKey}
      >
        <Copy className="size-4" />
        {managementKeys.isCopying ? "Copying…" : "Copy issued management key"}
      </Button>
    </div>
  )
}

function ManagementPlaintextNotice({ plaintextKey }: { plaintextKey: string }) {
  if (!plaintextKey) return null

  return (
    <div className="min-w-0 rounded-[1.2rem] border border-emerald-200 bg-emerald-50/70 p-3 text-xs leading-6 text-emerald-950">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em]">
          One-time plaintext
        </div>
        <Badge variant="secondary">copy now</Badge>
      </div>
      <div
        className="mt-2 max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px]"
        title={plaintextKey}
      >
        {keyPreview(plaintextKey)}
      </div>
      <div className="mt-1 text-[11px] leading-5">
        This value is not shown again by management-key list or audit views.
      </div>
    </div>
  )
}

function ManagementKeyInventory({
  credentials,
  managementKeys,
  actions,
}: {
  credentials: CredentialState
  managementKeys: ManagementKeyState
  actions: AccessControlActions
}) {
  return (
    <ScrollArea className="h-[220px] rounded-[1.2rem] border border-border/70 bg-card/80">
      <div className="grid gap-3 p-3">
        {managementKeys.records.length === 0 ? (
          <InventoryEmptyState>
            No management keys loaded yet. Issue or refresh to inspect scoped
            operator credentials.
          </InventoryEmptyState>
        ) : (
          managementKeys.records.map((record) => (
            <ManagementKeyRow
              key={record.key_id}
              adminToken={credentials.adminToken}
              record={record}
              revokingKeyId={managementKeys.revokingKeyId}
              onRevoke={actions.onRevokeManagementKey}
            />
          ))
        )}
      </div>
    </ScrollArea>
  )
}

function ManagementKeyRow({
  adminToken,
  record,
  revokingKeyId,
  onRevoke,
}: {
  adminToken: string
  record: ManagementApiKeyRecord
  revokingKeyId: string
  onRevoke: (keyId: string) => void
}) {
  const isActive = record.status === "active"
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-background/90 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{record.label}</div>
          <div className="mt-1 break-all text-xs leading-5 text-muted-foreground">
            {record.key_id}
          </div>
        </div>
        <Badge variant={isActive ? "secondary" : "outline"}>{record.status}</Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {record.scopes.map((scope) => (
          <Badge key={scope} variant="outline" className="max-w-full">
            <span className="truncate">{scope}</span>
          </Badge>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-[11px] leading-5 text-muted-foreground">
        <span>{record.created_at}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            !isActive || !adminToken.trim() || revokingKeyId === record.key_id
          }
          onClick={() => onRevoke(record.key_id)}
        >
          <Trash2 className="size-3.5" />
          {revokingKeyId === record.key_id ? "Revoking…" : "Revoke"}
        </Button>
      </div>
    </div>
  )
}

function InventoryEmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/80 bg-card/80 p-4 text-sm text-muted-foreground">
      {children}
    </div>
  )
}

export default AccessControlSection
