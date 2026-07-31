import { Console, Effect } from "effect"

import {
  EventBus,
  InMemoryEventBusLive,
  makeArtifactPublicationService,
  makeFixtureTrustArtifactSigner,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryVerifierCache,
  makePostgresPersistenceService,
  makeRecordingPostgresStatementSink,
  makeScannerDecisionService,
  makeVerifierCacheMaterializationService,
  type NetworkError,
} from "../index.js"
import type { SignedArtifact } from "../services/artifact-store.js"
import { demoIssuerProjection } from "../services/verifier-cache.js"

const observedAt = new Date("2026-05-17T00:00:00Z")

const program = Effect.gen(function* () {
  const eventBus = yield* EventBus
  const artifactStore = makeInMemoryArtifactStore()
  const publisher = makeArtifactPublicationService(artifactStore, eventBus)
  const governancePublisher = makeGovernancePublicationService(publisher)
  const materializer = makeVerifierCacheMaterializationService()
  const signer = makeFixtureTrustArtifactSigner()
  const sink = makeRecordingPostgresStatementSink()
  const persistence = makePostgresPersistenceService(sink)

  const publishedGovernance = yield* governancePublisher.publishReferenceBundle(
    observedAt,
  )
  const publishedIssuerStatus = yield* publisher.publishArtifact({
    artifact_type: "revocation_status_event",
    artifact_id: "art_status_acme_demo_active_v1",
    version: 1,
    root_program_id: demoIssuerProjection.namespace.root_program_id,
    delegated_authority_id:
      demoIssuerProjection.namespace.delegated_authority_id,
    issuer_id: demoIssuerProjection.namespace.issuer_id,
    body: (yield* signer.signTrustArtifact({
      body: {
        artifact_type: "revocation_status_event",
        schema_version: "0.1.0",
        status_event_id: "status:acme-demo:active:v1",
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        delegated_authority_id:
          demoIssuerProjection.namespace.delegated_authority_id,
        target: {
          target_type: "issuer_record",
          issuer_id: demoIssuerProjection.namespace.issuer_id,
          certificate_ref: "cert:acme-demo:web-signing:v1",
        },
        status: "active",
        reason: "active status event proves verifier-cache materialization",
        effective_at: observedAt.toISOString(),
        expires_at: demoIssuerProjection.cache_expires_at,
        signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      },
      signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
    })).body,
    occurredAt: observedAt,
    eventType: "issuer.status.changed",
    reason: "signed active status for verifier-cache materialization smoke",
  })

  const [
    rootManifest,
    delegatedAuthorityManifest,
    issuerRecord,
    destinationPolicy,
    statusEvent,
  ] = yield* fetchArtifacts(
    [
      publishedGovernance.root_manifest_artifact_id,
      publishedGovernance.delegated_authority_artifact_id,
      publishedGovernance.issuer_record_artifact_id,
      publishedGovernance.destination_policy_artifact_id,
      publishedIssuerStatus.artifact.artifact_id,
    ],
    artifactStore.get,
  )

  const materialized = yield* materializer.materialize({
    root_manifest: rootManifest,
    delegated_authority_manifest: delegatedAuthorityManifest,
    issuer_record: issuerRecord,
    destination_policy: destinationPolicy,
    status_event: statusEvent,
    materialized_at: observedAt,
  })
  const malformedMaterialization = yield* Effect.either(
    materializer.materialize({
      root_manifest: rootManifest,
      delegated_authority_manifest: delegatedAuthorityManifest,
      issuer_record: issuerRecord,
      destination_policy: malformedDestinationPolicyArtifact(destinationPolicy),
      status_event: statusEvent,
      materialized_at: observedAt,
    }),
  )

  const cache = makeInMemoryVerifierCache(
    [materialized.issuer_projection],
    [materialized.destination_policy_projection],
  )
  const scanner = makeScannerDecisionService(cache, eventBus)
  const green = yield* scanner.decide({
    payload: "https://acme.example/pay",
    observedAt,
  })

  const events = yield* eventBus.recent()
  const persistenceReport = yield* persistence.persistBatch({
    artifacts: [
      rootManifest,
      delegatedAuthorityManifest,
      issuerRecord,
      destinationPolicy,
      statusEvent,
    ],
    events,
    verifier_cache_entries: [
      {
        verifier_id: "verifier:local-demo",
        issuer: materialized.issuer_projection,
        policy: materialized.destination_policy_projection,
        source_artifact_hashes: materialized.source_artifact_hashes,
        freshness_status: "fresh",
      },
    ],
    scanner_decisions: [
      {
        verifier_id: "verifier:local-demo",
        decision: green,
      },
    ],
  })

  const cacheCommand = sink
    .recorded()
    .find((command) => command.name === "verifier_cache_entries.upsert")

  yield* assertSmoke(
    materialized.cache_entry.artifact_type === "verifier_cache_entry",
    "materialized body must be a verifier_cache_entry artifact body",
  )
  yield* assertSmoke(
    materialized.cache_entry.source_artifacts.status_event_ref ===
      "art_status_acme_demo_active_v1",
    "cache entry did not preserve status event artifact reference",
  )
  yield* assertSmoke(
    materialized.cache_entry.scanner_trust_projection.issuer_legitimacy ===
      "recognized",
    "cache projection did not expose recognized issuer legitimacy",
  )
  yield* assertSmoke(
    materialized.cache_entry.freshness.cache_expires_at ===
      demoIssuerProjection.cache_expires_at,
    "cache expiry did not collapse to the active status event freshness window",
  )
  yield* assertSmoke(
    green.decision_color === "green" &&
      green.governance?.issuer_id === demoIssuerProjection.namespace.issuer_id,
    "materialized verifier cache did not produce the expected green scanner decision",
  )
  yield* assertSmoke(
    Boolean(cacheCommand),
    "materialized verifier cache entry was not persistence-ready",
  )
  yield* assertSmoke(
    persistenceReport.cache_entries_upserted === 1 &&
      persistenceReport.scanner_decisions_inserted === 1,
    "persistence report did not include the materialized cache entry and scanner decision",
  )
  yield* assertSmoke(
    malformedMaterialization._tag === "Left" &&
      malformedMaterialization.left._tag === "ContractValidationError",
    "malformed destination policy was materialized into verifier cache",
  )

  yield* Console.log(
    JSON.stringify(
      {
        cache_entry_id: materialized.cache_entry.cache_entry_id,
        source_artifacts: materialized.cache_entry.source_artifacts,
        source_artifact_hashes: materialized.source_artifact_hashes.length,
        materialization_warnings: materialized.materialization_warnings,
        scanner_decision: {
          color: green.decision_color,
          state: green.decision_state,
          issuer: green.governance?.issuer_id,
        },
        persistence_report: persistenceReport,
        malformed_materialization_rejected:
          malformedMaterialization._tag === "Left",
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

const fetchArtifacts = (
  artifactIds: ReadonlyArray<string>,
  getArtifact: (
    artifactId: string,
  ) => Effect.Effect<SignedArtifact | undefined, NetworkError>,
): Effect.Effect<
  readonly [SignedArtifact, SignedArtifact, SignedArtifact, SignedArtifact, SignedArtifact],
  NetworkError
> =>
  Effect.gen(function* () {
    const artifacts: SignedArtifact[] = []

    for (const artifactId of artifactIds) {
      const artifact = yield* getArtifact(artifactId)
      if (!artifact) {
        throw new Error(`Expected artifact ${artifactId} to exist.`)
      }
      artifacts.push(artifact)
    }

    if (artifacts.length !== 5) {
      throw new Error(`Expected five artifacts, got ${artifacts.length}.`)
    }

    return artifacts as [
      SignedArtifact,
      SignedArtifact,
      SignedArtifact,
      SignedArtifact,
      SignedArtifact,
    ]
  })

const malformedDestinationPolicyArtifact = (
  artifact: SignedArtifact,
): SignedArtifact => {
  const body = artifact.body
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Expected destination policy body.")
  }
  const approvedDestinations = (body as Record<string, unknown>)
    .approved_destinations
  if (!Array.isArray(approvedDestinations)) {
    throw new Error("Expected destination policy approved destinations.")
  }

  return {
    ...artifact,
    artifact_hash: "sha256:materialization-smoke-malformed",
    body: {
      ...body,
      approved_destinations: approvedDestinations.map((destination, index) =>
        index === 0 && destination && typeof destination === "object"
          ? {
              ...destination,
              expected_final_url: "http://acme.example/pay",
            }
          : destination,
      ),
    },
  }
}

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Verifier cache materialization smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
