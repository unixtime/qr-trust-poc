export type NetworkOutboxFailedRow = {
  outbox_id: string
  event_id: string
  event_type: string
  attempts: number
  last_error: string | null
  created_at: string
}

export type NetworkOutboxMetrics = {
  observed_at: string
  pending_count: number
  publishing_count: number
  published_count: number
  failed_count: number
  quarantined_count: number
  stale_claim_count: number
  retryable_failed_count: number
  oldest_pending_age_ms: number
  oldest_failed_age_ms: number
  max_attempts: number
  failed_rows: NetworkOutboxFailedRow[]
}

export type NetworkOutboxOperatorStatus = {
  status: "healthy" | "degraded" | "blocked" | "unavailable"
  supervisor_state: "observable" | "unconfigured" | "unavailable"
  summary: string
  reasons: string[]
  database_configured: boolean
  database_dsn_label: string | null
  metrics: NetworkOutboxMetrics | null
  error: string | null
}

export type ManagementOutboxEventRecord = {
  outbox_id: string
  event_id: string
  event_type: string
  aggregate_type: string
  aggregate_id: string
  publish_status:
    | "pending"
    | "publishing"
    | "published"
    | "failed"
    | "quarantined"
    | string
  attempts: number
  last_error: string | null
  created_at: string
  published_at: string | null
}

export type ManagementOutboxStatusResponse = {
  status_counts: Record<
    "pending" | "publishing" | "published" | "failed" | "quarantined",
    number
  >
  recent_events: ManagementOutboxEventRecord[]
}

export type ManagementAuditRecord = {
  audit_id: string
  actor_key_id: string | null
  action: string
  target_type: string
  target_id: string
  root_program_id: string | null
  delegated_authority_id: string | null
  issuer_id: string | null
  before_json: Record<string, unknown> | null
  after_json: Record<string, unknown> | null
  request_id: string | null
  idempotency_key: string | null
  created_at: string
}

export type ManagementAuditListResponse = {
  audit_rows: ManagementAuditRecord[]
}

export type ManagementApiKeyRecord = {
  key_id: string
  label: string
  operator_id: string | null
  scopes: string[]
  status: string
  created_at: string
  expires_at: string | null
  revoked_at: string | null
}

export type ManagementApiKeyIssueResponse = {
  record: ManagementApiKeyRecord
  plaintext_key: string
}

export type ManagementApiKeyListResponse = {
  records: ManagementApiKeyRecord[]
}

export type ManagementApiKeyRevokeResponse = {
  record: ManagementApiKeyRecord
}

export type RootProgramUpsertResponse = {
  root_program_id: string
  status: string
  event_type: string
}

export type DelegatedAuthorityUpsertResponse = {
  root_program_id: string
  delegated_authority_id: string
  status: string
  event_type: string
}

export type IssuerEnrollmentResponse = {
  issuer_id: string
  enrollment_status: string
  event_type: string
}

export type IssuerStatusUpdateResponse = {
  issuer_id: string
  enrollment_status: string
  event_type: string
}

export type DomainProofUpsertResponse = {
  root_program_id: string
  delegated_authority_id: string
  issuer_id: string
  domain: string
  verification_status: string
  event_type: string
}

export type DestinationPolicyUpsertResponse = {
  destination_policy_id: string
  status: string
  event_type: string
  required_hosts: string[]
}

export type DestinationPolicyStatusUpdateResponse = {
  destination_policy_id: string
  status: string
  event_type: string
}

export type TrustKeyMutationResponse = {
  key_id: string
  key_status: string
  event_type: string
}

export type ManagementRuntimeProviderRecord = {
  provider_id: string
  display_name: string
  base_url: string | null
  verdict_ttl_seconds: number
  stale_behavior: string
  unavailable_behavior: string
  status: string
}

export type ManagementRuntimeProviderListResponse = {
  providers: ManagementRuntimeProviderRecord[]
}

export type RuntimeProviderUpsertResponse = {
  provider_id: string
  status: string
  event_type: string
}

export type NatsSubscriberAuthorizationResponse = {
  subscriber_id: string
  status: string
  event_type: string
  subjects: string[]
}

export type NatsSubscriberRecord = {
  subscriber_id: string
  display_name: string
  durable_name: string
  description: string
  status: string
  subjects: string[]
}

export type NatsSubscriberListResponse = {
  subscribers: NatsSubscriberRecord[]
}

export type ManagementOutboxEventRemediationResponse = {
  event_id: string
  publish_status: string
  attempts: number
  last_error: string | null
}

export type RuntimeSafetyProviderReport = {
  provider_id: string
  total_count: number
  risky_count: number
  blocked_count: number
  unavailable_count: number
  last_observed_at: string
}

export type RuntimeSafetyHostReport = {
  destination_host: string
  verdict: string
  risk_score: number
  reason_codes: string[]
  observed_at: string
  final_url: string | null
}

export type RuntimeSafetyObservationReport = {
  observed_at: string
  lookback_seconds: number
  total_count: number
  clear_count: number
  risky_count: number
  blocked_count: number
  unavailable_count: number
  unknown_count: number
  expired_count: number
  highest_risk_score: number
  provider_reports: RuntimeSafetyProviderReport[]
  top_hosts: RuntimeSafetyHostReport[]
}

export type RuntimeSafetyObservationOperatorStatus = {
  status: "healthy" | "degraded" | "blocked" | "unavailable"
  observation_state: "observable" | "unconfigured" | "unavailable"
  summary: string
  reasons: string[]
  database_configured: boolean
  database_dsn_label: string | null
  report: RuntimeSafetyObservationReport | null
  error: string | null
}

export type ScannerDecisionRecent = {
  decision_id: string
  verifier_id: string
  decision_color: "green" | "orange" | "red"
  decision_state: string
  reason_codes: string[]
  risk_score: number | null
  destination_fingerprint: string | null
  hold_to_open_required: boolean
  hold_to_open_duration_ms: number
  created_at: string
}

export type ScanActivityDecision = ScannerDecisionRecent & {
  /** `ios`, `android`, `browser_lab` or `unknown`, as the scanner reported it. */
  client_platform: string | null
}

/**
 * What the scanner did after its latest decision, from the UX events it
 * reported (`POST /scanner/ux-events`). `unreported` means no event reached
 * the verifier — the phone may still have opened the destination.
 */
export type ScanDestinationOutcome =
  | "opened"
  | "cancelled"
  | "held"
  | "previewed"
  | "unreported"

/**
 * Scan-flood state for one envelope: verdicts served from the short-lived
 * shared cache write no evidence row, so they are counted here instead, next
 * to the per-envelope budget that still applies to the scans the cache does
 * not absorb.
 */
export type ScanActivityThrottle = {
  cached_verdicts: number
  last_cached_at: string | null
  verdict_cache_ttl_seconds: number
  envelope_budget_limit: number
  envelope_budget_remaining: number
  envelope_budget_window_seconds: number
}

/**
 * Scans of one demo envelope as the verifier recorded them
 * (`GET /verifier/scan-activity?envelope_id=...`). `persistence_state` is the
 * honesty flag: the counts only mean something when it is `observable`;
 * `unconfigured`/`unavailable` say the evidence store cannot report phone
 * scans, not that none happened.
 */
export type ScanActivity = {
  envelope_fingerprint: string
  persistence_state: "observable" | "unconfigured" | "unavailable"
  lookback_seconds: number
  scan_count: number
  green_count: number
  orange_count: number
  red_count: number
  first_scanned_at: string | null
  last_scanned_at: string | null
  /** First green scan of this envelope. */
  first_verified_at: string | null
  /** Red decisions recorded after `first_verified_at`. */
  blocked_since_verified: number
  latest: ScanActivityDecision | null
  destination_outcome: ScanDestinationOutcome | null
  throttle: ScanActivityThrottle | null
  error: string | null
}

export type ScannerDecisionPersistenceReport = {
  observed_at: string
  lookback_seconds: number
  total_count: number
  green_count: number
  orange_count: number
  red_count: number
  hold_required_count: number
  highest_risk_score: number
  recent_decisions: ScannerDecisionRecent[]
}

export type ScannerDecisionOperatorStatus = {
  status: "healthy" | "degraded" | "blocked" | "unavailable"
  persistence_state: "observable" | "unconfigured" | "unavailable"
  summary: string
  reasons: string[]
  database_configured: boolean
  database_dsn_label: string | null
  report: ScannerDecisionPersistenceReport | null
  error: string | null
}

export type VerifierStatus = {
  verifier_profile_state: "active" | "stale" | "revoked"
  api_key_auth_enabled: boolean
  admin_api_key_management_enabled: boolean
  api_key_header: string
  admin_header: string
  redis_connected: boolean
  distributed_rate_limiting_enabled: boolean
  decode_image_fallback_enabled: boolean
  rate_limit_window_seconds: number
  rate_limit_max_requests: number
  decode_rate_limit_max_requests: number
  envelope_rate_limit_window_seconds: number
  envelope_rate_limit_max_requests: number
  issuer_rate_limit_max_requests: number
  forwarded_ip_trust_configured: boolean
  max_qr_payload_chars: number
  max_decode_image_bytes: number
  network_outbox: NetworkOutboxOperatorStatus
  scanner_decisions: ScannerDecisionOperatorStatus
  runtime_observations: RuntimeSafetyObservationOperatorStatus
}

export type CertificateRecord = {
  certificate_ref: string
  issuer_name: string
  algorithm_id: string
  public_key_pem: string
}

export type IssuerVerificationState = {
  verified_domains: string[]
  allow_subdomains: boolean
  certificate_active: boolean
  certificate_revoked: boolean
  certificate_revocation_reason: string | null
}

export type GovernanceCacheProfile = "fresh" | "stale" | "expired"

// Claims v2, in canonical order. The validity window is the only freshness
// input the verifier reads.
export type SignedClaims = {
  version: string
  certificate_ref: string
  issued_at: string
  expires_at: string
  payload: string
}

export type SignedEnvelope = {
  claims: SignedClaims
  signature: string
  code_algorithm_id: string | null
}

export type NarrowedVerifierRequest = {
  envelope: SignedEnvelope
  certificate: CertificateRecord
  issuer_state: IssuerVerificationState
}

export type ScannedVerifierRequest = {
  qr_payload: string
  certificate: CertificateRecord
  issuer_state: IssuerVerificationState
}

export type TrustKeyState = "active" | "retired" | "revoked"
export type TrustIssuerStatus = "active" | "suspended" | "revoked"

export type DemoMaterialsRequest = {
  payload: string
  governance_cache_profile: GovernanceCacheProfile
  verified_domains: string[]
  allow_subdomains: boolean
  certificate_active: boolean
  certificate_revoked: boolean
  certificate_revocation_reason: string | null
  issued_offset_minutes: number
  expires_offset_minutes: number
  /** Cycle 2: issuer-record window, relative to now. Omitted = no expiry. */
  issuer_record_expires_offset_minutes?: number | null
  /** Cycle 2: explicit key state; the backend derives "revoked" from `certificate_revoked` when absent. */
  key_state?: TrustKeyState
  /** Cycle 2: mint a new demo key and retire the previous one. */
  rotate_key?: boolean
  register_scanner_trust?: boolean
  artifact_profile?: ArtifactRenderProfile
}

export type ArtifactRenderProfile = "clean" | "low-quiet-zone" | "payload-mismatch"

export type DemoTrustEcho = {
  key_ref: string
  key_state: TrustKeyState
  issuer_status: TrustIssuerStatus
  retired_key_refs: string[]
}

export type DemoMaterialsResponse = {
  certificate: CertificateRecord
  issuer_state: IssuerVerificationState
  governance: ScannerDecisionGovernance | null
  verify_request: NarrowedVerifierRequest
  qr_payload: string
  qr_png_base64: string
  /** sha256 over the canonical claims and the signature; 64 hex chars. */
  envelope_id: string
  trust: DemoTrustEcho
}

export type TrustStoreIssuerRecord = {
  issuer_id: string
  issuer_name: string
  root_id: string
  status: TrustIssuerStatus
  issued_at: string
  expires_at: string | null
  verified_domains: string[]
  allow_subdomains: boolean
}
export type TrustStoreKeyRecord = {
  key_ref: string
  issuer_id: string
  algorithm_id: string
  state: TrustKeyState
  not_before: string
  not_after: string | null
  revoked_at: string | null
  revocation_reason: string | null
}
export type TrustStoreResponse = {
  generated_at: string
  issuers: TrustStoreIssuerRecord[]
  keys: TrustStoreKeyRecord[]
}

export type VerifierDecision = {
  allowed: boolean
  stage: string
  reason: string
  canonical_claims_sha256: string | null
  matched_rule: string | null
}

export type ScannerDecisionRequest = {
  qr_payload: string
  image_base64?: string | null
  display_text?: string | null
  prior_opened_hosts?: string[] | null
  known_bad_hosts?: string[]
  newly_registered_hosts?: string[]
  domain_age_days?: Record<string, number>
  client?: {
    platform: string
    app_version?: string | null
    verifier_profile_state?: "active" | "stale" | "revoked"
  }
}

export type ScannerUXEventType =
  | "preview"
  | "hold_start"
  | "hold_complete"
  | "open"
  | "cancel"

export type ScannerUXEventRequest = {
  event_type: ScannerUXEventType
  request_id?: string | null
  decision_id?: string | null
  decision_state: string
  risk_score: number
  risk_level: "green" | "amber" | "red"
  reason_codes: string[]
  hold_required: boolean
  hold_ms: number
  destination_display?: string | null
  destination_url?: string | null
  elapsed_ms?: number | null
  client?: {
    platform: string
    app_version?: string | null
    verifier_profile_state?: "active" | "stale" | "revoked"
  }
}

export type ScannerUXEventResponse = {
  recorded: boolean
  event_type: ScannerUXEventType
}

export type ScannerDecisionIssuer = {
  name: string | null
  tier: string | null
  status: string
}

export type ScannerDecisionDestination = {
  display_url: string
  host: string | null
  binding: string
  resolver_url: string | null
  final_url: string | null
  redirect_hops: number | null
  redirect_policy: string | null
}

export type ScannerDecisionSignal = {
  layer: string
  state: string
  message: string | null
}

export type ScannerDecisionAction = {
  id: string
  label: string
  style: string
}

export type ScannerDecisionUX = {
  risk_score: number
  risk_level: "green" | "amber" | "red"
  risk_stripe: "green" | "amber" | "red"
  hold_required: boolean
  hold_ms: number
  reason_codes: string[]
  destination_display: string | null
  destination_fingerprint: string | null
  primary_action: string
}

export type ScannerDecisionContractTrustStep = {
  status: string
  label: string
  message: string
  reason_codes: string[]
}

export type ScannerDecisionContract = {
  decision_id: string
  decided_at: string
  decision_color: "green" | "orange" | "red"
  decision_state: string
  reason_codes: string[]
  risk_score: number
  destination: {
    display_host: string
    fingerprint: string
    url: string
    resolver_url: string | null
    final_url: string | null
  }
  trust_path: {
    issuer_legitimacy: ScannerDecisionContractTrustStep
    destination_binding: ScannerDecisionContractTrustStep
    runtime_safety: ScannerDecisionContractTrustStep
    scanner_decision: ScannerDecisionContractTrustStep
  }
  hold_to_open: {
    required: boolean
    duration_ms: number
    reason_codes: string[]
  }
  cache_freshness: {
    status: "fresh" | "stale" | "expired" | "unavailable" | "not_applicable"
    cache_generated_at: string | null
    cache_expires_at: string | null
  }
  governance: Record<string, unknown>
}

// The six residual families the decision model scores, exactly as
// `RESIDUAL_FAMILIES` names them in `trust_residuals_decision.py`.
export type ResidualFamily =
  | "issuer_chain"
  | "destination_policy"
  | "redirect_flow"
  | "runtime_safety"
  | "freshness"
  | "artifact_integrity"

// Every tier `decide()` accepts. The backend emits a subset today; the union
// stays complete so a new tier is a type error, not a silent fallthrough.
export type ResidualTier =
  | "pass"
  | "not-applicable"
  | "not-checked"
  | "unknown"
  | "unavailable"
  | "stale"
  | "warn"
  | "fail"
  | "unaccepted-issuer"
  | "invalid-managed-claim"
  | "revoked-issuer"
  | "block"

/**
 * Closed vocabulary of residual causes the scanner emits. The backend's
 * scope-honesty source guard checks this list against every catalogue; adding
 * a slug here without copy in `en.ts` fails that guard, and copy without a
 * slug here fails the same guard from the other side.
 */
export type ResidualCause =
  | "signature-invalid"
  | "issuer-inactive"
  | "issuer-revoked"
  | "issuer-record-expired"
  | "issuer-record-not-yet-valid"
  | "key-revoked"
  | "key-window-mismatch"
  | "destination-mismatch"
  | "not-yet-valid"
  | "object-expired"
  | "redirect-policy-blocked"
  | "runtime-risky"
  | "runtime-blocked"
  | "runtime-expired"
  | "runtime-stale"
  | "runtime-unavailable"
  | "no-signed-envelope"
  | "unsupported-envelope"
  | "unsupported-claims-version"
  | "key-suspended"
  | "trust-state-unavailable"
  | "redirect-unobserved"
  | "destination-invalid"
  | "policy-invalid"

export type ResidualEntry = {
  tier: ResidualTier
  cause: ResidualCause | null
}

export type ResidualVector = Record<ResidualFamily, ResidualEntry>

export type ModelDecision = {
  profile: string
  primary_state: string
  annotations: string[]
  reason_codes: string[]
  attention_level: "positive" | "neutral" | "warning" | "block"
}

export type ScannerDecisionResponse = {
  decision_state: string
  open_allowed: boolean
  /** sha256 over the canonical claims and the signature; 64 hex chars. */
  envelope_id: string | null
  residual_vector: ResidualVector
  model_decision: ModelDecision | null
  primary_message: string
  issuer: ScannerDecisionIssuer
  destination: ScannerDecisionDestination
  governance: ScannerDecisionGovernance | null
  signals: ScannerDecisionSignal[]
  actions: ScannerDecisionAction[]
  scanner_ux: ScannerDecisionUX | null
  contract: ScannerDecisionContract | null
  verifier_stage: string
  verifier_reason: string
  request_id: string | null
}

export type ScannerDecisionGovernance = {
  root_program_id: string
  delegated_authority_id: string
  issuer_id: string
  issuer_namespace_label: string
  issuer_display_name: string
  assurance_tier: string
  destination_policy_id: string
  cache_entry_id: string
  cache_freshness_state: string
  cache_state_published_at: string
  cache_generated_at: string
  cache_expires_at: string
  max_staleness_seconds: number
  stale_behavior: string
  source_artifacts: Record<string, string>
}

export type VerifierApiKeyRecord = {
  key_id: string
  label: string
  source: string
  created_at: string
  active: boolean
}

export type VerifierApiKeyIssueResponse = {
  record: VerifierApiKeyRecord
  plaintext_key: string
}

export type VerifierApiKeyListResponse = {
  records: VerifierApiKeyRecord[]
}

export class VerifierApiError extends Error {
  status: number
  retryAfterSeconds: number | null

  constructor(status: number, message: string, retryAfterSeconds: number | null = null) {
    super(message)
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const DEFAULT_API_KEY_HEADER = "X-API-Key"
const DEFAULT_ADMIN_HEADER = "X-Verifier-Admin-Token"

function apiBaseUrl() {
  return (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "")
}

function stringifyErrorDetail(detail: unknown) {
  if (typeof detail === "string" && detail.trim()) {
    return detail
  }
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return String(item)
        }
        const record = item as Record<string, unknown>
        const location = Array.isArray(record.loc) ? record.loc.join(".") : ""
        const message =
          typeof record.msg === "string" ? record.msg : JSON.stringify(record)
        return location ? `${location}: ${message}` : message
      })
      .filter(Boolean)
    return messages.length > 0 ? messages.join("; ") : null
  }
  if (detail && typeof detail === "object") {
    return JSON.stringify(detail)
  }
  return null
}

async function parseError(response: Response) {
  try {
    const payload = (await response.json()) as { detail?: unknown }
    return (
      stringifyErrorDetail(payload.detail) ??
      `Request failed with status ${response.status}`
    )
  } catch {
    return `Request failed with status ${response.status}`
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE"
  body?: unknown
  apiKey?: string
  adminToken?: string
  apiKeyHeader?: string
  adminHeader?: string
  signal?: AbortSignal
}

export async function requestJson<T>(
  path: string,
  {
    method = "GET",
    body,
    apiKey,
    adminToken,
    apiKeyHeader = DEFAULT_API_KEY_HEADER,
    adminHeader = DEFAULT_ADMIN_HEADER,
    signal,
  }: RequestOptions = {}
) {
  const headers = new Headers()
  if (body !== undefined) {
    headers.set("Content-Type", "application/json")
  }
  if (apiKey) {
    headers.set(apiKeyHeader, apiKey)
  }
  if (adminToken) {
    headers.set(adminHeader, adminToken)
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const retryAfterRaw = response.headers.get("Retry-After")
    const retryAfterSeconds = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : null
    throw new VerifierApiError(
      response.status,
      await parseError(response),
      Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null
    )
  }

  return (await response.json()) as T
}

export function qrImageDataUrl(base64: string) {
  return `data:image/png;base64,${base64}`
}

export function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Unable to read the selected image file."))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== "string") {
        reject(new Error("Unable to read the selected image file."))
        return
      }

      const [, base64] = result.split(",", 2)
      if (!base64) {
        reject(new Error("The selected image is not a valid base64 payload."))
        return
      }

      resolve(base64)
    }
    reader.readAsDataURL(file)
  })
}

const verifierApiKeyStorageKey = "verifier.lab.api-key"

export function readStoredVerifierApiKey() {
  if (typeof window === "undefined") return ""
  return window.localStorage.getItem(verifierApiKeyStorageKey) ?? ""
}

export function storeVerifierApiKey(key: string) {
  if (typeof window === "undefined") return
  const trimmed = key.trim()
  if (!trimmed) {
    window.localStorage.removeItem(verifierApiKeyStorageKey)
    return
  }
  window.localStorage.setItem(verifierApiKeyStorageKey, trimmed)
}

export function clearStoredVerifierApiKey() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(verifierApiKeyStorageKey)
}
