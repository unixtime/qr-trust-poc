import { Effect } from "effect"

import { persistenceError, type NetworkError } from "../errors.js"
import { makeAcceptedRootPolicy } from "./accepted-root-policy.js"
import type { PostgresQueryClientShape } from "./postgres-driver.js"
import type {
  PostgresStatementSinkShape,
  SqlCommand,
} from "./postgres-persistence.js"
import {
  makeInMemoryVerifierCache,
  type DelegatedAuthorityKey,
  type DelegatedAuthorityIssuerContext,
  type DestinationPolicyProjection,
  type DestinationPolicyKey,
  type DestinationPolicyRule,
  type IssuerAssuranceTierUpdate,
  type IssuerNamespace,
  type IssuerProjection,
  type RedirectPolicyProjection,
  type RootAuthorityContext,
  type VerifierCacheShape,
  type VerifierCacheWriterShape,
} from "./verifier-cache.js"

export interface PostgresVerifierCacheOptions {
  readonly verifier_id: string
  readonly accepted_root_program_ids?: ReadonlyArray<string>
}

export const makePostgresVerifierCache = (
  client: PostgresQueryClientShape,
  options: PostgresVerifierCacheOptions,
): VerifierCacheShape => ({
  resolveByHost: (host) =>
    loadCacheOrMiss(client, options).pipe(
      Effect.flatMap((cache) => cache.resolveByHost(host)),
    ),
  resolveByDestination: (destinationUrl, issuerHintHost) =>
    loadCacheOrMiss(client, options).pipe(
      Effect.flatMap((cache) =>
        cache.resolveByDestination(destinationUrl, issuerHintHost),
      ),
    ),
})

export const makePostgresVerifierCacheWriter = (
  executor: PostgresQueryClientShape & PostgresStatementSinkShape,
  options: PostgresVerifierCacheOptions,
): VerifierCacheWriterShape => {
  const reader = makePostgresVerifierCache(executor, options)
  const activeDelegatedAuthoritiesByRoot = new Map<string, Set<string>>()
  const activeIssuersByAuthority = new Map<string, Set<string>>()

  return {
    ...reader,
    upsertIssuer: (projection) =>
      executor
        .execute(
          upsertVerifierCacheIssuerCommand(
            options,
            projection,
            authorityContextProjection(projection.namespace),
          ),
        )
        .pipe(Effect.as(projection)),
    upsertDestinationPolicy: (projection) =>
      executor
        .execute(
          upsertVerifierCacheDestinationPolicyCommand(
            options,
            projection,
            authorityContextProjection(projection.namespace),
          ),
        )
        .pipe(Effect.as(projection)),
    upsertRootAuthorityContext: (context) =>
      Effect.sync(() => recordRootAuthorityContext(context)).pipe(
        Effect.flatMap(() =>
          executor.execute(
            upsertVerifierCacheRootAuthorityContextCommand(options, context),
          ),
        ),
        Effect.asVoid,
      ),
    upsertDelegatedAuthorityIssuerContext: (context) =>
      Effect.sync(() => recordDelegatedAuthorityIssuerContext(context)).pipe(
        Effect.flatMap(() =>
          executor.execute(
            upsertVerifierCacheDelegatedAuthorityIssuerContextCommand(
              options,
              context,
            ),
          ),
        ),
        Effect.asVoid,
      ),
    updateIssuerAssuranceTier: (update) =>
      verifierCacheCommandReturnedRows(
        executor,
        updateVerifierCacheIssuerAssuranceTierCommand(options, update),
      ),
    removeIssuer: (namespace) =>
      verifierCacheCommandReturnedRows(
        executor,
        deleteVerifierCacheIssuerCommand(options, namespace),
      ),
    removeDestinationPolicy: (key) =>
      verifierCacheCommandReturnedRows(
        executor,
        deleteVerifierCacheDestinationPolicyCommand(options, key),
      ),
    removeDestinationPoliciesForIssuer: (namespace) =>
      verifierCacheCommandReturnedRows(
        executor,
        deleteVerifierCacheIssuerCommand(options, namespace),
      ),
    removeDelegatedAuthority: (key) =>
      Effect.sync(() => {
        activeDelegatedAuthoritiesByRoot
          .get(key.root_program_id)
          ?.delete(key.delegated_authority_id)
        activeIssuersByAuthority.delete(
          authorityContextKey(
            key.root_program_id,
            key.delegated_authority_id,
          ),
        )
      }).pipe(
        Effect.flatMap(() =>
          verifierCacheCommandReturnedRows(
            executor,
            deleteVerifierCacheDelegatedAuthorityCommand(options, key),
          ),
        ),
      ),
  }

  function recordRootAuthorityContext(context: RootAuthorityContext): void {
    activeDelegatedAuthoritiesByRoot.set(
      context.root_program_id,
      new Set(context.active_delegated_authority_ids),
    )
  }

  function recordDelegatedAuthorityIssuerContext(
    context: DelegatedAuthorityIssuerContext,
  ): void {
    activeIssuersByAuthority.set(
      authorityContextKey(
        context.root_program_id,
        context.delegated_authority_id,
      ),
      new Set(context.active_issuer_ids),
    )
  }

  function authorityContextProjection(
    namespace: IssuerNamespace,
  ): Record<string, boolean> {
    return {
      root_manifest_authorizes_authority:
        activeDelegatedAuthoritiesByRoot
          .get(namespace.root_program_id)
          ?.has(namespace.delegated_authority_id) === true,
      delegated_authority_authorizes_issuer:
        activeIssuersByAuthority
          .get(
            authorityContextKey(
              namespace.root_program_id,
              namespace.delegated_authority_id,
            ),
          )
          ?.has(namespace.issuer_id) === true,
    }
  }
}

export const upsertVerifierCacheDestinationPolicyCommand = (
  options: PostgresVerifierCacheOptions,
  projection: DestinationPolicyProjection,
  authorityContext: Record<string, boolean> = {},
): SqlCommand => ({
  name: "verifier_cache_entries.upsert_destination_policy",
  text: `
insert into qr_trust.verifier_cache_entries (
  verifier_id,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id,
  source_artifact_hashes,
  scanner_trust_projection,
  cache_generated_at,
  cache_expires_at,
  freshness_status
) values ($1, $2, $3, $4, $5, '{}', $6::jsonb || ${durableAuthorityContextSql()}, $7::timestamptz, $8::timestamptz, 'fresh')
on conflict (
  verifier_id,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id
) do update set
  scanner_trust_projection = jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(verifier_cache_entries.scanner_trust_projection, '{}'::jsonb),
        '{authority_context}',
        excluded.scanner_trust_projection->'authority_context',
        true
      ),
      '{issuer}',
      coalesce(
        verifier_cache_entries.scanner_trust_projection->'issuer',
        excluded.scanner_trust_projection->'issuer'
      ),
      true
    ),
    '{destination_policy}',
    excluded.scanner_trust_projection->'destination_policy',
    true
  ),
  cache_generated_at = greatest(
    verifier_cache_entries.cache_generated_at,
    excluded.cache_generated_at
  ),
  cache_expires_at = least(
    verifier_cache_entries.cache_expires_at,
    excluded.cache_expires_at
  ),
  freshness_status = excluded.freshness_status
`.trim(),
  values: [
    options.verifier_id,
    projection.namespace.root_program_id,
    projection.namespace.delegated_authority_id,
    projection.namespace.issuer_id,
    projection.destination_policy_id,
    jsonb({
      authority_context: authorityContext,
      issuer: fallbackIssuerProjection(projection),
      destination_policy: {
        destination_policy_id: projection.destination_policy_id,
        approved_destinations: projection.approved_destinations,
        redirect_policy: projection.redirect_policy,
      },
    }),
    projection.cache_generated_at,
    projection.cache_expires_at,
  ],
})

export const upsertVerifierCacheIssuerCommand = (
  options: PostgresVerifierCacheOptions,
  projection: IssuerProjection,
  authorityContext: Record<string, boolean> = {},
): SqlCommand => ({
  name: "verifier_cache_entries.upsert_issuer_projection",
  text: `
insert into qr_trust.verifier_cache_entries (
  verifier_id,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id,
  source_artifact_hashes,
  scanner_trust_projection,
  cache_generated_at,
  cache_expires_at,
  freshness_status
) values ($1, $2, $3, $4, $5, '{}', $6::jsonb || ${durableAuthorityContextSql()}, $7::timestamptz, $8::timestamptz, 'fresh')
on conflict (
  verifier_id,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id
) do update set
  scanner_trust_projection = jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(verifier_cache_entries.scanner_trust_projection, '{}'::jsonb),
        '{authority_context}',
        excluded.scanner_trust_projection->'authority_context',
        true
      ),
      '{destination_policy}',
      coalesce(
        verifier_cache_entries.scanner_trust_projection->'destination_policy',
        excluded.scanner_trust_projection->'destination_policy'
      ),
      true
    ),
    '{issuer}',
    excluded.scanner_trust_projection->'issuer',
    true
  ),
  cache_generated_at = greatest(verifier_cache_entries.cache_generated_at, excluded.cache_generated_at),
  cache_expires_at = least(verifier_cache_entries.cache_expires_at, excluded.cache_expires_at),
  freshness_status = excluded.freshness_status
`.trim(),
  values: [
    options.verifier_id,
    projection.namespace.root_program_id,
    projection.namespace.delegated_authority_id,
    projection.namespace.issuer_id,
    projection.destination_policy_id,
    jsonb({
      authority_context: authorityContext,
      issuer: {
        namespace: projection.namespace,
        display_name: projection.issuer_display_name,
        assurance_tier: projection.assurance_tier,
      },
      destination_policy: emptyDestinationPolicyProjection(
        projection.destination_policy_id,
      ),
    }),
    projection.cache_generated_at,
    projection.cache_expires_at,
  ],
})

export const upsertVerifierCacheRootAuthorityContextCommand = (
  options: PostgresVerifierCacheOptions,
  context: RootAuthorityContext,
): SqlCommand => ({
  name: "verifier_cache_entries.upsert_root_authority_context",
  text: `
update qr_trust.verifier_cache_entries
set scanner_trust_projection = jsonb_set(
  coalesce(scanner_trust_projection, '{}'::jsonb),
  '{authority_context}',
  coalesce(scanner_trust_projection->'authority_context', '{}'::jsonb) ||
    jsonb_build_object(
      'root_manifest_authorizes_authority',
      delegated_authority_id = any($3::text[])
    ),
  true
)
where
  verifier_id = $1
  and root_program_id = $2
`.trim(),
  values: [
    options.verifier_id,
    context.root_program_id,
    context.active_delegated_authority_ids,
  ],
})

export const upsertVerifierCacheDelegatedAuthorityIssuerContextCommand = (
  options: PostgresVerifierCacheOptions,
  context: DelegatedAuthorityIssuerContext,
): SqlCommand => ({
  name: "verifier_cache_entries.upsert_delegated_authority_issuer_context",
  text: `
update qr_trust.verifier_cache_entries
set scanner_trust_projection = jsonb_set(
  coalesce(scanner_trust_projection, '{}'::jsonb),
  '{authority_context}',
  coalesce(scanner_trust_projection->'authority_context', '{}'::jsonb) ||
    jsonb_build_object(
      'delegated_authority_authorizes_issuer',
      issuer_id = any($4::text[])
    ),
  true
)
where
  verifier_id = $1
  and root_program_id = $2
  and delegated_authority_id = $3
`.trim(),
  values: [
    options.verifier_id,
    context.root_program_id,
    context.delegated_authority_id,
    context.active_issuer_ids,
  ],
})

export const updateVerifierCacheIssuerAssuranceTierCommand = (
  options: PostgresVerifierCacheOptions,
  update: IssuerAssuranceTierUpdate,
): SqlCommand => ({
  name: "verifier_cache_entries.update_issuer_assurance_tier",
  text: `
update qr_trust.verifier_cache_entries
set scanner_trust_projection = jsonb_set(
  coalesce(scanner_trust_projection, '{}'::jsonb),
  '{issuer,assurance_tier}',
  to_jsonb($5::text),
  true
)
where
  verifier_id = $1
  and root_program_id = $2
  and delegated_authority_id = $3
  and issuer_id = $4
  and coalesce(scanner_trust_projection->'issuer'->>'placeholder', 'false') <> 'true'
  and coalesce(scanner_trust_projection->'issuer'->>'projection_kind', '') <> 'placeholder'
returning 1
`.trim(),
  values: [
    options.verifier_id,
    update.namespace.root_program_id,
    update.namespace.delegated_authority_id,
    update.namespace.issuer_id,
    update.assurance_tier,
  ],
})

export const deleteVerifierCacheIssuerCommand = (
  options: PostgresVerifierCacheOptions,
  namespace: IssuerNamespace,
): SqlCommand => ({
  name: "verifier_cache_entries.delete_issuer",
  text: `
delete from qr_trust.verifier_cache_entries
where
  verifier_id = $1
  and root_program_id = $2
  and delegated_authority_id = $3
  and issuer_id = $4
returning 1
`.trim(),
  values: [
    options.verifier_id,
    namespace.root_program_id,
    namespace.delegated_authority_id,
    namespace.issuer_id,
  ],
})

export const deleteVerifierCacheDestinationPolicyCommand = (
  options: PostgresVerifierCacheOptions,
  key: DestinationPolicyKey,
): SqlCommand => ({
  name: "verifier_cache_entries.delete_destination_policy",
  text: `
delete from qr_trust.verifier_cache_entries
where
  verifier_id = $1
  and root_program_id = $2
  and delegated_authority_id = $3
  and issuer_id = $4
  and destination_policy_id = $5
returning 1
`.trim(),
  values: [
    options.verifier_id,
    key.namespace.root_program_id,
    key.namespace.delegated_authority_id,
    key.namespace.issuer_id,
    key.destination_policy_id,
  ],
})

export const deleteVerifierCacheDelegatedAuthorityCommand = (
  options: PostgresVerifierCacheOptions,
  key: DelegatedAuthorityKey,
): SqlCommand => ({
  name: "verifier_cache_entries.delete_delegated_authority",
  text: `
delete from qr_trust.verifier_cache_entries
where
  verifier_id = $1
  and root_program_id = $2
  and delegated_authority_id = $3
returning 1
`.trim(),
  values: [options.verifier_id, key.root_program_id, key.delegated_authority_id],
})

const verifierCacheCommandReturnedRows = (
  client: PostgresQueryClientShape,
  command: SqlCommand,
): Effect.Effect<boolean, NetworkError> =>
  Effect.tryPromise({
    try: async () => {
      const result = await client.query(command.text, [...command.values])
      return result.rows.length > 0
    },
    catch: (cause) =>
      persistenceError(`Postgres command ${command.name} failed.`, cause),
  })

const emptyVerifierCache = makeInMemoryVerifierCache([], [])

const fallbackIssuerProjection = (
  projection: DestinationPolicyProjection,
): Record<string, unknown> => ({
  namespace: projection.namespace,
  projection_kind: "placeholder",
  placeholder: true,
  display_name: projection.namespace.issuer_id,
  assurance_tier: "source_of_truth_destination_policy",
})

const emptyDestinationPolicyProjection = (
  destinationPolicyId: string,
): Record<string, unknown> => ({
  destination_policy_id: destinationPolicyId,
  approved_destinations: [],
  redirect_policy: {
    resolver_urls: [],
    expected_final_destinations: [],
    allowed_redirect_hosts: [],
    max_redirect_hops: 0,
    nested_shorteners_allowed: false,
    scanner_must_display_resolver_and_final_destination: true,
  },
})

const durableAuthorityContextSql = (): string => `
jsonb_build_object(
  'authority_context',
  jsonb_build_object(
    'root_manifest_authorizes_authority',
    exists (
      select 1
      from qr_trust.published_artifacts root_artifact
      where root_artifact.root_program_id = $2
        and root_artifact.artifact_type = 'root_manifest'
        and root_artifact.publication_status = 'published'
        and exists (
          select 1
          from jsonb_array_elements(
            coalesce(
              root_artifact.canonical_json->'delegated_authorities',
              '[]'::jsonb
            )
          ) as delegated_authority
          where delegated_authority->>'delegated_authority_id' = $3
            and delegated_authority->>'status' = 'active'
        )
    ),
    'delegated_authority_authorizes_issuer',
    exists (
      select 1
      from qr_trust.published_artifacts authority_artifact
      where authority_artifact.root_program_id = $2
        and authority_artifact.delegated_authority_id = $3
        and authority_artifact.artifact_type = 'delegated_authority_manifest'
        and authority_artifact.publication_status = 'published'
        and exists (
          select 1
          from jsonb_array_elements(
            coalesce(
              authority_artifact.canonical_json->'enrolled_issuers',
              '[]'::jsonb
            )
          ) as enrolled_issuer
          where enrolled_issuer->>'issuer_id' = $4
            and enrolled_issuer->>'status' = 'active'
        )
    )
  )
)`

const jsonb = (value: unknown): string => JSON.stringify(value)

const loadCacheOrMiss = (
  client: PostgresQueryClientShape,
  options: PostgresVerifierCacheOptions,
): Effect.Effect<VerifierCacheShape> =>
  loadCache(client, options).pipe(
    // Scanner decisions must degrade to "no trusted cache state" instead of
    // leaking infrastructure errors through the cache port.
    Effect.catchAll(() => Effect.succeed(emptyVerifierCache)),
  )

const loadCache = (
  client: PostgresQueryClientShape,
  options: PostgresVerifierCacheOptions,
): Effect.Effect<VerifierCacheShape, NetworkError> =>
  Effect.tryPromise({
    try: async () => {
      const result = await client.query(
        `
select
  verifier_id,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id,
  scanner_trust_projection,
  cache_generated_at,
  cache_expires_at,
  freshness_status
from qr_trust.verifier_cache_entries
where verifier_id = $1
order by cache_expires_at desc, created_at desc
`.trim(),
        [options.verifier_id],
      )
      const entries = result.rows.flatMap((row) => {
        const entry = decodeVerifierCacheEntryRow(row)
        return entry ? [entry] : []
      })

      return makeInMemoryVerifierCache(
        entries.map((entry) => entry.issuer),
        entries.map((entry) => entry.policy),
        makeAcceptedRootPolicy(options.accepted_root_program_ids ?? []),
      )
    },
    catch: (cause) =>
      persistenceError("Postgres verifier-cache read failed.", cause),
  })

interface DecodedVerifierCacheEntry {
  readonly issuer: IssuerProjection
  readonly policy: DestinationPolicyProjection
}

const decodeVerifierCacheEntryRow = (
  row: Record<string, unknown>,
): DecodedVerifierCacheEntry | undefined => {
  const namespace: IssuerNamespace = {
    root_program_id: requireStringField(row, "root_program_id"),
    delegated_authority_id: requireStringField(row, "delegated_authority_id"),
    issuer_id: requireStringField(row, "issuer_id"),
  }
  const projection = requireRecordField(row, "scanner_trust_projection")
  if (!authorityContextAllowsResolution(projection)) {
    return undefined
  }
  const issuerProjection = requireRecordField(projection, "issuer")
  if (isPlaceholderIssuerProjection(issuerProjection)) {
    return undefined
  }
  const policyProjection = requireRecordField(projection, "destination_policy")
  const approvedDestinations = decodeApprovedDestinations(
    requireArrayField(policyProjection, "approved_destinations"),
  )
  const cacheGeneratedAt = isoTimestampField(row, "cache_generated_at")
  const cacheExpiresAt = isoTimestampField(row, "cache_expires_at")
  const destinationPolicyId = requireStringField(row, "destination_policy_id")
  const allowedHosts = uniqueStrings(
    approvedDestinations.flatMap((destination) => destination.allowed_hosts),
  )

  const issuer: IssuerProjection = {
    namespace,
    issuer_display_name: requireStringField(issuerProjection, "display_name"),
    assurance_tier: requireStringField(issuerProjection, "assurance_tier"),
    destination_policy_id: destinationPolicyId,
    allowed_hosts: allowedHosts,
    cache_generated_at: cacheGeneratedAt,
    cache_expires_at: cacheExpiresAt,
  }
  const policy: DestinationPolicyProjection = {
    namespace,
    destination_policy_id: destinationPolicyId,
    approved_destinations: approvedDestinations,
    redirect_policy: decodeRedirectPolicy(
      requireRecordField(policyProjection, "redirect_policy"),
    ),
    allowed_hosts: allowedHosts,
    allow_subdomains: approvedDestinations.some(
      (destination) => destination.allow_subdomains,
    ),
    cache_generated_at: cacheGeneratedAt,
    cache_expires_at: cacheExpiresAt,
  }

  return { issuer, policy }
}

const isPlaceholderIssuerProjection = (
  issuerProjection: Record<string, unknown>,
): boolean =>
  issuerProjection.placeholder === true ||
  issuerProjection.projection_kind === "placeholder"

const authorityContextAllowsResolution = (
  projection: Record<string, unknown>,
): boolean => {
  const authorityContext = projection.authority_context
  if (
    !authorityContext ||
    typeof authorityContext !== "object" ||
    Array.isArray(authorityContext)
  ) {
    return false
  }

  const record = authorityContext as Record<string, unknown>
  return (
    record.root_manifest_authorizes_authority === true &&
    record.delegated_authority_authorizes_issuer === true
  )
}

const authorityContextKey = (
  rootProgramId: string,
  delegatedAuthorityId: string,
): string => [rootProgramId, delegatedAuthorityId].join("\u001f")

const decodeApprovedDestinations = (
  values: ReadonlyArray<unknown>,
): ReadonlyArray<DestinationPolicyRule> =>
  values.map((value, index) => {
    const record = requireRecord(value, `approved_destinations[${index}]`)
    const allowedQueryKeys = optionalStringArrayField(
      record,
      "allowed_query_keys",
    )

    return {
      destination_id: requireStringField(record, "destination_id"),
      expected_final_url: requireHttpsUrlField(record, "expected_final_url"),
      allowed_hosts: requireStringArrayField(record, "allowed_hosts").map(
        (host) => requireHostnameValue(host, "allowed_hosts[]"),
      ),
      allow_subdomains: requireBooleanField(record, "allow_subdomains"),
      path_prefixes: requireStringArrayField(record, "path_prefixes").map(
        (path) => requirePathPrefixValue(path, "path_prefixes[]"),
      ),
      query_policy: requireLiteralField(record, "query_policy", [
        "none",
        "allow_known_payment_query",
      ]),
      ...(allowedQueryKeys ? { allowed_query_keys: allowedQueryKeys } : {}),
    }
  })

const decodeRedirectPolicy = (
  record: Record<string, unknown>,
): RedirectPolicyProjection => ({
  resolver_urls: requireStringArrayField(record, "resolver_urls").map((url) =>
    requireHttpsUrlValue(url, "resolver_urls[]"),
  ),
  expected_final_destinations: requireStringArrayField(
    record,
    "expected_final_destinations",
  ).map((url) => requireHttpsUrlValue(url, "expected_final_destinations[]")),
  allowed_redirect_hosts: requireStringArrayField(
    record,
    "allowed_redirect_hosts",
  ).map((host) => requireHostnameValue(host, "allowed_redirect_hosts[]")),
  max_redirect_hops: requireNonNegativeIntegerField(record, "max_redirect_hops"),
  nested_shorteners_allowed: requireBooleanField(
    record,
    "nested_shorteners_allowed",
  ),
  scanner_must_display_resolver_and_final_destination: requireBooleanField(
    record,
    "scanner_must_display_resolver_and_final_destination",
  ),
})

const requireRecordField = (
  row: Record<string, unknown>,
  field: string,
): Record<string, unknown> => requireRecord(row[field], field)

const requireRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  throw new Error(`Expected ${label} to be an object.`)
}

const requireArrayField = (
  row: Record<string, unknown>,
  field: string,
): ReadonlyArray<unknown> => {
  const value = row[field]
  if (Array.isArray(value)) {
    return value
  }

  throw new Error(`Expected ${field} to be an array.`)
}

const requireStringField = (
  row: Record<string, unknown>,
  field: string,
): string => {
  const value = row[field]
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  throw new Error(`Expected ${field} to be a non-empty string.`)
}

const requireHttpsUrlField = (
  row: Record<string, unknown>,
  field: string,
): string => requireHttpsUrlValue(row[field], field)

const requireHttpsUrlValue = (value: unknown, field: string): string => {
  const rawValue =
    typeof value === "string" && value.length > 0 ? value.trim() : ""
  if (!rawValue) {
    throw new Error(`Expected ${field} to be a non-empty string.`)
  }
  let url: URL
  try {
    url = new URL(rawValue)
  } catch {
    throw new Error(`Expected ${field} to be a valid URL.`)
  }
  if (url.protocol !== "https:") {
    throw new Error(`Expected ${field} to use https.`)
  }
  if (url.username || url.password) {
    throw new Error(`Expected ${field} to omit credentials.`)
  }
  return rawValue
}

const requireHostnameValue = (value: unknown, field: string): string => {
  const hostname =
    typeof value === "string" ? value.trim().replace(/\.$/, "").toLowerCase() : ""
  if (
    hostname.length === 0 ||
    hostname.length > 253 ||
    hostname.includes("://") ||
    hostname.includes("/") ||
    hostname.includes(":") ||
    /\s/.test(hostname)
  ) {
    throw new Error(`Expected ${field} to be a DNS hostname.`)
  }
  if (
    hostname.split(".").some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[a-z0-9-]+$/.test(label),
    )
  ) {
    throw new Error(`Expected ${field} to be a DNS hostname.`)
  }
  return hostname
}

const requirePathPrefixValue = (value: unknown, field: string): string => {
  const pathPrefix =
    typeof value === "string" && value.length > 0 ? value.trim() : ""
  if (!pathPrefix.startsWith("/")) {
    throw new Error(`Expected ${field} to start with /.`)
  }
  return pathPrefix
}

const requireLiteralField = <T extends string>(
  row: Record<string, unknown>,
  field: string,
  allowed: ReadonlyArray<T>,
): T => {
  const value = row[field]
  if (allowed.includes(value as T)) {
    return value as T
  }
  throw new Error(`Expected ${field} to be one of: ${allowed.join(", ")}.`)
}

const requireStringArrayField = (
  row: Record<string, unknown>,
  field: string,
): ReadonlyArray<string> => {
  const value = requireArrayField(row, field)
  if (value.every((item) => typeof item === "string")) {
    return value
  }

  throw new Error(`Expected ${field} to contain only strings.`)
}

const optionalStringArrayField = (
  row: Record<string, unknown>,
  field: string,
): ReadonlyArray<string> | undefined => {
  if (row[field] === undefined) {
    return undefined
  }

  return requireStringArrayField(row, field)
}

const requireBooleanField = (
  row: Record<string, unknown>,
  field: string,
): boolean => {
  const value = row[field]
  if (typeof value === "boolean") {
    return value
  }

  throw new Error(`Expected ${field} to be a boolean.`)
}

const requireNumberField = (
  row: Record<string, unknown>,
  field: string,
): number => {
  const value = row[field]
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  throw new Error(`Expected ${field} to be a finite number.`)
}

const requireNonNegativeIntegerField = (
  row: Record<string, unknown>,
  field: string,
): number => {
  const value = requireNumberField(row, field)
  if (Number.isInteger(value) && value >= 0) {
    return value
  }
  throw new Error(`Expected ${field} to be a non-negative integer.`)
}

const isoTimestampField = (
  row: Record<string, unknown>,
  field: string,
): string => {
  const value = row[field]
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : undefined

  if (date && !Number.isNaN(date.getTime())) {
    return date.toISOString()
  }

  throw new Error(`Expected ${field} to be a timestamp.`)
}

const uniqueStrings = (
  values: ReadonlyArray<string>,
): ReadonlyArray<string> => [...new Set(values)]
