import { Effect } from "effect"

import { type NetworkError } from "../errors.js"
import { hashJson } from "../hash.js"
import type { ArtifactStoreShape } from "./artifact-store.js"
import type { EventBusShape, NetworkEvent } from "./event-bus.js"
import { destinationPolicyProjectionFromArtifactPublicationInput } from "./destination-policy-publication.js"
import {
  makeFixtureSignatureVerifier,
  type SignedTrustArtifactSummary,
  type SignatureVerifierShape,
} from "./signature-verification.js"
import type {
  TrustKeyRegistryWriterShape,
  TrustKeyStatus,
} from "./trust-key-registry.js"
import type {
  DestinationPolicyRule,
  DestinationPolicyProjection,
  RedirectPolicyProjection,
  IssuerNamespace,
  IssuerProjection,
  VerifierCacheWriterShape,
} from "./verifier-cache.js"

export interface VerifierSyncReport {
  readonly processed_events: number
  readonly fetched_artifacts: number
  readonly validated_trust_artifacts: number
  readonly projected_issuers: number
  readonly projected_destination_policies: number
  readonly applied_status_events: number
  readonly applied_key_status_events: number
  readonly missing_artifacts: ReadonlyArray<string>
  readonly artifact_hash_mismatches: ReadonlyArray<string>
  readonly rejected_status_events: ReadonlyArray<string>
}

export interface VerifierSyncServiceShape {
  readonly syncRecent: () => Effect.Effect<VerifierSyncReport, NetworkError>
}

export const makeVerifierSyncService = (
  store: ArtifactStoreShape,
  eventBus: EventBusShape,
  cache?: VerifierCacheWriterShape,
  signatureVerifier: SignatureVerifierShape = makeFixtureSignatureVerifier(),
  trustKeyRegistry?: TrustKeyRegistryWriterShape,
): VerifierSyncServiceShape => ({
  syncRecent: () =>
    Effect.gen(function* () {
      const events = yield* eventBus.recent()
      const missing: string[] = []
      const mismatches: string[] = []
      const rejectedStatusEvents: string[] = []
      let fetchedArtifacts = 0
      let validatedTrustArtifacts = 0
      let projectedIssuers = 0
      let projectedDestinationPolicies = 0
      let appliedStatusEvents = 0
      let appliedKeyStatusEvents = 0

      for (const event of events) {
        if (event.envelope.type === "scanner.decision.recorded") {
          continue
        }

        const artifact = yield* store.get(event.envelope.artifact_id)
        if (!artifact) {
          missing.push(event.envelope.artifact_id)
          continue
        }

        fetchedArtifacts += 1

        const computedHash = `sha256:${hashJson(artifact.body)}`
        if (
          artifact.artifact_hash !== event.envelope.artifact_hash ||
          artifact.artifact_hash !== computedHash
        ) {
          mismatches.push(event.envelope.artifact_id)
          continue
        }

        const recognizedTrustArtifact = recognizedTrustArtifactFromBody(
          artifact.body,
        )
        if (recognizedTrustArtifact) {
          const signature = yield* verifyRecognizedTrustArtifact(
            signatureVerifier,
            recognizedTrustArtifact,
          )
          if (!signature.accepted) {
            rejectedStatusEvents.push(
              `${event.envelope.artifact_id}:${signature.reason}`,
            )
            continue
          }
          if (!trustArtifactScopeMatchesBody(recognizedTrustArtifact)) {
            rejectedStatusEvents.push(
              `${event.envelope.artifact_id}:scope_mismatch`,
            )
            continue
          }
          validatedTrustArtifacts += 1
        }

        const rootAuthorityContext = rootAuthorityContextFromArtifact(
          artifact.body,
        )
        if (cache && rootAuthorityContext) {
          yield* cache.upsertRootAuthorityContext(rootAuthorityContext)
        }

        const delegatedAuthorityIssuerContext =
          delegatedAuthorityIssuerContextFromArtifact(artifact.body)
        if (cache && delegatedAuthorityIssuerContext) {
          yield* cache.upsertDelegatedAuthorityIssuerContext(
            delegatedAuthorityIssuerContext,
          )
        }

        const issuerProjection = issuerProjectionFromArtifact(artifact.body)
        if (cache && issuerProjection) {
          yield* cache.upsertIssuer(issuerProjection)
          projectedIssuers += 1
        }

        const destinationPolicyProjectionResult =
          yield* destinationPolicyProjectionFromArtifact(artifact.body, event)
        if (
          destinationPolicyProjectionResult &&
          "rejection_reason" in destinationPolicyProjectionResult
        ) {
          rejectedStatusEvents.push(
            `${event.envelope.artifact_id}:${destinationPolicyProjectionResult.rejection_reason}`,
          )
        }
        if (
          cache &&
          destinationPolicyProjectionResult &&
          "projection" in destinationPolicyProjectionResult
        ) {
          yield* cache.upsertDestinationPolicy(
            destinationPolicyProjectionResult.projection,
          )
          projectedDestinationPolicies += 1
        }

        const statusEvent = statusEventFromArtifact(artifact.body)
        if (cache && statusEvent) {
          const applied = yield* applyStatusEvent(cache, statusEvent)
          if (applied) {
            appliedStatusEvents += 1
          }
        }

        if (
          trustKeyRegistry &&
          statusEvent?.artifact_type === "revocation_status_event"
        ) {
          const appliedKeyStatus = yield* applyKeyStatusEvent(
            trustKeyRegistry,
            statusEvent,
          )
          if (appliedKeyStatus) {
            appliedKeyStatusEvents += 1
          }
        }
      }

      return {
        processed_events: events.length,
        fetched_artifacts: fetchedArtifacts,
        validated_trust_artifacts: validatedTrustArtifacts,
        projected_issuers: projectedIssuers,
        projected_destination_policies: projectedDestinationPolicies,
        applied_status_events: appliedStatusEvents,
        applied_key_status_events: appliedKeyStatusEvents,
        missing_artifacts: missing,
        artifact_hash_mismatches: mismatches,
        rejected_status_events: rejectedStatusEvents,
      }
    }),
})

interface IssuerRecordArtifactBody {
  readonly artifact_type: "issuer_record"
  readonly issuer_namespace: IssuerNamespace
  readonly issuer_display_name: string
  readonly issuer_class: string
  readonly assurance_tier: string
  readonly destination_policies: ReadonlyArray<{
    readonly destination_policy_id: string
    readonly policy_ref: string
    readonly status: StatusEventStatus
  }>
  readonly status: {
    readonly issuer_status: StatusEventStatus
    readonly certificate_status: "active" | "suspended" | "revoked" | "expired"
    readonly status_event_ref: string
  }
  readonly publication: {
    readonly published_at: string
    readonly valid_until: string
  }
}

type StatusEventStatus =
  | "active"
  | "suspended"
  | "revoked"
  | "expired"
  | "retired"

const lifecycleStatuses = [
  "active",
  "suspended",
  "revoked",
  "expired",
  "retired",
] as const
const certificateStatuses = [
  "active",
  "suspended",
  "revoked",
  "expired",
] as const

interface RootManifestArtifactBody {
  readonly artifact_type: "root_manifest"
  readonly schema_version: string
  readonly root_program_id: string
  readonly name: string
  readonly accepted_algorithm_ids: ReadonlyArray<string>
  readonly trust_keys: ReadonlyArray<{
    readonly key_id: string
    readonly signer_id: string
    readonly algorithm_id: string
    readonly public_key_material_ref: string
    readonly status: TrustKeyStatus
  }>
  readonly policy_constraints: Record<string, unknown>
  readonly delegated_authorities: ReadonlyArray<{
    readonly delegated_authority_id: string
    readonly name: string
    readonly manifest_ref: string
    readonly status: StatusEventStatus
  }>
  readonly publication: {
    readonly published_at: string
    readonly valid_until: string
    readonly signed_by: string
    readonly signature_status: string
  }
  readonly signed_by: string
  readonly signature_status?: string
  readonly signature_algorithm_id?: string
  readonly signature_input?: string
  readonly signature?: string
}

interface DelegatedAuthorityManifestArtifactBody {
  readonly artifact_type: "delegated_authority_manifest"
  readonly schema_version: string
  readonly root_program_id: string
  readonly delegated_authority_id: string
  readonly operator_name: string
  readonly operator_class: string
  readonly scope: ReadonlyArray<string>
  readonly trust_keys: RootManifestArtifactBody["trust_keys"]
  readonly assurance_requirements: Record<string, unknown>
  readonly enrolled_issuers: ReadonlyArray<{
    readonly issuer_id: string
    readonly issuer_record_ref: string
    readonly assurance_tier: string
    readonly status: StatusEventStatus
  }>
  readonly publication: {
    readonly published_at: string
    readonly valid_until: string
    readonly signed_by: string
    readonly signature_status: string
  }
  readonly signed_by: string
  readonly signature_status?: string
  readonly signature_algorithm_id?: string
  readonly signature_input?: string
  readonly signature?: string
}

const isRootManifestArtifactBody = (
  body: unknown,
): body is RootManifestArtifactBody => {
  if (!body || typeof body !== "object") {
    return false
  }

  const candidate = body as Record<string, unknown>
  const publication = candidate.publication as Record<string, unknown> | undefined

  return (
    candidate.artifact_type === "root_manifest" &&
    typeof candidate.schema_version === "string" &&
    typeof candidate.root_program_id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.accepted_algorithm_ids) &&
    candidate.accepted_algorithm_ids.every((item) => typeof item === "string") &&
    Array.isArray(candidate.trust_keys) &&
    candidate.trust_keys.every(isTrustKeyManifestEntry) &&
    isRecord(candidate.policy_constraints) &&
    Array.isArray(candidate.delegated_authorities) &&
    candidate.delegated_authorities.every(isDelegatedAuthorityManifestEntry) &&
    isPublicationMetadata(publication) &&
    typeof candidate.signed_by === "string"
  )
}

const isDelegatedAuthorityManifestArtifactBody = (
  body: unknown,
): body is DelegatedAuthorityManifestArtifactBody => {
  if (!body || typeof body !== "object") {
    return false
  }

  const candidate = body as Record<string, unknown>
  const publication = candidate.publication as Record<string, unknown> | undefined

  return (
    candidate.artifact_type === "delegated_authority_manifest" &&
    typeof candidate.schema_version === "string" &&
    typeof candidate.root_program_id === "string" &&
    typeof candidate.delegated_authority_id === "string" &&
    typeof candidate.operator_name === "string" &&
    typeof candidate.operator_class === "string" &&
    Array.isArray(candidate.scope) &&
    candidate.scope.every((item) => typeof item === "string") &&
    Array.isArray(candidate.trust_keys) &&
    candidate.trust_keys.every(isTrustKeyManifestEntry) &&
    isRecord(candidate.assurance_requirements) &&
    Array.isArray(candidate.enrolled_issuers) &&
    candidate.enrolled_issuers.every(isEnrolledIssuerManifestEntry) &&
    isPublicationMetadata(publication) &&
    typeof candidate.signed_by === "string"
  )
}

const isTrustKeyManifestEntry = (
  entry: unknown,
): entry is RootManifestArtifactBody["trust_keys"][number] => {
  if (!entry || typeof entry !== "object") {
    return false
  }

  const candidate = entry as Record<string, unknown>
  return (
    typeof candidate.key_id === "string" &&
    typeof candidate.signer_id === "string" &&
    typeof candidate.algorithm_id === "string" &&
    typeof candidate.public_key_material_ref === "string" &&
    (candidate.status === "active" ||
      candidate.status === "suspended" ||
      candidate.status === "revoked" ||
      candidate.status === "expired")
  )
}

const isDelegatedAuthorityManifestEntry = (
  entry: unknown,
): entry is RootManifestArtifactBody["delegated_authorities"][number] => {
  if (!entry || typeof entry !== "object") {
    return false
  }

  const candidate = entry as Record<string, unknown>
  return (
    typeof candidate.delegated_authority_id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.manifest_ref === "string" &&
    isOneOf(candidate.status, lifecycleStatuses)
  )
}

const isEnrolledIssuerManifestEntry = (
  entry: unknown,
): entry is DelegatedAuthorityManifestArtifactBody["enrolled_issuers"][number] => {
  if (!entry || typeof entry !== "object") {
    return false
  }

  const candidate = entry as Record<string, unknown>
  return (
    typeof candidate.issuer_id === "string" &&
    typeof candidate.issuer_record_ref === "string" &&
    typeof candidate.assurance_tier === "string" &&
    isOneOf(candidate.status, lifecycleStatuses)
  )
}

const isPublicationMetadata = (
  publication: Record<string, unknown> | undefined,
): publication is RootManifestArtifactBody["publication"] =>
  Boolean(publication) &&
  typeof publication?.published_at === "string" &&
  typeof publication.valid_until === "string" &&
  typeof publication.signed_by === "string" &&
  typeof publication.signature_status === "string"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const rootAuthorityContextFromArtifact = (
  body: unknown,
):
  | {
      readonly root_program_id: string
      readonly active_delegated_authority_ids: ReadonlyArray<string>
    }
  | undefined => {
  if (!isRootManifestArtifactBody(body)) {
    return undefined
  }

  return {
    root_program_id: body.root_program_id,
    active_delegated_authority_ids: body.delegated_authorities
      .filter((authority) => authority.status === "active")
      .map((authority) => authority.delegated_authority_id),
  }
}

const delegatedAuthorityIssuerContextFromArtifact = (
  body: unknown,
):
  | {
      readonly root_program_id: string
      readonly delegated_authority_id: string
      readonly active_issuer_ids: ReadonlyArray<string>
    }
  | undefined => {
  if (!isDelegatedAuthorityManifestArtifactBody(body)) {
    return undefined
  }

  return {
    root_program_id: body.root_program_id,
    delegated_authority_id: body.delegated_authority_id,
    active_issuer_ids: body.enrolled_issuers
      .filter((issuer) => issuer.status === "active")
      .map((issuer) => issuer.issuer_id),
  }
}

const issuerProjectionFromArtifact = (
  body: unknown,
): IssuerProjection | undefined => {
  if (
    !isIssuerRecordArtifactBody(body) ||
    body.status.issuer_status !== "active" ||
    body.status.certificate_status !== "active"
  ) {
    return undefined
  }

  const activeDestinationPolicy = body.destination_policies.find(
    (policy) => policy.status === "active",
  )
  if (!activeDestinationPolicy) {
    return undefined
  }

  return {
    namespace: body.issuer_namespace,
    issuer_display_name: body.issuer_display_name,
    assurance_tier: body.assurance_tier,
    destination_policy_id: activeDestinationPolicy.destination_policy_id,
    allowed_hosts: [],
    cache_generated_at: body.publication.published_at,
    cache_expires_at: body.publication.valid_until,
  }
}

const isIssuerRecordArtifactBody = (
  body: unknown,
): body is IssuerRecordArtifactBody => {
  if (!body || typeof body !== "object") {
    return false
  }

  const candidate = body as Record<string, unknown>
  const namespace = candidate.issuer_namespace as Record<string, unknown> | undefined
  const status = candidate.status as Record<string, unknown> | undefined
  const publication = candidate.publication as Record<string, unknown> | undefined

  return (
    candidate.artifact_type === "issuer_record" &&
    Boolean(namespace) &&
    typeof namespace?.root_program_id === "string" &&
    typeof namespace.delegated_authority_id === "string" &&
    typeof namespace.issuer_id === "string" &&
    typeof candidate.issuer_display_name === "string" &&
    typeof candidate.issuer_class === "string" &&
    typeof candidate.assurance_tier === "string" &&
    Array.isArray(candidate.destination_policies) &&
    candidate.destination_policies.every(isIssuerDestinationPolicyRef) &&
    Boolean(status) &&
    isOneOf(status?.issuer_status, lifecycleStatuses) &&
    isOneOf(status.certificate_status, certificateStatuses) &&
    typeof status.status_event_ref === "string" &&
    Boolean(publication) &&
    typeof publication?.published_at === "string" &&
    typeof publication.valid_until === "string"
  )
}

const isIssuerDestinationPolicyRef = (
  policy: unknown,
): policy is IssuerRecordArtifactBody["destination_policies"][number] => {
  if (!policy || typeof policy !== "object") {
    return false
  }

  const candidate = policy as Record<string, unknown>
  return (
    typeof candidate.destination_policy_id === "string" &&
    typeof candidate.policy_ref === "string" &&
    isOneOf(candidate.status, lifecycleStatuses)
  )
}

interface DestinationPolicyArtifactBody {
  readonly artifact_type: "destination_policy"
  readonly root_program_id: string
  readonly delegated_authority_id: string
  readonly issuer_id: string
  readonly destination_policy_id: string
  readonly approved_destinations: ReadonlyArray<DestinationPolicyRule>
  readonly redirect_policy: RedirectPolicyProjection
  readonly publication: {
    readonly published_at: string
    readonly valid_until: string
  }
}

interface RevocationStatusArtifactBody {
  readonly artifact_type: "revocation_status_event"
  readonly root_program_id: string
  readonly delegated_authority_id: string
  readonly target: {
    readonly target_type:
      | "issuer_record"
      | "issuer"
      | "certificate"
      | "destination_policy"
      | "delegated_authority"
      | "trust_key"
    readonly issuer_id?: string
    readonly destination_policy_id?: string
    readonly certificate_ref?: string
    readonly key_id?: string
  }
  readonly status: StatusEventStatus
  readonly signed_by: string
  readonly signature_status: string
  readonly signature_algorithm_id: string
  readonly signature_input: string
  readonly signature: string
}

interface AssuranceStatusArtifactBody {
  readonly artifact_type: "assurance_status_event"
  readonly root_program_id: string
  readonly delegated_authority_id: string
  readonly target: {
    readonly target_type: "issuer_record" | "issuer"
    readonly issuer_id: string
  }
  readonly previous_assurance_tier?: string
  readonly new_assurance_tier: string
  readonly signed_by: string
  readonly signature_status: string
  readonly signature_algorithm_id: string
  readonly signature_input: string
  readonly signature: string
}

const destinationPolicyProjectionFromArtifact = (
  body: unknown,
  event: NetworkEvent,
): Effect.Effect<
  | {
      readonly projection: DestinationPolicyProjection
    }
  | {
      readonly rejection_reason: "contract_validation_failed"
    }
  | undefined,
  never
> => {
  if (!artifactBodyTypeIs(body, "destination_policy")) {
    return Effect.succeed(undefined)
  }

  return destinationPolicyProjectionFromArtifactPublicationInput({
    artifact_type: "destination_policy",
    artifact_id: event.envelope.artifact_id,
    version: event.envelope.version,
    root_program_id: event.envelope.root_program_id,
    ...(event.envelope.delegated_authority_id
      ? { delegated_authority_id: event.envelope.delegated_authority_id }
      : {}),
    ...(event.envelope.issuer_id ? { issuer_id: event.envelope.issuer_id } : {}),
    ...(event.envelope.destination_policy_id
      ? { destination_policy_id: event.envelope.destination_policy_id }
      : {}),
    body,
    occurredAt: new Date(event.envelope.occurred_at),
    eventType: event.envelope.type,
  }).pipe(
    Effect.map((projection) => ({ projection }) as const),
    Effect.catchAll(() =>
      Effect.succeed({ rejection_reason: "contract_validation_failed" } as const),
    ),
  )
}

const artifactBodyTypeIs = (body: unknown, artifactType: string): boolean =>
  Boolean(
    body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as Record<string, unknown>).artifact_type === artifactType,
  )

const isDestinationPolicyArtifactBody = (
  body: unknown,
): body is DestinationPolicyArtifactBody => {
  if (!body || typeof body !== "object") {
    return false
  }

  const candidate = body as Record<string, unknown>
  const publication = candidate.publication as Record<string, unknown> | undefined

  return (
    candidate.artifact_type === "destination_policy" &&
    typeof candidate.root_program_id === "string" &&
    typeof candidate.delegated_authority_id === "string" &&
    typeof candidate.issuer_id === "string" &&
    typeof candidate.destination_policy_id === "string" &&
    Array.isArray(candidate.approved_destinations) &&
    candidate.approved_destinations.every(isDestinationPolicyDestination) &&
    isRedirectPolicy(candidate.redirect_policy) &&
    Boolean(publication) &&
    typeof publication?.published_at === "string" &&
    typeof publication.valid_until === "string"
  )
}

const isDestinationPolicyDestination = (
  destination: unknown,
): destination is DestinationPolicyArtifactBody["approved_destinations"][number] => {
  if (!destination || typeof destination !== "object") {
    return false
  }

  const candidate = destination as Record<string, unknown>
  return (
    typeof candidate.destination_id === "string" &&
    typeof candidate.expected_final_url === "string" &&
    Array.isArray(candidate.allowed_hosts) &&
    candidate.allowed_hosts.every((host) => typeof host === "string") &&
    typeof candidate.allow_subdomains === "boolean" &&
    Array.isArray(candidate.path_prefixes) &&
    candidate.path_prefixes.every((prefix) => typeof prefix === "string") &&
    typeof candidate.query_policy === "string" &&
    (typeof candidate.allowed_query_keys === "undefined" ||
      (Array.isArray(candidate.allowed_query_keys) &&
        candidate.allowed_query_keys.every((key) => typeof key === "string")))
  )
}

const isRedirectPolicy = (
  policy: unknown,
): policy is RedirectPolicyProjection => {
  if (!policy || typeof policy !== "object") {
    return false
  }

  const candidate = policy as Record<string, unknown>
  return (
    Array.isArray(candidate.resolver_urls) &&
    candidate.resolver_urls.every((url) => typeof url === "string") &&
    Array.isArray(candidate.expected_final_destinations) &&
    candidate.expected_final_destinations.every((url) => typeof url === "string") &&
    Array.isArray(candidate.allowed_redirect_hosts) &&
    candidate.allowed_redirect_hosts.every((host) => typeof host === "string") &&
    typeof candidate.max_redirect_hops === "number" &&
    typeof candidate.nested_shorteners_allowed === "boolean" &&
    typeof candidate.scanner_must_display_resolver_and_final_destination ===
      "boolean"
  )
}

const statusEventFromArtifact = (
  body: unknown,
): RevocationStatusArtifactBody | AssuranceStatusArtifactBody | undefined =>
  isRevocationStatusArtifactBody(body) || isAssuranceStatusArtifactBody(body)
    ? body
    : undefined

const recognizedTrustArtifactFromBody = (
  body: unknown,
): SignedTrustArtifactSummary | undefined => {
  if (
    isRootManifestArtifactBody(body) ||
    isDelegatedAuthorityManifestArtifactBody(body) ||
    isIssuerRecordArtifactBody(body) ||
    isDestinationPolicyArtifactBody(body) ||
    isRevocationStatusArtifactBody(body) ||
    isAssuranceStatusArtifactBody(body)
  ) {
    return body as SignedTrustArtifactSummary
  }

  return undefined
}

const verifyRecognizedTrustArtifact = (
  signatureVerifier: SignatureVerifierShape,
  body: SignedTrustArtifactSummary,
) => signatureVerifier.verifyTrustArtifact(body as SignedTrustArtifactSummary)

const trustArtifactScopeMatchesBody = (
  body: SignedTrustArtifactSummary,
): boolean => {
  if (isRootManifestArtifactBody(body)) {
    return (
      body.root_program_id ===
        (body as SignedTrustArtifactSummary).root_program_id &&
      body.publication.signed_by === body.signed_by &&
      body.publication.signature_status === body.signature_status
    )
  }

  if (isDelegatedAuthorityManifestArtifactBody(body)) {
    return (
      body.root_program_id ===
        (body as SignedTrustArtifactSummary).root_program_id &&
      body.delegated_authority_id ===
        (body as SignedTrustArtifactSummary).delegated_authority_id &&
      body.publication.signed_by === body.signed_by &&
      body.publication.signature_status === body.signature_status
    )
  }

  if (isIssuerRecordArtifactBody(body)) {
    return (
      body.root_program_id === body.issuer_namespace.root_program_id &&
      body.delegated_authority_id ===
        body.issuer_namespace.delegated_authority_id &&
      optionalIssuerIdMatchesNamespace(body)
    )
  }

  if (isDestinationPolicyArtifactBody(body)) {
    const signedScope = body as SignedTrustArtifactSummary
    const projectedScope = body as DestinationPolicyArtifactBody
    return (
      signedScope.root_program_id === projectedScope.root_program_id &&
      signedScope.delegated_authority_id ===
        projectedScope.delegated_authority_id &&
      optionalDestinationIssuerIdMatchesBody(signedScope, projectedScope)
    )
  }

  if (isAssuranceStatusArtifactBody(body)) {
    return (
      body.target.target_type === "issuer" ||
      body.target.target_type === "issuer_record"
    )
  }

  return true
}

const optionalIssuerIdMatchesNamespace = (
  body: SignedTrustArtifactSummary & IssuerRecordArtifactBody,
): boolean => {
  const issuerId = (body as unknown as Record<string, unknown>).issuer_id
  return (
    typeof issuerId === "undefined" ||
    issuerId === body.issuer_namespace.issuer_id
  )
}

const optionalDestinationIssuerIdMatchesBody = (
  signedScope: SignedTrustArtifactSummary,
  body: DestinationPolicyArtifactBody,
): boolean => {
  const issuerId = (signedScope as unknown as Record<string, unknown>).issuer_id
  return typeof issuerId === "string" && issuerId === body.issuer_id
}

const applyStatusEvent = (
  cache: VerifierCacheWriterShape,
  body: RevocationStatusArtifactBody | AssuranceStatusArtifactBody,
): Effect.Effect<boolean, NetworkError> => {
  if (body.artifact_type === "assurance_status_event") {
    return cache.updateIssuerAssuranceTier({
      namespace: {
        root_program_id: body.root_program_id,
        delegated_authority_id: body.delegated_authority_id,
        issuer_id: body.target.issuer_id,
      },
      assurance_tier: body.new_assurance_tier,
    })
  }

  if (body.status === "active") {
    return Effect.succeed(false)
  }

  if (
    (body.target.target_type === "issuer_record" ||
      body.target.target_type === "issuer" ||
      body.target.target_type === "certificate") &&
    typeof body.target.issuer_id === "string"
  ) {
    const issuerId = body.target.issuer_id
    return Effect.gen(function* () {
      const namespace = {
        root_program_id: body.root_program_id,
        delegated_authority_id: body.delegated_authority_id,
        issuer_id: issuerId,
      }
      const issuerRemoved = yield* cache.removeIssuer(namespace)
      const policyRemoved =
        yield* cache.removeDestinationPoliciesForIssuer(namespace)

      return issuerRemoved || policyRemoved
    })
  }

  if (body.target.target_type === "delegated_authority") {
    return cache.removeDelegatedAuthority({
      root_program_id: body.root_program_id,
      delegated_authority_id: body.delegated_authority_id,
    })
  }

  if (
    body.target.target_type === "destination_policy" &&
    typeof body.target.destination_policy_id === "string" &&
    typeof body.target.issuer_id === "string"
  ) {
    return cache.removeDestinationPolicy({
      namespace: {
        root_program_id: body.root_program_id,
        delegated_authority_id: body.delegated_authority_id,
        issuer_id: body.target.issuer_id,
      },
      destination_policy_id: body.target.destination_policy_id,
    })
  }

  return Effect.succeed(false)
}

const applyKeyStatusEvent = (
  registry: TrustKeyRegistryWriterShape,
  body: RevocationStatusArtifactBody,
): Effect.Effect<boolean, NetworkError> => {
  const keyId = body.target.key_id
  const status = body.status

  if (
    body.target.target_type !== "trust_key" ||
    typeof keyId !== "string" ||
    !isTrustKeyStatus(status)
  ) {
    return Effect.succeed(false)
  }

  // Every sibling status event writes through the namespace the signature gate
  // already bound the signing key to, so none of them can reach outside it.
  // This one addresses its target by key id instead, so the namespace has to be
  // re-applied here: otherwise any delegated authority under a root program
  // could revoke a peer authority's key, or the root program's own, with a
  // perfectly valid signature.
  return Effect.gen(function* () {
    const signer = yield* registry.lookupSignerKey({
      signed_by: body.signed_by,
      root_program_id: body.root_program_id,
      delegated_authority_id: body.delegated_authority_id,
      accepted_algorithm_ids: [body.signature_algorithm_id],
    })

    if (!signer.key || signer.reason) {
      return false
    }

    return yield* registry.updateTrustKeyStatus({
      root_program_id: body.root_program_id,
      key_id: keyId,
      status,
      // A root-program signer governs every key in its program. A delegated
      // authority governs only the keys issued under it.
      ...(signer.key.scope === "root_program"
        ? {}
        : { delegated_authority_id: body.delegated_authority_id }),
    })
  })
}

const isRevocationStatusArtifactBody = (
  body: unknown,
): body is RevocationStatusArtifactBody => {
  if (!body || typeof body !== "object") {
    return false
  }

  const candidate = body as Record<string, unknown>
  const target = candidate.target as Record<string, unknown> | undefined
  if (!target) {
    return false
  }

  const targetType = target?.target_type

  return (
    candidate.artifact_type === "revocation_status_event" &&
    typeof candidate.root_program_id === "string" &&
    typeof candidate.delegated_authority_id === "string" &&
    (targetType === "issuer_record" ||
      targetType === "issuer" ||
      targetType === "certificate" ||
      targetType === "destination_policy" ||
      targetType === "delegated_authority" ||
      targetType === "trust_key") &&
    (typeof target.issuer_id === "undefined" ||
      typeof target.issuer_id === "string") &&
    (typeof target.destination_policy_id === "undefined" ||
      typeof target.destination_policy_id === "string") &&
    (typeof target.certificate_ref === "undefined" ||
      typeof target.certificate_ref === "string") &&
    (typeof target.key_id === "undefined" ||
      typeof target.key_id === "string") &&
    (candidate.status === "active" ||
      candidate.status === "suspended" ||
      candidate.status === "revoked" ||
      candidate.status === "expired" ||
      candidate.status === "retired") &&
    typeof candidate.signed_by === "string" &&
    typeof candidate.signature_status === "string" &&
    typeof candidate.signature_algorithm_id === "string" &&
    typeof candidate.signature_input === "string" &&
    typeof candidate.signature === "string"
  )
}

const isAssuranceStatusArtifactBody = (
  body: unknown,
): body is AssuranceStatusArtifactBody => {
  if (!body || typeof body !== "object") {
    return false
  }

  const candidate = body as Record<string, unknown>
  const target = candidate.target as Record<string, unknown> | undefined
  if (!target) {
    return false
  }

  return (
    candidate.artifact_type === "assurance_status_event" &&
    typeof candidate.root_program_id === "string" &&
    typeof candidate.delegated_authority_id === "string" &&
    (target.target_type === "issuer" ||
      target.target_type === "issuer_record") &&
    typeof target.issuer_id === "string" &&
    (typeof candidate.previous_assurance_tier === "undefined" ||
      typeof candidate.previous_assurance_tier === "string") &&
    typeof candidate.new_assurance_tier === "string" &&
    typeof candidate.signed_by === "string" &&
    typeof candidate.signature_status === "string" &&
    typeof candidate.signature_algorithm_id === "string" &&
    typeof candidate.signature_input === "string" &&
    typeof candidate.signature === "string"
  )
}

const isOneOf = <T extends readonly string[]>(
  value: unknown,
  allowedValues: T,
): value is T[number] =>
  typeof value === "string" && allowedValues.includes(value)

const isTrustKeyStatus = (status: StatusEventStatus): status is TrustKeyStatus =>
  status === "active" ||
  status === "suspended" ||
  status === "revoked" ||
  status === "expired"
