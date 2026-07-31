import { Context, Effect, Layer } from "effect"

import type { NetworkError } from "../errors.js"
import {
  acceptAllRootsPolicy,
  type AcceptedRootPolicyShape,
} from "./accepted-root-policy.js"

export interface IssuerNamespace {
  readonly root_program_id: string
  readonly delegated_authority_id: string
  readonly issuer_id: string
}

export interface DestinationPolicyKey {
  readonly namespace: IssuerNamespace
  readonly destination_policy_id: string
}

export interface RootAuthorityContext {
  readonly root_program_id: string
  readonly active_delegated_authority_ids: ReadonlyArray<string>
}

export interface DelegatedAuthorityIssuerContext {
  readonly root_program_id: string
  readonly delegated_authority_id: string
  readonly active_issuer_ids: ReadonlyArray<string>
}

export interface DelegatedAuthorityKey {
  readonly root_program_id: string
  readonly delegated_authority_id: string
}

export interface IssuerAssuranceTierUpdate {
  readonly namespace: IssuerNamespace
  readonly assurance_tier: string
}

export const verifierCachePolicyKey = (key: DestinationPolicyKey): string =>
  [
    key.namespace.root_program_id,
    key.namespace.delegated_authority_id,
    key.namespace.issuer_id,
    key.destination_policy_id,
  ].join("\u001f")

export interface IssuerProjection {
  readonly namespace: IssuerNamespace
  readonly issuer_display_name: string
  readonly assurance_tier: string
  readonly destination_policy_id: string
  readonly allowed_hosts: ReadonlyArray<string>
  readonly cache_generated_at: string
  readonly cache_expires_at: string
}

export interface DestinationPolicyRule {
  readonly destination_id: string
  readonly expected_final_url: string
  readonly allowed_hosts: ReadonlyArray<string>
  readonly allow_subdomains: boolean
  readonly path_prefixes: ReadonlyArray<string>
  readonly query_policy: string
  readonly allowed_query_keys?: ReadonlyArray<string>
}

export interface RedirectPolicyProjection {
  readonly resolver_urls: ReadonlyArray<string>
  readonly expected_final_destinations: ReadonlyArray<string>
  readonly allowed_redirect_hosts: ReadonlyArray<string>
  readonly max_redirect_hops: number
  readonly nested_shorteners_allowed: boolean
  readonly scanner_must_display_resolver_and_final_destination: boolean
}

export interface DestinationPolicyProjection {
  readonly namespace: IssuerNamespace
  readonly destination_policy_id: string
  readonly approved_destinations: ReadonlyArray<DestinationPolicyRule>
  readonly redirect_policy: RedirectPolicyProjection
  readonly allowed_hosts: ReadonlyArray<string>
  readonly allow_subdomains: boolean
  readonly cache_generated_at: string
  readonly cache_expires_at: string
}

export interface DestinationResolution {
  readonly issuer: IssuerProjection
  readonly policy: DestinationPolicyProjection
  readonly destination: DestinationPolicyRule
  readonly binding_status: "bound" | "mismatch"
  readonly reason_codes: ReadonlyArray<string>
  readonly resolver_url?: string
  readonly final_url?: string
  readonly observed_redirect_hops?: number
}

export interface VerifierCacheShape {
  readonly resolveByHost: (
    host: string,
  ) => Effect.Effect<IssuerProjection | undefined>
  readonly resolveByDestination: (
    destinationUrl: URL,
    issuerHintHost?: string,
  ) => Effect.Effect<DestinationResolution | undefined>
}

export interface VerifierCacheWriterShape extends VerifierCacheShape {
  readonly upsertIssuer: (
    projection: IssuerProjection,
  ) => Effect.Effect<IssuerProjection, NetworkError>
  readonly upsertDestinationPolicy: (
    projection: DestinationPolicyProjection,
  ) => Effect.Effect<DestinationPolicyProjection, NetworkError>
  readonly upsertRootAuthorityContext: (
    context: RootAuthorityContext,
  ) => Effect.Effect<void, NetworkError>
  readonly upsertDelegatedAuthorityIssuerContext: (
    context: DelegatedAuthorityIssuerContext,
  ) => Effect.Effect<void, NetworkError>
  readonly updateIssuerAssuranceTier: (
    update: IssuerAssuranceTierUpdate,
  ) => Effect.Effect<boolean, NetworkError>
  readonly removeIssuer: (
    namespace: IssuerNamespace,
  ) => Effect.Effect<boolean, NetworkError>
  readonly removeDestinationPolicy: (
    key: DestinationPolicyKey,
  ) => Effect.Effect<boolean, NetworkError>
  readonly removeDestinationPoliciesForIssuer: (
    namespace: IssuerNamespace,
  ) => Effect.Effect<boolean, NetworkError>
  readonly removeDelegatedAuthority: (
    key: DelegatedAuthorityKey,
  ) => Effect.Effect<boolean, NetworkError>
}

export class VerifierCache extends Context.Tag("qrtrust/VerifierCache")<
  VerifierCache,
  VerifierCacheShape
>() {}

export const demoIssuerProjection: IssuerProjection = {
  namespace: {
    root_program_id: "root:qrtrust-demo:2026",
    delegated_authority_id: "authority:qrtrust-demo:merchant-web",
    issuer_id: "issuer:acme-demo",
  },
  issuer_display_name: "ACME Demo",
  assurance_tier: "verified_business",
  destination_policy_id: "policy:acme-demo:web-payments:v1",
  allowed_hosts: ["acme.example", "checkout.acme.example"],
  cache_generated_at: "2026-05-17T00:00:00Z",
  cache_expires_at: "2026-12-31T23:59:59Z",
}

export const demoDestinationPolicyProjection: DestinationPolicyProjection = {
  namespace: demoIssuerProjection.namespace,
  destination_policy_id: demoIssuerProjection.destination_policy_id,
  approved_destinations: [
    {
      destination_id: "dest:acme-demo:pay",
      expected_final_url: "https://acme.example/pay",
      allowed_hosts: ["acme.example", "checkout.acme.example"],
      allow_subdomains: false,
      path_prefixes: ["/pay"],
      query_policy: "allow_known_payment_query",
    },
  ],
  redirect_policy: {
    resolver_urls: ["https://qr.acme.example/r/pay"],
    expected_final_destinations: ["https://acme.example/pay"],
    allowed_redirect_hosts: ["acme.example"],
    max_redirect_hops: 1,
    nested_shorteners_allowed: false,
    scanner_must_display_resolver_and_final_destination: true,
  },
  allowed_hosts: ["acme.example", "checkout.acme.example"],
  allow_subdomains: false,
  cache_generated_at: demoIssuerProjection.cache_generated_at,
  cache_expires_at: demoIssuerProjection.cache_expires_at,
}

export const makeInMemoryVerifierCache = (
  initial: ReadonlyArray<IssuerProjection> = [],
  initialDestinationPolicies: ReadonlyArray<DestinationPolicyProjection> = [],
  acceptedRoots: AcceptedRootPolicyShape = acceptAllRootsPolicy,
): VerifierCacheWriterShape => {
  const issuersByPolicyKey = new Map<string, IssuerProjection>()
  const policiesByKey = new Map<string, DestinationPolicyProjection>()
  const activeDelegatedAuthoritiesByRoot = new Map<string, Set<string>>()
  const activeIssuersByAuthority = new Set<string>()

  const seedAuthorityContext = (namespace: IssuerNamespace) => {
    mergeRootAuthorityContextSync({
      root_program_id: namespace.root_program_id,
      active_delegated_authority_ids: [namespace.delegated_authority_id],
    })
    mergeDelegatedAuthorityIssuerContextSync({
      root_program_id: namespace.root_program_id,
      delegated_authority_id: namespace.delegated_authority_id,
      active_issuer_ids: [namespace.issuer_id],
    })
  }

  const putProjection = (projection: IssuerProjection) => {
    issuersByPolicyKey.set(
      verifierCachePolicyKey({
        namespace: projection.namespace,
        destination_policy_id: projection.destination_policy_id,
      }),
      projection,
    )
  }

  for (const projection of initial) {
    putProjection(projection)
    seedAuthorityContext(projection.namespace)
  }

  for (const projection of initialDestinationPolicies) {
    policiesByKey.set(verifierCachePolicyKey(projection), projection)
    seedAuthorityContext(projection.namespace)
  }

  return {
    resolveByHost: (host) =>
      Effect.sync(() => {
        const normalizedHost = host.toLowerCase()
        const match = findPolicyMatchWithAuthorityContext(
          policiesByKey.values(),
          normalizedHost,
          policyAllowsHost,
        )
        return match
          ? materializeIssuer(match.issuer, match.policy, normalizedHost)
          : undefined
      }),
    resolveByDestination: (destinationUrl, issuerHintHost) =>
      Effect.sync(() => {
        const lookupHost = (issuerHintHost ?? destinationUrl.hostname).toLowerCase()
        const match = findPolicyMatchWithAuthorityContext(
          policiesByKey.values(),
          lookupHost,
          policyAllowsLookupHost,
        )
        if (!match) {
          return undefined
        }

        return resolveDestination(match.issuer, match.policy, destinationUrl, lookupHost)
      }),
    upsertIssuer: (projection) =>
      Effect.sync(() => {
        putProjection(projection)
        return projection
      }),
    upsertDestinationPolicy: (projection) =>
      Effect.sync(() => {
        policiesByKey.set(verifierCachePolicyKey(projection), projection)
        return projection
      }),
    upsertRootAuthorityContext: (context) =>
      Effect.sync(() => {
        replaceRootAuthorityContextSync(context)
      }),
    upsertDelegatedAuthorityIssuerContext: (context) =>
      Effect.sync(() => {
        replaceDelegatedAuthorityIssuerContextSync(context)
      }),
    updateIssuerAssuranceTier: (update) =>
      Effect.sync(() => {
        let updated = false
        for (const [policyKey, issuer] of issuersByPolicyKey.entries()) {
          if (namespaceEquals(issuer.namespace, update.namespace)) {
            issuersByPolicyKey.set(policyKey, {
              ...issuer,
              assurance_tier: update.assurance_tier,
            })
            updated = true
          }
        }

        return updated
      }),
    removeIssuer: (namespace) =>
      Effect.sync(() => {
        let removed = false
        for (const [policyKey, issuer] of issuersByPolicyKey.entries()) {
          if (namespaceEquals(issuer.namespace, namespace)) {
            issuersByPolicyKey.delete(policyKey)
            removed = true
          }
        }

        return removed
      }),
    removeDestinationPolicy: (key) =>
      Effect.sync(() => policiesByKey.delete(verifierCachePolicyKey(key))),
    removeDestinationPoliciesForIssuer: (namespace) =>
      Effect.sync(() => {
        let removed = false
        for (const [policyKey, policy] of policiesByKey.entries()) {
          if (namespaceEquals(policy.namespace, namespace)) {
            policiesByKey.delete(policyKey)
            removed = true
          }
        }

        return removed
      }),
    removeDelegatedAuthority: (key) =>
      Effect.sync(() => {
        let removed = false
        for (const [policyKey, issuer] of issuersByPolicyKey.entries()) {
          if (delegatedAuthorityEquals(issuer.namespace, key)) {
            issuersByPolicyKey.delete(policyKey)
            removed = true
          }
        }
        for (const [policyKey, policy] of policiesByKey.entries()) {
          if (delegatedAuthorityEquals(policy.namespace, key)) {
            policiesByKey.delete(policyKey)
            removed = true
          }
        }

        const authorities = activeDelegatedAuthoritiesByRoot.get(
          key.root_program_id,
        )
        if (authorities?.delete(key.delegated_authority_id)) {
          removed = true
        }
        const prefix = [
          key.root_program_id,
          key.delegated_authority_id,
          "",
        ].join("\u001f")
        for (const authorityIssuer of activeIssuersByAuthority) {
          if (authorityIssuer.startsWith(prefix)) {
            activeIssuersByAuthority.delete(authorityIssuer)
            removed = true
          }
        }

        return removed
      }),
  }

  function mergeRootAuthorityContextSync(context: RootAuthorityContext): void {
    const existing =
      activeDelegatedAuthoritiesByRoot.get(context.root_program_id) ??
      new Set<string>()

    for (const delegatedAuthorityId of context.active_delegated_authority_ids) {
      existing.add(delegatedAuthorityId)
    }

    activeDelegatedAuthoritiesByRoot.set(context.root_program_id, existing)
  }

  function replaceRootAuthorityContextSync(context: RootAuthorityContext): void {
    activeDelegatedAuthoritiesByRoot.set(
      context.root_program_id,
      new Set(context.active_delegated_authority_ids),
    )
  }

  function mergeDelegatedAuthorityIssuerContextSync(
    context: DelegatedAuthorityIssuerContext,
  ): void {
    for (const issuerId of context.active_issuer_ids) {
      activeIssuersByAuthority.add(
        authorityIssuerKey({
          root_program_id: context.root_program_id,
          delegated_authority_id: context.delegated_authority_id,
          issuer_id: issuerId,
        }),
      )
    }
  }

  function replaceDelegatedAuthorityIssuerContextSync(
    context: DelegatedAuthorityIssuerContext,
  ): void {
    const prefix = [
      context.root_program_id,
      context.delegated_authority_id,
      "",
    ].join("\u001f")

    for (const key of activeIssuersByAuthority) {
      if (key.startsWith(prefix)) {
        activeIssuersByAuthority.delete(key)
      }
    }

    mergeDelegatedAuthorityIssuerContextSync(context)
  }

  function hasAuthorityContext(namespace: IssuerNamespace): boolean {
    return (
      activeDelegatedAuthoritiesByRoot
        .get(namespace.root_program_id)
        ?.has(namespace.delegated_authority_id) === true &&
      activeIssuersByAuthority.has(authorityIssuerKey(namespace))
    )
  }

  function findPolicyMatchWithAuthorityContext(
    policies: Iterable<DestinationPolicyProjection>,
    host: string,
    allowsHost: (
      policy: DestinationPolicyProjection,
      host: string,
    ) => boolean,
  ): { issuer: IssuerProjection; policy: DestinationPolicyProjection } | undefined {
    return findPolicyMatch(
      policies,
      host,
      issuersByPolicyKey,
      acceptedRoots,
      hasAuthorityContext,
      allowsHost,
    )
  }
}

export const makeDemoVerifierCache = (): VerifierCacheShape =>
  makeInMemoryVerifierCache(
    [demoIssuerProjection],
    [demoDestinationPolicyProjection],
  )

export const DemoVerifierCacheLive = Layer.succeed(
  VerifierCache,
  makeDemoVerifierCache(),
)

const policyAllowsHost = (
  policy: DestinationPolicyProjection,
  host: string,
): boolean =>
  policy.approved_destinations.some((destination) =>
    ruleAllowsHost(destination, host),
  )

const policyAllowsLookupHost = (
  policy: DestinationPolicyProjection,
  host: string,
): boolean =>
  policyAllowsHost(policy, host) ||
  policy.redirect_policy.resolver_urls.some((resolverUrl) => {
    const parsed = parseUrl(resolverUrl)
    return parsed?.hostname.toLowerCase() === host
  })

const ruleAllowsHost = (
  destination: DestinationPolicyRule,
  host: string,
): boolean =>
  destination.allowed_hosts.some((allowedHost) => {
    const normalizedAllowedHost = allowedHost.toLowerCase()
    return (
      host === normalizedAllowedHost ||
      (destination.allow_subdomains &&
        host.endsWith(`.${normalizedAllowedHost}`))
    )
  })

const findPolicyMatch = (
  policies: Iterable<DestinationPolicyProjection>,
  host: string,
  issuersByPolicyKey: ReadonlyMap<string, IssuerProjection>,
  acceptedRoots: AcceptedRootPolicyShape,
  hasAuthorityContext: (namespace: IssuerNamespace) => boolean,
  allowsHost: (policy: DestinationPolicyProjection, host: string) => boolean,
): { issuer: IssuerProjection; policy: DestinationPolicyProjection } | undefined => {
  for (const policy of policies) {
    if (!acceptedRoots.accepts(policy.namespace.root_program_id)) {
      continue
    }

    if (!hasAuthorityContext(policy.namespace)) {
      continue
    }

    if (!allowsHost(policy, host)) {
      continue
    }

    const issuer = issuersByPolicyKey.get(verifierCachePolicyKey(policy))
    if (!issuer) {
      return undefined
    }

    return { issuer, policy }
  }

  return undefined
}

function authorityIssuerKey(namespace: IssuerNamespace): string {
  return [
    namespace.root_program_id,
    namespace.delegated_authority_id,
    namespace.issuer_id,
  ].join("\u001f")
}

const resolveDestination = (
  issuer: IssuerProjection,
  policy: DestinationPolicyProjection,
  destinationUrl: URL,
  lookupHost: string,
): DestinationResolution => {
  const resolverUrl = matchedResolverUrl(policy.redirect_policy, destinationUrl)
  if (resolverUrl) {
    return resolveRedirectDestination(issuer, policy, destinationUrl, resolverUrl)
  }

  const matchedDestination = policy.approved_destinations.find((destination) =>
    ruleAllowsHost(destination, destinationUrl.hostname.toLowerCase()),
  )
  if (!matchedDestination) {
    return mismatchResolution(
      issuer,
      policy,
      fallbackDestination(policy, lookupHost),
      ["destination_host_not_approved"],
    )
  }

  const reasonCodes = directDestinationMismatchReasons(
    matchedDestination,
    destinationUrl,
  )

  return reasonCodes.length === 0
    ? boundResolution(issuer, policy, matchedDestination, {
        final_url: destinationUrl.toString(),
      })
    : mismatchResolution(issuer, policy, matchedDestination, reasonCodes)
}

const resolveRedirectDestination = (
  issuer: IssuerProjection,
  policy: DestinationPolicyProjection,
  destinationUrl: URL,
  resolverUrl: string,
): DestinationResolution => {
  const fallback = fallbackDestination(policy, destinationUrl.hostname)
  const reasonCodes: string[] = []
  const observedHops = parseRedirectHopCount(destinationUrl.searchParams.get("hops"))
  if (observedHops === undefined) {
    reasonCodes.push("redirect_hop_count_invalid")
  } else if (observedHops > policy.redirect_policy.max_redirect_hops) {
    reasonCodes.push("redirect_hop_limit_exceeded")
  }

  const finalParam = destinationUrl.searchParams.get("final")
  const finalUrl = finalParam ? parseUrl(finalParam) : undefined
  if (!finalUrl) {
    reasonCodes.push("redirect_final_destination_missing")
  } else if (!redirectFinalDestinationAllowed(policy, finalUrl)) {
    reasonCodes.push("redirect_final_destination_mismatch")
  }

  if (
    !policy.redirect_policy.nested_shorteners_allowed &&
    destinationUrl.searchParams.get("nested") === "1"
  ) {
    reasonCodes.push("nested_shortener_not_allowed")
  }

  const extras = {
    resolver_url: resolverUrl,
    ...(finalUrl ? { final_url: finalUrl.toString() } : {}),
    ...(observedHops !== undefined ? { observed_redirect_hops: observedHops } : {}),
  }

  return reasonCodes.length === 0
    ? boundResolution(issuer, policy, fallback, extras)
    : mismatchResolution(issuer, policy, fallback, reasonCodes, extras)
}

const directDestinationMismatchReasons = (
  destination: DestinationPolicyRule,
  destinationUrl: URL,
): ReadonlyArray<string> => {
  const reasons: string[] = []
  if (
    destination.path_prefixes.length > 0 &&
    !destination.path_prefixes.some((prefix) => destinationUrl.pathname.startsWith(prefix))
  ) {
    reasons.push("destination_path_not_approved")
  }

  if (
    destination.query_policy === "none" &&
    Array.from(destinationUrl.searchParams.keys()).length > 0
  ) {
    reasons.push("destination_query_not_approved")
  }

  const allowedQueryKeys = destination.allowed_query_keys ?? []
  if (
    allowedQueryKeys.length > 0 &&
    Array.from(destinationUrl.searchParams.keys()).some(
      (key) => !allowedQueryKeys.includes(key),
    )
  ) {
    reasons.push("destination_query_not_approved")
  }

  return reasons
}

const boundResolution = (
  issuer: IssuerProjection,
  policy: DestinationPolicyProjection,
  destination: DestinationPolicyRule,
  extras: DestinationResolutionExtras = {},
): DestinationResolution => ({
  issuer: materializeIssuer(issuer, policy, destination.allowed_hosts[0] ?? ""),
  policy,
  destination,
  binding_status: "bound",
  reason_codes: ["destination_bound"],
  ...extras,
})

const mismatchResolution = (
  issuer: IssuerProjection,
  policy: DestinationPolicyProjection,
  destination: DestinationPolicyRule,
  reasonCodes: ReadonlyArray<string>,
  extras: DestinationResolutionExtras = {},
): DestinationResolution => ({
  issuer: materializeIssuer(issuer, policy, destination.allowed_hosts[0] ?? ""),
  policy,
  destination,
  binding_status: "mismatch",
  reason_codes: reasonCodes,
  ...extras,
})

type DestinationResolutionExtras = Pick<
  DestinationResolution,
  "resolver_url" | "final_url" | "observed_redirect_hops"
>

const fallbackDestination = (
  policy: DestinationPolicyProjection,
  host: string,
): DestinationPolicyRule =>
  policy.approved_destinations[0] ?? {
    destination_id: "dest:unknown",
    expected_final_url: `https://${host}/`,
    allowed_hosts: [host],
    allow_subdomains: false,
    path_prefixes: [],
    query_policy: "none",
  }

const matchedResolverUrl = (
  redirectPolicy: RedirectPolicyProjection,
  destinationUrl: URL,
): string | undefined =>
  redirectPolicy.resolver_urls.find((resolverUrl) => {
    const parsed = parseUrl(resolverUrl)
    if (!parsed) {
      return false
    }

    return (
      parsed.hostname.toLowerCase() === destinationUrl.hostname.toLowerCase() &&
      parsed.pathname === destinationUrl.pathname
    )
  })

const redirectFinalDestinationAllowed = (
  policy: DestinationPolicyProjection,
  finalUrl: URL,
): boolean =>
  policy.redirect_policy.expected_final_destinations.some(
    (expected) => parseUrl(expected)?.toString() === finalUrl.toString(),
  )

const parseRedirectHopCount = (value: string | null): number | undefined => {
  if (value === null) {
    return 0
  }

  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) {
    return undefined
  }

  const hops = Number(normalized)
  return Number.isSafeInteger(hops) ? hops : undefined
}

const parseUrl = (value: string): URL | undefined => {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

const namespaceEquals = (
  left: IssuerNamespace,
  right: IssuerNamespace,
): boolean =>
  left.root_program_id === right.root_program_id &&
  left.delegated_authority_id === right.delegated_authority_id &&
  left.issuer_id === right.issuer_id

const delegatedAuthorityEquals = (
  namespace: IssuerNamespace,
  key: DelegatedAuthorityKey,
): boolean =>
  namespace.root_program_id === key.root_program_id &&
  namespace.delegated_authority_id === key.delegated_authority_id

const materializedAllowedHosts = (
  policy: DestinationPolicyProjection,
  host: string,
): ReadonlyArray<string> =>
  policy.allowed_hosts.some((allowedHost) => allowedHost.toLowerCase() === host)
    ? policy.allowed_hosts
    : [...policy.allowed_hosts, host]

const materializeIssuer = (
  issuer: IssuerProjection,
  policy: DestinationPolicyProjection,
  host: string,
): IssuerProjection => ({
  ...issuer,
  allowed_hosts: materializedAllowedHosts(policy, host),
  cache_generated_at: maxIsoDate([
    issuer.cache_generated_at,
    policy.cache_generated_at,
  ]),
  cache_expires_at: minIsoDate([
    issuer.cache_expires_at,
    policy.cache_expires_at,
  ]),
})

const minIsoDate = (dates: ReadonlyArray<string>): string =>
  dates.reduce((min, date) => (date < min ? date : min))

const maxIsoDate = (dates: ReadonlyArray<string>): string =>
  dates.reduce((max, date) => (date > max ? date : max))
