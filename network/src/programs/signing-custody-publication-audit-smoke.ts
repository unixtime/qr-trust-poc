import { Console, Effect } from "effect"

import { persistenceError } from "../errors.js"
import {
  EventBus,
  InMemoryEventBusLive,
  decodePostgresArtifactPublicationWorkItemRows,
  makeArtifactPublicationQueueWorker,
  makeArtifactPublicationService,
  makeInMemoryArtifactStore,
  makePostgresArtifactPublicationQueueStore,
  makeSigningCustodyPublicationAuditExport,
  reasonCodeFromPublicationFailure,
  referenceRootManifestBody,
  renderSigningCustodyAuditJsonl,
  type ArtifactPublicationServiceShape,
  type PostgresArtifactPublicationQueueExecutorShape,
  type SqlCommand,
  type SigningCustodyPublicationAuditOutcome,
} from "../index.js"

const observedAt = new Date("2026-05-21T00:00:00Z")
const rootProgramId = "root:qrtrust-demo:2026"
const failedFixtureReason = "Fixture publication failed."

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
      worker_id: "worker:signing-custody-publication-audit-smoke",
      batch_size: 2,
      now: () => observedAt,
    },
  )

  const report = yield* queueWorker.processOnce()
  const auditExport = makeSigningCustodyPublicationAuditExport({
    exportId: "signing-custody-publication-audit-smoke",
    generatedAt: observedAt.toISOString(),
    scope: { root_program_id: rootProgramId },
    workerReport: report,
    resolveMetadata: managedCustodyMetadata,
  })
  const jsonl = renderSigningCustodyAuditJsonl(auditExport)
  const parsedJsonl = jsonl.split("\n").map((line) => JSON.parse(line))
  const publishedEntry = auditExport.entries.find(
    (entry) => entry.publication_result === "published",
  )
  const failedEntry = auditExport.entries.find(
    (entry) => entry.publication_result === "failed",
  )

  yield* assertSmoke(
    auditExport.summary.entry_count === 2 &&
      auditExport.summary.published === 1 &&
      auditExport.summary.failed === 1,
    "publication audit export summary did not match worker outcomes",
  )
  yield* assertSmoke(
    publishedEntry?.artifact_id === "art_root_queue_demo_v1" &&
      publishedEntry.artifact_hash.startsWith("sha256:"),
    "publication audit export did not preserve successful artifact metadata",
  )
  yield* assertSmoke(
    failedEntry?.artifact_id === "art_bad_publication" &&
      failedEntry.reason_codes?.[0] ===
        reasonCodeFromPublicationFailure(failedFixtureReason),
    "publication audit export did not preserve failed artifact metadata",
  )
  yield* assertSmoke(
    parsedJsonl.length === 2 &&
      parsedJsonl.every(
        (entry) =>
          typeof entry.provider_audit_id === "string" &&
          entry.custody_provider_ref ===
            "managed://qrtrust-reference/publication-worker",
      ),
    "publication audit JSONL is not public-safe managed-custody evidence",
  )

  yield* Console.log(
    JSON.stringify(
      {
        export_id: auditExport.export_id,
        summary: auditExport.summary,
        entries: auditExport.entries.map((entry) => ({
          artifact_id: entry.artifact_id,
          publication_result: entry.publication_result,
          provider_audit_id: entry.provider_audit_id,
          reason_codes: entry.reason_codes ?? [],
        })),
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

const managedCustodyMetadata = (
  outcome: SigningCustodyPublicationAuditOutcome,
) => ({
  signer_id: `signer:${outcome.root_program_id}:publication-worker`,
  key_id: `key:${outcome.root_program_id}:ed25519:managed`,
  algorithm_id: "ed25519",
  custody_provider_ref: "managed://qrtrust-reference/publication-worker",
  provider_audit_id: `managed-audit:${outcome.work_item_id}`,
})

const failingOnBadFixturePublisher = (
  basePublisher: ArtifactPublicationServiceShape,
): ArtifactPublicationServiceShape => ({
  publishArtifact: (input) =>
    input.artifact_id === "art_bad_publication"
      ? Effect.fail(
          persistenceError(
            failedFixtureReason,
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
        `Signing custody publication audit smoke failed: ${message}`,
      )
    }
  })

Effect.runPromise(program)
