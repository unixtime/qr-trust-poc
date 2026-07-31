import { Console, Effect } from "effect"

import {
  EventBus,
  InMemoryEventBusLive,
  makeArtifactPublicationService,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryTrustKeyRegistry,
  makeInMemoryVerifierCache,
  makeScannerDecisionService,
  makeVerifierSyncService,
  makeFixtureSignatureVerifier,
  makeFixtureTrustArtifactSigner,
  type ArtifactPublicationResult,
  type ArtifactPublicationServiceShape,
  type NetworkError,
  type TrustArtifactSignerShape,
  type TrustKeyStatus,
} from "../index.js"
import {
  demoDelegatedAuthorityTrustKey,
} from "../services/trust-key-registry.js"
import { demoIssuerProjection } from "../services/verifier-cache.js"

const observedAt = new Date("2026-05-17T00:00:00Z")

const program = Effect.gen(function* () {
  const eventBus = yield* EventBus
  const artifactStore = makeInMemoryArtifactStore()
  const cache = makeInMemoryVerifierCache()
  const trustKeyRegistry = makeInMemoryTrustKeyRegistry()
  const publisher = makeArtifactPublicationService(artifactStore, eventBus)
  const governancePublisher = makeGovernancePublicationService(publisher)
  const signatureVerifier = makeFixtureSignatureVerifier(trustKeyRegistry)
  const signer = makeFixtureTrustArtifactSigner()
  const verifierSync = makeVerifierSyncService(
    artifactStore,
    eventBus,
    cache,
    signatureVerifier,
    trustKeyRegistry,
  )
  const scanner = makeScannerDecisionService(cache, eventBus)

  yield* governancePublisher.publishReferenceBundle(observedAt)
  yield* verifierSync.syncRecent()

  const rootSignerAccepted = yield* signatureVerifier.verifyTrustArtifact(
    yield* signSummary(
      signer,
      {
        artifact_type: "revocation_status_event",
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        signed_by: demoIssuerProjection.namespace.root_program_id,
      },
      demoIssuerProjection.namespace.root_program_id,
    ),
  )
  const authoritySignerAccepted = yield* signatureVerifier.verifyTrustArtifact(
    yield* signSummary(
      signer,
      {
        artifact_type: "revocation_status_event",
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        delegated_authority_id:
          demoIssuerProjection.namespace.delegated_authority_id,
        signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      },
      demoIssuerProjection.namespace.delegated_authority_id,
      demoIssuerProjection.namespace.delegated_authority_id,
    ),
  )
  const scopedAuthorityArtifact = yield* signSummary(
    signer,
    {
      artifact_type: "revocation_status_event",
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      signed_by: demoIssuerProjection.namespace.delegated_authority_id,
    },
    demoIssuerProjection.namespace.delegated_authority_id,
    demoIssuerProjection.namespace.delegated_authority_id,
  )
  const {
    delegated_authority_id: _removedDelegatedAuthorityId,
    ...scopedAuthorityWithoutScope
  } = scopedAuthorityArtifact
  const scopedAuthorityRejected = yield* signatureVerifier.verifyTrustArtifact(
    scopedAuthorityWithoutScope,
  )
  const unsupportedAlgorithmRejected =
    yield* signatureVerifier.verifyTrustArtifact(
      yield* signSummary(
        signer,
        {
          artifact_type: "revocation_status_event",
          root_program_id: demoIssuerProjection.namespace.root_program_id,
          delegated_authority_id:
            demoIssuerProjection.namespace.delegated_authority_id,
          signed_by: demoIssuerProjection.namespace.delegated_authority_id,
          accepted_algorithm_ids: ["rsa-fixture"],
        },
        demoIssuerProjection.namespace.delegated_authority_id,
        demoIssuerProjection.namespace.delegated_authority_id,
      ),
    )
  const revokedKeyVerifier = makeFixtureSignatureVerifier(
    makeInMemoryTrustKeyRegistry([
      {
        ...demoDelegatedAuthorityTrustKey,
        status: "revoked",
      },
    ]),
  )
  const revokedKeyRejected = yield* revokedKeyVerifier.verifyTrustArtifact(
    yield* signSummary(
      signer,
      {
        artifact_type: "revocation_status_event",
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        delegated_authority_id:
          demoIssuerProjection.namespace.delegated_authority_id,
        signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      },
      demoIssuerProjection.namespace.delegated_authority_id,
      demoIssuerProjection.namespace.delegated_authority_id,
    ),
  )

  const beforeInvalidStatus = yield* scanner.decide({
    payload: "https://acme.example/pay",
    observedAt,
  })

  yield* publishStatusEvent(publisher, signer, {
    artifactId: "art_status_acme_demo_bad_signer_v1",
    statusEventId: "status:acme-demo:bad-signer:v1",
    status: "suspended",
    signedBy: "issuer:acme-demo",
    reason: "unauthorized signer must not mutate verifier cache",
  })

  const badSignerSync = yield* verifierSync.syncRecent()
  const afterBadSigner = yield* scanner.decide({
    payload: "https://acme.example/pay",
    observedAt,
  })

  yield* publishStatusEvent(publisher, signer, {
    artifactId: "art_status_acme_demo_invalid_signature_v1",
    statusEventId: "status:acme-demo:invalid-signature:v1",
    status: "suspended",
    signedBy: demoIssuerProjection.namespace.delegated_authority_id,
    reason: "tampered signed event must not mutate verifier cache",
    tamperAfterSigning: true,
  })

  const invalidSignatureSync = yield* verifierSync.syncRecent()
  const afterInvalidSignature = yield* scanner.decide({
    payload: "https://acme.example/pay",
    observedAt,
  })

  yield* publishStatusEvent(publisher, signer, {
    artifactId: "art_status_acme_demo_valid_suspension_v1",
    statusEventId: "status:acme-demo:valid-suspension:v1",
    status: "suspended",
    signedBy: demoIssuerProjection.namespace.delegated_authority_id,
    reason: "valid authority signer must remove active issuer cache",
  })

  const validSuspensionSync = yield* verifierSync.syncRecent()
  const afterValidSuspension = yield* scanner.decide({
    payload: "https://acme.example/pay",
    observedAt,
  })

  yield* publishStatusEvent(publisher, signer, {
    artifactId: "art_status_authority_key_revoked_v1",
    statusEventId: "status:key:authority:revoked:v1",
    status: "revoked",
    signedBy: demoIssuerProjection.namespace.delegated_authority_id,
    reason: "valid authority signer can revoke its own active signing key",
    target: {
      target_type: "trust_key",
      key_id: demoDelegatedAuthorityTrustKey.key_id,
    },
  })

  const keyRevocationSync = yield* verifierSync.syncRecent()
  const afterKeyRevocation = yield* signatureVerifier.verifyTrustArtifact(
    yield* signSummary(
      signer,
      {
        artifact_type: "revocation_status_event",
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        delegated_authority_id:
          demoIssuerProjection.namespace.delegated_authority_id,
        signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      },
      demoIssuerProjection.namespace.delegated_authority_id,
      demoIssuerProjection.namespace.delegated_authority_id,
    ),
  )

  yield* assertSmoke(
    beforeInvalidStatus.decision_color === "green",
    "initial governance sync did not produce green",
  )
  yield* assertSmoke(
    rootSignerAccepted.accepted,
    "root signer key was not accepted",
  )
  yield* assertSmoke(
    authoritySignerAccepted.accepted,
    "delegated authority signer key was not accepted",
  )
  yield* assertSmoke(
    scopedAuthorityRejected.reason === "scope_mismatch",
    "delegated authority key without authority scope was not rejected",
  )
  yield* assertSmoke(
    unsupportedAlgorithmRejected.reason === "algorithm_not_accepted",
    "unsupported signing algorithm was not rejected",
  )
  yield* assertSmoke(
    revokedKeyRejected.reason === "key_not_active",
    "revoked signer key was not rejected",
  )
  yield* assertSmoke(
    badSignerSync.rejected_status_events.some((entry) =>
      entry.endsWith(":key_not_found"),
    ),
    "unauthorized status signer was not rejected",
  )
  yield* assertSmoke(
    afterBadSigner.decision_color === "green",
    "unauthorized signer changed verifier cache",
  )
  yield* assertSmoke(
    invalidSignatureSync.rejected_status_events.some((entry) =>
      entry.endsWith(":signature_verification_failed"),
    ),
    "tampered signature was not rejected",
  )
  yield* assertSmoke(
    afterInvalidSignature.decision_color === "green",
    "tampered signature changed verifier cache",
  )
  yield* assertSmoke(
    validSuspensionSync.applied_status_events === 1,
    "valid status event was not applied",
  )
  yield* assertSmoke(
    afterValidSuspension.decision_color !== "green",
    "valid suspension did not remove active issuer cache",
  )
  yield* assertSmoke(
    keyRevocationSync.applied_key_status_events === 1,
    "valid trust-key status event was not applied",
  )
  yield* assertSmoke(
    afterKeyRevocation.reason === "key_not_active",
    "revoked trust key still accepted subsequent signatures",
  )

  yield* Console.log(
    JSON.stringify(
      {
        direct_signature_checks: {
          root_signer: rootSignerAccepted.reason,
          authority_signer: authoritySignerAccepted.reason,
          scoped_authority_without_scope: scopedAuthorityRejected.reason,
          unsupported_algorithm: unsupportedAlgorithmRejected.reason,
          revoked_key: revokedKeyRejected.reason,
        },
        before_invalid_status: beforeInvalidStatus.decision_color,
        bad_signer_sync: {
          applied_status_events: badSignerSync.applied_status_events,
          rejected_status_events: badSignerSync.rejected_status_events,
        },
        after_bad_signer: afterBadSigner.decision_color,
        invalid_signature_sync: {
          applied_status_events: invalidSignatureSync.applied_status_events,
          rejected_status_events: invalidSignatureSync.rejected_status_events,
        },
        after_invalid_signature: afterInvalidSignature.decision_color,
        valid_suspension_sync: {
          applied_status_events: validSuspensionSync.applied_status_events,
          rejected_status_events: validSuspensionSync.rejected_status_events,
        },
        after_valid_suspension: afterValidSuspension.decision_color,
        key_revocation_sync: {
          applied_key_status_events:
            keyRevocationSync.applied_key_status_events,
          rejected_status_events: keyRevocationSync.rejected_status_events,
        },
        after_key_revocation: afterKeyRevocation.reason,
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

interface StatusEventFixtureInput {
  readonly artifactId: string
  readonly statusEventId: string
  readonly status: Exclude<TrustKeyStatus, "active">
  readonly signedBy: string
  readonly reason: string
  readonly target?: {
    readonly target_type: "issuer_record" | "trust_key"
    readonly issuer_id?: string
    readonly key_id?: string
  }
  readonly tamperAfterSigning?: boolean
}

const publishStatusEvent = (
  publisher: ArtifactPublicationServiceShape,
  signer: TrustArtifactSignerShape,
  input: StatusEventFixtureInput,
): Effect.Effect<ArtifactPublicationResult, NetworkError> => {
  return Effect.gen(function* () {
    const signed = yield* signer.signTrustArtifact({
      body: {
        artifact_type: "revocation_status_event",
        schema_version: "0.1.0",
        status_event_id: input.statusEventId,
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        delegated_authority_id:
          demoIssuerProjection.namespace.delegated_authority_id,
        target: input.target ?? {
          target_type: "issuer_record",
          issuer_id: demoIssuerProjection.namespace.issuer_id,
        },
        status: input.status,
        reason: input.reason,
        effective_at: observedAt.toISOString(),
        signed_by: input.signedBy,
      },
      signed_by: input.signedBy,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
    })

    const body = input.tamperAfterSigning
      ? {
          ...signed.body,
          reason: `${signed.body.reason} after signature creation`,
        }
      : signed.body

    return yield* publisher.publishArtifact({
      artifact_type: "revocation_status_event",
      artifact_id: input.artifactId,
      version: 1,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
      issuer_id: demoIssuerProjection.namespace.issuer_id,
      body,
      occurredAt: observedAt,
      eventType: "issuer.status.changed",
      reason: input.reason,
    })
  })
}

const signSummary = <T extends Record<string, unknown>>(
  signer: TrustArtifactSignerShape,
  artifact: T,
  signedBy: string,
  delegatedAuthorityId?: string,
) =>
  Effect.map(
    signer.signTrustArtifact({
      body: artifact,
      signed_by: signedBy,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      ...(delegatedAuthorityId
        ? { delegated_authority_id: delegatedAuthorityId }
        : {}),
    }),
    (result) => result.body,
  )

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Signature verification smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
