import { Effect } from "effect"

import { contractValidationError, type NetworkError } from "../errors.js"
import { hashJson } from "../hash.js"
import type { SignedArtifact } from "./artifact-store.js"
import type {
  DestinationPolicyProjection,
  DestinationPolicyRule,
  IssuerNamespace,
  IssuerProjection,
  RedirectPolicyProjection,
} from "./verifier-cache.js"

export type VerifierCacheStaleBehavior =
  | "allow"
  | "downgrade_to_caution"
  | "downgrade_or_block"
  | "block"

export interface VerifierCacheEntryArtifactBody {
  readonly artifact_type: "verifier_cache_entry"
  readonly schema_version: string
  readonly cache_entry_id: string
  readonly effective_issuer_namespace: IssuerNamespace
  readonly source_artifacts: {
    readonly root_manifest_ref: string
    readonly delegated_operator_manifest_ref: string
    readonly issuer_record_ref: string
    readonly destination_policy_ref: string
    readonly status_event_ref: string
  }
  readonly certificate_ref: string
  readonly issuer_display_name: string
  readonly assurance_tier: string
  readonly destination_policy_id: string
  readonly scanner_trust_projection: {
    readonly issuer_legitimacy: string
    readonly destination_binding: string
    readonly runtime_safety: string
    readonly scanner_decision_if_clean: string
    readonly scanner_decision_if_risky: string
    readonly approved_destination_count: number
    readonly resolver_policy: string
  }
  readonly freshness: {
    readonly state_published_at: string
    readonly cache_generated_at: string
    readonly cache_expires_at: string
    readonly max_staleness_seconds: number
    readonly stale_behavior: VerifierCacheStaleBehavior
  }
}

export interface VerifierCacheMaterializationInput {
  readonly root_manifest: SignedArtifact
  readonly delegated_authority_manifest: SignedArtifact
  readonly issuer_record: SignedArtifact
  readonly destination_policy: SignedArtifact
  readonly status_event: SignedArtifact
  readonly materialized_at: Date
  readonly max_staleness_seconds?: number
  readonly stale_behavior?: VerifierCacheStaleBehavior
}

export interface VerifierCacheMaterializationReport {
  readonly cache_entry: VerifierCacheEntryArtifactBody
  readonly issuer_projection: IssuerProjection
  readonly destination_policy_projection: DestinationPolicyProjection
  readonly source_artifact_hashes: ReadonlyArray<string>
  readonly materialization_warnings: ReadonlyArray<string>
}

export interface VerifierCacheMaterializationServiceShape {
  readonly materialize: (
    input: VerifierCacheMaterializationInput,
  ) => Effect.Effect<VerifierCacheMaterializationReport, NetworkError>
}

export const makeVerifierCacheMaterializationService =
  (): VerifierCacheMaterializationServiceShape => ({
    materialize: materializeVerifierCacheEntry,
  })

export const materializeVerifierCacheEntry = (
  input: VerifierCacheMaterializationInput,
): Effect.Effect<VerifierCacheMaterializationReport, NetworkError> =>
  Effect.try({
    try: () => materializeVerifierCacheEntryUnsafe(input),
    catch: (cause) =>
      contractValidationError(
        "Verifier cache entry could not be materialized from the supplied artifact chain.",
        cause,
      ),
  })

const materializeVerifierCacheEntryUnsafe = (
  input: VerifierCacheMaterializationInput,
): VerifierCacheMaterializationReport => {
  const rootManifest = rootManifestBody(input.root_manifest)
  const delegatedAuthority = delegatedAuthorityBody(
    input.delegated_authority_manifest,
  )
  const issuerRecord = issuerRecordBody(input.issuer_record)
  const destinationPolicy = destinationPolicyBody(input.destination_policy)
  const statusEvent = statusEventBody(input.status_event)

  requireEqual(
    delegatedAuthority.root_program_id,
    rootManifest.root_program_id,
    "delegated authority root_program_id must match root manifest",
  )
  requireEqual(
    issuerRecord.issuer_namespace.root_program_id,
    rootManifest.root_program_id,
    "issuer root_program_id must match root manifest",
  )
  requireEqual(
    issuerRecord.issuer_namespace.delegated_authority_id,
    delegatedAuthority.delegated_authority_id,
    "issuer delegated_authority_id must match delegated authority",
  )
  requireEqual(
    destinationPolicy.root_program_id,
    issuerRecord.issuer_namespace.root_program_id,
    "destination policy root_program_id must match issuer namespace",
  )
  requireEqual(
    destinationPolicy.delegated_authority_id,
    issuerRecord.issuer_namespace.delegated_authority_id,
    "destination policy delegated_authority_id must match issuer namespace",
  )
  requireEqual(
    destinationPolicy.issuer_id,
    issuerRecord.issuer_namespace.issuer_id,
    "destination policy issuer_id must match issuer namespace",
  )
  requireEqual(
    statusEvent.root_program_id,
    issuerRecord.issuer_namespace.root_program_id,
    "status event root_program_id must match issuer namespace",
  )
  requireEqual(
    statusEvent.delegated_authority_id,
    issuerRecord.issuer_namespace.delegated_authority_id,
    "status event delegated_authority_id must match issuer namespace",
  )

  const delegatedAuthorityRef = requireTruthy(
    rootManifest.delegated_authorities.find(
      (authority) =>
        authority.delegated_authority_id ===
        delegatedAuthority.delegated_authority_id,
    ),
    "root manifest does not delegate this authority",
  )
  requireEqual(
    delegatedAuthorityRef.status,
    "active",
    "delegated authority must be active in the root manifest",
  )
  requireRefMatchesArtifact(
    delegatedAuthorityRef.manifest_ref,
    input.delegated_authority_manifest.artifact_id,
    "delegated authority manifest ref",
  )

  const enrolledIssuer = requireTruthy(
    delegatedAuthority.enrolled_issuers.find(
      (issuer) => issuer.issuer_id === issuerRecord.issuer_namespace.issuer_id,
    ),
    "delegated authority does not enroll this issuer",
  )
  requireEqual(
    enrolledIssuer.status,
    "active",
    "issuer enrollment must be active in delegated authority manifest",
  )
  requireRefMatchesArtifact(
    enrolledIssuer.issuer_record_ref,
    input.issuer_record.artifact_id,
    "issuer record ref",
  )

  requireEqual(
    issuerRecord.status.issuer_status,
    "active",
    "issuer record must be active before cache materialization",
  )
  requireEqual(
    issuerRecord.status.certificate_status,
    "active",
    "issuer certificate must be active before cache materialization",
  )

  const issuerPolicy = requireTruthy(
    issuerRecord.destination_policies.find(
      (policy) =>
        policy.destination_policy_id === destinationPolicy.destination_policy_id,
    ),
    "issuer record does not reference destination policy",
  )
  requireEqual(
    issuerPolicy.status,
    "active",
    "issuer destination policy reference must be active",
  )
  requireRefMatchesArtifact(
    issuerPolicy.policy_ref,
    input.destination_policy.artifact_id,
    "destination policy ref",
  )

  requireEqual(
    statusEvent.target.target_type,
    "issuer_record",
    "materialized cache status event must target the issuer record",
  )
  requireEqual(
    statusEvent.target.issuer_id,
    issuerRecord.issuer_namespace.issuer_id,
    "status event issuer target must match issuer record",
  )
  requireEqual(
    statusEvent.status,
    "active",
    "status event must be active before cache materialization",
  )

  const certificateRef = requireTruthy(
    statusEvent.target.certificate_ref ?? issuerRecord.certificate_refs[0],
    "issuer record must expose at least one certificate ref",
  )
  requireTruthy(
    issuerRecord.certificate_refs.includes(certificateRef),
    "status event certificate ref must belong to the issuer record",
  )

  const statePublishedAt = latestIso([
    rootManifest.publication.published_at,
    delegatedAuthority.publication.published_at,
    issuerRecord.publication.published_at,
    destinationPolicy.publication.published_at,
    statusEvent.effective_at,
  ])
  const cacheExpiresAt = earliestIso(
    [
      rootManifest.publication.valid_until,
      delegatedAuthority.publication.valid_until,
      issuerRecord.publication.valid_until,
      destinationPolicy.publication.valid_until,
      statusEvent.expires_at,
    ].filter((value): value is string => typeof value === "string"),
  )
  const staleBehavior =
    input.stale_behavior ??
    destinationPolicy.runtime_safety_policy.stale_behavior ??
    "downgrade_or_block"
  const sourceArtifactHashes = [
    input.root_manifest.artifact_hash,
    input.delegated_authority_manifest.artifact_hash,
    input.issuer_record.artifact_hash,
    input.destination_policy.artifact_hash,
    input.status_event.artifact_hash,
  ]

  const issuerProjection: IssuerProjection = {
    namespace: issuerRecord.issuer_namespace,
    issuer_display_name: issuerRecord.issuer_display_name,
    assurance_tier: issuerRecord.assurance_tier,
    destination_policy_id: destinationPolicy.destination_policy_id,
    allowed_hosts: allowedHosts(destinationPolicy),
    cache_generated_at: input.materialized_at.toISOString(),
    cache_expires_at: cacheExpiresAt,
  }
  const destinationPolicyProjection: DestinationPolicyProjection = {
    namespace: issuerRecord.issuer_namespace,
    destination_policy_id: destinationPolicy.destination_policy_id,
    approved_destinations: destinationPolicy.approved_destinations.map(
      normalizeDestinationRule,
    ),
    redirect_policy: {
      resolver_urls: destinationPolicy.redirect_policy.resolver_urls,
      expected_final_destinations:
        destinationPolicy.redirect_policy.expected_final_destinations,
      allowed_redirect_hosts:
        destinationPolicy.redirect_policy.allowed_redirect_hosts.map((host) =>
          host.toLowerCase(),
        ),
      max_redirect_hops: destinationPolicy.redirect_policy.max_redirect_hops,
      nested_shorteners_allowed:
        destinationPolicy.redirect_policy.nested_shorteners_allowed,
      scanner_must_display_resolver_and_final_destination:
        destinationPolicy.redirect_policy
          .scanner_must_display_resolver_and_final_destination,
    },
    allowed_hosts: allowedHosts(destinationPolicy),
    allow_subdomains: destinationPolicy.approved_destinations.some(
      (destination) => destination.allow_subdomains,
    ),
    cache_generated_at: input.materialized_at.toISOString(),
    cache_expires_at: cacheExpiresAt,
  }

  return {
    cache_entry: {
      artifact_type: "verifier_cache_entry",
      schema_version: "0.1.0",
      cache_entry_id: cacheEntryId(
        issuerRecord.issuer_namespace,
        destinationPolicy.destination_policy_id,
        sourceArtifactHashes,
      ),
      effective_issuer_namespace: issuerRecord.issuer_namespace,
      source_artifacts: {
        root_manifest_ref: input.root_manifest.artifact_id,
        delegated_operator_manifest_ref:
          input.delegated_authority_manifest.artifact_id,
        issuer_record_ref: input.issuer_record.artifact_id,
        destination_policy_ref: input.destination_policy.artifact_id,
        status_event_ref: input.status_event.artifact_id,
      },
      certificate_ref: certificateRef,
      issuer_display_name: issuerRecord.issuer_display_name,
      assurance_tier: issuerRecord.assurance_tier,
      destination_policy_id: destinationPolicy.destination_policy_id,
      scanner_trust_projection: {
        issuer_legitimacy: "recognized",
        destination_binding: "policy_bound",
        runtime_safety: "provider_required",
        scanner_decision_if_clean: "verified_issuer",
        scanner_decision_if_risky: "verified_issuer_destination_risky",
        approved_destination_count: destinationPolicy.approved_destinations.length,
        resolver_policy:
          destinationPolicy.redirect_policy.resolver_urls.length > 0
            ? "resolver_final_destination_required"
            : "direct_destination_only",
      },
      freshness: {
        state_published_at: statePublishedAt,
        cache_generated_at: input.materialized_at.toISOString(),
        cache_expires_at: cacheExpiresAt,
        max_staleness_seconds: input.max_staleness_seconds ?? 3600,
        stale_behavior: staleBehavior,
      },
    },
    issuer_projection: issuerProjection,
    destination_policy_projection: destinationPolicyProjection,
    source_artifact_hashes: sourceArtifactHashes,
    materialization_warnings: materializationWarnings(input.materialized_at, cacheExpiresAt),
  }
}

interface RootManifestBody {
  readonly artifact_type: "root_manifest"
  readonly root_program_id: string
  readonly delegated_authorities: ReadonlyArray<{
    readonly delegated_authority_id: string
    readonly manifest_ref: string
    readonly status: "active" | "suspended" | "revoked"
  }>
  readonly publication: PublicationBody
}

interface DelegatedAuthorityBody {
  readonly artifact_type: "delegated_authority_manifest" | "delegated_operator_manifest"
  readonly root_program_id: string
  readonly delegated_authority_id: string
  readonly enrolled_issuers: ReadonlyArray<{
    readonly issuer_id: string
    readonly issuer_record_ref: string
    readonly assurance_tier: string
    readonly status: "active" | "suspended" | "revoked"
  }>
  readonly publication: PublicationBody
}

interface IssuerRecordBody {
  readonly artifact_type: "issuer_record"
  readonly issuer_namespace: IssuerNamespace
  readonly issuer_display_name: string
  readonly assurance_tier: string
  readonly certificate_refs: ReadonlyArray<string>
  readonly destination_policies: ReadonlyArray<{
    readonly destination_policy_id: string
    readonly policy_ref: string
    readonly status: "active" | "suspended" | "revoked"
  }>
  readonly status: {
    readonly issuer_status: "active" | "suspended" | "revoked"
    readonly certificate_status: "active" | "suspended" | "revoked" | "expired"
    readonly status_event_ref: string
  }
  readonly publication: PublicationBody
}

interface DestinationPolicyBody {
  readonly artifact_type: "destination_policy"
  readonly root_program_id: string
  readonly delegated_authority_id: string
  readonly issuer_id: string
  readonly destination_policy_id: string
  readonly approved_destinations: ReadonlyArray<DestinationPolicyRule>
  readonly redirect_policy: RedirectPolicyProjection
  readonly runtime_safety_policy: {
    readonly provider: string
    readonly verdict_ttl_seconds: number
    readonly stale_behavior: VerifierCacheStaleBehavior
    readonly unavailable_behavior: VerifierCacheStaleBehavior
  }
  readonly publication: PublicationBody
}

interface StatusEventBody {
  readonly artifact_type: "revocation_status_event"
  readonly root_program_id: string
  readonly delegated_authority_id: string
  readonly target: {
    readonly target_type: string
    readonly issuer_id?: string
    readonly certificate_ref?: string
  }
  readonly status: "active" | "suspended" | "revoked" | "expired"
  readonly effective_at: string
  readonly expires_at?: string
}

interface PublicationBody {
  readonly published_at: string
  readonly valid_until: string
}

const rootManifestBody = (artifact: SignedArtifact): RootManifestBody => {
  const body = recordBody(artifact, "root_manifest")
  return {
    artifact_type: "root_manifest",
    root_program_id: requireString(body.root_program_id, "root manifest root_program_id"),
    delegated_authorities: requireArray(
      body.delegated_authorities,
      "root manifest delegated_authorities",
    ).map((authority) => {
      const candidate = recordValue(authority, "delegated authority")
      return {
        delegated_authority_id: requireString(
          candidate.delegated_authority_id,
          "delegated authority id",
        ),
        manifest_ref: requireString(
          candidate.manifest_ref,
          "delegated authority manifest_ref",
        ),
        status: lifecycleStatus(candidate.status, "delegated authority status"),
      }
    }),
    publication: publicationBody(body.publication, "root manifest publication"),
  }
}

const delegatedAuthorityBody = (
  artifact: SignedArtifact,
): DelegatedAuthorityBody => {
  const body = recordValue(artifact.body, "delegated authority manifest")
  if (
    body.artifact_type !== "delegated_authority_manifest" &&
    body.artifact_type !== "delegated_operator_manifest"
  ) {
    throw new Error(
      `Expected delegated authority manifest, got ${String(body.artifact_type)}.`,
    )
  }

  return {
    artifact_type: body.artifact_type,
    root_program_id: requireString(
      body.root_program_id,
      "delegated authority root_program_id",
    ),
    delegated_authority_id: requireString(
      body.delegated_authority_id,
      "delegated authority delegated_authority_id",
    ),
    enrolled_issuers: requireArray(
      body.enrolled_issuers,
      "delegated authority enrolled_issuers",
    ).map((issuer) => {
      const candidate = recordValue(issuer, "enrolled issuer")
      return {
        issuer_id: requireString(candidate.issuer_id, "enrolled issuer id"),
        issuer_record_ref: requireString(
          candidate.issuer_record_ref,
          "enrolled issuer record ref",
        ),
        assurance_tier: requireString(
          candidate.assurance_tier,
          "enrolled issuer assurance tier",
        ),
        status: lifecycleStatus(candidate.status, "enrolled issuer status"),
      }
    }),
    publication: publicationBody(
      body.publication,
      "delegated authority publication",
    ),
  }
}

const issuerRecordBody = (artifact: SignedArtifact): IssuerRecordBody => {
  const body = recordBody(artifact, "issuer_record")
  const namespace = recordValue(body.issuer_namespace, "issuer namespace")
  const status = recordValue(body.status, "issuer status")

  return {
    artifact_type: "issuer_record",
    issuer_namespace: {
      root_program_id: requireString(
        namespace.root_program_id,
        "issuer namespace root_program_id",
      ),
      delegated_authority_id: requireString(
        namespace.delegated_authority_id,
        "issuer namespace delegated_authority_id",
      ),
      issuer_id: requireString(namespace.issuer_id, "issuer namespace issuer_id"),
    },
    issuer_display_name: requireString(
      body.issuer_display_name,
      "issuer display name",
    ),
    assurance_tier: requireString(body.assurance_tier, "issuer assurance tier"),
    certificate_refs: requireStringArray(
      body.certificate_refs,
      "issuer certificate refs",
    ),
    destination_policies: requireArray(
      body.destination_policies,
      "issuer destination policies",
    ).map((policy) => {
      const candidate = recordValue(policy, "issuer destination policy")
      return {
        destination_policy_id: requireString(
          candidate.destination_policy_id,
          "issuer destination_policy_id",
        ),
        policy_ref: requireString(candidate.policy_ref, "issuer policy ref"),
        status: lifecycleStatus(candidate.status, "issuer policy status"),
      }
    }),
    status: {
      issuer_status: lifecycleStatus(status.issuer_status, "issuer status"),
      certificate_status: certificateStatus(
        status.certificate_status,
        "certificate status",
      ),
      status_event_ref: requireString(
        status.status_event_ref,
        "issuer status_event_ref",
      ),
    },
    publication: publicationBody(body.publication, "issuer publication"),
  }
}

const destinationPolicyBody = (
  artifact: SignedArtifact,
): DestinationPolicyBody => {
  const body = recordBody(artifact, "destination_policy")
  const runtimeSafetyPolicy = recordValue(
    body.runtime_safety_policy,
    "runtime safety policy",
  )

  return {
    artifact_type: "destination_policy",
    root_program_id: requireString(
      body.root_program_id,
      "destination policy root_program_id",
    ),
    delegated_authority_id: requireString(
      body.delegated_authority_id,
      "destination policy delegated_authority_id",
    ),
    issuer_id: requireString(body.issuer_id, "destination policy issuer_id"),
    destination_policy_id: requireString(
      body.destination_policy_id,
      "destination policy id",
    ),
    approved_destinations: requireArray(
      body.approved_destinations,
      "destination policy approved_destinations",
    ).map(destinationRule),
    redirect_policy: redirectPolicy(body.redirect_policy),
    runtime_safety_policy: {
      provider: requireString(runtimeSafetyPolicy.provider, "runtime provider"),
      verdict_ttl_seconds: requireNumber(
        runtimeSafetyPolicy.verdict_ttl_seconds,
        "runtime verdict_ttl_seconds",
      ),
      stale_behavior: staleBehavior(
        runtimeSafetyPolicy.stale_behavior,
        "runtime stale_behavior",
      ),
      unavailable_behavior: staleBehavior(
        runtimeSafetyPolicy.unavailable_behavior,
        "runtime unavailable_behavior",
      ),
    },
    publication: publicationBody(
      body.publication,
      "destination policy publication",
    ),
  }
}

const statusEventBody = (artifact: SignedArtifact): StatusEventBody => {
  const body = recordBody(artifact, "revocation_status_event")
  const target = recordValue(body.target, "status target")

  return {
    artifact_type: "revocation_status_event",
    root_program_id: requireString(body.root_program_id, "status root_program_id"),
    delegated_authority_id: requireString(
      body.delegated_authority_id,
      "status delegated_authority_id",
    ),
    target: {
      target_type: requireString(target.target_type, "status target_type"),
      ...(typeof target.issuer_id === "string"
        ? { issuer_id: target.issuer_id }
        : {}),
      ...(typeof target.certificate_ref === "string"
        ? { certificate_ref: target.certificate_ref }
        : {}),
    },
    status: statusValue(body.status, "status event status"),
    effective_at: requireString(body.effective_at, "status effective_at"),
    ...(typeof body.expires_at === "string" ? { expires_at: body.expires_at } : {}),
  }
}

const recordBody = (
  artifact: SignedArtifact,
  expectedArtifactType: string,
): Record<string, unknown> => {
  const body = recordValue(artifact.body, `${expectedArtifactType} body`)
  if (body.artifact_type !== expectedArtifactType) {
    throw new Error(
      `Artifact ${artifact.artifact_id} expected ${expectedArtifactType}, got ${String(
        body.artifact_type,
      )}.`,
    )
  }

  return body
}

const publicationBody = (
  value: unknown,
  label: string,
): PublicationBody => {
  const candidate = recordValue(value, label)
  return {
    published_at: requireString(candidate.published_at, `${label} published_at`),
    valid_until: requireString(candidate.valid_until, `${label} valid_until`),
  }
}

const destinationRule = (value: unknown): DestinationPolicyRule => {
  const candidate = recordValue(value, "destination policy rule")
  return {
    destination_id: requireString(
      candidate.destination_id,
      "destination destination_id",
    ),
    expected_final_url: requireHttpsUrl(
      candidate.expected_final_url,
      "destination expected_final_url",
    ),
    allowed_hosts: requireStringArray(
      candidate.allowed_hosts,
      "destination allowed_hosts",
    ).map((host) => requireHostname(host, "destination allowed_hosts[]")),
    allow_subdomains: requireBoolean(
      candidate.allow_subdomains,
      "destination allow_subdomains",
    ),
    path_prefixes: requireStringArray(
      candidate.path_prefixes,
      "destination path_prefixes",
    ).map((path) => requirePathPrefix(path, "destination path_prefixes[]")),
    query_policy: requireLiteral(
      candidate.query_policy,
      "destination query_policy",
      ["none", "allow_known_payment_query"],
    ),
    ...(typeof candidate.allowed_query_keys !== "undefined"
      ? {
          allowed_query_keys: requireStringArray(
            candidate.allowed_query_keys,
            "destination allowed_query_keys",
          ),
        }
      : {}),
  }
}

const redirectPolicy = (value: unknown): RedirectPolicyProjection => {
  const candidate = recordValue(value, "redirect policy")
  return {
    resolver_urls: requireStringArray(
      candidate.resolver_urls,
      "redirect resolver_urls",
    ).map((url) => requireHttpsUrl(url, "redirect resolver_urls[]")),
    expected_final_destinations: requireStringArray(
      candidate.expected_final_destinations,
      "redirect expected_final_destinations",
    ).map((url) => requireHttpsUrl(url, "redirect expected_final_destinations[]")),
    allowed_redirect_hosts: requireStringArray(
      candidate.allowed_redirect_hosts,
      "redirect allowed_redirect_hosts",
    ).map((host) => requireHostname(host, "redirect allowed_redirect_hosts[]")),
    max_redirect_hops: requireNonNegativeInteger(
      candidate.max_redirect_hops,
      "redirect max_redirect_hops",
    ),
    nested_shorteners_allowed: requireBoolean(
      candidate.nested_shorteners_allowed,
      "redirect nested_shorteners_allowed",
    ),
    scanner_must_display_resolver_and_final_destination: requireBoolean(
      candidate.scanner_must_display_resolver_and_final_destination,
      "redirect scanner_must_display_resolver_and_final_destination",
    ),
  }
}

const normalizeDestinationRule = (
  destination: DestinationPolicyRule,
): DestinationPolicyRule => ({
  ...destination,
  allowed_hosts: destination.allowed_hosts.map((host) => host.toLowerCase()),
})

const allowedHosts = (
  destinationPolicy: DestinationPolicyBody,
): ReadonlyArray<string> => [
  ...new Set(
    destinationPolicy.approved_destinations.flatMap((destination) =>
      destination.allowed_hosts.map((host) => host.toLowerCase()),
    ),
  ),
]

const cacheEntryId = (
  namespace: IssuerNamespace,
  destinationPolicyId: string,
  sourceArtifactHashes: ReadonlyArray<string>,
): string =>
  `cache:${namespace.issuer_id.replace(/^issuer:/, "")}:${destinationPolicyId.replace(
    /^policy:/,
    "",
  )}:${hashJson({
    namespace,
    destinationPolicyId,
    sourceArtifactHashes,
  }).slice(0, 16)}`

/**
 * Raised when an entry is materialized past the expiry it carries. Consumers
 * key persisted freshness off this code, so it is exported rather than left as
 * a bare string the caller has to spell correctly.
 */
export const CACHE_MATERIALIZED_AFTER_EXPIRY_WARNING =
  "cache_materialized_after_expiry"

const materializationWarnings = (
  materializedAt: Date,
  cacheExpiresAt: string,
): ReadonlyArray<string> =>
  materializedAt.toISOString() > cacheExpiresAt
    ? [CACHE_MATERIALIZED_AFTER_EXPIRY_WARNING]
    : []

const requireRefMatchesArtifact = (
  artifactRef: string,
  artifactId: string,
  label: string,
): void => {
  if (artifactRef !== artifactId) {
    throw new Error(`${label} ${artifactRef} does not match artifact ${artifactId}.`)
  }
}

const latestIso = (dates: ReadonlyArray<string>): string =>
  dates.reduce((latest, date) => (date > latest ? date : latest))

const earliestIso = (dates: ReadonlyArray<string>): string =>
  dates.reduce((earliest, date) => (date < earliest ? date : earliest))

const requireEqual = (actual: unknown, expected: unknown, message: string): void => {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}.`)
  }
}

const requireTruthy = <T>(value: T | undefined | null | false, message: string): T => {
  if (!value) {
    throw new Error(message)
  }

  return value
}

const recordValue = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }

  return value as Record<string, unknown>
}

const requireArray = (value: unknown, label: string): ReadonlyArray<unknown> => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`)
  }

  return value
}

const requireStringArray = (
  value: unknown,
  label: string,
): ReadonlyArray<string> => {
  const entries = requireArray(value, label)
  if (!entries.every((entry) => typeof entry === "string")) {
    throw new Error(`${label} must contain only strings.`)
  }

  return entries
}

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`)
  }

  return value
}

const requireNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`)
  }

  return value
}

const requireHttpsUrl = (value: unknown, label: string): string => {
  const rawValue = requireString(value, label).trim()
  let url: URL
  try {
    url = new URL(rawValue)
  } catch {
    throw new Error(`${label} must be a valid URL.`)
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use https.`)
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not include credentials.`)
  }
  return rawValue
}

const requireHostname = (value: unknown, label: string): string => {
  const hostname = requireString(value, label)
    .trim()
    .replace(/\.$/, "")
    .toLowerCase()
  if (
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname.includes("://") ||
    hostname.includes("/") ||
    hostname.includes(":") ||
    /\s/.test(hostname)
  ) {
    throw new Error(`${label} must be a DNS hostname.`)
  }
  if (
    hostname.split(".").some(
      (part) =>
        part.length === 0 ||
        part.length > 63 ||
        part.startsWith("-") ||
        part.endsWith("-") ||
        !/^[a-z0-9-]+$/.test(part),
    )
  ) {
    throw new Error(`${label} must be a DNS hostname.`)
  }
  return hostname
}

const requirePathPrefix = (value: unknown, label: string): string => {
  const pathPrefix = requireString(value, label).trim()
  if (!pathPrefix.startsWith("/")) {
    throw new Error(`${label} must start with /.`)
  }
  return pathPrefix
}

const requireLiteral = <T extends string>(
  value: unknown,
  label: string,
  allowed: ReadonlyArray<T>,
): T => {
  if (allowed.includes(value as T)) {
    return value as T
  }
  throw new Error(`${label} must be one of: ${allowed.join(", ")}.`)
}

const requireNonNegativeInteger = (value: unknown, label: string): number => {
  const numericValue = requireNumber(value, label)
  if (Number.isInteger(numericValue) && numericValue >= 0) {
    return numericValue
  }
  throw new Error(`${label} must be a non-negative integer.`)
}

const requireBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`)
  }

  return value
}

const lifecycleStatus = (
  value: unknown,
  label: string,
): "active" | "suspended" | "revoked" => {
  if (value === "active" || value === "suspended" || value === "revoked") {
    return value
  }

  throw new Error(`${label} must be active, suspended, or revoked.`)
}

const certificateStatus = (
  value: unknown,
  label: string,
): "active" | "suspended" | "revoked" | "expired" => {
  if (
    value === "active" ||
    value === "suspended" ||
    value === "revoked" ||
    value === "expired"
  ) {
    return value
  }

  throw new Error(`${label} must be active, suspended, revoked, or expired.`)
}

const statusValue = (
  value: unknown,
  label: string,
): "active" | "suspended" | "revoked" | "expired" => {
  if (
    value === "active" ||
    value === "suspended" ||
    value === "revoked" ||
    value === "expired"
  ) {
    return value
  }

  throw new Error(`${label} must be active, suspended, revoked, or expired.`)
}

const staleBehavior = (
  value: unknown,
  label: string,
): VerifierCacheStaleBehavior => {
  if (
    value === "allow" ||
    value === "downgrade_to_caution" ||
    value === "downgrade_or_block" ||
    value === "block"
  ) {
    return value
  }

  throw new Error(`${label} is not a recognized stale behavior.`)
}
