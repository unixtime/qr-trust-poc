import { Console, Effect } from "effect"

import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  makeAcceptedRootPolicy,
  makeArtifactPublicationService,
  makeFixtureSignatureVerifier,
  makeFixtureTrustArtifactSigner,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryEventBus,
  makeInMemoryVerifierCache,
  makeVerifierSyncService,
  planReferenceGovernancePublication,
  signGovernancePublicationPlan,
  type ArtifactPublicationInput,
  type ArtifactPublicationServiceShape,
} from "../index.js"
import type {
  DestinationPolicyProjection,
  IssuerNamespace,
  IssuerProjection,
} from "../services/verifier-cache.js"

const observedAt = new Date("2026-05-25T00:00:00Z")
const demoRootProgramId = demoIssuerProjection.namespace.root_program_id
const demoDestinationUrl = new URL("https://acme.example/pay")

const program = Effect.gen(function* () {
  const destinationPolicyOnly = yield* destinationPolicyAloneIsMiss()
  const lowerLevelWithoutAcceptedRoot =
    yield* issuerAndPolicyNeedAcceptedRootContext()
  const acceptedRootWithoutManifestContext =
    yield* acceptedRootStillNeedsManifestContext()
  const acceptedAuthorityContext = yield* fullHierarchyResolvesInPrecedenceOrder()
  const statusInvalidation = yield* statusEventsInvalidateAndSourceRefreshUpdates()
  const unacceptedRoot = yield* unacceptedRootDoesNotResolve()

  yield* Console.log(
    JSON.stringify(
      {
        section_7_2_precedence_smoke: "passed",
        destination_policy_only: destinationPolicyOnly,
        issuer_policy_without_accepted_root: lowerLevelWithoutAcceptedRoot,
        issuer_policy_with_accepted_root_without_manifest_context:
          acceptedRootWithoutManifestContext,
        accepted_root_authority_issuer_policy: acceptedAuthorityContext,
        status_events_afterward: statusInvalidation,
        unaccepted_root: unacceptedRoot,
      },
      null,
      2,
    ),
  )
})

const destinationPolicyAloneIsMiss = () =>
  Effect.gen(function* () {
    const cache = makeInMemoryVerifierCache(
      [],
      [demoDestinationPolicyProjection],
      makeAcceptedRootPolicy([demoRootProgramId]),
    )

    const resolution = yield* cache.resolveByDestination(demoDestinationUrl)

    yield* assertSmoke(
      resolution === undefined,
      "destination policy alone must not become a trusted cache hit",
    )

    return {
      policy_present: true,
      issuer_present: false,
      resolved: Boolean(resolution),
    }
  })

const issuerAndPolicyNeedAcceptedRootContext = () =>
  Effect.gen(function* () {
    const artifactStore = makeInMemoryArtifactStore()
    const eventBus = makeInMemoryEventBus()
    const publisher = makeArtifactPublicationService(artifactStore, eventBus)
    const cache = makeInMemoryVerifierCache(
      [],
      [],
      makeAcceptedRootPolicy(["root:unaccepted-fixture:2026"]),
    )
    const verifierSync = makeVerifierSyncService(
      artifactStore,
      eventBus,
      cache,
      makeFixtureSignatureVerifier(),
    )

    yield* publishIssuerAndPolicyOnly(publisher, observedAt)
    const report = yield* verifierSync.syncRecent()
    const resolution = yield* cache.resolveByDestination(demoDestinationUrl)

    yield* assertSmoke(
      report.projected_issuers === 1 &&
        report.projected_destination_policies === 1,
      "issuer and policy artifacts should be synchronized before root acceptance is checked at resolve time",
    )
    yield* assertSmoke(
      resolution === undefined,
      "issuer plus destination policy must not resolve under an unaccepted root context",
    )

    return {
      projected_issuers: report.projected_issuers,
      projected_destination_policies: report.projected_destination_policies,
      accepted_roots: ["root:unaccepted-fixture:2026"],
      resolved: Boolean(resolution),
    }
  })

const acceptedRootStillNeedsManifestContext = () =>
  Effect.gen(function* () {
    const artifactStore = makeInMemoryArtifactStore()
    const eventBus = makeInMemoryEventBus()
    const publisher = makeArtifactPublicationService(artifactStore, eventBus)
    const cache = makeInMemoryVerifierCache(
      [],
      [],
      makeAcceptedRootPolicy([demoRootProgramId]),
    )
    const verifierSync = makeVerifierSyncService(
      artifactStore,
      eventBus,
      cache,
      makeFixtureSignatureVerifier(),
    )

    yield* publishIssuerAndPolicyOnly(publisher, observedAt)
    const report = yield* verifierSync.syncRecent()
    const resolution = yield* cache.resolveByDestination(demoDestinationUrl)

    yield* assertSmoke(
      report.projected_issuers === 1 &&
        report.projected_destination_policies === 1,
      "issuer and policy artifacts should still project without manifest context",
    )
    yield* assertSmoke(
      resolution === undefined,
      "accepted root alone must not resolve issuer plus policy without root and delegated-authority manifest context",
    )

    return {
      accepted_roots: [demoRootProgramId],
      projected_issuers: report.projected_issuers,
      projected_destination_policies: report.projected_destination_policies,
      root_manifest_synced: false,
      delegated_authority_manifest_synced: false,
      resolved: Boolean(resolution),
    }
  })

const fullHierarchyResolvesInPrecedenceOrder = () =>
  Effect.gen(function* () {
    const artifactStore = makeInMemoryArtifactStore()
    const eventBus = makeInMemoryEventBus()
    const publisher = makeArtifactPublicationService(artifactStore, eventBus)
    const governance = makeGovernancePublicationService(publisher)
    const cache = makeInMemoryVerifierCache(
      [],
      [],
      makeAcceptedRootPolicy([demoRootProgramId]),
    )
    const verifierSync = makeVerifierSyncService(
      artifactStore,
      eventBus,
      cache,
      makeFixtureSignatureVerifier(),
    )

    const publication = yield* governance.publishReferenceBundle(observedAt)
    const report = yield* verifierSync.syncRecent()
    const resolution = yield* cache.resolveByDestination(demoDestinationUrl)

    yield* assertSmoke(
      publication.published_artifacts === 4,
      "root, delegated authority, issuer, and destination policy should publish as one source-of-truth hierarchy",
    )
    yield* assertSmoke(
      report.validated_trust_artifacts === 4 &&
        report.projected_issuers === 1 &&
        report.projected_destination_policies === 1,
      "verifier sync should validate and project the accepted hierarchy",
    )
    yield* assertSmoke(
      resolution?.binding_status === "bound" &&
        resolution.issuer.namespace.root_program_id === demoRootProgramId,
      "accepted root and delegated authority context should allow issuer plus policy to resolve",
    )

    return {
      published_artifacts: publication.published_artifacts,
      validated_trust_artifacts: report.validated_trust_artifacts,
      projected_issuers: report.projected_issuers,
      projected_destination_policies: report.projected_destination_policies,
      binding_status: resolution?.binding_status,
    }
  })

const statusEventsInvalidateAndSourceRefreshUpdates = () =>
  Effect.gen(function* () {
    const artifactStore = makeInMemoryArtifactStore()
    const eventBus = makeInMemoryEventBus()
    const publisher = makeArtifactPublicationService(artifactStore, eventBus)
    const governance = makeGovernancePublicationService(publisher)
    const cache = makeInMemoryVerifierCache(
      [],
      [],
      makeAcceptedRootPolicy([demoRootProgramId]),
    )
    const verifierSync = makeVerifierSyncService(
      artifactStore,
      eventBus,
      cache,
      makeFixtureSignatureVerifier(),
    )

    yield* governance.publishReferenceBundle(observedAt)
    yield* verifierSync.syncRecent()
    const beforeStatus = yield* cache.resolveByDestination(demoDestinationUrl)

    yield* publishIssuerRevocationStatus(publisher)
    const invalidationReport = yield* verifierSync.syncRecent()
    const afterRevocation = yield* cache.resolveByDestination(demoDestinationUrl)

    yield* publishIssuerAndPolicyOnly(
      publisher,
      new Date("2026-05-25T00:02:00Z"),
    )
    const refreshReport = yield* verifierSync.syncRecent()
    const afterRefresh = yield* cache.resolveByDestination(demoDestinationUrl)

    yield* assertSmoke(
      beforeStatus?.binding_status === "bound",
      "accepted hierarchy should resolve before status invalidation",
    )
    yield* assertSmoke(
      invalidationReport.applied_status_events >= 1 &&
        afterRevocation === undefined,
      "signed status event should invalidate the active verifier cache entry",
    )
    yield* assertSmoke(
      afterRefresh?.binding_status === "bound",
      "later source-of-truth issuer and policy refresh should update the cache after invalidation",
    )

    return {
      before_status_resolved: Boolean(beforeStatus),
      applied_status_events: invalidationReport.applied_status_events,
      after_revocation_resolved: Boolean(afterRevocation),
      refresh_projected_issuers: refreshReport.projected_issuers,
      refresh_projected_destination_policies:
        refreshReport.projected_destination_policies,
      after_refresh_resolved: Boolean(afterRefresh),
    }
  })

const unacceptedRootDoesNotResolve = () =>
  Effect.gen(function* () {
    const unacceptedRootProgramId = "root:section-7-2-unaccepted:2026"
    const namespace: IssuerNamespace = {
      root_program_id: unacceptedRootProgramId,
      delegated_authority_id: "authority:section-7-2-unaccepted:web",
      issuer_id: "issuer:section-7-2-unaccepted",
    }
    const cache = makeInMemoryVerifierCache(
      [withNamespace(demoIssuerProjection, namespace)],
      [withPolicyNamespace(demoDestinationPolicyProjection, namespace)],
      makeAcceptedRootPolicy([demoRootProgramId]),
    )

    const resolution = yield* cache.resolveByDestination(demoDestinationUrl)

    yield* assertSmoke(
      resolution === undefined,
      "unaccepted roots must not resolve even when issuer and policy projections are present",
    )

    return {
      projected_root: unacceptedRootProgramId,
      accepted_roots: [demoRootProgramId],
      resolved: Boolean(resolution),
    }
  })

const publishIssuerAndPolicyOnly = (
  publisher: ArtifactPublicationServiceShape,
  occurredAt: Date,
) =>
  Effect.gen(function* () {
    const plan = planReferenceGovernancePublication(occurredAt)
    const signed = yield* signGovernancePublicationPlan(
      {
        artifacts: [
          plan.artifacts[0],
          plan.artifacts[1],
          {
            ...plan.artifacts[2],
            occurredAt,
            reason: "section 7.2 issuer source refresh",
          },
          {
            ...plan.artifacts[3],
            occurredAt,
            reason: "section 7.2 destination policy source refresh",
          },
        ],
      },
      makeFixtureTrustArtifactSigner(),
    )

    yield* publishAll(publisher, [signed[2], signed[3]])
  })

const publishIssuerRevocationStatus = (
  publisher: ArtifactPublicationServiceShape,
) =>
  Effect.gen(function* () {
    const signer = makeFixtureTrustArtifactSigner()
    const signed = yield* signer.signTrustArtifact({
      body: {
        artifact_type: "revocation_status_event",
        schema_version: "0.1.0",
        status_event_id: "status:section-7-2:issuer:revoked:v1",
        root_program_id: demoRootProgramId,
        delegated_authority_id:
          demoIssuerProjection.namespace.delegated_authority_id,
        target: {
          target_type: "issuer",
          issuer_id: demoIssuerProjection.namespace.issuer_id,
        },
        status: "revoked",
        reason: "section 7.2 signed status event invalidates lower-level state",
        effective_at: "2026-05-25T00:01:00Z",
        signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      },
      signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      root_program_id: demoRootProgramId,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
    })

    yield* publisher.publishArtifact({
      artifact_type: "revocation_status_event",
      artifact_id: "art_section_7_2_issuer_revoked_v1",
      version: 1,
      root_program_id: demoRootProgramId,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
      issuer_id: demoIssuerProjection.namespace.issuer_id,
      body: signed.body,
      occurredAt: new Date("2026-05-25T00:01:00Z"),
      eventType: "issuer.status.changed",
      reason: "section 7.2 issuer status changed",
    })
  })

const publishAll = (
  publisher: ArtifactPublicationServiceShape,
  artifacts: ReadonlyArray<ArtifactPublicationInput>,
) =>
  Effect.forEach(artifacts, (artifact) => publisher.publishArtifact(artifact), {
    discard: true,
  })

const withNamespace = (
  projection: IssuerProjection,
  namespace: IssuerNamespace,
): IssuerProjection => ({
  ...projection,
  namespace,
})

const withPolicyNamespace = (
  projection: DestinationPolicyProjection,
  namespace: IssuerNamespace,
): DestinationPolicyProjection => ({
  ...projection,
  namespace,
})

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Section 7.2 precedence smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
