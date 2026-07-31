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

const program = Effect.gen(function* () {
  const issuerRecordTarget = yield* runInvalidationFixture({
    artifact_id: "art_status_acme_demo_revoked_v1",
    expected_status_events: 1,
    reason:
      "signed issuer_record status with destination policy invalidates verifier cache",
    status: "revoked",
    status_event_id: "status:acme-demo:revoked:v1",
    target: {
      target_type: "issuer_record",
      issuer_id: demoIssuerProjection.namespace.issuer_id,
      destination_policy_id:
        demoDestinationPolicyProjection.destination_policy_id,
    },
  })
  const issuerTarget = yield* runInvalidationFixture({
    artifact_id: "art_status_acme_demo_issuer_suspended_v1",
    expected_status_events: 1,
    reason:
      "signed issuer status without destination policy invalidates verifier cache",
    status: "suspended",
    status_event_id: "status:acme-demo:issuer:suspended:v1",
    target: {
      target_type: "issuer",
      issuer_id: demoIssuerProjection.namespace.issuer_id,
    },
  })
  const certificateTarget = yield* runInvalidationFixture({
    artifact_id: "art_status_acme_demo_certificate_revoked_v1",
    event_type: "certificate.status.changed",
    expected_status_events: 1,
    reason:
      "signed certificate status invalidates issuer-scoped verifier cache",
    status: "revoked",
    status_event_id: "status:acme-demo:certificate:revoked:v1",
    target: {
      target_type: "certificate",
      issuer_id: demoIssuerProjection.namespace.issuer_id,
      certificate_ref: "cert:acme-demo:2026:web-payments",
    },
  })
  const delegatedAuthorityTarget = yield* runInvalidationFixture({
    artifact_id: "art_status_acme_demo_authority_revoked_v1",
    expected_status_events: 1,
    reason:
      "signed delegated authority status invalidates all authority-scoped verifier cache",
    status: "revoked",
    status_event_id: "status:acme-demo:authority:revoked:v1",
    target: {
      target_type: "delegated_authority",
    },
  })

  yield* Console.log(
    JSON.stringify(
      {
        verifier_cache_status_invalidation_smoke: "passed",
        issuer_record_target: issuerRecordTarget,
        issuer_target_without_policy: issuerTarget,
        certificate_target: certificateTarget,
        delegated_authority_target: delegatedAuthorityTarget,
      },
      null,
      2,
    ),
  )
})

type InvalidationStatus = "suspended" | "revoked"

interface InvalidationFixtureInput {
  readonly artifact_id: string
  readonly event_type?: "issuer.status.changed" | "certificate.status.changed"
  readonly expected_status_events: number
  readonly reason: string
  readonly status: InvalidationStatus
  readonly status_event_id: string
  readonly target: {
    readonly target_type:
      | "issuer"
      | "issuer_record"
      | "certificate"
      | "delegated_authority"
    readonly issuer_id?: string
    readonly destination_policy_id?: string
    readonly certificate_ref?: string
  }
}

const runInvalidationFixture = (input: InvalidationFixtureInput) =>
  Effect.gen(function* () {
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

    const beforeInvalidation = yield* cache.resolveByDestination(
      new URL("https://acme.example/pay"),
    )

    yield* assertSmoke(
      beforeInvalidation?.issuer.namespace.issuer_id ===
        demoIssuerProjection.namespace.issuer_id,
      "demo destination should resolve before invalidation",
    )

    const signed = yield* signer.signTrustArtifact({
      body: {
        artifact_type: "revocation_status_event",
        schema_version: "0.1.0",
        status_event_id: input.status_event_id,
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        delegated_authority_id:
          demoIssuerProjection.namespace.delegated_authority_id,
        target: input.target,
        status: input.status,
        reason: input.reason,
        effective_at: observedAt.toISOString(),
        signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      },
      signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
    })

    yield* publisher.publishArtifact({
      artifact_type: "revocation_status_event",
      artifact_id: input.artifact_id,
      version: 1,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
      issuer_id: demoIssuerProjection.namespace.issuer_id,
      ...(input.target.destination_policy_id
        ? { destination_policy_id: input.target.destination_policy_id }
        : {}),
      body: signed.body,
      occurredAt: observedAt,
      eventType: input.event_type ?? "issuer.status.changed",
      reason: input.reason,
    })

    const report = yield* verifierSync.syncRecent()
    const afterInvalidation = yield* cache.resolveByDestination(
      new URL("https://acme.example/pay"),
    )

    yield* assertSmoke(
      report.applied_status_events === input.expected_status_events,
      "signed inactive status event should be applied",
    )
    yield* assertSmoke(
      report.rejected_status_events.length === 0,
      "signed inactive status event should pass signature gating",
    )
    yield* assertSmoke(
      afterInvalidation === undefined,
      "issuer should not resolve after invalidation",
    )

    yield* cache.upsertIssuer(demoIssuerProjection)

    const afterIssuerReseed = yield* cache.resolveByDestination(
      new URL("https://acme.example/pay"),
    )

    yield* assertSmoke(
      afterIssuerReseed === undefined,
      "destination policy should not resolve after issuer reseed",
    )

    return {
      artifact_id: input.artifact_id,
      target_type: input.target.target_type,
      target_has_destination_policy: Boolean(input.target.destination_policy_id),
      applied_status_events: report.applied_status_events,
      rejected_status_events: report.rejected_status_events,
      before_invalidation_resolved: Boolean(beforeInvalidation),
      after_invalidation_resolved: Boolean(afterInvalidation),
      after_issuer_reseed_resolved: Boolean(afterIssuerReseed),
    }
  })

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(
        `Verifier cache status invalidation smoke failed: ${message}`,
      )
    }
  })

Effect.runPromise(program)
