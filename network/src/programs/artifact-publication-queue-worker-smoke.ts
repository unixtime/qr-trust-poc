import { Console, Effect } from "effect"

import {
  EventBus,
  InMemoryEventBusLive,
  decodePostgresArtifactPublicationWorkItemRows,
  makeArtifactPublicationQueueWorker,
  makeArtifactPublicationService,
  makeInMemoryArtifactStore,
  makePostgresArtifactPublicationQueueStore,
  referenceRootManifestBody,
  type ArtifactPublicationServiceShape,
  type PostgresArtifactPublicationQueueExecutorShape,
  type SqlCommand,
} from "../index.js"
import { persistenceError } from "../errors.js"

const observedAt = new Date("2026-05-17T00:00:00Z")
const rootProgramId = "root:qrtrust-demo:2026"

const program = Effect.gen(function* () {
  const eventBus = yield* EventBus
  const artifactStore = makeInMemoryArtifactStore()
  const basePublisher = makeArtifactPublicationService(artifactStore, eventBus)
  const publisher = failingOnBadFixturePublisher(basePublisher)

  const executor = makeRecordingQueueExecutor([
    {
      work_item_id: "11111111-1111-4111-8111-111111111111",
      artifact_type: "root_manifest",
      artifact_id: "art_root_queue_demo_v1",
      version: 1,
      root_program_id: rootProgramId,
      canonical_json: JSON.stringify(referenceRootManifestBody()),
      occurred_at: observedAt.toISOString(),
      event_type: "root.manifest.published",
      reason: "queue worker fixture publication",
    },
    {
      work_item_id: "22222222-2222-4222-8222-222222222222",
      artifact_type: "root_manifest",
      artifact_id: "art_bad_publication",
      version: 1,
      root_program_id: rootProgramId,
      canonical_json: referenceRootManifestBody(),
      occurred_at: observedAt,
      event_type: "root.manifest.published",
      reason: "intentional failed queue item",
    },
  ])
  const queueStore = makePostgresArtifactPublicationQueueStore(executor)
  const queueWorker = makeArtifactPublicationQueueWorker(
    queueStore,
    publisher,
    {
      worker_id: "worker:artifact-publication-smoke",
      batch_size: 2,
      now: () => observedAt,
    },
  )

  const report = yield* queueWorker.processOnce()
  const queueCommands = executor.recorded()
  const claimCommand = queueCommands[0]
  const storedArtifact = yield* artifactStore.get("art_root_queue_demo_v1")
  const recentEvents = yield* eventBus.recent()
  const decoded = yield* decodePostgresArtifactPublicationWorkItemRows([
    {
      work_item_id: "33333333-3333-4333-8333-333333333333",
      artifact_type: "destination_policy",
      artifact_id: "art_policy_decode_demo_v4",
      version: "4",
      root_program_id: rootProgramId,
      delegated_authority_id: "authority:decode",
      issuer_id: "issuer:decode",
      destination_policy_id: "policy:decode",
      canonical_json: JSON.stringify({
        artifact_type: "destination_policy",
        destination_policy_id: "policy:decode",
      }),
      occurred_at: "2026-05-17T00:00:00.000Z",
      event_type: "destination_policy.published",
      artifact_ref: "art_policy_decode_demo_v3",
      previous_version: "3",
      reason: "decode coverage",
    },
  ])

  yield* assertSmoke(
    report.claimed === 2,
    "artifact-publication queue did not claim two items",
  )
  yield* assertSmoke(
    report.completed === 1 && report.failed === 1,
    "artifact-publication queue did not separate one success and one failure",
  )
  yield* assertSmoke(
    report.marked_completed === 1 && report.marked_failed === 1,
    "artifact-publication queue did not mark completed and failed rows",
  )
  yield* assertSmoke(
    queueCommands.map((command) => command.name).join(",") ===
      [
        "artifact_publication_work_items.claim_pending",
        "artifact_publication_work_items.mark_completed",
        "artifact_publication_work_items.mark_failed",
      ].join(","),
    "artifact-publication queue commands were not emitted in claim/complete/fail order",
  )
  yield* assertSmoke(
    claimCommand?.text.includes("for update skip locked") === true &&
      claimCommand.text.includes("work_status = 'processing'"),
    "artifact-publication claim command does not use non-blocking atomic processing claims",
  )
  yield* assertSmoke(
    storedArtifact?.artifact_id === "art_root_queue_demo_v1",
    "successful queue item did not write a published artifact",
  )
  yield* assertSmoke(
    recentEvents.length === 1 &&
      report.successes[0]?.event_id.startsWith("evt_") === true,
    "successful queue item did not emit exactly one publication event",
  )
  yield* assertSmoke(
    report.failures[0]?.reason.includes("Fixture publication failed.") === true,
    "failed queue item did not preserve the stable publication failure reason",
  )
  yield* assertSmoke(
    decoded[0]?.input.version === 4 &&
      decoded[0]?.input.previous_version === 3 &&
      decoded[0]?.input.destination_policy_id === "policy:decode",
    "Postgres artifact-publication work-item decoding did not preserve versioned metadata",
  )

  yield* Console.log(
    JSON.stringify(
      {
        claimed: report.claimed,
        completed: report.completed,
        failed: report.failed,
        successes: report.successes.map((success) => ({
          work_item_id: success.work_item_id,
          artifact_id: success.artifact_id,
          event_id: success.event_id,
        })),
        failures: report.failures.map((failure) => ({
          work_item_id: failure.work_item_id,
          reason: failure.reason,
        })),
        queue_command_names: queueCommands.map((command) => command.name),
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

const failingOnBadFixturePublisher = (
  basePublisher: ArtifactPublicationServiceShape,
): ArtifactPublicationServiceShape => ({
  publishArtifact: (input) =>
    input.artifact_id === "art_bad_publication"
      ? Effect.fail(
          persistenceError(
            "Fixture publication failed.",
            new Error("intentional queue failure"),
          ),
        )
      : basePublisher.publishArtifact(input),
})

const makeRecordingQueueExecutor = (
  rows: ReadonlyArray<Record<string, unknown>>,
): PostgresArtifactPublicationQueueExecutorShape => {
  const commands: SqlCommand[] = []

  return {
    execute: (command) =>
      Effect.sync(() => {
        commands.push(command)
        return command
      }),
    queryArtifactPublicationWorkItems: (command) =>
      Effect.gen(function* () {
        commands.push(command)
        return yield* decodePostgresArtifactPublicationWorkItemRows(rows)
      }),
    recorded: () => [...commands],
  }
}

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(
        `Artifact publication queue-worker smoke failed: ${message}`,
      )
    }
  })

Effect.runPromise(program)
