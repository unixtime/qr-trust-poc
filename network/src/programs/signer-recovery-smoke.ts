import { Console, Effect } from "effect"

import {
  makeArtifactPublicationService,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryEventBus,
  makeInMemoryTrustKeyRegistry,
  makeInMemoryVerifierCache,
  makeScannerDecisionService,
  makeVerifierSyncService,
  makeFixtureSignatureVerifier,
  makeFixtureTrustArtifactSigner,
  referenceDelegatedAuthorityBody,
  referenceRootManifestBody,
  type ArtifactPublicationResult,
  type ArtifactPublicationServiceShape,
  type NetworkError,
  type TrustArtifactSignerShape,
  type TrustKeyStatus,
} from "../index.js"
import { demoReplacementDelegatedAuthoritySigningKey } from "../services/signing-custody.js"
import {
  demoDelegatedAuthorityTrustKey,
  demoReplacementDelegatedAuthorityTrustKey,
  demoRootTrustKey,
  type TrustKeyRegistryWriterShape,
} from "../services/trust-key-registry.js"
import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  type DestinationPolicyProjection,
  type IssuerProjection,
} from "../services/verifier-cache.js"

const observedAt = new Date("2026-05-17T00:00:00Z")
const rootProgramId = demoIssuerProjection.namespace.root_program_id
const delegatedAuthorityId =
  demoIssuerProjection.namespace.delegated_authority_id
const issuerId = demoIssuerProjection.namespace.issuer_id
const demoPayload = "https://acme.example/pay"
const unrelatedAuthorityId = "authority:qrtrust-demo:campus-web"
const unrelatedIssuerId = "issuer:campus-demo"
const unrelatedDestinationPolicyId = "policy:campus-demo:library:v1"
const unrelatedPayload = "https://library.campus.example/pay"
const unrelatedDelegatedAuthorityManifestRef =
  "art_authority_qrtrust_demo_campus_web_v1"

const program = Effect.gen(function* () {
  const rootRecovery = yield* runRootRecoveryFixture()
  const delegatedRecovery = yield* runDelegatedRecoveryFixture()
  const staleCache = yield* runStaleCacheFixture()

  yield* Console.log(
    JSON.stringify(
      {
        root_recovery: rootRecovery,
        delegated_recovery: delegatedRecovery,
        stale_cache: staleCache,
      },
      null,
      2,
    ),
  )
})

const runRootRecoveryFixture = () =>
  Effect.gen(function* () {
    const context = makeRecoveryContext()
    yield* seedGreenCache(context)

    const beforeRecovery = yield* context.scanner.decide({
      payload: demoPayload,
      observedAt,
    })

    yield* publishStatusEvent(context.publisher, context.signer, {
      artifactId: "art_status_root_key_revoked_recovery_v1",
      statusEventId: "status:key:root:revoked:recovery:v1",
      status: "revoked",
      signedBy: rootProgramId,
      reason: "root signer compromise recovery fixture",
      target: {
        target_type: "trust_key",
        key_id: demoRootTrustKey.key_id,
      },
    })

    const rootRevocationSync = yield* context.verifierSync.syncRecent()
    const rootAfterRevocation = yield* signatureCheck(
      context.signer,
      context.trustKeyRegistry,
      {
        signedBy: rootProgramId,
      },
    )

    yield* publishStatusEvent(context.publisher, context.signer, {
      artifactId: "art_status_root_post_recovery_mutation_v1",
      statusEventId: "status:issuer:root-post-recovery-mutation:v1",
      status: "suspended",
      signedBy: rootProgramId,
      reason: "revoked root signer must not mutate verifier cache",
      target: {
        target_type: "issuer_record",
        issuer_id: issuerId,
      },
    })

    const rejectedMutationSync = yield* context.verifierSync.syncRecent()
    const afterRejectedMutation = yield* context.scanner.decide({
      payload: demoPayload,
      observedAt,
    })

    yield* assertSmoke(
      beforeRecovery.decision_color === "green",
      "root recovery fixture did not start from green cache",
    )
    yield* assertSmoke(
      rootRevocationSync.applied_key_status_events === 1,
      "root key revocation status event was not applied",
    )
    yield* assertSmoke(
      rootAfterRevocation.reason === "key_not_active",
      "revoked root key still accepted direct signatures",
    )
    yield* assertSmoke(
      rejectedMutationSync.rejected_status_events.some(
        (entry) =>
          entry === "art_status_root_post_recovery_mutation_v1:key_not_active",
      ),
      "post-recovery root-signed mutation was not rejected",
    )
    yield* assertSmoke(
      afterRejectedMutation.decision_color === "green",
      "revoked root signer changed verifier cache after recovery",
    )

    return {
      before_recovery: beforeRecovery.decision_color,
      root_revocation: {
        applied_key_status_events:
          rootRevocationSync.applied_key_status_events,
        direct_signature_reason: rootAfterRevocation.reason,
      },
      rejected_post_recovery_mutation:
        rejectedMutationSync.rejected_status_events.filter((entry) =>
          entry.startsWith("art_status_root_post_recovery_mutation_v1:"),
        ),
      after_rejected_mutation: afterRejectedMutation.decision_color,
    }
  })

const runDelegatedRecoveryFixture = () =>
  Effect.gen(function* () {
    const context = makeRecoveryContext()
    yield* seedGreenCache(context)
    yield* seedUnrelatedAuthorityCache(context)

    const beforeRecovery = yield* context.scanner.decide({
      payload: demoPayload,
      observedAt,
    })
    const unrelatedBeforeRecovery = yield* context.scanner.decide({
      payload: unrelatedPayload,
      observedAt,
    })

    yield* publishStatusEvent(context.publisher, context.signer, {
      artifactId: "art_status_authority_key_revoked_recovery_v1",
      statusEventId: "status:key:authority:revoked:recovery:v1",
      status: "revoked",
      signedBy: delegatedAuthorityId,
      reason: "delegated authority signer compromise recovery fixture",
      target: {
        target_type: "trust_key",
        key_id: demoDelegatedAuthorityTrustKey.key_id,
      },
    })

    const authorityRevocationSync = yield* context.verifierSync.syncRecent()
    const authorityAfterRevocation = yield* signatureCheck(
      context.signer,
      context.trustKeyRegistry,
      {
        signedBy: delegatedAuthorityId,
        delegatedAuthorityId,
      },
    )

    yield* publishStatusEvent(context.publisher, context.signer, {
      artifactId: "art_status_authority_post_recovery_mutation_v1",
      statusEventId: "status:issuer:authority-post-recovery-mutation:v1",
      status: "suspended",
      signedBy: delegatedAuthorityId,
      reason: "revoked delegated authority signer must not mutate cache",
      target: {
        target_type: "issuer_record",
        issuer_id: issuerId,
      },
    })

    const rejectedMutationSync = yield* context.verifierSync.syncRecent()
    const afterRejectedMutation = yield* context.scanner.decide({
      payload: demoPayload,
      observedAt,
    })

    yield* context.trustKeyRegistry.upsertTrustKey(
      demoReplacementDelegatedAuthorityTrustKey,
    )

    yield* publishStatusEvent(context.publisher, context.signer, {
      artifactId: "art_status_issuer_suspended_replacement_key_v1",
      statusEventId: "status:issuer:replacement-key-suspension:v1",
      status: "suspended",
      signedBy: delegatedAuthorityId,
      signingKeyId: demoReplacementDelegatedAuthoritySigningKey.key_id,
      reason:
        "active replacement delegated authority signer can publish recovery status",
      target: {
        target_type: "issuer_record",
        issuer_id: issuerId,
      },
    })

    const replacementSync = yield* context.verifierSync.syncRecent()
    const afterReplacementMutation = yield* context.scanner.decide({
      payload: demoPayload,
      observedAt,
    })
    const unrelatedAfterReplacementMutation = yield* context.scanner.decide({
      payload: unrelatedPayload,
      observedAt,
    })

    yield* assertSmoke(
      beforeRecovery.decision_color === "green",
      "delegated recovery fixture did not start from green cache",
    )
    yield* assertSmoke(
      authorityRevocationSync.applied_key_status_events === 1,
      "delegated authority key revocation status event was not applied",
    )
    yield* assertSmoke(
      authorityAfterRevocation.reason === "key_not_active",
      "revoked delegated authority key still accepted direct signatures",
    )
    yield* assertSmoke(
      rejectedMutationSync.rejected_status_events.some(
        (entry) =>
          entry ===
          "art_status_authority_post_recovery_mutation_v1:key_not_active",
      ),
      "post-recovery delegated-authority mutation was not rejected",
    )
    yield* assertSmoke(
      afterRejectedMutation.decision_color === "green",
      "revoked delegated authority changed verifier cache after recovery",
    )
    yield* assertSmoke(
      replacementSync.applied_status_events >= 1,
      "replacement delegated authority key did not apply issuer suspension",
    )
    yield* assertSmoke(
      afterReplacementMutation.decision_color !== "green",
      "replacement-key issuer suspension did not remove green eligibility",
    )
    yield* assertSmoke(
      unrelatedBeforeRecovery.decision_color === "green",
      "unrelated authority fixture did not start from green cache",
    )
    yield* assertSmoke(
      unrelatedAfterReplacementMutation.decision_color === "green",
      "delegated recovery changed unrelated authority scanner outcome",
    )

    return {
      before_recovery: beforeRecovery.decision_color,
      delegated_key_revocation: {
        applied_key_status_events:
          authorityRevocationSync.applied_key_status_events,
        direct_signature_reason: authorityAfterRevocation.reason,
      },
      rejected_post_recovery_mutation:
        rejectedMutationSync.rejected_status_events.filter((entry) =>
          entry.startsWith("art_status_authority_post_recovery_mutation_v1:"),
        ),
      after_rejected_mutation: afterRejectedMutation.decision_color,
      replacement_key: {
        applied_status_events: replacementSync.applied_status_events,
        after_replacement_mutation: afterReplacementMutation.decision_color,
      },
      unrelated_authority: {
        before_recovery: unrelatedBeforeRecovery.decision_color,
        after_replacement_mutation:
          unrelatedAfterReplacementMutation.decision_color,
      },
    }
  })

const runStaleCacheFixture = () =>
  Effect.gen(function* () {
    const context = makeRecoveryContext()
    yield* seedGreenCache(context)
    yield* context.verifierCache.upsertIssuer(expiredIssuerProjection())
    yield* context.verifierCache.upsertDestinationPolicy(
      expiredDestinationPolicyProjection(),
    )

    const decision = yield* context.scanner.decide({
      payload: demoPayload,
      observedAt,
    })

    yield* assertSmoke(
      decision.decision_color === "orange",
      "expired verifier cache did not downgrade the scanner decision",
    )
    yield* assertSmoke(
      decision.cache_freshness.status === "expired",
      "expired verifier cache did not surface cache freshness evidence",
    )
    yield* assertSmoke(
      decision.reason_codes.includes("cache_expired"),
      "expired verifier cache did not include cache_expired reason code",
    )
    yield* assertSmoke(
      decision.hold_to_open.required,
      "expired verifier cache did not require hold-to-open",
    )

    return {
      decision_color: decision.decision_color,
      decision_state: decision.decision_state,
      cache_freshness: decision.cache_freshness.status,
      hold_to_open_required: decision.hold_to_open.required,
      reason_codes: decision.reason_codes,
    }
  })

const makeRecoveryContext = () => {
  const eventBus = makeInMemoryEventBus()
  const artifactStore = makeInMemoryArtifactStore()
  const cache = makeInMemoryVerifierCache()
  const trustKeyRegistry = makeInMemoryTrustKeyRegistry()
  const publisher = makeArtifactPublicationService(artifactStore, eventBus)
  const governancePublisher = makeGovernancePublicationService(publisher)
  const signatureVerifier = makeFixtureSignatureVerifier(trustKeyRegistry)
  const verifierSync = makeVerifierSyncService(
    artifactStore,
    eventBus,
    cache,
    signatureVerifier,
    trustKeyRegistry,
  )
  const scanner = makeScannerDecisionService(cache, eventBus)
  const signer = makeFixtureTrustArtifactSigner()

  return {
    governancePublisher,
    publisher,
    scanner,
    signer,
    trustKeyRegistry,
    verifierCache: cache,
    verifierSync,
  }
}

type RecoveryContext = ReturnType<typeof makeRecoveryContext>

const seedGreenCache = (
  context: RecoveryContext,
): Effect.Effect<void, NetworkError> =>
  Effect.gen(function* () {
    yield* context.governancePublisher.publishReferenceBundle(observedAt)
    yield* context.verifierSync.syncRecent()
  })

const seedUnrelatedAuthorityCache = (
  context: RecoveryContext,
): Effect.Effect<void, NetworkError> =>
  Effect.gen(function* () {
    yield* publishUnrelatedAuthorityContext(context)
    yield* context.verifierSync.syncRecent()
    yield* context.verifierCache.upsertIssuer(unrelatedIssuerProjection())
    yield* context.verifierCache.upsertDestinationPolicy(
      unrelatedDestinationPolicyProjection(),
    )
  })

const publishUnrelatedAuthorityContext = (
  context: RecoveryContext,
): Effect.Effect<void, NetworkError> =>
  Effect.gen(function* () {
    const rootBody = referenceRootManifestBody()
    const signedRoot = yield* context.signer.signTrustArtifact({
      body: {
        ...rootBody,
        delegated_authorities: [
          ...rootBody.delegated_authorities,
          {
            delegated_authority_id: unrelatedAuthorityId,
            name: "QR Trust Demo Campus Web Authority",
            manifest_ref: unrelatedDelegatedAuthorityManifestRef,
            status: "active",
          },
        ],
      },
      signed_by: rootProgramId,
      root_program_id: rootProgramId,
    })
    yield* context.publisher.publishArtifact({
      artifact_type: "root_manifest",
      artifact_id: "art_root_qrtrust_demo_2026_multi_authority_v1",
      version: 2,
      root_program_id: rootProgramId,
      body: signatureAlignedPublicationBody(signedRoot.body),
      occurredAt: observedAt,
      eventType: "root.manifest.published",
      reason: "fixture multi-authority root manifest publication",
    })

    const delegatedAuthorityBody = referenceDelegatedAuthorityBody()
    const signedDelegatedAuthority = yield* context.signer.signTrustArtifact({
      body: {
        ...delegatedAuthorityBody,
        delegated_authority_id: unrelatedAuthorityId,
        operator_name: "QR Trust Demo Campus Web Authority",
        operator_class: "campus_operator",
        scope: ["campus-web"],
        trust_keys: [],
        enrolled_issuers: [
          {
            issuer_id: unrelatedIssuerId,
            issuer_record_ref: "art_issuer_campus_demo_v1",
            assurance_tier: demoIssuerProjection.assurance_tier,
            status: "active",
          },
        ],
      },
      signed_by: rootProgramId,
      root_program_id: rootProgramId,
    })
    yield* context.publisher.publishArtifact({
      artifact_type: "delegated_authority_manifest",
      artifact_id: unrelatedDelegatedAuthorityManifestRef,
      version: 1,
      root_program_id: rootProgramId,
      delegated_authority_id: unrelatedAuthorityId,
      body: signatureAlignedPublicationBody(signedDelegatedAuthority.body),
      occurredAt: observedAt,
      eventType: "delegated_authority.manifest.published",
      reason: "fixture unrelated delegated authority publication",
    })
  })

const signatureAlignedPublicationBody = (
  body: Record<string, unknown>,
): Record<string, unknown> => {
  const publication = body.publication
  if (
    !publication ||
    typeof publication !== "object" ||
    Array.isArray(publication)
  ) {
    return body
  }

  return {
    ...body,
    publication: {
      ...publication,
      signed_by: body.signed_by,
      signature_status: body.signature_status,
    },
  }
}

const expiredIssuerProjection = (): IssuerProjection => ({
  ...demoIssuerProjection,
  cache_generated_at: "2026-01-01T00:00:00Z",
  cache_expires_at: "2026-01-02T00:00:00Z",
})

const expiredDestinationPolicyProjection = (): DestinationPolicyProjection => ({
  ...demoDestinationPolicyProjection,
  cache_generated_at: "2026-01-01T00:00:00Z",
  cache_expires_at: "2026-01-02T00:00:00Z",
})

const unrelatedIssuerProjection = (): IssuerProjection => ({
  ...demoIssuerProjection,
  namespace: {
    root_program_id: rootProgramId,
    delegated_authority_id: unrelatedAuthorityId,
    issuer_id: unrelatedIssuerId,
  },
  issuer_display_name: "Campus Demo",
  destination_policy_id: unrelatedDestinationPolicyId,
  allowed_hosts: ["library.campus.example"],
})

const unrelatedDestinationPolicyProjection =
  (): DestinationPolicyProjection => ({
    ...demoDestinationPolicyProjection,
    namespace: {
      root_program_id: rootProgramId,
      delegated_authority_id: unrelatedAuthorityId,
      issuer_id: unrelatedIssuerId,
    },
    destination_policy_id: unrelatedDestinationPolicyId,
    approved_destinations: [
      {
        destination_id: "dest:campus-demo:library",
        expected_final_url: unrelatedPayload,
        allowed_hosts: ["library.campus.example"],
        allow_subdomains: false,
        path_prefixes: ["/pay"],
        query_policy: "none",
      },
    ],
    redirect_policy: {
      resolver_urls: [],
      expected_final_destinations: [],
      allowed_redirect_hosts: [],
      max_redirect_hops: 0,
      nested_shorteners_allowed: false,
      scanner_must_display_resolver_and_final_destination: false,
    },
    allowed_hosts: ["library.campus.example"],
    allow_subdomains: false,
  })

interface StatusEventFixtureInput {
  readonly artifactId: string
  readonly statusEventId: string
  readonly status: Exclude<TrustKeyStatus, "active">
  readonly signedBy: string
  readonly reason: string
  readonly signingKeyId?: string
  readonly target: {
    readonly target_type: "issuer_record" | "trust_key"
    readonly issuer_id?: string
    readonly key_id?: string
  }
}

const publishStatusEvent = (
  publisher: ArtifactPublicationServiceShape,
  signer: TrustArtifactSignerShape,
  input: StatusEventFixtureInput,
): Effect.Effect<ArtifactPublicationResult, NetworkError> =>
  Effect.gen(function* () {
    const signed = yield* signer.signTrustArtifact({
      body: {
        artifact_type: "revocation_status_event",
        schema_version: "0.1.0",
        status_event_id: input.statusEventId,
        root_program_id: rootProgramId,
        delegated_authority_id: delegatedAuthorityId,
        target: input.target,
        status: input.status,
        reason: input.reason,
        effective_at: observedAt.toISOString(),
        signed_by: input.signedBy,
      },
      signed_by: input.signedBy,
      root_program_id: rootProgramId,
      ...(input.signedBy === delegatedAuthorityId
        ? { delegated_authority_id: delegatedAuthorityId }
        : {}),
      ...(input.signingKeyId ? { key_id: input.signingKeyId } : {}),
    })

    return yield* publisher.publishArtifact({
      artifact_type: "revocation_status_event",
      artifact_id: input.artifactId,
      version: 1,
      root_program_id: rootProgramId,
      delegated_authority_id: delegatedAuthorityId,
      issuer_id: issuerId,
      body: signed.body,
      occurredAt: observedAt,
      eventType:
        input.target.target_type === "trust_key"
          ? "trust-key.status.changed"
          : "issuer.status.changed",
      reason: input.reason,
    })
  })

const signatureCheck = (
  signer: TrustArtifactSignerShape,
  trustKeyRegistry: TrustKeyRegistryWriterShape,
  input: {
    readonly signedBy: string
    readonly delegatedAuthorityId?: string
  },
) =>
  Effect.gen(function* () {
    const signatureVerifier = makeFixtureSignatureVerifier(trustKeyRegistry)
    const signed = yield* signer.signTrustArtifact({
      body: {
        artifact_type: "revocation_status_event",
        root_program_id: rootProgramId,
        delegated_authority_id: delegatedAuthorityId,
        signed_by: input.signedBy,
      },
      signed_by: input.signedBy,
      root_program_id: rootProgramId,
      ...(input.delegatedAuthorityId
        ? { delegated_authority_id: input.delegatedAuthorityId }
        : {}),
    })

    return yield* signatureVerifier.verifyTrustArtifact(signed.body)
  })

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Signer recovery smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
