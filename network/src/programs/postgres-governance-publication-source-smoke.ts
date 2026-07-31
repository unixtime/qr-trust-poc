import { Console, Effect } from "effect"

import {
  decodePostgresGovernancePublicationRows,
  demoDelegatedAuthorityTrustKey,
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  demoRootTrustKey,
  makeArtifactPublicationService,
  makeAuthorityPublicationService,
  makeFixtureSignatureVerifier,
  makeInMemoryArtifactStore,
  makeInMemoryEventBus,
  makePostgresGovernancePublicationSource,
  makeRecordingPostgresGovernancePublicationSourceExecutor,
  makeVerifierSyncService,
  natsGovernanceSyncReportAcceptance,
  type ArtifactPublicationInput,
  type NetworkEvent,
} from "../index.js"
import { postgresGovernancePublicationFixtureRow } from "./postgres-governance-fixture.js"

const observedAt = new Date("2026-05-20T12:00:00Z")

const expectedArtifactTypes = [
  "root_manifest",
  "delegated_authority_manifest",
  "issuer_record",
  "destination_policy",
] as const

const program = Effect.gen(function* () {
  const rawInactiveFixtureRow = {
    ...postgresGovernancePublicationFixtureRow(),
    issuer_status_event_ref: "status:acme-demo:suspended:v1",
    issuer_status_event_status: "suspended" as const,
    issuer_status_event_published_at: observedAt,
  }
  const decodedInactiveRows = yield* decodePostgresGovernancePublicationRows([
    rawInactiveFixtureRow,
  ])
  const inactiveFixtureRow = decodedInactiveRows[0]
  if (!inactiveFixtureRow) {
    throw new Error("Postgres source fixture row should decode")
  }
  yield* assertSmoke(
    inactiveFixtureRow.issuer_status_event_status === "suspended" &&
      inactiveFixtureRow.issuer_status_event_published_at ===
        observedAt.toISOString(),
    "Postgres source did not decode issuer status event fields",
  )

  const inactiveExecutor =
    makeRecordingPostgresGovernancePublicationSourceExecutor([
      inactiveFixtureRow,
    ])
  const inactiveSource = makePostgresGovernancePublicationSource(
    inactiveExecutor,
  )
  const inactivePlanResult = yield* Effect.either(
    inactiveSource.planGovernancePublication({
      namespace: demoIssuerProjection.namespace,
      destination_policy_id: demoIssuerProjection.destination_policy_id,
      observedAt,
    }),
  )
  yield* assertSmoke(
    inactivePlanResult._tag === "Left",
    "Postgres source must not plan a normal bundle for inactive issuer status",
  )

  const [badRedirectPolicyRow] = yield* decodePostgresGovernancePublicationRows(
    [
      {
        ...postgresGovernancePublicationFixtureRow(),
        destination_policy_redirect_policy: {
          ...demoDestinationPolicyProjection.redirect_policy,
          max_redirect_hops: -1,
        },
      },
    ],
  )
  if (!badRedirectPolicyRow) {
    throw new Error("Postgres source bad redirect policy row should decode")
  }
  const badRedirectPolicySource = makePostgresGovernancePublicationSource(
    makeRecordingPostgresGovernancePublicationSourceExecutor([
      badRedirectPolicyRow,
    ]),
  )
  const badRedirectPolicyPlan = yield* Effect.either(
    badRedirectPolicySource.planGovernancePublication({
      namespace: demoIssuerProjection.namespace,
      destination_policy_id: demoIssuerProjection.destination_policy_id,
      observedAt,
    }),
  )
  yield* assertSmoke(
    badRedirectPolicyPlan._tag === "Left",
    "Postgres source must reject invalid redirect hop limits instead of defaulting them",
  )

  const badRuntimeTtlFixtureRow = postgresGovernancePublicationFixtureRow()
  const [badRuntimeTtlRow] = yield* decodePostgresGovernancePublicationRows([
    {
      ...badRuntimeTtlFixtureRow,
      destination_policy_runtime_safety_policy: {
        ...badRuntimeTtlFixtureRow.destination_policy_runtime_safety_policy,
        publication_ttl_seconds: -1,
      },
    },
  ])
  if (!badRuntimeTtlRow) {
    throw new Error("Postgres source bad runtime TTL row should decode")
  }
  const badRuntimeTtlSource = makePostgresGovernancePublicationSource(
    makeRecordingPostgresGovernancePublicationSourceExecutor([badRuntimeTtlRow]),
  )
  const badRuntimeTtlPlan = yield* Effect.either(
    badRuntimeTtlSource.planGovernancePublication({
      namespace: demoIssuerProjection.namespace,
      destination_policy_id: demoIssuerProjection.destination_policy_id,
      observedAt,
    }),
  )
  yield* assertSmoke(
    badRuntimeTtlPlan._tag === "Left",
    "Postgres source must reject invalid runtime publication TTL instead of defaulting it",
  )

  const badDestinationUrlFixtureRow = postgresGovernancePublicationFixtureRow()
  const [badDestinationUrlRow] = yield* decodePostgresGovernancePublicationRows([
    {
      ...badDestinationUrlFixtureRow,
      destination_policy_approved_destinations:
        badDestinationUrlFixtureRow.destination_policy_approved_destinations.map(
          (destination, index) =>
            index === 0 && typeof destination === "object" && destination
              ? {
                  ...destination,
                  expected_final_url: "http://acme.example/pay",
                }
              : destination,
        ),
    },
  ])
  if (!badDestinationUrlRow) {
    throw new Error("Postgres source bad destination URL row should decode")
  }
  const badDestinationUrlPlan = yield* Effect.either(
    makePostgresGovernancePublicationSource(
      makeRecordingPostgresGovernancePublicationSourceExecutor([
        badDestinationUrlRow,
      ]),
    ).planGovernancePublication({
      namespace: demoIssuerProjection.namespace,
      destination_policy_id: demoIssuerProjection.destination_policy_id,
      observedAt,
    }),
  )
  yield* assertSmoke(
    badDestinationUrlPlan._tag === "Left",
    "Postgres source must reject non-HTTPS approved destination URLs",
  )

  const badAllowedHostFixtureRow = postgresGovernancePublicationFixtureRow()
  const [badAllowedHostRow] = yield* decodePostgresGovernancePublicationRows([
    {
      ...badAllowedHostFixtureRow,
      destination_policy_approved_destinations:
        badAllowedHostFixtureRow.destination_policy_approved_destinations.map(
          (destination, index) =>
            index === 0 && typeof destination === "object" && destination
              ? {
                  ...destination,
                  allowed_hosts: ["acme.example/pay"],
                }
              : destination,
        ),
    },
  ])
  if (!badAllowedHostRow) {
    throw new Error("Postgres source bad allowed host row should decode")
  }
  const badAllowedHostPlan = yield* Effect.either(
    makePostgresGovernancePublicationSource(
      makeRecordingPostgresGovernancePublicationSourceExecutor([
        badAllowedHostRow,
      ]),
    ).planGovernancePublication({
      namespace: demoIssuerProjection.namespace,
      destination_policy_id: demoIssuerProjection.destination_policy_id,
      observedAt,
    }),
  )
  yield* assertSmoke(
    badAllowedHostPlan._tag === "Left",
    "Postgres source must reject approved destination allowed_hosts that are not hostnames",
  )

  const customRootTrustKey = {
    ...demoRootTrustKey,
    key_id: "key:root:postgres-row:ed25519:v1",
  }
  const customAuthorityTrustKey = {
    ...demoDelegatedAuthorityTrustKey,
    key_id: "key:authority:postgres-row:ed25519:v1",
  }
  const [fixtureRow] = yield* decodePostgresGovernancePublicationRows([
    {
      ...postgresGovernancePublicationFixtureRow(),
      root_trust_keys: [customRootTrustKey],
      delegated_authority_trust_keys: [customAuthorityTrustKey],
    },
  ])
  if (!fixtureRow) {
    throw new Error("Postgres source active fixture row should decode")
  }
  const executor = makeRecordingPostgresGovernancePublicationSourceExecutor([
    fixtureRow,
  ])
  const source = makePostgresGovernancePublicationSource(executor)
  const plan = yield* source.planGovernancePublication({
    namespace: demoIssuerProjection.namespace,
    destination_policy_id: demoIssuerProjection.destination_policy_id,
    observedAt,
  })
  const artifacts = plan.artifacts
  const [rootManifest, delegatedAuthority, issuerRecord, destinationPolicy] =
    artifacts

  yield* assertSmoke(
    artifacts.length === expectedArtifactTypes.length,
    "Postgres source should plan the four governance artifacts",
  )
  artifacts.forEach((artifact, index) => {
    if (artifact.artifact_type !== expectedArtifactTypes[index]) {
      throw new Error(
        `expected artifact ${index} to be ${expectedArtifactTypes[index]}, got ${artifact.artifact_type}`,
      )
    }

    if (artifact.occurredAt !== observedAt) {
      throw new Error(`expected artifact ${index} to reuse observedAt`)
    }
  })

  yield* assertSmoke(
    executor.recorded()[0]?.name ===
      "governance_publication.bundle_by_issuer_policy",
    "Postgres source did not query the active governance publication bundle",
  )
  yield* assertSmoke(
    rootManifest.root_program_id ===
      demoIssuerProjection.namespace.root_program_id,
    "root manifest is not scoped to the demo root program",
  )
  yield* assertSmoke(
    rootManifest.artifact_id === "art_root_qrtrust_demo_2026_v1",
    "root artifact id should match the reference naming convention",
  )
  yield* assertSmoke(
    delegatedAuthority.delegated_authority_id ===
      demoIssuerProjection.namespace.delegated_authority_id,
    "delegated authority artifact is not scoped to the demo authority",
  )
  yield* assertSmoke(
    delegatedAuthority.artifact_id ===
      "art_authority_qrtrust_demo_merchant_web_v1",
    "delegated authority artifact id should match the reference naming convention",
  )
  yield* assertSmoke(
    issuerRecord.issuer_id === demoIssuerProjection.namespace.issuer_id,
    "issuer record artifact is not scoped to the demo issuer",
  )
  yield* assertSmoke(
    issuerRecord.artifact_id === "art_issuer_acme_demo_v1",
    "issuer artifact id should match the reference naming convention",
  )
  yield* assertSmoke(
    destinationPolicy.destination_policy_id ===
      demoDestinationPolicyProjection.destination_policy_id,
    "destination policy artifact does not match the fixture policy",
  )
  yield* assertSmoke(
    destinationPolicy.artifact_id === "art_policy_acme_demo_web_payments_v1",
    "destination policy artifact id should match the reference naming convention",
  )

  const issuerBody = objectBody(issuerRecord, "issuer record")
  const issuerNamespace = objectValue(
    issuerBody.issuer_namespace,
    "issuer namespace",
  )
  const issuerStatus = objectValue(issuerBody.status, "issuer status")
  const certificateRefs = arrayValue(
    issuerBody.certificate_refs,
    "issuer certificate refs",
  )
  const destinationPolicyBody = objectBody(
    destinationPolicy,
    "destination policy",
  )
  const rootBody = objectBody(rootManifest, "root manifest")
  const delegatedAuthorityBody = objectBody(
    delegatedAuthority,
    "delegated authority",
  )
  const runtimeSafetyPolicy = objectValue(
    destinationPolicyBody.runtime_safety_policy,
    "runtime safety policy",
  )
  const publication = objectValue(
    destinationPolicyBody.publication,
    "publication metadata",
  )

  yield* assertSmoke(
    issuerNamespace.issuer_id === demoIssuerProjection.namespace.issuer_id,
    "issuer body namespace does not match the queried issuer",
  )
  yield* assertSmoke(
    certificateRefs.includes("cert:acme-demo:web-signing:v1"),
    "issuer body did not preserve active certificate refs from Postgres",
  )
  yield* assertSmoke(
    arrayValue(rootBody.trust_keys, "root trust keys").length > 0,
    "root manifest should include trust keys for verifier signature lookup",
  )
  yield* assertSmoke(
    arrayValue(rootBody.trust_keys, "root trust keys").some(
      (entry) =>
        objectValue(entry, "root trust key").key_id ===
        customRootTrustKey.key_id,
    ),
    "root manifest should use the root trust keys read from the Postgres row",
  )
  yield* assertSmoke(
    arrayValue(delegatedAuthorityBody.trust_keys, "authority trust keys")
      .length > 0,
    "delegated authority manifest should include trust keys for verifier signature lookup",
  )
  yield* assertSmoke(
    arrayValue(
      delegatedAuthorityBody.trust_keys,
      "authority trust keys",
    ).some(
      (entry) =>
        objectValue(entry, "authority trust key").key_id ===
        customAuthorityTrustKey.key_id,
    ),
    "delegated authority manifest should use the authority trust keys read from the Postgres row",
  )
  yield* assertSmoke(
    arrayValue(delegatedAuthorityBody.scope, "authority scope").includes(
      "merchant-web",
    ),
    "delegated authority scope should be verifier-recognizable",
  )
  yield* assertSmoke(
    issuerStatus.certificate_status === "active" &&
      issuerStatus.issuer_status === "active" &&
      issuerStatus.status_event_ref === "status:acme-demo:active:v1",
    "issuer body did not expose materializable certificate status metadata",
  )
  const recordedCommand = executor.recorded()[0]
  yield* assertSmoke(
    Boolean(
      recordedCommand?.text.includes("left join lateral") &&
        recordedCommand.text.includes("qr_trust.status_events"),
    ),
    "Postgres source SQL did not look up issuer status events",
  )
  yield* assertSmoke(
    destinationPolicyBody.usage_policy === "reusable_public",
    "destination policy usage policy was not preserved from Postgres",
  )
  yield* assertSmoke(
    runtimeSafetyPolicy.provider === "deterministic-fixture",
    "runtime safety publication policy was not preserved from Postgres",
  )
  yield* assertSmoke(
    publication.signature_status === "pending_publication_signature",
    "source plan should leave signature custody pending",
  )

  const artifactStore = makeInMemoryArtifactStore()
  const eventBus = makeInMemoryEventBus()
  const artifactPublisher = makeArtifactPublicationService(
    artifactStore,
    eventBus,
  )
  const publicationExecutor =
    makeRecordingPostgresGovernancePublicationSourceExecutor([fixtureRow])
  const authorityPublisher = makeAuthorityPublicationService(
    makePostgresGovernancePublicationSource(publicationExecutor),
    artifactPublisher,
  )
  const publicationReport = yield* authorityPublisher.publishGovernanceBundle({
    namespace: demoIssuerProjection.namespace,
    destination_policy_id: demoIssuerProjection.destination_policy_id,
    observedAt,
  })
  const publishedEvents = yield* eventBus.recent()
  const rootEvent = requireEvent(
    publishedEvents,
    "root.manifest.published",
  )
  const delegatedAuthorityEvent = requireEvent(
    publishedEvents,
    "delegated_authority.manifest.published",
  )
  const signedRoot = yield* artifactStore.get(
    publicationReport.root_manifest_artifact_id,
  )
  const signedAuthority = yield* artifactStore.get(
    publicationReport.delegated_authority_artifact_id,
  )
  const signedRootBody = objectValue(signedRoot?.body, "signed root body")
  const signedAuthorityBody = objectValue(
    signedAuthority?.body,
    "signed authority body",
  )

  yield* assertSmoke(
    signedRootBody.signature_status === "ed25519-signed" &&
      signedAuthorityBody.signature_status === "ed25519-signed",
    "published root and delegated authority artifacts should be signed",
  )
  yield* assertSmoke(
    objectValue(signedRootBody.publication, "signed root publication")
      .signature_status === signedRootBody.signature_status &&
      objectValue(signedAuthorityBody.publication, "signed authority publication")
        .signature_status === signedAuthorityBody.signature_status,
    "published root and delegated authority publication metadata should match top-level signature status",
  )

  const rootReport = yield* makeVerifierSyncService(
    artifactStore,
    singleEventBus(rootEvent),
    undefined,
    makeFixtureSignatureVerifier(),
  ).syncRecent()
  const authorityReport = yield* makeVerifierSyncService(
    artifactStore,
    singleEventBus(delegatedAuthorityEvent),
    undefined,
    makeFixtureSignatureVerifier(),
  ).syncRecent()
  const rootAcceptance = natsGovernanceSyncReportAcceptance(
    rootEvent,
    rootReport,
  )
  const authorityAcceptance = natsGovernanceSyncReportAcceptance(
    delegatedAuthorityEvent,
    authorityReport,
  )

  yield* assertSmoke(
    rootReport.validated_trust_artifacts === 1 &&
      rootAcceptance.accepted,
    "published Postgres root manifest should pass verifier sync and subscriber gate",
  )
  yield* assertSmoke(
    authorityReport.validated_trust_artifacts === 1 &&
      authorityAcceptance.accepted,
    "published Postgres delegated authority manifest should pass verifier sync and subscriber gate",
  )

  yield* Console.log(
    JSON.stringify(
      {
        postgres_governance_publication_source_smoke: "passed",
        command_names: executor.recorded().map((command) => command.name),
        planned_artifacts: artifacts.map((artifact) => ({
          artifact_id: artifact.artifact_id,
          artifact_type: artifact.artifact_type,
          event_type: artifact.eventType,
        })),
        subscriber_acceptance: {
          root_manifest: rootAcceptance.reason,
          delegated_authority_manifest: authorityAcceptance.reason,
        },
      },
      null,
      2,
    ),
  )
})

const objectBody = (
  artifact: ArtifactPublicationInput,
  label: string,
): Record<string, unknown> => objectValue(artifact.body, label)

const objectValue = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} should be an object`)
  }

  return value as Record<string, unknown>
}

const arrayValue = (value: unknown, label: string): ReadonlyArray<unknown> => {
  if (!Array.isArray(value)) {
    throw new Error(`${label} should be an array`)
  }

  return value
}

const requireEvent = (
  events: ReadonlyArray<NetworkEvent>,
  eventType: string,
): NetworkEvent => {
  const event = events.find((candidate) => candidate.envelope.type === eventType)
  if (!event) {
    throw new Error(`expected published event ${eventType}`)
  }

  return event
}

const singleEventBus = (event: NetworkEvent) => ({
  publish: () => Effect.void,
  recent: () => Effect.succeed([event]),
})

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(
        `Postgres governance publication source smoke failed: ${message}`,
      )
    }
  })

Effect.runPromise(program)
