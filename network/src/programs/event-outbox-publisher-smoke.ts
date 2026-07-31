import { Console, Effect } from "effect"

import {
  EventBus,
  InMemoryEventBusLive,
  makeArtifactPublicationService,
  makeEventOutboxPublisher,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryVerifierCache,
  makeLiveJetStreamMessageSink,
  makeScannerDecisionService,
  makeVerifierSyncService,
  type EventOutboxRecord,
} from "../index.js"

const observedAt = new Date("2026-05-18T00:00:00Z")

const program = Effect.gen(function* () {
  const eventBus = yield* EventBus
  const artifactStore = makeInMemoryArtifactStore()
  const cache = makeInMemoryVerifierCache()
  const publisher = makeArtifactPublicationService(artifactStore, eventBus)
  const governancePublisher = makeGovernancePublicationService(publisher)
  const verifierSync = makeVerifierSyncService(artifactStore, eventBus, cache)
  const scanner = makeScannerDecisionService(cache, eventBus)
  const capturedSubjects: string[] = []

  yield* governancePublisher.publishReferenceBundle(observedAt)
  yield* verifierSync.syncRecent()
  yield* scanner.decide({
    payload: "https://acme.example/pay",
    observedAt,
  })

  const events = yield* eventBus.recent()
  const records: EventOutboxRecord[] = [
    ...events.map((event, index) => ({
      outbox_id: `outbox_${index + 1}`,
      event_id: event.envelope.event_id,
      payload: event,
    })),
    {
      outbox_id: "outbox_bad_payload",
      event_id: "evt_bad_payload",
      payload: { body: "missing envelope" },
    },
    {
      outbox_id: "outbox_invalid_envelope",
      event_id: "evt_invalid_envelope",
      payload: {
        envelope: {
          event_id: "evt_invalid_envelope",
          type: "issuer.record.published",
          occurred_at: "not-a-date",
          root_program_id: "not-a-root",
          artifact_id: "",
          artifact_hash: "md5:not-a-contract-hash",
          version: 1.5,
        },
      },
    },
  ]

  const sink = makeLiveJetStreamMessageSink({
    publish: async (subject) => {
      capturedSubjects.push(subject)
    },
  })
  const outboxPublisher = makeEventOutboxPublisher(sink)
  const report = yield* outboxPublisher.publishBatch(records)

  yield* assertSmoke(
    report.attempted === records.length,
    "outbox publisher should account for every attempted row",
  )
  yield* assertSmoke(
    report.published === events.length,
    "only contract-valid outbox rows should publish successfully",
  )
  yield* assertSmoke(
    report.failed === 2,
    "invalid outbox rows should be reported as failed for retry or quarantine",
  )
  yield* assertSmoke(
    report.failures[0]?.outbox_id === "outbox_bad_payload",
    "the malformed row should be isolated in the failure report",
  )
  yield* assertSmoke(
    report.failures[1]?.outbox_id === "outbox_invalid_envelope",
    "the contract-invalid envelope should be isolated in the failure report",
  )
  yield* assertSmoke(
    capturedSubjects.includes(
      "qrtrust.root-qrtrust-demo-2026.scanner.decision.recorded.v1",
    ),
    "scanner decision outbox rows should publish to the scanner audit subject",
  )
  yield* assertSmoke(
    sink.recorded().length === report.published,
    "only successfully published rows should be recorded by the sink",
  )

  yield* Console.log(
    JSON.stringify(
      {
        attempted: report.attempted,
        published: report.published,
        failed: report.failed,
        first_subject: report.successes[0]?.subject,
        failed_outbox_id: report.failures[0]?.outbox_id,
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Event outbox publisher smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
