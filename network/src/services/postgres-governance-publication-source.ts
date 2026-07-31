import { Effect } from "effect"

import { persistenceError, type NetworkError } from "../errors.js"
import type { ArtifactPublicationInput } from "./artifact-publication.js"
import type { GovernancePublicationPlan } from "./governance-publication.js"
import type { SqlCommand } from "./postgres-persistence.js"
import type { TrustKeyRecord } from "./trust-key-registry.js"
import type {
  DestinationPolicyProjection,
  DestinationPolicyRule,
  IssuerNamespace,
  RedirectPolicyProjection,
} from "./verifier-cache.js"

export interface PostgresGovernancePublicationSourceInput {
  readonly namespace: IssuerNamespace
  readonly destination_policy_id: string
  readonly observedAt: Date
}

export interface PostgresGovernancePublicationBundleRow {
  readonly root_program_id: string
  readonly root_name: string
  readonly root_program_scope: string
  readonly root_accepted_algorithm_ids: ReadonlyArray<string>
  readonly root_trust_keys: ReadonlyArray<TrustKeyRecord>
  readonly root_policy_constraints: Readonly<Record<string, unknown>>
  readonly root_status: "active"
  readonly delegated_authority_id: string
  readonly delegated_authority_name: string
  readonly delegated_authority_type: string
  readonly delegated_authority_scope: Readonly<Record<string, unknown>>
  readonly delegated_authority_assurance_requirements: Readonly<
    Record<string, unknown>
  >
  readonly delegated_authority_trust_keys: ReadonlyArray<TrustKeyRecord>
  readonly delegated_authority_status: "active"
  readonly issuer_id: string
  readonly issuer_display_name: string
  readonly issuer_class: string
  readonly issuer_assurance_tier: string
  readonly issuer_assurance_evidence: Readonly<Record<string, unknown>>
  readonly issuer_enrollment_status: "active"
  readonly issuer_certificate_refs: ReadonlyArray<string>
  readonly issuer_certificate_status: "active"
  readonly issuer_status_event_ref: string
  readonly issuer_status_event_status:
    | "active"
    | "suspended"
    | "revoked"
    | "expired"
    | "retired"
  readonly issuer_status_event_published_at: string
  readonly destination_policy_id: string
  readonly destination_policy_usage_policy:
    | "reusable_public"
    | "one_time"
    | "time_limited"
  readonly destination_policy_approved_destinations: ReadonlyArray<unknown>
  readonly destination_policy_redirect_policy: Readonly<Record<string, unknown>>
  readonly destination_policy_runtime_safety_policy: Readonly<
    Record<string, unknown>
  >
  readonly destination_policy_version: number
  readonly destination_policy_status: "active"
}

export interface PostgresGovernancePublicationSourceExecutorShape {
  readonly queryGovernancePublicationBundle: (
    command: SqlCommand,
  ) => Effect.Effect<
    ReadonlyArray<PostgresGovernancePublicationBundleRow>,
    NetworkError
  >
  readonly recorded: () => ReadonlyArray<SqlCommand>
}

export interface PostgresGovernancePublicationSourceShape {
  readonly planGovernancePublication: (
    input: PostgresGovernancePublicationSourceInput,
  ) => Effect.Effect<GovernancePublicationPlan, NetworkError>
}

export const governancePublicationBundleByPolicyCommand = (
  input: PostgresGovernancePublicationSourceInput,
): SqlCommand => ({
  name: "governance_publication.bundle_by_issuer_policy",
  text: `
select
  rp.root_program_id,
  rp.name as root_name,
  rp.program_scope as root_program_scope,
  rp.accepted_algorithm_ids as root_accepted_algorithm_ids,
  root_keys.trust_keys as root_trust_keys,
  rp.policy_constraints as root_policy_constraints,
  rp.status as root_status,
  da.delegated_authority_id,
  da.name as delegated_authority_name,
  da.authority_type as delegated_authority_type,
  da.scope as delegated_authority_scope,
  da.assurance_requirements as delegated_authority_assurance_requirements,
  authority_keys.trust_keys as delegated_authority_trust_keys,
  da.status as delegated_authority_status,
  i.issuer_id,
  i.display_name as issuer_display_name,
  i.issuer_class,
  i.assurance_tier as issuer_assurance_tier,
  i.assurance_evidence as issuer_assurance_evidence,
  i.enrollment_status as issuer_enrollment_status,
  certs.issuer_certificate_refs,
  'active' as issuer_certificate_status,
  coalesce(
    issuer_status.status_event_id,
    ('status:' || regexp_replace(i.issuer_id, '^issuer:', '') || ':active:v1')
  ) as issuer_status_event_ref,
  coalesce(issuer_status.status, i.enrollment_status) as issuer_status_event_status,
  coalesce(issuer_status.effective_at, $5::timestamptz) as issuer_status_event_published_at,
  dp.destination_policy_id,
  dp.usage_policy as destination_policy_usage_policy,
  dp.approved_destinations as destination_policy_approved_destinations,
  dp.redirect_policy as destination_policy_redirect_policy,
  dp.runtime_safety_policy as destination_policy_runtime_safety_policy,
  dp.version as destination_policy_version,
  dp.status as destination_policy_status
from qr_trust.root_programs rp
join qr_trust.delegated_authorities da
  on da.root_program_id = rp.root_program_id
join qr_trust.issuers i
  on i.root_program_id = da.root_program_id
 and i.delegated_authority_id = da.delegated_authority_id
join qr_trust.destination_policies dp
  on dp.root_program_id = i.root_program_id
 and dp.delegated_authority_id = i.delegated_authority_id
 and dp.issuer_id = i.issuer_id
join lateral (
  select array_agg(ic.certificate_id order by ic.certificate_id) as issuer_certificate_refs
  from qr_trust.issuer_certificates ic
  where ic.root_program_id = i.root_program_id
    and ic.delegated_authority_id = i.delegated_authority_id
    and ic.issuer_id = i.issuer_id
    and ic.key_status = 'active'
    and ic.not_before <= $5::timestamptz
    and ic.not_after > $5::timestamptz
) certs on certs.issuer_certificate_refs is not null
join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'key_id', tk.key_id,
      'signer_id', tk.signer_id,
      'root_program_id', tk.root_program_id,
      'algorithm_id', tk.algorithm_id,
      'scope', tk.scope,
      'status', tk.key_status,
      'public_key_material_ref', tk.public_key_material_ref,
      'public_key_material_pem', tk.public_key_material_pem
    )
    order by tk.key_id
  ) as trust_keys
  from qr_trust.trust_keys tk
  where tk.root_program_id = rp.root_program_id
    and tk.signer_id = rp.root_program_id
    and tk.scope = 'root_program'
    and tk.key_status = 'active'
    and tk.algorithm_id = any(rp.accepted_algorithm_ids)
) root_keys on root_keys.trust_keys is not null
join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'key_id', tk.key_id,
      'signer_id', tk.signer_id,
      'root_program_id', tk.root_program_id,
      'delegated_authority_id', tk.delegated_authority_id,
      'algorithm_id', tk.algorithm_id,
      'scope', tk.scope,
      'status', tk.key_status,
      'public_key_material_ref', tk.public_key_material_ref,
      'public_key_material_pem', tk.public_key_material_pem
    )
    order by tk.key_id
  ) as trust_keys
  from qr_trust.trust_keys tk
  where tk.root_program_id = rp.root_program_id
    and tk.delegated_authority_id = da.delegated_authority_id
    and tk.signer_id = da.delegated_authority_id
    and tk.scope = 'delegated_authority'
    and tk.key_status = 'active'
    and tk.algorithm_id = any(rp.accepted_algorithm_ids)
) authority_keys on authority_keys.trust_keys is not null
left join lateral (
  select
    se.status_event_id,
    se.status,
    se.effective_at
  from qr_trust.status_events se
  where se.root_program_id = i.root_program_id
    and se.delegated_authority_id = i.delegated_authority_id
    and se.issuer_id = i.issuer_id
    and se.target_type in ('issuer', 'issuer_record')
    and se.target_id = i.issuer_id
    and se.effective_at <= $5::timestamptz
  order by se.effective_at desc, se.created_at desc
  limit 1
) issuer_status on true
where rp.root_program_id = $1
  and da.delegated_authority_id = $2
  and i.issuer_id = $3
  and dp.destination_policy_id = $4
  and rp.status = 'active'
  and da.status = 'active'
  and i.enrollment_status = 'active'
  and coalesce(issuer_status.status, i.enrollment_status) = 'active'
  and dp.status = 'active'
limit 1
`.trim(),
  values: [
    input.namespace.root_program_id,
    input.namespace.delegated_authority_id,
    input.namespace.issuer_id,
    input.destination_policy_id,
    input.observedAt.toISOString(),
  ],
})

export const makePostgresGovernancePublicationSource = (
  executor: PostgresGovernancePublicationSourceExecutorShape,
): PostgresGovernancePublicationSourceShape => ({
  planGovernancePublication: (input) =>
    Effect.gen(function* () {
      const rows = yield* executor.queryGovernancePublicationBundle(
        governancePublicationBundleByPolicyCommand(input),
      )
      const row = yield* requireSingleGovernancePublicationBundle(rows, input)

      return yield* Effect.try({
        try: () => planGovernancePublicationFromPostgresRow(row, input.observedAt),
        catch: (cause) =>
          persistenceError(
            "Postgres governance publication bundle planning failed.",
            cause,
          ),
      })
    }),
})

export const makeRecordingPostgresGovernancePublicationSourceExecutor = (
  initialRows: ReadonlyArray<PostgresGovernancePublicationBundleRow> = [],
): PostgresGovernancePublicationSourceExecutorShape => {
  const rows = [...initialRows]
  const commands: SqlCommand[] = []

  return {
    queryGovernancePublicationBundle: (command) =>
      Effect.sync(() => {
        commands.push(command)

        if (command.name !== "governance_publication.bundle_by_issuer_policy") {
          return []
        }

        const rootProgramId = stringCommandValue(command, 0)
        const delegatedAuthorityId = stringCommandValue(command, 1)
        const issuerId = stringCommandValue(command, 2)
        const destinationPolicyId = stringCommandValue(command, 3)

        return rows.filter(
          (row) =>
            row.root_program_id === rootProgramId &&
            row.delegated_authority_id === delegatedAuthorityId &&
            row.issuer_id === issuerId &&
            row.destination_policy_id === destinationPolicyId,
        )
      }),
    recorded: () => [...commands],
  }
}

export const decodePostgresGovernancePublicationRows = (
  rows: ReadonlyArray<Record<string, unknown>>,
): Effect.Effect<
  ReadonlyArray<PostgresGovernancePublicationBundleRow>,
  NetworkError
> =>
  Effect.try({
    try: () => rows.map(postgresGovernancePublicationBundleRowFromRecord),
    catch: (cause) =>
      persistenceError(
        "Postgres governance publication bundle row decoding failed.",
        cause,
      ),
  })

export const planGovernancePublicationFromPostgresRow = (
  row: PostgresGovernancePublicationBundleRow,
  occurredAt: Date,
): GovernancePublicationPlan => {
  const ids = governanceArtifactIds(row)
  const namespace = namespaceFromRow(row)
  const destinationPolicy = destinationPolicyProjectionFromRow(row, occurredAt)

  const artifacts: readonly [
    ArtifactPublicationInput,
    ArtifactPublicationInput,
    ArtifactPublicationInput,
    ArtifactPublicationInput,
  ] = [
    {
      artifact_type: "root_manifest",
      artifact_id: ids.root_manifest_artifact_id,
      version: 1,
      root_program_id: row.root_program_id,
      body: rootManifestBodyFromRow(row, ids, occurredAt),
      occurredAt,
      eventType: "root.manifest.published",
      reason: "source-of-truth root manifest publication",
    },
    {
      artifact_type: "delegated_authority_manifest",
      artifact_id: ids.delegated_authority_artifact_id,
      version: 1,
      root_program_id: row.root_program_id,
      delegated_authority_id: row.delegated_authority_id,
      body: delegatedAuthorityManifestBodyFromRow(row, ids, occurredAt),
      occurredAt,
      eventType: "delegated_authority.manifest.published",
      reason: "source-of-truth delegated authority publication",
    },
    {
      artifact_type: "issuer_record",
      artifact_id: ids.issuer_record_artifact_id,
      version: 1,
      root_program_id: row.root_program_id,
      delegated_authority_id: row.delegated_authority_id,
      issuer_id: row.issuer_id,
      destination_policy_id: row.destination_policy_id,
      body: issuerRecordBodyFromRow(row, ids, occurredAt),
      occurredAt,
      eventType: "issuer.record.published",
      reason: "source-of-truth issuer record publication",
    },
    {
      artifact_type: "destination_policy",
      artifact_id: ids.destination_policy_artifact_id,
      version: row.destination_policy_version,
      root_program_id: namespace.root_program_id,
      delegated_authority_id: namespace.delegated_authority_id,
      issuer_id: namespace.issuer_id,
      destination_policy_id: destinationPolicy.destination_policy_id,
      body: destinationPolicyBodyFromRow(row, destinationPolicy, occurredAt),
      occurredAt,
      eventType: "destination.policy.published",
      reason: "source-of-truth destination policy publication",
    },
  ]

  return { artifacts }
}

const requireSingleGovernancePublicationBundle = (
  rows: ReadonlyArray<PostgresGovernancePublicationBundleRow>,
  input: PostgresGovernancePublicationSourceInput,
): Effect.Effect<PostgresGovernancePublicationBundleRow, NetworkError> => {
  const row = rows[0]
  if (rows.length === 1 && row?.issuer_status_event_status === "active") {
    return Effect.succeed(row)
  }

  return Effect.fail(
    persistenceError(
      "Governance publication source could not resolve one active bundle.",
      {
        namespace: input.namespace,
        destination_policy_id: input.destination_policy_id,
        row_count: rows.length,
      },
    ),
  )
}

const rootManifestBodyFromRow = (
  row: PostgresGovernancePublicationBundleRow,
  ids: GovernanceArtifactIds,
  occurredAt: Date,
) => ({
  artifact_type: "root_manifest",
  schema_version: "0.1.0",
  root_program_id: row.root_program_id,
  name: row.root_name,
  program_scope: row.root_program_scope,
  accepted_algorithm_ids: row.root_accepted_algorithm_ids,
  trust_keys: row.root_trust_keys.map(trustKeyManifestEntry),
  policy_constraints: row.root_policy_constraints,
  delegated_authorities: [
    {
      delegated_authority_id: row.delegated_authority_id,
      name: row.delegated_authority_name,
      manifest_ref: ids.delegated_authority_artifact_id,
      status: row.delegated_authority_status,
    },
  ],
  publication: publicationMetadata(
    occurredAt,
    row.root_program_id,
    row.destination_policy_runtime_safety_policy,
  ),
})

const delegatedAuthorityManifestBodyFromRow = (
  row: PostgresGovernancePublicationBundleRow,
  ids: GovernanceArtifactIds,
  occurredAt: Date,
) => ({
  artifact_type: "delegated_authority_manifest",
  schema_version: "0.1.0",
  root_program_id: row.root_program_id,
  delegated_authority_id: row.delegated_authority_id,
  operator_name: row.delegated_authority_name,
  operator_class: row.delegated_authority_type,
  scope: delegatedAuthorityScopeFromRow(row.delegated_authority_scope),
  trust_keys: row.delegated_authority_trust_keys.map(trustKeyManifestEntry),
  assurance_requirements: row.delegated_authority_assurance_requirements,
  enrolled_issuers: [
    {
      issuer_id: row.issuer_id,
      issuer_record_ref: ids.issuer_record_artifact_id,
      assurance_tier: row.issuer_assurance_tier,
      status: row.issuer_enrollment_status,
    },
  ],
  publication: publicationMetadata(
    occurredAt,
    row.root_program_id,
    row.destination_policy_runtime_safety_policy,
  ),
})

const issuerRecordBodyFromRow = (
  row: PostgresGovernancePublicationBundleRow,
  ids: GovernanceArtifactIds,
  occurredAt: Date,
) => ({
  artifact_type: "issuer_record",
  schema_version: "0.1.0",
  issuer_namespace: namespaceFromRow(row),
  issuer_display_name: row.issuer_display_name,
  issuer_class: row.issuer_class,
  assurance_tier: row.issuer_assurance_tier,
  assurance_evidence: row.issuer_assurance_evidence,
  certificate_refs: row.issuer_certificate_refs,
  destination_policies: [
    {
      destination_policy_id: row.destination_policy_id,
      policy_ref: ids.destination_policy_artifact_id,
      usage_policy: row.destination_policy_usage_policy,
      status: row.destination_policy_status,
    },
  ],
  inspection_scope: {
    passive_public_checks: true,
    runtime_reputation_checks: "delegated-provider",
    authenticated_or_invasive_testing: false,
  },
  status: {
    issuer_status: row.issuer_status_event_status,
    certificate_status: row.issuer_certificate_status,
    status_event_ref: row.issuer_status_event_ref,
  },
  publication: publicationMetadata(
    occurredAt,
    row.delegated_authority_id,
    row.destination_policy_runtime_safety_policy,
  ),
})

const destinationPolicyBodyFromRow = (
  row: PostgresGovernancePublicationBundleRow,
  policy: DestinationPolicyProjection,
  occurredAt: Date,
) => ({
  artifact_type: "destination_policy",
  schema_version: "0.1.0",
  root_program_id: policy.namespace.root_program_id,
  delegated_authority_id: policy.namespace.delegated_authority_id,
  issuer_id: policy.namespace.issuer_id,
  destination_policy_id: policy.destination_policy_id,
  usage_policy: row.destination_policy_usage_policy,
  approved_destinations: policy.approved_destinations,
  redirect_policy: policy.redirect_policy,
  runtime_safety_policy: row.destination_policy_runtime_safety_policy,
  publication: publicationMetadata(
    occurredAt,
    policy.namespace.delegated_authority_id,
    row.destination_policy_runtime_safety_policy,
  ),
})

const destinationPolicyProjectionFromRow = (
  row: PostgresGovernancePublicationBundleRow,
  occurredAt: Date,
): DestinationPolicyProjection => {
  const approvedDestinations =
    row.destination_policy_approved_destinations.map(destinationRuleFromUnknown)
  const cacheGeneratedAt = occurredAt.toISOString()

  return {
    namespace: namespaceFromRow(row),
    destination_policy_id: row.destination_policy_id,
    approved_destinations: approvedDestinations,
    redirect_policy: redirectPolicyFromUnknown(
      row.destination_policy_redirect_policy,
    ),
    allowed_hosts: uniqueStrings(
      approvedDestinations.flatMap((destination) =>
        destination.allowed_hosts.map(normalizeHost),
      ),
    ),
    allow_subdomains: approvedDestinations.some(
      (destination) => destination.allow_subdomains,
    ),
    cache_generated_at: cacheGeneratedAt,
    cache_expires_at: validUntil(
      occurredAt,
      row.destination_policy_runtime_safety_policy,
    ),
  }
}

const trustKeyManifestEntry = (key: TrustKeyRecord) => ({
  key_id: key.key_id,
  signer_id: key.signer_id,
  algorithm_id: key.algorithm_id,
  public_key_material_ref: key.public_key_material_ref,
  status: key.status,
})

const delegatedAuthorityScopeFromRow = (
  scope: Readonly<Record<string, unknown>>,
): ReadonlyArray<string> => {
  const allowedOperatorScope = scope.allowed_operator_scope
  if (
    Array.isArray(allowedOperatorScope) &&
    allowedOperatorScope.every((item) => typeof item === "string")
  ) {
    return allowedOperatorScope
  }

  return Object.entries(scope)
    .filter(([, value]) => value === true)
    .map(([key]) => key)
}

const namespaceFromRow = (
  row: PostgresGovernancePublicationBundleRow,
): IssuerNamespace => ({
  root_program_id: row.root_program_id,
  delegated_authority_id: row.delegated_authority_id,
  issuer_id: row.issuer_id,
})

interface GovernanceArtifactIds {
  readonly root_manifest_artifact_id: string
  readonly delegated_authority_artifact_id: string
  readonly issuer_record_artifact_id: string
  readonly destination_policy_artifact_id: string
}

const governanceArtifactIds = (
  row: PostgresGovernancePublicationBundleRow,
): GovernanceArtifactIds => ({
  root_manifest_artifact_id: `art_root_${artifactSlug(row.root_program_id, "root")}_v1`,
  delegated_authority_artifact_id: `art_authority_${artifactSlug(row.delegated_authority_id, "authority")}_v1`,
  issuer_record_artifact_id: `art_issuer_${artifactSlug(row.issuer_id, "issuer")}_v1`,
  destination_policy_artifact_id: `art_policy_${artifactSlug(row.destination_policy_id, "policy")}_v${row.destination_policy_version}`,
})

const publicationMetadata = (
  occurredAt: Date,
  signedBy: string,
  runtimeSafetyPolicy: Readonly<Record<string, unknown>>,
) => ({
  published_at: occurredAt.toISOString(),
  valid_until: validUntil(occurredAt, runtimeSafetyPolicy),
  signed_by: signedBy,
  signature_status: "pending_publication_signature",
})

const validUntil = (
  occurredAt: Date,
  runtimeSafetyPolicy: Readonly<Record<string, unknown>>,
): string => {
  const ttlSeconds = positiveIntegerOrDefault(
    runtimeSafetyPolicy.publication_ttl_seconds,
    86_400,
    "publication_ttl_seconds",
  )
  return new Date(occurredAt.getTime() + ttlSeconds * 1000).toISOString()
}

const postgresGovernancePublicationBundleRowFromRecord = (
  row: Record<string, unknown>,
): PostgresGovernancePublicationBundleRow => ({
  root_program_id: requireStringField(row, "root_program_id"),
  root_name: requireStringField(row, "root_name"),
  root_program_scope: requireStringField(row, "root_program_scope"),
  root_accepted_algorithm_ids: requireStringArrayField(
    row,
    "root_accepted_algorithm_ids",
  ),
  root_trust_keys: requireTrustKeyArrayField(row, "root_trust_keys"),
  root_policy_constraints: requireObjectField(row, "root_policy_constraints"),
  root_status: requireLiteralField(row, "root_status", ["active"]),
  delegated_authority_id: requireStringField(row, "delegated_authority_id"),
  delegated_authority_name: requireStringField(
    row,
    "delegated_authority_name",
  ),
  delegated_authority_type: requireStringField(
    row,
    "delegated_authority_type",
  ),
  delegated_authority_scope: requireObjectField(
    row,
    "delegated_authority_scope",
  ),
  delegated_authority_assurance_requirements: requireObjectField(
    row,
    "delegated_authority_assurance_requirements",
  ),
  delegated_authority_trust_keys: requireTrustKeyArrayField(
    row,
    "delegated_authority_trust_keys",
  ),
  delegated_authority_status: requireLiteralField(
    row,
    "delegated_authority_status",
    ["active"],
  ),
  issuer_id: requireStringField(row, "issuer_id"),
  issuer_display_name: requireStringField(row, "issuer_display_name"),
  issuer_class: requireStringField(row, "issuer_class"),
  issuer_assurance_tier: requireStringField(row, "issuer_assurance_tier"),
  issuer_assurance_evidence: requireObjectField(
    row,
    "issuer_assurance_evidence",
  ),
  issuer_enrollment_status: requireLiteralField(
    row,
    "issuer_enrollment_status",
    ["active"],
  ),
  issuer_certificate_refs: requireStringArrayField(
    row,
    "issuer_certificate_refs",
  ),
  issuer_certificate_status: requireLiteralField(
    row,
    "issuer_certificate_status",
    ["active"],
  ),
  issuer_status_event_ref: requireStringField(row, "issuer_status_event_ref"),
  issuer_status_event_status: requireLiteralField(
    row,
    "issuer_status_event_status",
    ["active", "suspended", "revoked", "expired", "retired"],
  ),
  issuer_status_event_published_at: requireTimestampStringField(
    row,
    "issuer_status_event_published_at",
  ),
  destination_policy_id: requireStringField(row, "destination_policy_id"),
  destination_policy_usage_policy: requireLiteralField(
    row,
    "destination_policy_usage_policy",
    ["reusable_public", "one_time", "time_limited"],
  ),
  destination_policy_approved_destinations: requireArrayField(
    row,
    "destination_policy_approved_destinations",
  ),
  destination_policy_redirect_policy: requireObjectField(
    row,
    "destination_policy_redirect_policy",
  ),
  destination_policy_runtime_safety_policy: requireObjectField(
    row,
    "destination_policy_runtime_safety_policy",
  ),
  destination_policy_version: requireNumberField(
    row,
    "destination_policy_version",
  ),
  destination_policy_status: requireLiteralField(
    row,
    "destination_policy_status",
    ["active"],
  ),
})

const destinationRuleFromUnknown = (value: unknown): DestinationPolicyRule => {
  const rule = objectValue(value, "destination policy rule")

  return {
    destination_id: requireStringValue(rule.destination_id, "destination_id"),
    expected_final_url: requireHttpsUrlValue(
      rule.expected_final_url,
      "expected_final_url",
    ),
    allowed_hosts: arrayValue(rule.allowed_hosts, "allowed_hosts").map((host) =>
      requireHostnameValue(host, "allowed_hosts[]"),
    ),
    allow_subdomains: booleanValue(rule.allow_subdomains, "allow_subdomains"),
    path_prefixes: arrayValue(rule.path_prefixes, "path_prefixes").map((path) =>
      requirePathPrefixValue(path, "path_prefixes[]"),
    ),
    query_policy: requireLiteralValue(rule.query_policy, "query_policy", [
      "none",
      "allow_known_payment_query",
    ]),
    ...(rule.allowed_query_keys
      ? {
          allowed_query_keys: arrayValue(
            rule.allowed_query_keys,
            "allowed_query_keys",
          ).map((key) => requireStringValue(key, "allowed_query_keys[]")),
        }
      : {}),
  }
}

const redirectPolicyFromUnknown = (
  value: Readonly<Record<string, unknown>>,
): RedirectPolicyProjection => ({
  resolver_urls: arrayValue(value.resolver_urls, "resolver_urls").map((url) =>
    requireHttpsUrlValue(url, "resolver_urls[]"),
  ),
  expected_final_destinations: arrayValue(
    value.expected_final_destinations,
    "expected_final_destinations",
  ).map((url) =>
    requireHttpsUrlValue(url, "expected_final_destinations[]"),
  ),
  allowed_redirect_hosts: arrayValue(
    value.allowed_redirect_hosts,
    "allowed_redirect_hosts",
  ).map((host) => requireHostnameValue(host, "allowed_redirect_hosts[]")),
  max_redirect_hops: requireNonNegativeIntegerValue(
    value.max_redirect_hops,
    "max_redirect_hops",
  ),
  nested_shorteners_allowed: booleanValue(
    value.nested_shorteners_allowed,
    "nested_shorteners_allowed",
  ),
  scanner_must_display_resolver_and_final_destination: booleanValue(
    value.scanner_must_display_resolver_and_final_destination,
    "scanner_must_display_resolver_and_final_destination",
  ),
})

const stringCommandValue = (
  command: SqlCommand,
  index: number,
): string | undefined => {
  const value = command.values[index]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

const requireStringField = (
  row: Record<string, unknown>,
  field: string,
): string => requireStringValue(row[field], field)

const requireTimestampStringField = (
  row: Record<string, unknown>,
  field: string,
): string => {
  const value = row[field]
  if (value instanceof Date) {
    return value.toISOString()
  }
  return requireStringValue(value, field)
}

const requireStringValue = (value: unknown, field: string): string => {
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  throw new Error(`Postgres governance publication row is missing ${field}.`)
}

const requireHttpsUrlValue = (value: unknown, field: string): string => {
  const rawValue = requireStringValue(value, field).trim()
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

const requireHostnameValue = (value: unknown, field: string): string => {
  const hostname = normalizeHost(requireStringValue(value, field))
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

const requirePathPrefixValue = (value: unknown, field: string): string => {
  const pathPrefix = requireStringValue(value, field).trim()
  if (!pathPrefix.startsWith("/")) {
    throw new Error(`${field} must start with /.`)
  }
  return pathPrefix
}

const requireNumberField = (
  row: Record<string, unknown>,
  field: string,
): number => {
  const value = row[field]
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "bigint") {
    return Number(value)
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value)
  }

  throw new Error(`Postgres governance publication row is missing ${field}.`)
}

const requireStringArrayField = (
  row: Record<string, unknown>,
  field: string,
): ReadonlyArray<string> =>
  requireArrayField(row, field).map((value) => requireStringValue(value, field))

const requireTrustKeyArrayField = (
  row: Record<string, unknown>,
  field: string,
): ReadonlyArray<TrustKeyRecord> =>
  requireArrayField(row, field).map((value) => trustKeyRecordFromUnknown(value))

const trustKeyRecordFromUnknown = (value: unknown): TrustKeyRecord => {
  const row = objectValue(parseJson(value), "trust key")
  const delegatedAuthorityId = row.delegated_authority_id
  const publicKeyMaterialPem = row.public_key_material_pem

  return {
    key_id: requireStringValue(row.key_id, "key_id"),
    signer_id: requireStringValue(row.signer_id, "signer_id"),
    root_program_id: requireStringValue(row.root_program_id, "root_program_id"),
    algorithm_id: requireStringValue(row.algorithm_id, "algorithm_id"),
    scope: requireLiteralValue(row.scope, "scope", [
      "root_program",
      "delegated_authority",
    ]),
    status: requireLiteralValue(row.status, "status", [
      "active",
      "suspended",
      "revoked",
      "expired",
    ]),
    public_key_material_ref: requireStringValue(
      row.public_key_material_ref,
      "public_key_material_ref",
    ),
    ...(typeof delegatedAuthorityId === "string" && delegatedAuthorityId
      ? { delegated_authority_id: delegatedAuthorityId }
      : {}),
    ...(typeof publicKeyMaterialPem === "string" && publicKeyMaterialPem
      ? { public_key_material_pem: publicKeyMaterialPem }
      : {}),
  }
}

const requireObjectField = (
  row: Record<string, unknown>,
  field: string,
): Readonly<Record<string, unknown>> => objectValue(parseJson(row[field]), field)

const requireArrayField = (
  row: Record<string, unknown>,
  field: string,
): ReadonlyArray<unknown> => arrayValue(parseJson(row[field]), field)

const requireLiteralField = <T extends string>(
  row: Record<string, unknown>,
  field: string,
  allowed: ReadonlyArray<T>,
): T => {
  return requireLiteralValue(row[field], field, allowed)
}

const requireLiteralValue = <T extends string>(
  value: unknown,
  field: string,
  allowed: ReadonlyArray<T>,
): T => {
  if (allowed.includes(value as T)) {
    return value as T
  }

  throw new Error(`Postgres governance publication row has invalid ${field}.`)
}

const objectValue = (
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  throw new Error(`${field} must be an object.`)
}

const arrayValue = (value: unknown, field: string): ReadonlyArray<unknown> => {
  if (Array.isArray(value)) {
    return value
  }

  throw new Error(`${field} must be an array.`)
}

const booleanValue = (value: unknown, field: string): boolean => {
  if (typeof value === "boolean") {
    return value
  }

  throw new Error(`${field} must be a boolean.`)
}

const parseJson = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value
  }

  return JSON.parse(value) as unknown
}

const positiveIntegerOrDefault = (
  value: unknown,
  fallback: number,
  field: string,
): number => {
  if (value === undefined || value === null) {
    return fallback
  }
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0
  ) {
    return value
  }
  if (typeof value === "string" && /^\d+$/.test(value) && Number(value) > 0) {
    return Number(value)
  }

  throw new Error(`${field} must be a positive integer.`)
}

const requireNonNegativeIntegerValue = (
  value: unknown,
  field: string,
): number => {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
  ) {
    return value
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value)
  }

  throw new Error(`${field} must be a non-negative integer.`)
}

const normalizeHost = (value: string): string =>
  value.trim().replace(/\.$/, "").toLowerCase()

const uniqueStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values.filter((value) => value.length > 0))]

const artifactSlug = (value: string, prefix: string): string => {
  const unprefixed = value.startsWith(`${prefix}:`)
    ? value.slice(prefix.length + 1)
    : value

  return slug(unprefixed.replace(/:v\d+$/i, ""))
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
