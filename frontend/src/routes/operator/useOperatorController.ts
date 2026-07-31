import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"

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
  return "The verifier request failed."
}

async function copyText(value: string) {
  if (!value.trim()) {
    throw new Error("There is no key value to copy yet.")
  }

  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard access is unavailable in this browser.")
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

  const runtimeSummary = useMemo(() => {
    if (!runtimeStatus) return "Loading live verifier posture."
    if (!runtimeStatus.api_key_auth_enabled) {
      return "Verifier auth is disabled on this runtime. The lab can operate without a client key."
    }
    if (!runtimeStatus.admin_api_key_management_enabled) {
      return "Verifier auth is enabled, but admin key issuance is disabled. Engineers must paste an existing client key into the lab."
    }
    return "Verifier auth and admin key issuance are both enabled. Issue a key here, then return to the lab with a shared browser-side key."
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
          title: "Runtime status failed",
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
  }, [adminHeader, adminToken])

  async function refreshKeys() {
    if (!adminToken.trim()) {
      setAccessMessage({
        title: "Admin token missing",
        body: "Provide the verifier admin token before refreshing the dynamic key inventory.",
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
        title: "Key inventory refreshed",
        body: `Loaded ${response.records.length} DB-backed verifier client key records from the management API.`,
        tone: "success",
      })
    } catch (error) {
      setAccessMessage({
        title: "Key refresh failed",
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
        title: "Admin token missing",
        body: "Provide a management credential before refreshing management keys.",
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
        title: "Management keys refreshed",
        body: `Loaded ${response.records.length} DB-backed management key records.`,
        tone: "success",
      })
    } catch (error) {
      setAccessMessage({
        title: "Management key refresh failed",
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
        title: "Admin token missing",
        body: "Provide the verifier admin token before loading management evidence.",
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
          title: "Management evidence partially unavailable",
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
        title: "Admin token missing",
        body: "Provide the verifier admin token before issuing a client key.",
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
        title: "Verifier key issued",
        body: `Key ${response.record.label} is active. It has been stored in the browser so the lab can reuse it immediately.`,
        tone: "success",
      })
      await loadRuntimeStatus()
    } catch (error) {
      setAccessMessage({
        title: "Key issue failed",
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
        title: "Admin token missing",
        body: "Provide a management credential before issuing a management key.",
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
        title: "Management scopes missing",
        body: "Add at least one scope before issuing a management key.",
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
        title: "Management key issued",
        body: "Copy this key now. The plaintext value is not returned by list or audit views.",
        tone: "success",
      })
    } catch (error) {
      setAccessMessage({
        title: "Management key issue failed",
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
        title: "Admin token missing",
        body: "Provide a management credential before running operator workflows.",
        tone: "blocked",
      })
      return
    }

    setIsSubmittingManagementWorkflow(true)
    setSubmittingManagementWorkflowId(workflowId)
    try {
      let body = "The management mutation was accepted."

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
        body = `${rootResponse.event_type} and ${authorityResponse.event_type} were recorded.`
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
        let statusSuffix = ""
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
          statusSuffix = ` ${statusResponse.event_type} set ${statusResponse.key_status}.`
        }
        body = `${response.key_id} is ${response.key_status}; ${response.event_type} was queued.${statusSuffix}`
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
        body = `${response.issuer_id} is ${response.enrollment_status}; ${response.event_type} was queued.`
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
        body = `${response.issuer_id} is now ${response.enrollment_status}; ${response.event_type} was queued.`
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
        body = `${response.domain} is ${response.verification_status}; ${response.event_type} was queued.`
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
        body = `${response.destination_policy_id} is ${response.status}; required hosts: ${response.required_hosts.join(", ")}.`
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
        body = `${response.destination_policy_id} is now ${response.status}; ${response.event_type} was queued.`
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
        body = `${response.provider_id} is ${response.status}; ${response.event_type} was queued.`
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
        body = `${response.subscriber_id} is ${response.status}; ${response.subjects.length} subject rule(s) are approved.`
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
        body = `${response.event_id} is now ${response.publish_status}; attempts ${response.attempts}.`
      } else {
        throw new Error("This management workflow is read-only.")
      }

      setManagementMessage({
        title: "Management workflow recorded",
        body,
        tone: "success",
      })
      await loadManagementEvidence({ reportErrors: false })
    } catch (error) {
      setManagementMessage({
        title: "Management workflow failed",
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
        title: "Admin token missing",
        body: "Provide a management credential before revoking a management key.",
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
        title: "Management key revoked",
        body: `${response.record.label} is no longer accepted by the management API.`,
        tone: "success",
      })
    } catch (error) {
      setAccessMessage({
        title: "Management key revoke failed",
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
        title: "Key copied",
        body: "The current verifier key is now in your clipboard.",
        tone: "success",
      })
    } catch (error) {
      setAccessMessage({
        title: "Copy failed",
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
        title: "Management key copied",
        body: "The one-time plaintext management key is now in your clipboard.",
        tone: "success",
      })
    } catch (error) {
      setAccessMessage({
        title: "Copy failed",
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
        title: "Shared key cleared",
        body: "The lab will no longer preload a verifier API key from browser storage.",
        tone: "neutral",
      })
      return
    }
    setAccessMessage({
      title: "Shared lab key cleared",
      body: "The latest issued key still appears below for inspection, but it will no longer preload into the lab.",
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
    runtimeSummary,
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
