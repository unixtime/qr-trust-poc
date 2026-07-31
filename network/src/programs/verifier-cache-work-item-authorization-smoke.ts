import { Console, Effect } from "effect"

import {
  EventBus,
  InMemoryEventBusLive,
  decodePostgresVerifierCacheWorkItemRows,
  makeArtifactPublicationService,
  makeFixtureSignatureVerifier,
  makeFixtureTrustArtifactSigner,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryTrustKeyRegistry,
  makePostgresPersistenceService,
  makePostgresVerifierCacheReadModelQueueStore,
  makeRecordingPostgresStatementSink,
  makeVerifierCacheReadModelQueueWorker,
  makeVerifierCacheReadModelWorkItemAuthorizer,
  makeVerifierCacheReadModelWorker,
  type ArtifactPublicationResult,
  type ArtifactPublicationServiceShape,
  type PostgresVerifierCacheReadModelQueueExecutorShape,
  type SqlCommand,
  type TrustArtifactSignerShape,
} from "../index.js"
import type { NetworkError } from "../errors.js"
import { demoIssuerProjection } from "../services/verifier-cache.js"

const observedAt = new Date("2026-05-17T00:00:00Z")

const program = Effect.gen(function* () {
  const eventBus = yield* EventBus
  const artifactStore = makeInMemoryArtifactStore()
  const publisher = makeArtifactPublicationService(artifactStore, eventBus)
  const governancePublisher = makeGovernancePublicationService(publisher)
  const signer = makeFixtureTrustArtifactSigner()
  const trustKeyRegistry = makeInMemoryTrustKeyRegistry()
  const signatureVerifier = makeFixtureSignatureVerifier(trustKeyRegistry)
  const authorizer = makeVerifierCacheReadModelWorkItemAuthorizer(
    artifactStore,
    signatureVerifier,
  )
  const persistenceSink = makeRecordingPostgresStatementSink()
  const persistence = makePostgresPersistenceService(persistenceSink)
  const readModelWorker = makeVerifierCacheReadModelWorker(
    artifactStore,
    persistence,
    eventBus,
  )
  const publishedGovernance = yield* governancePublisher.publishReferenceBundle(
    observedAt,
  )
  const validStatus = yield* publishActiveStatusEvent({
    artifact_id: "art_status_acme_demo_authorized_v1",
    status_event_id: "status:acme-demo:authorized:v1",
    signed_by: demoIssuerProjection.namespace.delegated_authority_id,
    reason: "delegated authority authorizes cache materialization",
    publisher,
    signer,
  })
  const issuerSignedStatus = yield* publishActiveStatusEvent({
    artifact_id: "art_status_acme_demo_issuer_signed_v1",
    status_event_id: "status:acme-demo:issuer-signed:v1",
    signed_by: demoIssuerProjection.namespace.issuer_id,
    reason: "issuer-signed status event should not authorize cache updates",
    publisher,
    signer,
  })
  const tamperedStatus = yield* publishActiveStatusEvent({
    artifact_id: "art_status_acme_demo_tampered_v1",
    status_event_id: "status:acme-demo:tampered:v1",
    signed_by: demoIssuerProjection.namespace.delegated_authority_id,
    reason: "tampered status event should not authorize cache updates",
    tamper_after_signing: true,
    publisher,
    signer,
  })

  const executor = makeRecordingQueueExecutor([
    makeQueueRow(
      "11111111-1111-4111-8111-111111111111",
      publishedGovernance,
      validStatus.artifact.artifact_id,
    ),
    makeQueueRow(
      "22222222-2222-4222-8222-222222222222",
      publishedGovernance,
      issuerSignedStatus.artifact.artifact_id,
    ),
    makeQueueRow(
      "33333333-3333-4333-8333-333333333333",
      publishedGovernance,
      tamperedStatus.artifact.artifact_id,
    ),
  ])
  const queueStore = makePostgresVerifierCacheReadModelQueueStore(executor)
  const queueWorker = makeVerifierCacheReadModelQueueWorker(
    queueStore,
    readModelWorker,
    {
      worker_id: "worker:authorization-smoke",
      batch_size: 3,
      now: () => observedAt,
      authorizer,
    },
  )

  const report = yield* queueWorker.processOnce()
  const tamperedChainRejected = yield* runTamperedChainFixture()
  const queueCommands = executor.recorded()
  const persistenceCommands = persistenceSink.recorded()

  yield* assertSmoke(
    report.claimed === 3,
    "queue worker did not claim all authorization examples",
  )
  yield* assertSmoke(
    report.completed === 1 && report.failed === 2,
    "authorization did not accept exactly one status event",
  )
  yield* assertSmoke(
    report.marked_completed === 1 && report.marked_failed === 2,
    "authorization did not mark queue rows correctly",
  )
  yield* assertSmoke(
    report.failures.every((failure) =>
      failure.reason.includes(
        "Verifier cache work item status event is not authorized.",
      ),
    ),
    "failed work items did not stop at authorization",
  )
  yield* assertSmoke(
    tamperedChainRejected,
    "tampered governance artifact chain was authorized",
  )
  yield* assertSmoke(
    persistenceCommands.map((command) => command.name).join(",") ===
      ["verifier_cache_entries.upsert", "scanner_decisions.insert"].join(","),
    "unauthorized status events reached the persistence layer",
  )
  yield* assertSmoke(
    queueCommands.map((command) => command.name).join(",") ===
      [
        "verifier_cache_work_items.claim_pending",
        "verifier_cache_work_items.mark_completed",
        "verifier_cache_work_items.mark_failed",
      ].join(","),
    "queue command order changed",
  )

  yield* Console.log(
    JSON.stringify(
      {
        completed: report.completed,
        failed: report.failed,
        authorized_successes: report.successes.map((success) => ({
          work_item_id: success.work_item_id,
          cache_entry_id: success.cache_entry_id,
        })),
        authorization_failures: report.failures.map((failure) => ({
          work_item_id: failure.work_item_id,
          reason: failure.reason,
        })),
        tampered_chain_rejected: tamperedChainRejected,
        persistence_command_names: persistenceCommands.map(
          (command) => command.name,
        ),
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

interface StatusEventFixtureInput {
  readonly artifact_id: string
  readonly status_event_id: string
  readonly signed_by: string
  readonly reason: string
  readonly tamper_after_signing?: boolean
  readonly publisher: ArtifactPublicationServiceShape
  readonly signer: TrustArtifactSignerShape
}

const publishActiveStatusEvent = (
  input: StatusEventFixtureInput,
): Effect.Effect<ArtifactPublicationResult, NetworkError> =>
  Effect.gen(function* () {
    const signed = yield* input.signer.signTrustArtifact({
      body: {
        artifact_type: "revocation_status_event",
        schema_version: "0.1.0",
        status_event_id: input.status_event_id,
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        delegated_authority_id:
          demoIssuerProjection.namespace.delegated_authority_id,
        target: {
          target_type: "issuer_record",
          issuer_id: demoIssuerProjection.namespace.issuer_id,
          certificate_ref: "cert:acme-demo:web-signing:v1",
        },
        status: "active",
        reason: input.reason,
        effective_at: observedAt.toISOString(),
        expires_at: demoIssuerProjection.cache_expires_at,
        signed_by: input.signed_by,
      },
      signed_by: input.signed_by,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
    })
    const body = input.tamper_after_signing
      ? {
          ...signed.body,
          reason: `${signed.body.reason} after signature creation`,
        }
      : signed.body

    return yield* input.publisher.publishArtifact({
      artifact_type: "revocation_status_event",
      artifact_id: input.artifact_id,
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

const runTamperedChainFixture = () =>
  Effect.gen(function* () {
    const eventBus = yield* EventBus
    const artifactStore = makeInMemoryArtifactStore()
    const publisher = makeArtifactPublicationService(artifactStore, eventBus)
    const governancePublisher = makeGovernancePublicationService(publisher)
    const signer = makeFixtureTrustArtifactSigner()
    const signatureVerifier = makeFixtureSignatureVerifier(
      makeInMemoryTrustKeyRegistry(),
    )
    const authorizer = makeVerifierCacheReadModelWorkItemAuthorizer(
      artifactStore,
      signatureVerifier,
    )
    const publishedGovernance = yield* governancePublisher.publishReferenceBundle(
      observedAt,
    )
    const status = yield* publishActiveStatusEvent({
      artifact_id: "art_status_acme_demo_tampered_chain_v1",
      status_event_id: "status:acme-demo:tampered-chain:v1",
      signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      reason: "valid status event cannot authorize tampered governance chain",
      publisher,
      signer,
    })
    const destinationPolicy = yield* artifactStore.get(
      publishedGovernance.destination_policy_artifact_id,
    )
    if (!destinationPolicy) {
      throw new Error("Expected destination policy artifact to exist.")
    }
    yield* artifactStore.put({
      ...destinationPolicy,
      body: tamperedDestinationPolicyBody(destinationPolicy.body),
    })

    const result = yield* Effect.either(
      authorizer.authorize({
        verifier_id: "verifier:local-demo",
        artifacts: {
          root_manifest_artifact_id: publishedGovernance.root_manifest_artifact_id,
          delegated_authority_manifest_artifact_id:
            publishedGovernance.delegated_authority_artifact_id,
          issuer_record_artifact_id: publishedGovernance.issuer_record_artifact_id,
          destination_policy_artifact_id:
            publishedGovernance.destination_policy_artifact_id,
          status_event_artifact_id: status.artifact.artifact_id,
        },
        materialized_at: observedAt,
      }),
    )

    return result._tag === "Left"
  })

const tamperedDestinationPolicyBody = (body: unknown): unknown => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Expected destination policy body.")
  }
  const record = body as Record<string, unknown>
  const runtimePolicy = record.runtime_safety_policy
  if (!runtimePolicy || typeof runtimePolicy !== "object") {
    throw new Error("Expected destination policy runtime policy.")
  }

  return {
    ...record,
    runtime_safety_policy: {
      ...runtimePolicy,
      provider: "tampered-runtime-provider",
    },
  }
}

interface PublishedGovernanceRefs {
  readonly root_manifest_artifact_id: string
  readonly delegated_authority_artifact_id: string
  readonly issuer_record_artifact_id: string
  readonly destination_policy_artifact_id: string
}

const makeQueueRow = (
  workItemId: string,
  governance: PublishedGovernanceRefs,
  statusEventArtifactId: string,
): Record<string, unknown> => ({
  work_item_id: workItemId,
  verifier_id: "verifier:local-demo",
  root_manifest_artifact_id: governance.root_manifest_artifact_id,
  delegated_authority_manifest_artifact_id:
    governance.delegated_authority_artifact_id,
  issuer_record_artifact_id: governance.issuer_record_artifact_id,
  destination_policy_artifact_id: governance.destination_policy_artifact_id,
  status_event_artifact_id: statusEventArtifactId,
  materialized_at: observedAt.toISOString(),
  scanner_probes: JSON.stringify([
    {
      payload: "https://acme.example/pay",
    },
  ]),
})

const makeRecordingQueueExecutor = (
  rows: ReadonlyArray<Record<string, unknown>>,
): PostgresVerifierCacheReadModelQueueExecutorShape => {
  const commands: SqlCommand[] = []

  return {
    execute: (command) =>
      Effect.sync(() => {
        commands.push(command)
        return command
      }),
    queryVerifierCacheWorkItems: (command) =>
      Effect.gen(function* () {
        commands.push(command)
        return yield* decodePostgresVerifierCacheWorkItemRows(rows)
      }),
    recorded: () => [...commands],
  }
}

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(
        `Verifier cache work-item authorization smoke failed: ${message}`,
      )
    }
  })

Effect.runPromise(program)
