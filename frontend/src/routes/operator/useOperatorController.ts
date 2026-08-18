import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"

import { t, type MessageKey } from "@/i18n"
import {
  clearStoredVerifierApiKey,
  type DelegatedAuthorityUpsertResponse,
  type DestinationPolicyStatusUpdateResponse,
  type DestinationPolicyUpsertResponse,
  type DomainProofUpsertResponse,
  type IssuerEnrollmentResponse,
  type IssuerStatusUpdateResponse,
  type ManagementApiKeyIssueResponse,
  type ManagementApiKeyListResponse,
  type ManagementApiKeyRecord,
  type ManagementApiKeyRevokeResponse,
  type ManagementAuditListResponse,
  type ManagementOutboxEventRemediationResponse,
  type ManagementOutboxStatusResponse,
  type ManagementRuntimeProviderListResponse,
  type ManagementRuntimeProviderRecord,
  type NatsSubscriberAuthorizationResponse,
  readStoredVerifierApiKey,
  requestJson,
  type RootProgramUpsertResponse,
  type RuntimeProviderUpsertResponse,
  storeVerifierApiKey,
  type TrustKeyMutationResponse,
  VerifierApiError,
  type VerifierStatus,
} from "@/lib/verifier-client"
import type { MessageState } from "@/routes/operator/types"

const runtimeStatusPollMs = 3000

type ManagementWorkflowPayload = Record<string, unknown>

type AuthoritySetupPayload = {
  root_program: ManagementWorkflowPayload
  delegated_authority: ManagementWorkflowPayload
}

type TrustKeyWorkflowPayload = {
  trust_key: ManagementWorkflowPayload
  status_update?: ManagementWorkflowPayload | null
}

function summariseError(error: unknown) {
  if (error instanceof VerifierApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return t("operator.error.requestFailed")
}

async function copyText(value: string) {
  if (!value.trim()) {
    throw new Error(t("operator.copy.noValue"))
  }

  if (!navigator.clipboard?.writeText) {
    throw new Error(t("operator.copy.clipboardUnavailable"))
  }

  await navigator.clipboard.writeText(value)
}

export function useOperatorController() {
  const [runtimeStatus, setRuntimeStatus] = useState<VerifierStatus | null>(null)
  const [adminToken, setAdminToken] = useState("local-lab-admin")
  const [apiKeyLabel, setApiKeyLabel] = useState("lab-client")
  const [managementKeyLabel, setManagementKeyLabel] = useState("operator-audit")
  const [managementKeyScopes, setManagementKeyScopes] = useState(
    "audit:read, outbox:read, management_keys:read",
  )
  const [apiKeys, setApiKeys] = useState<ManagementApiKeyRecord[]>([])
  const [managementKeys, setManagementKeys] = useState<ManagementApiKeyRecord[]>([])
  const [latestIssuedKey, setLatestIssuedKey] = useState("")
  const [latestIssuedManagementKey, setLatestIssuedManagementKey] = useState("")
  const [latestIssuedManagementKeyId, setLatestIssuedManagementKeyId] = useState("")
  const [sharedLabKey, setSharedLabKey] = useState(() => readStoredVerifierApiKey())
  const [statusMessage, setStatusMessage] = useState<MessageState | null>(null)
  const [accessMessage, setAccessMessage] = useState<MessageState | null>(null)
  const [managementMessage, setManagementMessage] = useState<MessageState | null>(null)
  const [managementOutbox, setManagementOutbox] =
    useState<ManagementOutboxStatusResponse | null>(null)
  const [managementAudit, setManagementAudit] =
    useState<ManagementAuditListResponse | null>(null)
  const [runtimeProviders, setRuntimeProviders] = useState<
    ManagementRuntimeProviderRecord[]
  >([])
  const [isLoadingStatus, setIsLoadingStatus] = useState(false)
  const [isRefreshingKeys, setIsRefreshingKeys] = useState(false)
  const [isRefreshingManagementKeys, setIsRefreshingManagementKeys] = useState(false)
  const [isIssuingKey, setIsIssuingKey] = useState(false)
  const [isIssuingManagementKey, setIsIssuingManagementKey] = useState(false)
  const [isCopyingKey, setIsCopyingKey] = useState(false)
  const [isCopyingManagementKey, setIsCopyingManagementKey] = useState(false)
  const [revokingManagementKeyId, setRevokingManagementKeyId] = useState("")
  const [isSubmittingManagementWorkflow, setIsSubmittingManagementWorkflow] =
    useState(false)
  const [submittingManagementWorkflowId, setSubmittingManagementWorkflowId] =
    useState("")
  const [isLoadingManagementEvidence, setIsLoadingManagementEvidence] = useState(false)
  const statusInFlightRef = useRef(false)
  const managementEvidenceInFlightRef = useRef(false)

  const apiKeyHeader = runtimeStatus?.api_key_header ?? "X-API-Key"
  const adminHeader = runtimeStatus?.admin_header ?? "X-Admin-Token"
  const apiAuthEnabled = Boolean(runtimeStatus?.api_key_auth_enabled)
  const adminFlowEnabled = Boolean(runtimeStatus?.admin_api_key_management_enabled)

  // A key, not a translated string: the memo is keyed on `runtimeStatus` alone,
  // so a resolved string would survive a locale switch and keep the card in the
  // language that happened to be active when the status last changed.
  const runtimeSummaryKey = useMemo<MessageKey>(() => {
    if (!runtimeStatus) return "operator.summary.loading"
    if (!runtimeStatus.api_key_auth_enabled) {
      return "operator.summary.authDisabled"
    }
    if (!runtimeStatus.admin_api_key_management_enabled) {
      return "operator.summary.adminDisabled"
    }
    return "operator.summary.ready"
  }, [runtimeStatus])

  async function loadRuntimeStatus({ reportErrors = true } = {}) {
    if (statusInFlightRef.current) return
    statusInFlightRef.current = true
    setIsLoadingStatus(true)
    try {
      const status = await requestJson<VerifierStatus>("/verifier/status", {
        adminToken: adminToken.trim() || undefined,
        adminHeader,
      })
      setRuntimeStatus(status)
      setStatusMessage(null)
    } catch (error) {
      if (reportErrors) {
        setStatusMessage({
          title: t("operator.status.failed.title"),
          body: summariseError(error),
          tone: "blocked",
        })
      }
    } finally {
      statusInFlightRef.current = false
      setIsLoadingStatus(false)
    }
  }

  const pollRuntimeStatus = useEffectEvent(loadRuntimeStatus)

  // Mount-only on purpose. `pollRuntimeStatus` is an Effect Event, so it already
  // reads the current adminToken/adminHeader on every tick. Listing those here
  // instead re-subscribed the poller on each keystroke of the admin token field,
  // and every re-subscribe fired the immediate timer below — one /verifier/status
  // request per character, each carrying a partial token.
  useEffect(() => {
    const initialPollTimer = window.setTimeout(() => {
      void pollRuntimeStatus()
    }, 0)
    const timer = window.setInterval(() => {
      void pollRuntimeStatus({ reportErrors: false })
    }, runtimeStatusPollMs)
    return () => {
      window.clearTimeout(initialPollTimer)
      window.clearInterval(timer)
    }
  }, [])

  async function refreshKeys() {
    if (!adminToken.trim()) {
      setAccessMessage({
        title: t("operator.adminToken.missing.title"),
        body: t("operator.adminToken.missing.refreshKeys"),
        tone: "blocked",
      })
      return
    }

    setIsRefreshingKeys(true)
    try {
      const response = await requestJson<ManagementApiKeyListResponse>(
        "/admin/verifier-clients/api-keys",
        {
          adminToken: adminToken.trim(),
          adminHeader,
        },
      )
      setApiKeys(response.records)
      setAccessMessage({
        title: t("operator.keys.refreshed.title"),
        body: t("operator.keys.refreshed.body", {
          count: response.records.length,
        }),
        tone: "success",
      })
    } catch (error) {
      setAccessMessage({
        title: t("operator.keys.refreshFailed.title"),
        body: summariseError(error),
        tone: "blocked",
      })
    } finally {
      setIsRefreshingKeys(false)
    }
  }

  async function refreshManagementKeys() {
    if (!adminToken.trim()) {
      setAccessMessage({
        title: t("operator.adminToken.missing.title"),
        body: t("operator.adminToken.missing.refreshManagementKeys"),
        tone: "blocked",
      })
      return
    }

    setIsRefreshingManagementKeys(true)
    try {
      const response = await requestJson<ManagementApiKeyListResponse>(
        "/admin/management-keys?limit=20",
        {
          adminToken: adminToken.trim(),
          adminHeader,
        },
      )
      setManagementKeys(response.records)
      setAccessMessage({
        title: t("operator.managementKeys.refreshed.title"),
        body: t("operator.managementKeys.refreshed.body", {
          count: response.records.length,
        }),
        tone: "success",
      })
    } catch (error) {
      setAccessMessage({
        title: t("operator.managementKeys.refreshFailed.title"),
        body: summariseError(error),
        tone: "blocked",
      })
    } finally {
      setIsRefreshingManagementKeys(false)
    }
  }

  async function loadManagementEvidence({ reportErrors = true } = {}) {
    if (managementEvidenceInFlightRef.current) return
    if (!adminToken.trim()) {
      setManagementMessage({
        title: t("operator.adminToken.missing.title"),
        body: t("operator.adminToken.missing.managementEvidence"),
        tone: "blocked",
      })
      return
    }

    managementEvidenceInFlightRef.current = true
    setIsLoadingManagementEvidence(true)
    try {
      const [outboxResult, auditResult, runtimeProviderResult] =
        await Promise.allSettled([
          requestJson<ManagementOutboxStatusResponse>("/admin/outbox?limit=6", {
            adminToken: adminToken.trim(),
            adminHeader,
          }),
          requestJson<ManagementAuditListResponse>("/admin/audit?limit=6", {
            adminToken: adminToken.trim(),
            adminHeader,
          }),
          requestJson<ManagementRuntimeProviderListResponse>(
            "/admin/runtime-providers",
            {
              adminToken: adminToken.trim(),
              adminHeader,
            },
          ),
        ])
      if (outboxResult.status === "fulfilled") {
        setManagementOutbox(outboxResult.value)
      } else {
        setManagementOutbox(null)
      }
      if (auditResult.status === "fulfilled") {
        setManagementAudit(auditResult.value)
      } else {
        setManagementAudit(null)
      }
      if (runtimeProviderResult.status === "fulfilled") {
        setRuntimeProviders(runtimeProviderResult.value.providers)
      } else {
        setRuntimeProviders([])
      }

      const errors = [outboxResult, auditResult, runtimeProviderResult]
        .filter((result) => result.status === "rejected")
        .map((result) =>
          result.status === "rejected" ? summariseError(result.reason) : ""
        )
        .filter(Boolean)
      if (errors.length > 0 && reportErrors) {
        setManagementMessage({
          title: t("operator.evidence.partial.title"),
          body: errors.join(" "),
          tone: "blocked",
        })
      } else if (reportErrors) {
        setManagementMessage(null)
      }
    } finally {
      managementEvidenceInFlightRef.current = false
      setIsLoadingManagementEvidence(false)
    }
  }

  async function issueKey() {
    if (!adminToken.trim()) {
      setAccessMessage({
        title: t("operator.adminToken.missing.title"),
        body: t("operator.adminToken.missing.issueKey"),
        tone: "blocked",
      })
      return
    }

    setIsIssuingKey(true)
    try {
      const response = await requestJson<ManagementApiKeyIssueResponse>(
        "/admin/verifier-clients/api-keys/issue",
        {
          method: "POST",
          adminToken: adminToken.trim(),
          adminHeader,
          body: { label: apiKeyLabel.trim() || "lab-client" },
        },
      )
      setLatestIssuedKey(response.plaintext_key)
      storeVerifierApiKey(response.plaintext_key)
      setSharedLabKey(response.plaintext_key)
      setApiKeys((current) => [
        response.record,
        ...current.filter((record) => record.key_id !== response.record.key_id),
      ])
      setAccessMessage({
        title: t("operator.keys.issued.title"),
        body: t("operator.keys.issued.body", { label: response.record.label }),
        tone: "success",
      })
      await loadRuntimeStatus()
    } catch (error) {
      setAccessMessage({
        title: t("operator.keys.issueFailed.title"),
        body: summariseError(error),
        tone: "blocked",
      })
    } finally {
      setIsIssuingKey(false)
    }
  }

  async function issueManagementKey() {
    if (!adminToken.trim()) {
      setAccessMessage({
        title: t("operator.adminToken.missing.title"),
        body: t("operator.adminToken.missing.issueManagementKey"),
        tone: "blocked",
      })
      return
    }

    const scopes = managementKeyScopes
      .split(/[,\n]/)
      .map((scope) => scope.trim())
      .filter(Boolean)
    if (scopes.length === 0) {
      setAccessMessage({
        title: t("operator.scopes.missing.title"),
        body: t("operator.scopes.missing.body"),
        tone: "blocked",
      })
      return
    }

    setIsIssuingManagementKey(true)
    try {
      const response = await requestJson<ManagementApiKeyIssueResponse>(
        "/admin/management-keys/issue",
        {
          method: "POST",
          adminToken: adminToken.trim(),
          adminHeader,
          body: {
            label: managementKeyLabel.trim() || "operator-key",
            scopes,
          },
        },
      )
      setLatestIssuedManagementKey(response.plaintext_key)
      setLatestIssuedManagementKeyId(response.record.key_id)
      setManagementKeys((current) => [
        response.record,
        ...current.filter((record) => record.key_id !== response.record.key_id),
      ])
      setAccessMessage({
        title: t("operator.managementKeys.issued.title"),
        body: t("operator.managementKeys.issued.body"),
        tone: "success",
      })
    } catch (error) {
      setAccessMessage({
        title: t("operator.managementKeys.issueFailed.title"),
        body: summariseError(error),
        tone: "blocked",
      })
    } finally {
      setIsIssuingManagementKey(false)
    }
  }

  async function submitManagementWorkflow(
    workflowId: string,
    payload: ManagementWorkflowPayload,
  ) {
    if (!adminToken.trim()) {
      setManagementMessage({
        title: t("operator.adminToken.missing.title"),
        body: t("operator.adminToken.missing.runWorkflow"),
        tone: "blocked",
      })
      return
    }

    setIsSubmittingManagementWorkflow(true)
    setSubmittingManagementWorkflowId(workflowId)
    try {
      // Every branch reports the same shape — subject, resulting status, queued
      // event — so they share two catalog entries instead of eight. Eight
      // separate English sentences would have been translated eight times and
      // drifted apart; one key cannot.
      let body = t("operator.workflow.accepted")

      if (workflowId === "authority-setup") {
        const setupPayload = payload as AuthoritySetupPayload
        const rootResponse = await requestJson<RootProgramUpsertResponse>(
          "/admin/root-programs",
          {
            method: "POST",
            adminToken: adminToken.trim(),
            adminHeader,
            body: setupPayload.root_program,
          },
        )
        const authorityResponse =
          await requestJson<DelegatedAuthorityUpsertResponse>(
            "/admin/delegated-authorities",
            {
              method: "POST",
              adminToken: adminToken.trim(),
              adminHeader,
              body: setupPayload.delegated_authority,
            },
          )
        body = t("operator.workflow.authorityRecorded", {
          rootEvent: rootResponse.event_type,
          authorityEvent: authorityResponse.event_type,
        })
      } else if (workflowId === "trust-keys") {
        const trustKeyPayload = payload as TrustKeyWorkflowPayload
        const response = await requestJson<TrustKeyMutationResponse>(
          "/admin/trust-keys",
          {
            method: "POST",
            adminToken: adminToken.trim(),
            adminHeader,
            body: trustKeyPayload.trust_key,
          },
        )
        // Sentences are collected and joined here rather than concatenated with
        // a leading space inside a catalog string — a translator (human or
        // machine) will not reliably preserve leading whitespace.
        const sentences = [
          t("operator.workflow.queued", {
            subject: response.key_id,
            status: response.key_status,
            event: response.event_type,
          }),
        ]
        if (trustKeyPayload.status_update) {
          const statusResponse = await requestJson<TrustKeyMutationResponse>(
            "/admin/trust-keys/status",
            {
              method: "POST",
              adminToken: adminToken.trim(),
              adminHeader,
              body: trustKeyPayload.status_update,
            },
          )
          sentences.push(
            t("operator.workflow.statusSet", {
              event: statusResponse.event_type,
              status: statusResponse.key_status,
            }),
          )
        }
        body = sentences.join(" ")
      } else if (workflowId === "issuer-enrollment") {
        const response = await requestJson<IssuerEnrollmentResponse>(
          "/admin/issuers",
          {
            method: "POST",
            adminToken: adminToken.trim(),
            adminHeader,
            body: payload,
          },
        )
        body = t("operator.workflow.queued", {
          subject: response.issuer_id,
          status: response.enrollment_status,
          event: response.event_type,
        })
      } else if (workflowId === "issuer-status") {
        const response = await requestJson<IssuerStatusUpdateResponse>(
          "/admin/issuers/status",
          {
            method: "POST",
            adminToken: adminToken.trim(),
            adminHeader,
            body: payload,
          },
        )
        body = t("operator.workflow.queuedNow", {
          subject: response.issuer_id,
          status: response.enrollment_status,
          event: response.event_type,
        })
      } else if (workflowId === "domain-proof") {
        const response = await requestJson<DomainProofUpsertResponse>(
          "/admin/domain-proofs",
          {
            method: "POST",
            adminToken: adminToken.trim(),
            adminHeader,
            body: payload,
          },
        )
        body = t("operator.workflow.queued", {
          subject: response.domain,
          status: response.verification_status,
          event: response.event_type,
        })
      } else if (workflowId === "destination-policy") {
        const response = await requestJson<DestinationPolicyUpsertResponse>(
          "/admin/destination-policies",
          {
            method: "POST",
            adminToken: adminToken.trim(),
            adminHeader,
            body: payload,
          },
        )
        body = t("operator.workflow.policyHosts", {
          subject: response.destination_policy_id,
          status: response.status,
          hosts: response.required_hosts.join(", "),
        })
      } else if (workflowId === "policy-status") {
        const response =
          await requestJson<DestinationPolicyStatusUpdateResponse>(
            "/admin/destination-policies/status",
            {
              method: "POST",
              adminToken: adminToken.trim(),
              adminHeader,
              body: payload,
            },
          )
        body = t("operator.workflow.queuedNow", {
          subject: response.destination_policy_id,
          status: response.status,
          event: response.event_type,
        })
      } else if (workflowId === "runtime-providers") {
        const response = await requestJson<RuntimeProviderUpsertResponse>(
          "/admin/runtime-providers",
          {
            method: "POST",
            adminToken: adminToken.trim(),
            adminHeader,
            body: payload,
          },
        )
        body = t("operator.workflow.queued", {
          subject: response.provider_id,
          status: response.status,
          event: response.event_type,
        })
      } else if (workflowId === "nats-subscribers") {
        const response = await requestJson<NatsSubscriberAuthorizationResponse>(
          "/admin/nats/subscribers",
          {
            method: "POST",
            adminToken: adminToken.trim(),
            adminHeader,
            body: payload,
          },
        )
        body = t("operator.workflow.subscriberRules", {
          subject: response.subscriber_id,
          status: response.status,
          count: response.subjects.length,
        })
      } else if (workflowId === "outbox-health") {
        const response =
          await requestJson<ManagementOutboxEventRemediationResponse>(
            "/admin/outbox/events/remediate",
            {
              method: "POST",
              adminToken: adminToken.trim(),
              adminHeader,
              body: payload,
            },
          )
        body = t("operator.workflow.outboxAttempts", {
          subject: response.event_id,
          status: response.publish_status,
          attempts: response.attempts,
        })
      } else {
        throw new Error(t("operator.workflow.readOnly"))
      }

      setManagementMessage({
        title: t("operator.workflow.recorded.title"),
        body,
        tone: "success",
      })
      await loadManagementEvidence({ reportErrors: false })
    } catch (error) {
      setManagementMessage({
        title: t("operator.workflow.failed.title"),
        body: summariseError(error),
        tone: "blocked",
      })
    } finally {
      setIsSubmittingManagementWorkflow(false)
      setSubmittingManagementWorkflowId("")
    }
  }

  async function revokeManagementKey(keyId: string) {
    if (!adminToken.trim()) {
      setAccessMessage({
        title: t("operator.adminToken.missing.title"),
        body: t("operator.adminToken.missing.revokeManagementKey"),
        tone: "blocked",
      })
      return
    }

    setRevokingManagementKeyId(keyId)
    try {
      const response = await requestJson<ManagementApiKeyRevokeResponse>(
        `/admin/management-keys/${encodeURIComponent(keyId)}/revoke`,
        {
          method: "POST",
          adminToken: adminToken.trim(),
          adminHeader,
        },
      )
      setManagementKeys((current) =>
        current.map((record) =>
          record.key_id === response.record.key_id ? response.record : record,
        ),
      )
      if (latestIssuedManagementKeyId === response.record.key_id) {
        setLatestIssuedManagementKey("")
        setLatestIssuedManagementKeyId("")
      }
      setAccessMessage({
        title: t("operator.managementKeys.revoked.title"),
        body: t("operator.managementKeys.revoked.body", {
          label: response.record.label,
        }),
        tone: "success",
      })
    } catch (error) {
      setAccessMessage({
        title: t("operator.managementKeys.revokeFailed.title"),
        body: summariseError(error),
        tone: "blocked",
      })
    } finally {
      setRevokingManagementKeyId("")
    }
  }

  async function copyCurrentKey() {
    setIsCopyingKey(true)
    try {
      await copyText(latestIssuedKey || sharedLabKey)
      setAccessMessage({
        title: t("operator.copy.key.title"),
        body: t("operator.copy.key.body"),
        tone: "success",
      })
    } catch (error) {
      setAccessMessage({
        title: t("operator.copy.failed.title"),
        body: summariseError(error),
        tone: "blocked",
      })
    } finally {
      setIsCopyingKey(false)
    }
  }

  async function copyCurrentManagementKey() {
    setIsCopyingManagementKey(true)
    try {
      await copyText(latestIssuedManagementKey)
      setAccessMessage({
        title: t("operator.copy.managementKey.title"),
        body: t("operator.copy.managementKey.body"),
        tone: "success",
      })
    } catch (error) {
      setAccessMessage({
        title: t("operator.copy.failed.title"),
        body: summariseError(error),
        tone: "blocked",
      })
    } finally {
      setIsCopyingManagementKey(false)
    }
  }

  function clearSharedKey() {
    clearStoredVerifierApiKey()
    setSharedLabKey("")
    if (!latestIssuedKey) {
      setAccessMessage({
        title: t("operator.sharedKey.cleared.title"),
        body: t("operator.sharedKey.cleared.body"),
        tone: "neutral",
      })
      return
    }
    setAccessMessage({
      title: t("operator.sharedKey.clearedWithIssued.title"),
      body: t("operator.sharedKey.clearedWithIssued.body"),
      tone: "neutral",
    })
  }

  return {
    runtimeStatus,
    adminToken,
    apiKeyLabel,
    managementKeyLabel,
    managementKeyScopes,
    apiKeys,
    managementKeys,
    latestIssuedKey,
    latestIssuedManagementKey,
    sharedLabKey,
    statusMessage,
    accessMessage,
    managementMessage,
    managementOutbox,
    managementAudit,
    runtimeProviders,
    isLoadingStatus,
    isRefreshingKeys,
    isRefreshingManagementKeys,
    isIssuingKey,
    isIssuingManagementKey,
    isCopyingKey,
    isCopyingManagementKey,
    revokingManagementKeyId,
    isSubmittingManagementWorkflow,
    submittingManagementWorkflowId,
    isLoadingManagementEvidence,
    apiKeyHeader,
    adminHeader,
    apiAuthEnabled,
    adminFlowEnabled,
    runtimeSummaryKey,
    setAdminToken,
    setApiKeyLabel,
    setManagementKeyLabel,
    setManagementKeyScopes,
    loadRuntimeStatus,
    refreshKeys,
    refreshManagementKeys,
    loadManagementEvidence,
    issueKey,
    issueManagementKey,
    submitManagementWorkflow,
    revokeManagementKey,
    copyCurrentKey,
    copyCurrentManagementKey,
    clearSharedKey,
  }
}
