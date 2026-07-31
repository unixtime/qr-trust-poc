import { Effect } from "effect"

import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  makePostgresVerifierCache,
  makePostgresVerifierCacheWriter,
  type PostgresQueryResultShape,
  type SqlCommand,
} from "../index.js"

type CacheRow = Record<string, unknown>

const commands: SqlCommand[] = []
const queries: Array<{
  readonly text: string
  readonly values?: ReadonlyArray<unknown>
}> = []
const rows = new Map<string, CacheRow>()
const durableAuthoritiesByRoot = new Map<string, Set<string>>()
const durableIssuersByAuthority = new Map<string, Set<string>>()

const executor = {
  execute: (command: SqlCommand) =>
    Effect.sync(() => {
      commands.push(command)
      applyCommand(command)
      return command
    }),
  recorded: () => [...commands],
  query: async (
    text: string,
    values?: ReadonlyArray<unknown>,
  ): Promise<PostgresQueryResultShape> => {
    queries.push(values ? { text, values } : { text })
    if (text.startsWith("update qr_trust.verifier_cache_entries")) {
      return updateRows(text, values ?? [])
    }
    if (text.startsWith("delete from qr_trust.verifier_cache_entries")) {
      return deleteRows(text, values ?? [])
    }
    if (text.startsWith("select")) {
      return {
        rows: [...rows.values()].filter(
          (row) => row.verifier_id === values?.[0],
        ),
      }
    }

    return { rows: [] }
  },
}

const writer = makePostgresVerifierCacheWriter(executor, {
  verifier_id: "verifier:writer-smoke",
  accepted_root_program_ids: [demoIssuerProjection.namespace.root_program_id],
})

let missingDestinationPolicyRemoved: boolean | undefined

await Effect.runPromise(
  Effect.gen(function* () {
    missingDestinationPolicyRemoved = yield* writer.removeDestinationPolicy({
      namespace: demoDestinationPolicyProjection.namespace,
      destination_policy_id: "policy:missing",
    })

    clearRows()
    yield* writer.upsertDestinationPolicy(demoDestinationPolicyProjection)
    const policyOnly = yield* resolveDemoDestination()

    yield* writer.upsertIssuer(demoIssuerProjection)
    const policyThenIssuerBeforeContext = yield* resolveDemoDestination()

    yield* writer.upsertRootAuthorityContext({
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      active_delegated_authority_ids: [
        demoIssuerProjection.namespace.delegated_authority_id,
      ],
    })
    yield* writer.upsertDelegatedAuthorityIssuerContext({
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
      active_issuer_ids: [demoIssuerProjection.namespace.issuer_id],
    })
    const policyThenIssuer = yield* resolveDemoDestination()

    clearRows()
    yield* writer.upsertIssuer(demoIssuerProjection)
    const issuerOnly = yield* resolveDemoDestination()

    yield* writer.upsertDestinationPolicy(demoDestinationPolicyProjection)
    const issuerThenPolicy = yield* resolveDemoDestination()
    const assuranceUpdated = yield* writer.updateIssuerAssuranceTier({
      namespace: demoIssuerProjection.namespace,
      assurance_tier: "domain_validated",
    })
    const afterAssuranceUpdate = yield* resolveDemoDestination()
    const unacceptedRootReader = makePostgresVerifierCache(executor, {
      verifier_id: "verifier:writer-smoke",
      accepted_root_program_ids: ["root:other:2026"],
    })
    const unacceptedRootResolution =
      yield* unacceptedRootReader.resolveByDestination(
        new URL("https://acme.example/pay"),
      )
    const delegatedAuthorityRemoved = yield* writer.removeDelegatedAuthority({
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
    })
    const afterDelegatedAuthorityRemoval = yield* resolveDemoDestination()

    clearRows()
    insertCacheRow({
      scanner_trust_projection: {
        authority_context: {
          root_manifest_authorizes_authority: true,
          delegated_authority_authorizes_issuer: true,
        },
        issuer: {
          display_name: demoIssuerProjection.issuer_display_name,
          assurance_tier: demoIssuerProjection.assurance_tier,
        },
        destination_policy: {
          destination_policy_id:
            demoDestinationPolicyProjection.destination_policy_id,
          approved_destinations: [
            {
              ...demoDestinationPolicyProjection.approved_destinations[0]!,
              expected_final_url: "http://acme.example/pay",
              allowed_hosts: ["acme.example"],
            },
          ],
          redirect_policy: demoDestinationPolicyProjection.redirect_policy,
        },
      },
    })
    const malformedCachedPolicy = yield* resolveDemoDestination()

    yield* writer.removeDestinationPolicy({
      namespace: demoDestinationPolicyProjection.namespace,
      destination_policy_id:
        demoDestinationPolicyProjection.destination_policy_id,
    })
    yield* writer.removeIssuer(demoIssuerProjection.namespace)

    assertSmoke(
      policyOnly === undefined,
      "destination-policy-only placeholder row resolved a destination",
    )
    assertSmoke(
      policyThenIssuerBeforeContext === undefined,
      "issuer plus destination-policy resolved before authority context was recorded",
    )
    assertSmoke(
      Boolean(policyThenIssuer),
      "destination-policy then issuer did not resolve after authority context",
    )
    assertSmoke(
      issuerOnly === undefined,
      "issuer-only empty destination-policy placeholder resolved a destination",
    )
    assertSmoke(
      Boolean(issuerThenPolicy),
      "issuer then destination-policy did not resolve",
    )
    assertSmoke(
      assuranceUpdated === true &&
        afterAssuranceUpdate?.issuer.assurance_tier === "domain_validated" &&
        afterAssuranceUpdate.binding_status === "bound",
      "assurance-tier update should preserve destination binding",
    )
    assertSmoke(
      unacceptedRootResolution === undefined,
      "Postgres cache resolved a row whose root was not accepted",
    )
    assertSmoke(
      delegatedAuthorityRemoved === true &&
        afterDelegatedAuthorityRemoval === undefined,
      "delegated authority removal did not clear authority-scoped cache rows",
    )
    assertSmoke(
      malformedCachedPolicy === undefined,
      "malformed cached destination policy should not resolve scanner trust",
    )
  }),
).catch((cause: unknown) => {
  console.error(cause)
  process.exitCode = 1
})

if (process.exitCode === undefined) {
  assertSmoke(
    commands.some(
      (command) =>
        command.name === "verifier_cache_entries.upsert_destination_policy" &&
        command.text.includes("insert into qr_trust.verifier_cache_entries"),
    ),
    "destination-policy projection did not record an upsert command",
  )
  assertSmoke(
    commands.some(
      (command) =>
        command.name === "verifier_cache_entries.upsert_issuer_projection" &&
        command.text.includes("insert into qr_trust.verifier_cache_entries"),
    ),
    "issuer-first projection did not record an upsert command",
  )
  const issuerUpsert = commands.find(
    (command) =>
      command.name === "verifier_cache_entries.upsert_issuer_projection",
  )
  const policyUpsert = commands.find(
    (command) =>
      command.name === "verifier_cache_entries.upsert_destination_policy",
  )
  assertSmoke(
    Boolean(issuerUpsert?.text.includes("on conflict")),
    "issuer-first upsert should be order-independent",
  )
  assertSmoke(
    placeholderPolicyIsSafe(issuerUpsert),
    "issuer-first upsert did not include a safe placeholder policy projection",
  )
  assertSmoke(
    fallbackIssuerIsPlaceholder(policyUpsert),
    "destination-policy-only upsert did not mark fallback issuer as placeholder",
  )
  assertSmoke(
    usesConservativeFreshnessMerge(policyUpsert),
    "destination-policy upsert did not preserve conservative freshness bounds",
  )
  assertSmoke(
    usesConservativeFreshnessMerge(issuerUpsert),
    "issuer upsert did not preserve conservative freshness bounds",
  )
  assertSmoke(
    Boolean(
      issuerUpsert?.text.includes("qr_trust.published_artifacts") &&
        policyUpsert?.text.includes("qr_trust.published_artifacts"),
    ),
    "issuer and destination-policy upserts should derive authority context from durable artifacts",
  )
  assertSmoke(
    queries.some(
      (query) =>
        query.text.includes("'{issuer,assurance_tier}'") &&
        query.text.includes("returning 1"),
    ),
    "issuer assurance-tier update did not record an update query",
  )
  assertSmoke(
    queries.some(
      (query) =>
        query.text.includes("delete from qr_trust.verifier_cache_entries") &&
        query.text.includes("destination_policy_id = $5") &&
        query.text.includes("returning 1"),
    ),
    "destination-policy removal did not record a delete query",
  )
  assertSmoke(
    missingDestinationPolicyRemoved === false,
    "missing destination-policy removal should return false",
  )
  assertSmoke(
    queries.some(
      (query) =>
        query.text.includes("delete from qr_trust.verifier_cache_entries") &&
        query.text.includes("issuer_id = $4") &&
        query.text.includes("returning 1"),
    ),
    "issuer removal did not record a delete query",
  )
  assertSmoke(
    queries.some(
      (query) =>
        query.text.includes("delete from qr_trust.verifier_cache_entries") &&
        query.text.includes("delegated_authority_id = $3") &&
        query.text.includes("returning 1"),
    ),
    "delegated authority removal did not record a delete query",
  )
  assertSmoke(
    commands.some(
      (command) =>
        command.name === "verifier_cache_entries.upsert_root_authority_context",
    ),
    "root authority context upsert command was not recorded",
  )
  assertSmoke(
    commands.some(
      (command) =>
        command.name ===
        "verifier_cache_entries.upsert_delegated_authority_issuer_context",
    ),
    "delegated authority issuer context upsert command was not recorded",
  )

  console.log(
    JSON.stringify(
      {
        postgres_verifier_cache_writer_smoke: "passed",
        commands: [...new Set(commands.map((command) => command.name))],
        delete_queries: queries.filter((query) =>
          query.text.startsWith("delete from qr_trust.verifier_cache_entries"),
        ).length,
        resolution_cases: {
          destination_policy_only: "miss",
          destination_policy_then_issuer_before_context: "miss",
          destination_policy_then_issuer_after_context: "resolved",
          issuer_only: "miss",
          issuer_then_destination_policy: "resolved",
          after_assurance_tier_update: "resolved",
          unaccepted_root_after_context: "miss",
          after_delegated_authority_removal: "miss",
        },
      },
      null,
      2,
    ),
  )
}

function resolveDemoDestination() {
  return writer.resolveByDestination(new URL("https://acme.example/pay"))
}

function clearRows(): void {
  rows.clear()
}

function insertCacheRow(overrides: Partial<CacheRow>): void {
  const values = [
    "verifier:writer-smoke",
    demoIssuerProjection.namespace.root_program_id,
    demoIssuerProjection.namespace.delegated_authority_id,
    demoIssuerProjection.namespace.issuer_id,
    demoDestinationPolicyProjection.destination_policy_id,
  ]
  rows.set(rowKey(values), {
    verifier_id: values[0],
    root_program_id: values[1],
    delegated_authority_id: values[2],
    issuer_id: values[3],
    destination_policy_id: values[4],
    source_artifact_hashes: [],
    scanner_trust_projection: {},
    cache_generated_at: "2026-05-25T00:00:00Z",
    cache_expires_at: "2026-12-31T23:59:59Z",
    freshness_status: "fresh",
    created_at: "2026-05-25T00:00:00Z",
    ...overrides,
  })
}

function applyCommand(command: SqlCommand): void {
  if (
    command.name !== "verifier_cache_entries.upsert_issuer_projection" &&
    command.name !== "verifier_cache_entries.upsert_destination_policy" &&
    command.name !== "verifier_cache_entries.upsert_root_authority_context" &&
    command.name !==
      "verifier_cache_entries.upsert_delegated_authority_issuer_context"
  ) {
    return
  }
  if (command.name === "verifier_cache_entries.upsert_root_authority_context") {
    applyRootAuthorityContext(command)
    return
  }
  if (
    command.name ===
    "verifier_cache_entries.upsert_delegated_authority_issuer_context"
  ) {
    applyDelegatedAuthorityIssuerContext(command)
    return
  }

  const key = rowKey(command.values)
  const existing = rows.get(key)
  const incoming = JSON.parse(String(command.values[5])) as Record<string, unknown>
  const existingProjection = existing?.scanner_trust_projection as
    | Record<string, unknown>
    | undefined
  const authorityContext = durableAuthorityContext(command.values)
  const scannerTrustProjection =
    command.name === "verifier_cache_entries.upsert_issuer_projection"
      ? {
          ...(authorityContext ? { authority_context: authorityContext } : {}),
          destination_policy:
            existingProjection?.destination_policy ??
            incoming.destination_policy,
          issuer: incoming.issuer,
        }
      : {
          ...(authorityContext ? { authority_context: authorityContext } : {}),
          issuer: existingProjection?.issuer ?? incoming.issuer,
          destination_policy: incoming.destination_policy,
        }

  rows.set(key, {
    verifier_id: command.values[0],
    root_program_id: command.values[1],
    delegated_authority_id: command.values[2],
    issuer_id: command.values[3],
    destination_policy_id: command.values[4],
    source_artifact_hashes: [],
    scanner_trust_projection: scannerTrustProjection,
    cache_generated_at: command.values[6],
    cache_expires_at: command.values[7],
    freshness_status: "fresh",
    created_at: "2026-05-25T00:00:00Z",
  })
}

function deleteRows(
  text: string,
  values: ReadonlyArray<unknown>,
): PostgresQueryResultShape {
  const before = rows.size
  if (text.includes("destination_policy_id = $5")) {
    rows.delete(rowKey(values))
  } else {
    const prefix = values.slice(0, 4).join("\u001f")
    for (const key of rows.keys()) {
      if (key.startsWith(prefix)) {
        rows.delete(key)
      }
    }
  }

  return rows.size < before ? { rows: [{ deleted: 1 }] } : { rows: [] }
}

function updateRows(
  text: string,
  values: ReadonlyArray<unknown>,
): PostgresQueryResultShape {
  if (!text.includes("'{issuer,assurance_tier}'")) {
    return { rows: [] }
  }

  let updatedRows = 0
  const prefix = values.slice(0, 4).join("\u001f")
  for (const [key, row] of rows.entries()) {
    if (!key.startsWith(prefix)) {
      continue
    }

    const projection = row.scanner_trust_projection as Record<string, unknown>
    const issuer =
      projection.issuer &&
      typeof projection.issuer === "object" &&
      !Array.isArray(projection.issuer)
        ? (projection.issuer as Record<string, unknown>)
        : undefined
    if (
      !issuer ||
      issuer.placeholder === true ||
      issuer.projection_kind === "placeholder"
    ) {
      continue
    }

    row.scanner_trust_projection = {
      ...projection,
      issuer: {
        ...issuer,
        assurance_tier: values[4],
      },
    }
    updatedRows += 1
  }

  return {
    rows: Array.from({ length: updatedRows }, () => ({ updated: 1 })),
  }
}

function applyRootAuthorityContext(command: SqlCommand): void {
  const activeAuthorities = new Set(command.values[2] as ReadonlyArray<string>)
  durableAuthoritiesByRoot.set(String(command.values[1]), activeAuthorities)
  for (const row of rows.values()) {
    if (
      row.verifier_id !== command.values[0] ||
      row.root_program_id !== command.values[1]
    ) {
      continue
    }

    mergeAuthorityContext(row, {
      root_manifest_authorizes_authority: activeAuthorities.has(
        String(row.delegated_authority_id),
      ),
    })
  }
}

function applyDelegatedAuthorityIssuerContext(command: SqlCommand): void {
  const activeIssuers = new Set(command.values[3] as ReadonlyArray<string>)
  durableIssuersByAuthority.set(
    authorityKey(String(command.values[1]), String(command.values[2])),
    activeIssuers,
  )
  for (const row of rows.values()) {
    if (
      row.verifier_id !== command.values[0] ||
      row.root_program_id !== command.values[1] ||
      row.delegated_authority_id !== command.values[2]
    ) {
      continue
    }

    mergeAuthorityContext(row, {
      delegated_authority_authorizes_issuer: activeIssuers.has(
        String(row.issuer_id),
      ),
    })
  }
}

function durableAuthorityContext(
  values: ReadonlyArray<unknown>,
): Record<string, boolean> {
  const rootProgramId = String(values[1])
  const delegatedAuthorityId = String(values[2])
  const issuerId = String(values[3])

  return {
    root_manifest_authorizes_authority:
      durableAuthoritiesByRoot
        .get(rootProgramId)
        ?.has(delegatedAuthorityId) === true,
    delegated_authority_authorizes_issuer:
      durableIssuersByAuthority
        .get(authorityKey(rootProgramId, delegatedAuthorityId))
        ?.has(issuerId) === true,
  }
}

function authorityKey(
  rootProgramId: string,
  delegatedAuthorityId: string,
): string {
  return [rootProgramId, delegatedAuthorityId].join("\u001f")
}

function mergeAuthorityContext(
  row: CacheRow,
  patch: Record<string, boolean>,
): void {
  const projection = row.scanner_trust_projection as Record<string, unknown>
  const existing =
    projection.authority_context &&
    typeof projection.authority_context === "object" &&
    !Array.isArray(projection.authority_context)
      ? (projection.authority_context as Record<string, unknown>)
      : {}

  row.scanner_trust_projection = {
    ...projection,
    authority_context: {
      ...existing,
      ...patch,
    },
  }
}

function rowKey(values: ReadonlyArray<unknown>): string {
  return values.slice(0, 5).join("\u001f")
}

function assertSmoke(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Postgres verifier-cache writer smoke failed: ${message}`)
  }
}

function placeholderPolicyIsSafe(command: SqlCommand | undefined): boolean {
  const projection = projectionFromCommand(command)

  return (
    Array.isArray(projection.destination_policy?.approved_destinations) &&
    projection.destination_policy.approved_destinations.length === 0 &&
    Array.isArray(projection.destination_policy.redirect_policy?.resolver_urls) &&
    projection.destination_policy.redirect_policy.resolver_urls.length === 0 &&
    Array.isArray(
      projection.destination_policy.redirect_policy?.expected_final_destinations,
    ) &&
    projection.destination_policy.redirect_policy.expected_final_destinations
      .length === 0 &&
    Array.isArray(
      projection.destination_policy.redirect_policy?.allowed_redirect_hosts,
    ) &&
    projection.destination_policy.redirect_policy.allowed_redirect_hosts.length ===
      0
  )
}

function fallbackIssuerIsPlaceholder(command: SqlCommand | undefined): boolean {
  const projection = projectionFromCommand(command)

  return (
    projection.issuer?.placeholder === true ||
    projection.issuer?.projection_kind === "placeholder"
  )
}

function usesConservativeFreshnessMerge(command: SqlCommand | undefined): boolean {
  return (
    command?.text.includes("cache_generated_at = greatest(") === true &&
    command.text.includes("cache_expires_at = least(")
  )
}

function projectionFromCommand(command: SqlCommand | undefined): {
  readonly issuer?: {
    readonly placeholder?: boolean
    readonly projection_kind?: string
  }
  readonly destination_policy?: {
    readonly approved_destinations?: ReadonlyArray<unknown>
    readonly redirect_policy?: {
      readonly resolver_urls?: ReadonlyArray<unknown>
      readonly expected_final_destinations?: ReadonlyArray<unknown>
      readonly allowed_redirect_hosts?: ReadonlyArray<unknown>
    }
  }
} {
  const projectionJson = command?.values[5]
  if (typeof projectionJson !== "string") {
    return {}
  }

  return JSON.parse(projectionJson) as ReturnType<typeof projectionFromCommand>
}
