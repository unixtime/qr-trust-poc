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
import { useT, type MessageKey } from "@/i18n"
import { useTNodes } from "@/i18n/nodes"
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

// Module scope evaluates once at import, so this returns a key and lets the
// caller translate it at render time — a string here would freeze the locale.
function compactCount(value: boolean): MessageKey {
  return value ? "operator.value.enabled" : "operator.value.disabled"
}

// Pure formatting: no prose, so nothing to translate.
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
    <Card className="h-fit min-w-0">
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
  const t = useT()
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="rounded-full border border-white/10 bg-white/5 p-2 text-muted-foreground">
          <WalletCards className="size-4" />
        </div>
        <div>
          <CardTitle className="text-base">
            {t("operator.access.title")}
          </CardTitle>
          <CardDescription>{t("operator.access.description")}</CardDescription>
        </div>
      </div>
      <Badge variant={adminFlowEnabled ? "secondary" : "outline"}>
        {t(
          adminFlowEnabled
            ? "operator.access.adminFlow.enabled"
            : "operator.access.adminFlow.disabled",
        )}
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
  const t = useT()
  const tNodes = useTNodes()
  if (adminFlowEnabled) return null

  return (
    <Alert>
      <AlertTitle>{t("operator.access.adminDisabled.title")}</AlertTitle>
      <AlertDescription>
        {tNodes("operator.access.adminDisabled.body", {
          writeScope: <code>verifier_clients:write</code>,
          readScope: <code>verifier_clients:read</code>,
        })}{" "}
        {t(
          apiAuthEnabled
            ? "operator.access.adminDisabled.authOn"
            : "operator.access.adminDisabled.authOff",
        )}
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
  const t = useT()
  const tNodes = useTNodes()
  const canCallManagementApi = adminFlowEnabled || Boolean(credentials.adminToken.trim())
  return (
    <FieldGroup className="grid gap-5 md:grid-cols-2">
      <Field>
        <FieldLabel htmlFor="operator-admin-token">
          {t("operator.access.adminToken.label")}
        </FieldLabel>
        <Input
          id="operator-admin-token"
          value={credentials.adminToken}
          onChange={(event) => actions.onAdminTokenChange(event.target.value)}
          placeholder={t("operator.access.adminToken.placeholder")}
        />
        <FieldDescription>
          {tNodes("operator.access.adminToken.description", {
            header: <code>{adminHeader}</code>,
          })}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="operator-key-label">
          {t("operator.access.keyLabel.label")}
        </FieldLabel>
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
  const t = useT()
  const canCallManagementApi = adminFlowEnabled || hasAdminCredential
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        onClick={actions.onIssueKey}
        disabled={verifierKeys.isIssuing || !canCallManagementApi}
      >
        <KeyRound className="size-4" />
        {t(
          verifierKeys.isIssuing
            ? "operator.access.issuing"
            : "operator.access.issueKey",
        )}
      </Button>
      <Button
        variant="outline"
        onClick={actions.onRefreshKeys}
        disabled={verifierKeys.isRefreshing || !canCallManagementApi}
      >
        <RefreshCw className="size-4" />
        {t(
          verifierKeys.isRefreshing
            ? "operator.access.refreshing"
            : "operator.access.refreshKeys",
        )}
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
        {t(
          verifierKeys.isCopying
            ? "operator.access.copying"
            : "operator.access.copyKey",
        )}
      </Button>
      <Button
        variant="outline"
        onClick={actions.onClearSharedKey}
        disabled={!verifierKeys.sharedLabKey}
      >
        {t("operator.access.clearSharedKey")}
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
  const t = useT()
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <RuntimeMetric
        label={t("operator.access.metric.activeKeys")}
        value={String(
          verifierKeys.records.filter((record) => record.status === "active")
            .length,
        )}
      />
      <RuntimeMetric
        label={t("operator.access.metric.configuredAuth")}
        value={t(
          runtimeStatus
            ? compactCount(runtimeStatus.api_key_auth_enabled)
            : "operator.value.loading",
        )}
      />
      <RuntimeMetric
        label={t("operator.access.metric.labPreload")}
        value={t(
          verifierKeys.sharedLabKey
            ? "operator.value.ready"
            : "operator.value.notLoaded",
        )}
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
  const t = useT()
  return (
    <div className="grid gap-3 rounded-2xl border border-white/8 bg-white/3 p-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold text-foreground">
          {t("operator.access.handoff.title")}
        </h3>
        <p className="text-sm leading-6 text-muted-foreground">
          {t("operator.access.handoff.body")}
        </p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-[rgba(5,10,18,0.35)] p-3 text-sm leading-6 text-muted-foreground">
        {t(
          verifierKeys.sharedLabKey
            ? "operator.access.handoff.staged"
            : "operator.access.handoff.notStaged",
        )}
      </div>
      <div className="grid min-w-0 gap-3">
        <Button className="w-full min-w-0 justify-center" onClick={actions.onNavigateLab}>
          {t("operator.access.handoff.open")}
          <ArrowRight className="size-4" />
        </Button>
        {verifierKeys.latestIssuedKey ? (
          <div className="min-w-0 rounded-2xl border border-white/10 bg-[rgba(5,10,18,0.35)] p-3 text-xs leading-6 text-muted-foreground">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t("operator.access.handoff.stagedKey")}
              </div>
              <Badge variant="secondary">
                {t("operator.access.handoff.browserOnly")}
              </Badge>
            </div>
            <div
              className="mt-2 max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-foreground"
              title={verifierKeys.latestIssuedKey}
            >
              {keyPreview(verifierKeys.latestIssuedKey)}
            </div>
            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {t("operator.access.handoff.stagedKeyNote")}
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
  const t = useT()
  const canCallManagementApi = adminFlowEnabled || hasAdminCredential
  return (
    <ScrollArea className="h-[300px] rounded-2xl border border-white/8 bg-[rgba(5,10,18,0.35)]">
      <div className="grid gap-3 p-3">
        {!canCallManagementApi ? (
          <InventoryEmptyState>
            {t("operator.access.inventory.unavailable")}
          </InventoryEmptyState>
        ) : records.length === 0 ? (
          <InventoryEmptyState>
            {t("operator.access.inventory.empty")}
          </InventoryEmptyState>
        ) : (
          records.map((record) => <VerifierKeyRow key={record.key_id} record={record} />)
        )}
      </div>
    </ScrollArea>
  )
}

function VerifierKeyRow({ record }: { record: ManagementApiKeyRecord }) {
  const t = useT()
  const isActive = record.status === "active"
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-white/8 bg-white/3 p-3">
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
        {t("operator.access.keyRow.source", { createdAt: record.created_at })}
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
    <div className="grid gap-4 rounded-2xl border border-white/8 bg-white/3 p-4">
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
  const t = useT()
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-trust-green" />
          <h3 className="text-sm font-semibold text-foreground">
            {t("operator.access.management.title")}
          </h3>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          {t("operator.access.management.body")}
        </p>
      </div>
      <Badge variant="outline">{t("operator.access.management.badge")}</Badge>
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
  const t = useT()
  return (
    <FieldGroup className="grid gap-4 md:grid-cols-2">
      <Field>
        <FieldLabel htmlFor="operator-management-key-label">
          {t("operator.access.management.labelField")}
        </FieldLabel>
        <Input
          id="operator-management-key-label"
          value={credentials.managementKeyLabel}
          onChange={(event) => actions.onManagementKeyLabelChange(event.target.value)}
          placeholder="operator-audit"
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="operator-management-key-scopes">
          {t("operator.access.management.scopesField")}
        </FieldLabel>
        <Input
          id="operator-management-key-scopes"
          value={credentials.managementKeyScopes}
          onChange={(event) => actions.onManagementKeyScopesChange(event.target.value)}
          placeholder="audit:read, outbox:read"
        />
        <FieldDescription>
          {t("operator.access.management.scopesDescription")}
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
  const t = useT()
  const hasAdminToken = Boolean(adminToken.trim())
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        type="button"
        onClick={actions.onIssueManagementKey}
        disabled={managementKeys.isIssuing || !hasAdminToken}
      >
        <ShieldCheck className="size-4" />
        {t(
          managementKeys.isIssuing
            ? "operator.access.issuing"
            : "operator.access.management.issue",
        )}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={actions.onRefreshManagementKeys}
        disabled={managementKeys.isRefreshing || !hasAdminToken}
      >
        <RefreshCw className="size-4" />
        {t(
          managementKeys.isRefreshing
            ? "operator.access.refreshing"
            : "operator.access.management.refresh",
        )}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={actions.onCopyCurrentManagementKey}
        disabled={managementKeys.isCopying || !managementKeys.latestIssuedKey}
      >
        <Copy className="size-4" />
        {t(
          managementKeys.isCopying
            ? "operator.access.copying"
            : "operator.access.management.copy",
        )}
      </Button>
    </div>
  )
}

function ManagementPlaintextNotice({ plaintextKey }: { plaintextKey: string }) {
  const t = useT()
  if (!plaintextKey) return null

  return (
    <div className="min-w-0 rounded-2xl border border-trust-green/30 bg-trust-green/10 p-3 text-xs leading-6 text-foreground">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]">
          {t("operator.access.plaintext.title")}
        </div>
        <Badge variant="secondary">{t("operator.access.plaintext.badge")}</Badge>
      </div>
      <div
        className="mt-2 max-w-full overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px]"
        title={plaintextKey}
      >
        {keyPreview(plaintextKey)}
      </div>
      <div className="mt-1 text-[11px] leading-5">
        {t("operator.access.plaintext.note")}
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
  const t = useT()
  return (
    <ScrollArea className="h-[220px] rounded-2xl border border-white/8 bg-[rgba(5,10,18,0.35)]">
      <div className="grid gap-3 p-3">
        {managementKeys.records.length === 0 ? (
          <InventoryEmptyState>
            {t("operator.access.management.inventoryEmpty")}
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
  const t = useT()
  const isActive = record.status === "active"
  return (
    <div className="min-w-0 overflow-hidden rounded-2xl border border-white/8 bg-white/3 p-3">
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
          {t(
            revokingKeyId === record.key_id
              ? "operator.access.management.revoking"
              : "operator.access.management.revoke",
          )}
        </Button>
      </div>
    </div>
  )
}

function InventoryEmptyState({ children }: { children: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/12 bg-white/2 p-4 text-sm text-muted-foreground">
      {children}
    </div>
  )
}

export default AccessControlSection
