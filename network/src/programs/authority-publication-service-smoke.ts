import { Console, Effect } from "effect"

import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  makeArtifactPublicationService,
  makeAuthorityPublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryEventBus,
  makePostgresGovernancePublicationSource,
  makeRecordingPostgresGovernancePublicationSourceExecutor,
} from "../index.js"
import { postgresGovernancePublicationFixtureRow } from "./postgres-governance-fixture.js"

const observedAt = new Date("2026-05-20T13:00:00Z")

const expectedEventTypes = [
  "root.manifest.published",
  "delegated_authority.manifest.published",
  "issuer.record.published",
  "destination.policy.published",
] as const

const program = Effect.gen(function* () {
  const artifactStore = makeInMemoryArtifactStore()
  const eventBus = makeInMemoryEventBus()
  const artifactPublisher = makeArtifactPublicationService(
    artifactStore,
    eventBus,
  )
  const executor = makeRecordingPostgresGovernancePublicationSourceExecutor([
    postgresGovernancePublicationFixtureRow(),
  ])
  const source = makePostgresGovernancePublicationSource(executor)
  const authorityPublisher = makeAuthorityPublicationService(
    source,
    artifactPublisher,
  )

  const report = yield* authorityPublisher.publishGovernanceBundle({
    namespace: demoIssuerProjection.namespace,
    destination_policy_id: demoDestinationPolicyProjection.destination_policy_id,
    observedAt,
  })
  const events = yield* eventBus.recent()

  yield* assertSmoke(
    report.source === "postgres_governance_publication_source",
    "authority report should identify the source-of-truth publisher",
  )
  yield* assertSmoke(
    report.published_artifacts === 4,
    "authority service should publish exactly four governance artifacts",
  )
  yield* assertSmoke(
    report.root_manifest_artifact_id === "art_root_qrtrust_demo_2026_v1",
    "root manifest artifact id did not match the source plan",
  )
  yield* assertSmoke(
    report.delegated_authority_artifact_id ===
      "art_authority_qrtrust_demo_merchant_web_v1",
    "delegated authority artifact id did not match the source plan",
  )
  yield* assertSmoke(
    report.issuer_record_artifact_id === "art_issuer_acme_demo_v1",
    "issuer record artifact id did not match the source plan",
  )
  yield* assertSmoke(
    report.destination_policy_artifact_id ===
      "art_policy_acme_demo_web_payments_v1",
    "destination policy artifact id did not match the source plan",
  )
  yield* assertSmoke(
    events.length === expectedEventTypes.length,
    "authority service should emit one event per published artifact",
  )

  expectedEventTypes.forEach((eventType, index) => {
    if (events[index]?.envelope.type !== eventType) {
      throw new Error(
        `Authority publication service smoke failed: event ${index} should be ${eventType}`,
      )
    }
  })

  const destinationPolicyArtifact = yield* artifactStore.get(
    report.destination_policy_artifact_id,
  )
  yield* assertSmoke(
    destinationPolicyArtifact?.artifact_type === "destination_policy",
    "published destination policy artifact was not stored",
  )
  yield* assertSmoke(
    executor.recorded()[0]?.name ===
      "governance_publication.bundle_by_issuer_policy",
    "authority service did not query the Postgres governance source",
  )

  yield* Console.log(
    JSON.stringify(
      {
        authority_publication_service_smoke: "passed",
        published_artifacts: report.published_artifacts,
        artifact_ids: {
          root: report.root_manifest_artifact_id,
          delegated_authority: report.delegated_authority_artifact_id,
          issuer: report.issuer_record_artifact_id,
          destination_policy: report.destination_policy_artifact_id,
        },
        event_types: report.published_event_types,
      },
      null,
      2,
    ),
  )
})

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Authority publication service smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
