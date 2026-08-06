import { Console, Effect } from "effect"

import {
  makeArtifactPublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryEventBus,
  makeInMemoryTrustKeyRegistry,
  makeInMemoryVerifierCache,
  makeFixtureSignatureVerifier,
  makeFixtureTrustArtifactSigner,
  makeVerifierSyncService,
  referenceDelegatedAuthorityBody,
  referenceDestinationPolicyBody,
  referenceRootManifestBody,
  type ArtifactPublicationServiceShape,
  type SignatureVerifierShape,
  type TrustArtifactSignerShape,
} from "../index.js"
import {
  demoDelegatedAuthorityTrustKey,
  demoRootTrustKey,
} from "../services/trust-key-registry.js"
import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  type IssuerProjection,
} from "../services/verifier-cache.js"

const observedAt = new Date("2026-05-17T00:00:00Z")

const rejectingVerifier: SignatureVerifierShape = {
  verifyTrustArtifact: (artifact) =>
    Effect.succeed({
      accepted: false,
      signer: artifact.signed_by ?? "smoke",
      reason: "signature_verification_failed",
    }),
}

const program = Effect.gen(function* () {
  const unsignedGate = yield* runUnsignedGateFixture()
  const namespaceBinding = yield* runNamespaceBindingFixture()
  const rootAuthorityGate = yield* runRootAuthorityGateFixture()
  const malformedDestinationPolicy =
    yield* runMalformedDestinationPolicyFixture()
  const crossAuthorityKeyRevocation =
    yield* runCrossAuthorityKeyRevocationFixture()
  const rootAuthorityKeyRevocation = yield* runRootAuthorityKeyRevocationFixture()

  yield* Console.log(
    JSON.stringify(
      {
        unsigned_gate: unsignedGate,
        namespace_binding: namespaceBinding,
        root_authority_gate: rootAuthorityGate,
        malformed_destination_policy: malformedDestinationPolicy,
        cross_authority_key_revocation: crossAuthorityKeyRevocation,
        root_authority_key_revocation: rootAuthorityKeyRevocation,
      },
      null,
      2,
    ),
  )
})

const runUnsignedGateFixture = () =>
  Effect.gen(function* () {
    const artifactStore = makeInMemoryArtifactStore()
    const eventBus = makeInMemoryEventBus()
    const publisher = makeArtifactPublicationService(artifactStore, eventBus)
    const cache = makeInMemoryVerifierCache()
    const verifierSync = makeVerifierSyncService(
      artifactStore,
      eventBus,
      cache,
      rejectingVerifier,
    )
    const issuerRecord = unsignedIssuerRecordBody(demoIssuerProjection)

    const published = yield* publisher.publishArtifact({
      artifact_type: "issuer_record",
      artifact_id: "art_issuer_signature_gate_unsigned_v1",
      version: 1,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
      issuer_id: demoIssuerProjection.namespace.issuer_id,
      destination_policy_id: demoIssuerProjection.destination_policy_id,
      body: issuerRecord,
      occurredAt: observedAt,
      eventType: "issuer.record.published",
      reason: "unsigned issuer record must not materialize verifier cache",
    })

    const report = yield* verifierSync.syncRecent()
    const resolved = yield* cache.resolveByDestination(
      new URL("https://acme.example/pay"),
    )

    yield* assertSmoke(
      report.projected_issuers === 0,
      "unsigned issuer record was projected into verifier cache",
    )
    yield* assertSmoke(
      report.rejected_status_events.length > 0,
      "unsigned issuer record did not produce a signature rejection",
    )
    yield* assertSmoke(
      resolved === undefined,
      "unsigned issuer record resolved a cache destination",
    )

    return {
      rejected_artifact: published.artifact.artifact_id,
      projected_issuers: report.projected_issuers,
      rejected_status_events: report.rejected_status_events,
      destination_resolved: Boolean(resolved),
    }
  })

const runRootAuthorityGateFixture = () =>
  Effect.gen(function* () {
    const artifactStore = makeInMemoryArtifactStore()
    const eventBus = makeInMemoryEventBus()
    const publisher = makeArtifactPublicationService(artifactStore, eventBus)
    const verifierSync = makeVerifierSyncService(
      artifactStore,
      eventBus,
      makeInMemoryVerifierCache(),
      rejectingVerifier,
    )

    const rootManifest = yield* publisher.publishArtifact({
      artifact_type: "root_manifest",
      artifact_id: "art_root_signature_gate_rejected_v1",
      version: 1,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      body: {
        ...referenceRootManifestBody(),
        signed_by: demoIssuerProjection.namespace.root_program_id,
      },
      occurredAt: observedAt,
      eventType: "root.manifest.published",
      reason: "root manifest must pass signature validation before ack",
    })
    const delegatedAuthority = yield* publisher.publishArtifact({
      artifact_type: "delegated_authority_manifest",
      artifact_id: "art_authority_signature_gate_rejected_v1",
      version: 1,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
      body: {
        ...referenceDelegatedAuthorityBody(),
        signed_by: demoIssuerProjection.namespace.root_program_id,
      },
      occurredAt: observedAt,
      eventType: "delegated_authority.manifest.published",
      reason:
        "delegated authority manifest must pass signature validation before ack",
    })

    const report = yield* verifierSync.syncRecent()

    yield* assertSmoke(
      report.rejected_status_events.some((entry) =>
        entry.startsWith(`${rootManifest.artifact.artifact_id}:`),
      ),
      "root manifest did not produce a signature rejection",
    )
    yield* assertSmoke(
      report.rejected_status_events.some((entry) =>
        entry.startsWith(`${delegatedAuthority.artifact.artifact_id}:`),
      ),
      "delegated authority manifest did not produce a signature rejection",
    )

    return {
      rejected_root_artifact: rootManifest.artifact.artifact_id,
      rejected_authority_artifact: delegatedAuthority.artifact.artifact_id,
      rejected_status_events: report.rejected_status_events,
    }
  })

const runNamespaceBindingFixture = () =>
  Effect.gen(function* () {
    const artifactStore = makeInMemoryArtifactStore()
    const eventBus = makeInMemoryEventBus()
    const publisher = makeArtifactPublicationService(artifactStore, eventBus)
    const cache = makeInMemoryVerifierCache()
    const signer = makeFixtureTrustArtifactSigner()
    const verifierSync = makeVerifierSyncService(
      artifactStore,
      eventBus,
      cache,
      makeFixtureSignatureVerifier(),
    )

    const signed = yield* signer.signTrustArtifact({
      body: forgedNamespaceIssuerRecordBody(demoIssuerProjection),
      signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
    })

    const published = yield* publisher.publishArtifact({
      artifact_type: "issuer_record",
      artifact_id: "art_issuer_signature_scope_mismatch_v1",
      version: 1,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
      issuer_id: demoIssuerProjection.namespace.issuer_id,
      destination_policy_id: demoIssuerProjection.destination_policy_id,
      body: signed.body,
      occurredAt: observedAt,
      eventType: "issuer.record.published",
      reason: "accepted signature must still bind to issuer namespace",
    })

    const report = yield* verifierSync.syncRecent()

    yield* assertSmoke(
      report.projected_issuers === 0,
      "signed issuer record with mismatched namespace was projected",
    )
    yield* assertSmoke(
      report.rejected_status_events.length > 0,
      "signed issuer record with mismatched namespace was not rejected",
    )

    return {
      rejected_artifact: published.artifact.artifact_id,
      projected_issuers: report.projected_issuers,
      rejected_status_events: report.rejected_status_events,
    }
  })

const runMalformedDestinationPolicyFixture = () =>
  Effect.gen(function* () {
    const artifactStore = makeInMemoryArtifactStore()
    const eventBus = makeInMemoryEventBus()
    const publisher = makeArtifactPublicationService(artifactStore, eventBus)
    const signer = makeFixtureTrustArtifactSigner()
    const verifierSync = makeVerifierSyncService(
      artifactStore,
      eventBus,
      makeInMemoryVerifierCache(),
      makeFixtureSignatureVerifier(),
    )
    const signed = yield* signer.signTrustArtifact({
      body: malformedDestinationPolicyBody(),
      signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
    })

    const published = yield* publisher.publishArtifact({
      artifact_type: "destination_policy",
      artifact_id: "art_policy_signature_gate_malformed_destination_v1",
      version: 1,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
      issuer_id: demoIssuerProjection.namespace.issuer_id,
      destination_policy_id: demoIssuerProjection.destination_policy_id,
      body: signed.body,
      occurredAt: observedAt,
      eventType: "destination.policy.published",
      reason: "signed destination policy must still pass contract validation",
    })

    const report = yield* verifierSync.syncRecent()

    yield* assertSmoke(
      report.projected_destination_policies === 0,
      "signed malformed destination policy was projected",
    )
    yield* assertSmoke(
      report.rejected_status_events.some((entry) =>
        entry.startsWith(`${published.artifact.artifact_id}:`),
      ),
      "signed malformed destination policy did not produce a rejection",
    )

    return {
      rejected_artifact: published.artifact.artifact_id,
      projected_destination_policies: report.projected_destination_policies,
      rejected_status_events: report.rejected_status_events,
    }
  })

/**
 * A trust-key revocation names its target by key id, not by the namespace the
 * signature gate bound the signer to. An honestly signed event from a
 * delegated authority therefore reaches the whole root program unless the
 * authority bind is re-applied when the write lands.
 */
const runCrossAuthorityKeyRevocationFixture = () =>
  Effect.gen(function* () {
    const artifactStore = makeInMemoryArtifactStore()
    const eventBus = makeInMemoryEventBus()
    const publisher = makeArtifactPublicationService(artifactStore, eventBus)
    const signer = makeFixtureTrustArtifactSigner()
    const trustKeyRegistry = makeInMemoryTrustKeyRegistry()
    const verifierSync = makeVerifierSyncService(
      artifactStore,
      eventBus,
      makeInMemoryVerifierCache(),
      makeFixtureSignatureVerifier(),
      // Omit the registry and `applyKeyStatusEvent` never runs, so every
      // assertion below would hold vacuously.
      trustKeyRegistry,
    )

    const published = yield* publishTrustKeyRevocation(publisher, signer, {
      artifact_id: "art_status_cross_authority_key_revocation_v1",
      signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      key_id: demoRootTrustKey.key_id,
      reason: "delegated authority must not revoke the root program's key",
    })

    const report = yield* verifierSync.syncRecent()
    const rootKey = yield* trustKeyRegistry.lookupSignerKey(rootKeyLookupInput)

    yield* assertSmoke(
      demoRootTrustKey.root_program_id ===
        demoDelegatedAuthorityTrustKey.root_program_id,
      "fixtures drifted: the root and delegated keys no longer share a root program, so this fixture proves nothing",
    )
    yield* assertSmoke(
      report.rejected_status_events.length === 0,
      "the cross-authority revocation should pass the signature gate — it is honestly signed — and be stopped by the authority bind instead",
    )
    yield* assertSmoke(
      report.applied_key_status_events === 0,
      "a delegated authority revoked the root program's trust key through verifier sync",
    )
    yield* assertSmoke(
      rootKey.key?.status === "active" && rootKey.reason === undefined,
      "root program key did not survive a cross-authority revocation event",
    )

    return {
      published_artifact: published.artifact.artifact_id,
      rejected_status_events: report.rejected_status_events,
      applied_key_status_events: report.applied_key_status_events,
      root_key_status: rootKey.key?.status,
    }
  })

const runRootAuthorityKeyRevocationFixture = () =>
  Effect.gen(function* () {
    const artifactStore = makeInMemoryArtifactStore()
    const eventBus = makeInMemoryEventBus()
    const publisher = makeArtifactPublicationService(artifactStore, eventBus)
    const signer = makeFixtureTrustArtifactSigner()
    const trustKeyRegistry = makeInMemoryTrustKeyRegistry()
    const verifierSync = makeVerifierSyncService(
      artifactStore,
      eventBus,
      makeInMemoryVerifierCache(),
      makeFixtureSignatureVerifier(),
      trustKeyRegistry,
    )

    const published = yield* publishTrustKeyRevocation(publisher, signer, {
      artifact_id: "art_status_root_authority_key_revocation_v1",
      signed_by: demoIssuerProjection.namespace.root_program_id,
      key_id: demoDelegatedAuthorityTrustKey.key_id,
      reason: "root program governs every key issued under it",
    })

    const report = yield* verifierSync.syncRecent()
    const delegatedKey = yield* trustKeyRegistry.lookupSignerKey(
      delegatedKeyLookupInput,
    )

    yield* assertSmoke(
      report.applied_key_status_events === 1,
      "the root program could not revoke a key issued under its own program",
    )
    yield* assertSmoke(
      delegatedKey.reason === "key_not_active",
      "revoked delegated authority key still resolved as a usable signer",
    )

    return {
      published_artifact: published.artifact.artifact_id,
      applied_key_status_events: report.applied_key_status_events,
      delegated_key_lookup: delegatedKey.reason,
    }
  })

const rootKeyLookupInput = {
  signed_by: demoRootTrustKey.signer_id,
  root_program_id: demoRootTrustKey.root_program_id,
  accepted_algorithm_ids: [demoRootTrustKey.algorithm_id],
}

const delegatedKeyLookupInput = {
  signed_by: demoDelegatedAuthorityTrustKey.signer_id,
  root_program_id: demoDelegatedAuthorityTrustKey.root_program_id,
  delegated_authority_id:
    demoDelegatedAuthorityTrustKey.delegated_authority_id ?? "",
  accepted_algorithm_ids: [demoDelegatedAuthorityTrustKey.algorithm_id],
}

const publishTrustKeyRevocation = (
  publisher: ArtifactPublicationServiceShape,
  signer: TrustArtifactSignerShape,
  input: {
    readonly artifact_id: string
    readonly signed_by: string
    readonly key_id: string
    readonly reason: string
  },
) =>
  Effect.gen(function* () {
    const signed = yield* signer.signTrustArtifact({
      body: {
        artifact_type: "revocation_status_event",
        schema_version: "0.1.0",
        status_event_id: `evt_${input.artifact_id}`,
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        // Present even when the root program signs: the body contract requires
        // the field, and it is the signer's own key scope — not this value —
        // that decides how far the write reaches.
        delegated_authority_id:
          demoIssuerProjection.namespace.delegated_authority_id,
        target: {
          target_type: "trust_key",
          key_id: input.key_id,
        },
        status: "revoked",
        reason: input.reason,
        effective_at: observedAt.toISOString(),
        signed_by: input.signed_by,
      },
      signed_by: input.signed_by,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
    })

    return yield* publisher.publishArtifact({
      artifact_type: "revocation_status_event",
      artifact_id: input.artifact_id,
      version: 1,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
      issuer_id: demoIssuerProjection.namespace.issuer_id,
      body: signed.body,
      occurredAt: observedAt,
      eventType: "issuer.status.changed",
      reason: input.reason,
    })
  })

const unsignedIssuerRecordBody = (issuer: IssuerProjection) => ({
  artifact_type: "issuer_record",
  schema_version: "0.1.0",
  issuer_namespace: issuer.namespace,
  issuer_display_name: issuer.issuer_display_name,
  issuer_class: "business",
  assurance_tier: issuer.assurance_tier,
  certificate_refs: ["cert:acme-demo:web-signing:v1"],
  destination_policies: [
    {
      destination_policy_id: issuer.destination_policy_id,
      policy_ref: "art_policy_acme_demo_v1",
      status: "active",
    },
  ],
  status: {
    issuer_status: "active",
    certificate_status: "active",
    status_event_ref: "status:acme-demo:active:v1",
  },
  publication: {
    published_at: issuer.cache_generated_at,
    valid_until: issuer.cache_expires_at,
  },
  signed_by: "fixture_unsigned",
})

const forgedNamespaceIssuerRecordBody = (issuer: IssuerProjection) => ({
  ...unsignedIssuerRecordBody(issuer),
  issuer_namespace: {
    ...issuer.namespace,
    delegated_authority_id: "authority:qrtrust-demo:forged-web",
  },
})

const malformedDestinationPolicyBody = () => ({
  ...referenceDestinationPolicyBody(),
  approved_destinations:
    demoDestinationPolicyProjection.approved_destinations.map((destination) => ({
      ...destination,
      expected_final_url: "http://acme.example/pay",
    })),
})

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Verifier sync signature gate smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
