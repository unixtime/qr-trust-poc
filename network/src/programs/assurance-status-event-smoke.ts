import { Console, Effect } from "effect"

import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  makeArtifactPublicationService,
  makeFixtureSignatureVerifier,
  makeFixtureTrustArtifactSigner,
  makeInMemoryArtifactStore,
  makeInMemoryEventBus,
  makeInMemoryVerifierCache,
  makeVerifierSyncService,
} from "../index.js"

const observedAt = new Date("2026-05-25T00:00:00Z")
const downgradedAssuranceTier = "domain_validated"

const program = Effect.gen(function* () {
  const artifactStore = makeInMemoryArtifactStore()
  const eventBus = makeInMemoryEventBus()
  const publisher = makeArtifactPublicationService(artifactStore, eventBus)
  const cache = makeInMemoryVerifierCache(
    [demoIssuerProjection],
    [demoDestinationPolicyProjection],
  )
  const signer = makeFixtureTrustArtifactSigner()
  const verifierSync = makeVerifierSyncService(
    artifactStore,
    eventBus,
    cache,
    makeFixtureSignatureVerifier(),
  )

  const before = yield* cache.resolveByDestination(
    new URL("https://acme.example/pay"),
  )

  yield* assertSmoke(
    before?.issuer.assurance_tier === "verified_business",
    "demo issuer should start at verified_business assurance",
  )

  const signed = yield* signer.signTrustArtifact({
    body: {
      artifact_type: "assurance_status_event",
      schema_version: "0.1.0",
      status_event_id: "status:acme-demo:assurance:downgraded:v1",
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
      target: {
        target_type: "issuer",
        issuer_id: demoIssuerProjection.namespace.issuer_id,
      },
      previous_assurance_tier: "verified_business",
      new_assurance_tier: downgradedAssuranceTier,
      reason: "signed assurance downgrade smoke",
      effective_at: observedAt.toISOString(),
      signed_by: demoIssuerProjection.namespace.delegated_authority_id,
    },
    signed_by: demoIssuerProjection.namespace.delegated_authority_id,
    root_program_id: demoIssuerProjection.namespace.root_program_id,
    delegated_authority_id:
      demoIssuerProjection.namespace.delegated_authority_id,
  })

  yield* publisher.publishArtifact({
    artifact_type: "assurance_status_event",
    artifact_id: "art_status_acme_demo_assurance_downgraded_v1",
    version: 1,
    root_program_id: demoIssuerProjection.namespace.root_program_id,
    delegated_authority_id:
      demoIssuerProjection.namespace.delegated_authority_id,
    issuer_id: demoIssuerProjection.namespace.issuer_id,
    body: signed.body,
    occurredAt: observedAt,
    eventType: "issuer.assurance.changed",
    reason: "signed assurance downgrade smoke",
  })

  const report = yield* verifierSync.syncRecent()
  const after = yield* cache.resolveByDestination(
    new URL("https://acme.example/pay"),
  )

  yield* assertSmoke(
    report.applied_status_events === 1,
    "signed assurance status event should be applied",
  )
  yield* assertSmoke(
    after?.binding_status === "bound",
    "assurance downgrade should not remove destination binding",
  )
  yield* assertSmoke(
    after?.issuer.assurance_tier === downgradedAssuranceTier,
    "assurance downgrade should update the cached issuer assurance tier",
  )

  yield* Console.log(
    JSON.stringify(
      {
        assurance_status_event_smoke: "passed",
        before_assurance_tier: before?.issuer.assurance_tier,
        after_assurance_tier: after?.issuer.assurance_tier,
        applied_status_events: report.applied_status_events,
        destination_still_bound: after?.binding_status === "bound",
      },
      null,
      2,
    ),
  )
})

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Assurance status event smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
