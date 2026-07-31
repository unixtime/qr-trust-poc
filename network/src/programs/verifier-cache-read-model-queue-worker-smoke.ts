import { Console, Effect } from "effect"

import {
  EventBus,
  InMemoryEventBusLive,
  decodePostgresVerifierCacheWorkItemRows,
  makeArtifactPublicationService,
  makeFixtureTrustArtifactSigner,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makePostgresPersistenceService,
  makePostgresVerifierCacheReadModelQueueStore,
  makeRecordingPostgresStatementSink,
  makeVerifierCacheReadModelQueueWorker,
  makeVerifierCacheReadModelWorker,
  type PostgresVerifierCacheReadModelQueueExecutorShape,
  type SqlCommand,
} from "../index.js"
import { demoIssuerProjection } from "../services/verifier-cache.js"

const observedAt = new Date("2026-05-17T00:00:00Z")

const program = Effect.gen(function* () {
  const eventBus = yield* EventBus
  const artifactStore = makeInMemoryArtifactStore()
  const publisher = makeArtifactPublicationService(artifactStore, eventBus)
  const governancePublisher = makeGovernancePublicationService(publisher)
  const signer = makeFixtureTrustArtifactSigner()
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
        reason: "active status event proves queue worker materialization",
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
    reason: "signed active status for queue-worker smoke",
  })

  const executor = makeRecordingQueueExecutor([
    {
      work_item_id: "11111111-1111-4111-8111-111111111111",
      verifier_id: "verifier:local-demo",
      root_manifest_artifact_id: publishedGovernance.root_manifest_artifact_id,
      delegated_authority_manifest_artifact_id:
        publishedGovernance.delegated_authority_artifact_id,
      issuer_record_artifact_id: publishedGovernance.issuer_record_artifact_id,
      destination_policy_artifact_id:
        publishedGovernance.destination_policy_artifact_id,
      status_event_artifact_id: publishedIssuerStatus.artifact.artifact_id,
      materialized_at: observedAt.toISOString(),
      scanner_probes: JSON.stringify([
        {
          payload: "https://acme.example/pay",
        },
      ]),
    },
    {
      work_item_id: "22222222-2222-4222-8222-222222222222",
      verifier_id: "verifier:local-demo",
      root_manifest_artifact_id: publishedGovernance.root_manifest_artifact_id,
      delegated_authority_manifest_artifact_id:
        publishedGovernance.delegated_authority_artifact_id,
      issuer_record_artifact_id: publishedGovernance.issuer_record_artifact_id,
      destination_policy_artifact_id:
        publishedGovernance.destination_policy_artifact_id,
      status_event_artifact_id: "art_status_missing_for_failure",
      materialized_at: observedAt,
      scanner_probes: [
        {
          payload: "https://acme.example/pay",
          issuer_hint_host: "acme.example",
        },
      ],
    },
  ])
  const queueStore = makePostgresVerifierCacheReadModelQueueStore(executor)
  const queueWorker = makeVerifierCacheReadModelQueueWorker(
    queueStore,
    readModelWorker,
    {
      worker_id: "worker:queue-smoke",
      batch_size: 2,
      now: () => observedAt,
    },
  )

  const report = yield* queueWorker.processOnce()
  const queueCommands = executor.recorded()
  const persistenceCommands = persistenceSink.recorded()
  const claimCommand = queueCommands[0]
  const decoded = yield* decodePostgresVerifierCacheWorkItemRows([
    {
      work_item_id: "33333333-3333-4333-8333-333333333333",
      verifier_id: "verifier:decode-demo",
      root_manifest_artifact_id: "art_root",
      delegated_authority_manifest_artifact_id: "art_authority",
      issuer_record_artifact_id: "art_issuer",
      destination_policy_artifact_id: "art_policy",
      status_event_artifact_id: "art_status",
      materialized_at: "2026-05-17T00:00:00.000Z",
      scanner_probes: JSON.stringify([
        {
          payload: "https://decode.example/pay",
          issuer_hint_host: "decode.example",
        },
      ]),
    },
  ])

  yield* assertSmoke(report.claimed === 2, "queue worker did not claim two items")
  yield* assertSmoke(
    report.completed === 1 && report.failed === 1,
    "queue worker did not separate one success and one failure",
  )
  yield* assertSmoke(
    report.marked_completed === 1 && report.marked_failed === 1,
    "queue worker did not mark completed and failed rows",
  )
  yield* assertSmoke(
    queueCommands.map((command) => command.name).join(",") ===
      [
        "verifier_cache_work_items.claim_pending",
        "verifier_cache_work_items.mark_completed",
        "verifier_cache_work_items.mark_failed",
      ].join(","),
    "queue commands were not emitted in claim/complete/fail order",
  )
  yield* assertSmoke(
    claimCommand?.text.includes("for update skip locked") === true &&
      claimCommand.text.includes("work_status = 'processing'"),
    "claim command does not use non-blocking atomic processing claims",
  )
  yield* assertSmoke(
    persistenceCommands[0]?.name === "verifier_cache_entries.upsert" &&
      persistenceCommands[1]?.name === "scanner_decisions.insert",
    "successful queue item did not persist the verifier-cache read model",
  )
  yield* assertSmoke(
    decoded[0]?.work_item.scanner_probes?.[0]?.issuer_hint_host ===
      "decode.example",
    "Postgres scanner probe decoding did not preserve issuer_hint_host",
  )

  yield* Console.log(
    JSON.stringify(
      {
        claimed: report.claimed,
        completed: report.completed,
        failed: report.failed,
        successes: report.successes.map((success) => ({
          work_item_id: success.work_item_id,
          cache_entry_id: success.cache_entry_id,
        })),
        failures: report.failures.map((failure) => ({
          work_item_id: failure.work_item_id,
          reason: failure.reason,
        })),
        queue_command_names: queueCommands.map((command) => command.name),
        persistence_command_names: persistenceCommands.map(
          (command) => command.name,
        ),
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

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
        `Verifier cache read-model queue-worker smoke failed: ${message}`,
      )
    }
  })

Effect.runPromise(program)
