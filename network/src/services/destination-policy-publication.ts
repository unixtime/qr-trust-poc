import { Effect } from "effect"

import {
  contractValidationError,
  policyPublicationError,
  type NetworkError,
} from "../errors.js"
import type {
  ArtifactPublicationInput,
  ArtifactPublicationResult,
  ArtifactPublicationServiceShape,
} from "./artifact-publication.js"
import {
  evaluateDestinationPolicyPublicationGate,
  type DestinationPolicyPublicationGateDecision,
} from "./destination-policy-publication-gate.js"
import type {
  DomainProofRecord,
  IssuerEnrollmentProjection,
} from "./domain-proof.js"
import type { DestinationPolicyProjection } from "./verifier-cache.js"

export interface DestinationPolicyPublicationInput {
  readonly issuer: IssuerEnrollmentProjection
  readonly destination_policy: DestinationPolicyProjection
  readonly domain_proofs: ReadonlyArray<DomainProofRecord>
  readonly artifact_id: string
  readonly version: number
  readonly occurredAt: Date
  readonly reason?: string
}

export interface DestinationPolicyPublicationResult {
  readonly gate: DestinationPolicyPublicationGateDecision
  readonly publication: ArtifactPublicationResult
}

export interface DestinationPolicyPublicationServiceShape {
  readonly publishDestinationPolicy: (
    input: DestinationPolicyPublicationInput,
  ) => Effect.Effect<DestinationPolicyPublicationResult, NetworkError>
}

export interface DestinationPolicyPublicationContext {
  readonly issuer: IssuerEnrollmentProjection
  readonly domain_proofs: ReadonlyArray<DomainProofRecord>
}

export interface DestinationPolicyPublicationContextResolverShape {
  readonly resolveDestinationPolicyContext: (
    input: ArtifactPublicationInput,
    destinationPolicy: DestinationPolicyProjection,
  ) => Effect.Effect<DestinationPolicyPublicationContext, NetworkError>
}

export const makeDestinationPolicyPublicationService = (
  publisher: ArtifactPublicationServiceShape,
): DestinationPolicyPublicationServiceShape => ({
  publishDestinationPolicy: (input) =>
    Effect.gen(function* () {
      yield* validateDestinationPolicyProjection(input.destination_policy)
      const gate = evaluateDestinationPolicyPublicationGate({
        issuer: input.issuer,
        destination_policy: input.destination_policy,
        domain_proofs: input.domain_proofs,
        observed_at: input.occurredAt,
      })

      if (!gate.publishable) {
        return yield* Effect.fail(
          policyPublicationError(
            "Destination policy publication blocked by domain-control gate.",
            gate,
          ),
        )
      }

      const publication = yield* publisher.publishArtifact({
        artifact_type: "destination_policy",
        artifact_id: input.artifact_id,
        version: input.version,
        root_program_id: input.destination_policy.namespace.root_program_id,
        delegated_authority_id:
          input.destination_policy.namespace.delegated_authority_id,
        issuer_id: input.destination_policy.namespace.issuer_id,
        destination_policy_id: input.destination_policy.destination_policy_id,
        body: destinationPolicyArtifactBody(input.destination_policy),
        occurredAt: input.occurredAt,
        eventType: "destination.policy.published",
        reason:
          input.reason ??
          "destination policy publication after domain-control gate",
      })

      return {
        gate,
        publication,
      }
    }),
})

export const makeDestinationPolicyAwareArtifactPublicationService = (
  publisher: ArtifactPublicationServiceShape,
  contextResolver: DestinationPolicyPublicationContextResolverShape,
): ArtifactPublicationServiceShape => {
  const destinationPolicyPublisher =
    makeDestinationPolicyPublicationService(publisher)

  return {
    publishArtifact: (input) =>
      input.artifact_type !== "destination_policy"
        ? publisher.publishArtifact(input)
        : Effect.gen(function* () {
            const destinationPolicy =
              yield* destinationPolicyProjectionFromArtifactPublicationInput(
                input,
              )
            const context =
              yield* contextResolver.resolveDestinationPolicyContext(
                input,
                destinationPolicy,
              )
            const result =
              yield* destinationPolicyPublisher.publishDestinationPolicy({
                issuer: context.issuer,
                destination_policy: destinationPolicy,
                domain_proofs: context.domain_proofs,
                artifact_id: input.artifact_id,
                version: input.version,
                occurredAt: input.occurredAt,
                ...(input.reason ? { reason: input.reason } : {}),
              })

            return result.publication
          }),
  }
}

export const destinationPolicyArtifactBody = (
  policy: DestinationPolicyProjection,
) => ({
  artifact_type: "destination_policy",
  schema_version: "0.1.0",
  root_program_id: policy.namespace.root_program_id,
  delegated_authority_id: policy.namespace.delegated_authority_id,
  issuer_id: policy.namespace.issuer_id,
  destination_policy_id: policy.destination_policy_id,
  approved_destinations: policy.approved_destinations.map((destination) => ({
    destination_id: destination.destination_id,
    expected_final_url: destination.expected_final_url,
    allowed_hosts: destination.allowed_hosts,
    allow_subdomains: destination.allow_subdomains,
    path_prefixes: destination.path_prefixes,
    query_policy: destination.query_policy,
    ...(destination.allowed_query_keys
      ? { allowed_query_keys: destination.allowed_query_keys }
      : {}),
  })),
  redirect_policy: policy.redirect_policy,
  runtime_safety_policy: {
    provider: "deterministic-fixture",
    verdict_ttl_seconds: 300,
    stale_behavior: "downgrade_to_caution",
    unavailable_behavior: "downgrade_to_caution",
  },
  publication: {
    published_at: policy.cache_generated_at,
    valid_until: policy.cache_expires_at,
    signed_by: policy.namespace.delegated_authority_id,
    signature_status: "ed25519-signed",
  },
})

export const destinationPolicyProjectionFromArtifactPublicationInput = (
  input: ArtifactPublicationInput,
): Effect.Effect<DestinationPolicyProjection, NetworkError> =>
  Effect.try({
    try: () => {
      const body = objectValue(input.body, "destination policy body")
      const approvedDestinations = arrayValue(
        body.approved_destinations,
        "approved_destinations",
      ).map(destinationPolicyRuleFromUnknown)
      const redirectPolicy = redirectPolicyFromUnknown(body.redirect_policy)
      const namespace = {
        root_program_id: stringValue(
          body.root_program_id ?? input.root_program_id,
          "root_program_id",
        ),
        delegated_authority_id: stringValue(
          body.delegated_authority_id ?? input.delegated_authority_id,
          "delegated_authority_id",
        ),
        issuer_id: stringValue(body.issuer_id ?? input.issuer_id, "issuer_id"),
      }
      const publication = optionalObjectValue(body.publication)

      return {
        namespace,
        destination_policy_id: stringValue(
          body.destination_policy_id ?? input.destination_policy_id,
          "destination_policy_id",
        ),
        approved_destinations: approvedDestinations,
        redirect_policy: redirectPolicy,
        allowed_hosts: uniqueStrings(
          approvedDestinations.flatMap((destination) =>
            destination.allowed_hosts.map(normalizeHost),
          ),
        ),
        allow_subdomains: approvedDestinations.some(
          (destination) => destination.allow_subdomains,
        ),
        cache_generated_at: stringValue(
          publication?.published_at ?? input.occurredAt.toISOString(),
          "publication.published_at",
        ),
        cache_expires_at: stringValue(
          publication?.valid_until ?? input.occurredAt.toISOString(),
          "publication.valid_until",
        ),
      }
    },
    catch: (cause) =>
      contractValidationError(
        "Destination policy publication work item failed projection decoding.",
        cause,
      ),
  })

const destinationPolicyRuleFromUnknown = (value: unknown) => {
  const rule = objectValue(value, "approved_destinations[]")
  return {
    destination_id: stringValue(rule.destination_id, "destination_id"),
    expected_final_url: httpsUrlValue(
      rule.expected_final_url,
      "expected_final_url",
    ),
    allowed_hosts: arrayValue(rule.allowed_hosts, "allowed_hosts").map((host) =>
      hostnameValue(host, "allowed_hosts[]"),
    ),
    allow_subdomains: booleanValue(rule.allow_subdomains, "allow_subdomains"),
    path_prefixes: arrayValue(rule.path_prefixes, "path_prefixes").map((path) =>
      pathPrefixValue(path, "path_prefixes[]"),
    ),
    query_policy: literalStringValue(rule.query_policy, "query_policy", [
      "none",
      "allow_known_payment_query",
    ]),
    ...optionalStringArrayProperty(rule, "allowed_query_keys"),
  }
}

const redirectPolicyFromUnknown = (value: unknown) => {
  const policy = objectValue(value, "redirect_policy")
  return {
    resolver_urls: arrayValue(policy.resolver_urls, "resolver_urls").map((url) =>
      httpsUrlValue(url, "resolver_urls[]"),
    ),
    expected_final_destinations: arrayValue(
      policy.expected_final_destinations,
      "expected_final_destinations",
    ).map((url) => httpsUrlValue(url, "expected_final_destinations[]")),
    allowed_redirect_hosts: arrayValue(
      policy.allowed_redirect_hosts,
      "allowed_redirect_hosts",
    ).map((host) => hostnameValue(host, "allowed_redirect_hosts[]")),
    max_redirect_hops: nonNegativeIntegerValue(
      policy.max_redirect_hops,
      "max_redirect_hops",
    ),
    nested_shorteners_allowed: booleanValue(
      policy.nested_shorteners_allowed,
      "nested_shorteners_allowed",
    ),
    scanner_must_display_resolver_and_final_destination: booleanValue(
      policy.scanner_must_display_resolver_and_final_destination,
      "scanner_must_display_resolver_and_final_destination",
    ),
  }
}

const validateDestinationPolicyProjection = (
  policy: DestinationPolicyProjection,
): Effect.Effect<void, NetworkError> =>
  Effect.try({
    try: () => {
      policy.approved_destinations.forEach((destination) => {
        stringValue(destination.destination_id, "destination_id")
        httpsUrlValue(destination.expected_final_url, "expected_final_url")
        destination.allowed_hosts.forEach((host) =>
          hostnameValue(host, "allowed_hosts[]"),
        )
        destination.path_prefixes.forEach((path) =>
          pathPrefixValue(path, "path_prefixes[]"),
        )
        literalStringValue(destination.query_policy, "query_policy", [
          "none",
          "allow_known_payment_query",
        ])
        destination.allowed_query_keys?.forEach((key) =>
          stringValue(key, "allowed_query_keys[]"),
        )
      })
      policy.redirect_policy.resolver_urls.forEach((url) =>
        httpsUrlValue(url, "resolver_urls[]"),
      )
      policy.redirect_policy.expected_final_destinations.forEach((url) =>
        httpsUrlValue(url, "expected_final_destinations[]"),
      )
      policy.redirect_policy.allowed_redirect_hosts.forEach((host) =>
        hostnameValue(host, "allowed_redirect_hosts[]"),
      )
      nonNegativeIntegerValue(
        policy.redirect_policy.max_redirect_hops,
        "max_redirect_hops",
      )
    },
    catch: (cause) =>
      contractValidationError(
        "Destination policy publication rejected malformed policy projection.",
        cause,
      ),
  })

const objectValue = (
  value: unknown,
  field: string,
): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  throw new Error(`${field} must be an object.`)
}

const optionalObjectValue = (
  value: unknown,
): Record<string, unknown> | undefined =>
  value === undefined || value === null ? undefined : objectValue(value, "object")

const stringValue = (value: unknown, field: string): string => {
  if (typeof value === "string" && value.length > 0) {
    return value
  }
  throw new Error(`${field} must be a non-empty string.`)
}

const httpsUrlValue = (value: unknown, field: string): string => {
  const rawValue = stringValue(value, field).trim()
  let url: URL
  try {
    url = new URL(rawValue)
  } catch {
    throw new Error(`${field} must be a valid URL.`)
  }
  if (url.protocol !== "https:") {
    throw new Error(`${field} must use https.`)
  }
  if (url.username || url.password) {
    throw new Error(`${field} must not include credentials.`)
  }
  return rawValue
}

const hostnameValue = (value: unknown, field: string): string => {
  const hostname = normalizeHost(stringValue(value, field))
  if (
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname.includes("://") ||
    hostname.includes("/") ||
    hostname.includes(":") ||
    /\s/.test(hostname)
  ) {
    throw new Error(`${field} must be a DNS hostname.`)
  }
  const labels = hostname.split(".")
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[a-z0-9-]+$/.test(label),
    )
  ) {
    throw new Error(`${field} must be a DNS hostname.`)
  }
  return hostname
}

const pathPrefixValue = (value: unknown, field: string): string => {
  const pathPrefix = stringValue(value, field).trim()
  if (!pathPrefix.startsWith("/")) {
    throw new Error(`${field} must start with /.`)
  }
  return pathPrefix
}

const literalStringValue = <T extends string>(
  value: unknown,
  field: string,
  allowed: ReadonlyArray<T>,
): T => {
  if (allowed.includes(value as T)) {
    return value as T
  }
  throw new Error(`${field} must be one of: ${allowed.join(", ")}.`)
}

const nonNegativeIntegerValue = (value: unknown, field: string): number => {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
  ) {
    return value
  }
  throw new Error(`${field} must be a non-negative integer.`)
}

const booleanValue = (value: unknown, field: string): boolean => {
  if (typeof value === "boolean") {
    return value
  }
  throw new Error(`${field} must be a boolean.`)
}

const arrayValue = (
  value: unknown,
  field: string,
): ReadonlyArray<unknown> => {
  if (Array.isArray(value)) {
    return value
  }
  throw new Error(`${field} must be an array.`)
}

const optionalStringArrayProperty = (
  value: Record<string, unknown>,
  property: string,
): { readonly allowed_query_keys?: ReadonlyArray<string> } => {
  const candidate = value[property]
  if (candidate === undefined || candidate === null) {
    return {}
  }
  return {
    allowed_query_keys: arrayValue(candidate, property).map((item) =>
      stringValue(item, `${property}[]`),
    ),
  }
}

const normalizeHost = (value: string): string =>
  value.trim().replace(/\.$/, "").toLowerCase()

const uniqueStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values.filter((value) => value.length > 0))]
