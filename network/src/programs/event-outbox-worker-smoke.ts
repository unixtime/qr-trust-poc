import { Console, Effect } from "effect"

import {
  EventBus,
  InMemoryEventBusLive,
  claimEventOutboxBatchCommand,
  decodePostgresEventOutboxRows,
  makeArtifactPublicationService,
  makeEventOutboxPublisher,
  makeEventOutboxWorker,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryVerifierCache,
  makeLiveJetStreamMessageSink,
  makeScannerDecisionService,
  makeVerifierSyncService,
  markEventOutboxFailedCommand,
  markEventOutboxPublishedCommand,
  type EventOutboxClaimInput,
  type EventOutboxPublishFailure,
  type EventOutboxPublishSuccess,
  type EventOutboxRecord,
  type EventOutboxWorkerStoreShape,
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
      outbox_id: uuidFor(index + 1),
      event_id: event.envelope.event_id,
      payload: event,
    })),
    {
      outbox_id: uuidFor(999),
      event_id: "evt_bad_payload",
      payload: { body: "missing envelope" },
    },
  ]
  const store = new InMemoryEventOutboxWorkerStore(records)
  const sink = makeLiveJetStreamMessageSink({
    publish: async (subject) => {
      capturedSubjects.push(subject)
    },
  })
  const worker = makeEventOutboxWorker(
    store,
    makeEventOutboxPublisher(sink),
    {
      worker_id: "worker-a",
      batch_size: 20,
      claim_ttl_ms: 60_000,
      now: deterministicClock(
        new Date("2026-05-18T00:01:00Z"),
        new Date("2026-05-18T00:01:03Z"),
      ),
    },
  )

  const report = yield* worker.processOnce()

  yield* assertSmoke(
    report.claimed === records.length,
    "worker should claim all available rows in the batch",
  )
  yield* assertSmoke(
    report.published === events.length,
    "valid claimed rows should be published",
  )
  yield* assertSmoke(
    report.failed === 1,
    "malformed claimed rows should be isolated as failed",
  )
  yield* assertSmoke(
    report.marked_published === events.length,
    "published rows should be marked published after propagation accepts them",
  )
  yield* assertSmoke(
    report.marked_failed === 1,
    "failed rows should be marked failed for operator review",
  )
  yield* assertSmoke(
    store.claims[0]?.worker_id === "worker-a",
    "worker claim should include the stable worker id",
  )
  yield* assertSmoke(
    store.claims[0]?.claim_expires_at.toISOString() ===
      "2026-05-18T00:02:00.000Z",
    "worker claim should carry a bounded claim expiry",
  )
  yield* assertSmoke(
    capturedSubjects.includes(
      "qrtrust.root-qrtrust-demo-2026.scanner.decision.recorded.v1",
    ),
    "claimed scanner decisions should publish to the scanner audit subject",
  )

  const claimCommand = claimEventOutboxBatchCommand({
    worker_id: "worker-a",
    batch_size: 50,
    claimed_at: new Date("2026-05-18T00:03:00Z"),
    claim_expires_at: new Date("2026-05-18T00:04:00Z"),
    max_retry_attempts: 3,
  })
  const publishedCommand = markEventOutboxPublishedCommand(
    store.published,
    new Date("2026-05-18T00:05:00Z"),
  )
  const failedCommand = markEventOutboxFailedCommand(
    store.failed,
    new Date("2026-05-18T00:05:00Z"),
  )
  const decodedRows = yield* decodePostgresEventOutboxRows([
    {
      outbox_id: uuidFor(77),
      event_id: "evt_decoded",
      payload: JSON.stringify({ envelope: { event_id: "evt_decoded" } }),
    },
  ])

  yield* assertSmoke(
    claimCommand.text.includes("for update skip locked"),
    "claim command must use skip-locked row claiming",
  )
  yield* assertSmoke(
    claimCommand.text.includes("publish_status = 'publishing'"),
    "claim command must move rows into the publishing state",
  )
  yield* assertSmoke(
    claimCommand.text.includes("publish_status = 'failed'") &&
      claimCommand.text.includes("attempts < $5::integer"),
    "claim command must reclaim failed rows that are still below the retry limit",
  )
  yield* assertSmoke(
    publishedCommand.name === "event_outbox.mark_published",
    "published command should be named for explicit auditability",
  )
  yield* assertSmoke(
    failedCommand.name === "event_outbox.mark_failed",
    "failed command should be named for explicit auditability",
  )
  yield* assertSmoke(
    failedCommand.values.length === 1 &&
      failedCommand.text.includes("$1::jsonb") &&
      !failedCommand.text.includes("$2::jsonb"),
    "failed command should not pass unused Postgres parameters",
  )
  yield* assertSmoke(
    decodedRows[0]?.payload !== undefined,
    "Postgres outbox rows should decode JSONB string payloads",
  )

  yield* Console.log(
    JSON.stringify(
      {
        worker: {
          claimed: report.claimed,
          published: report.published,
          failed: report.failed,
        },
        claim_command: {
          name: claimCommand.name,
          worker_id: claimCommand.values[0],
          batch_size: claimCommand.values[2],
        },
        mark_commands: [publishedCommand.name, failedCommand.name],
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

class InMemoryEventOutboxWorkerStore implements EventOutboxWorkerStoreShape {
  readonly claims: EventOutboxClaimInput[] = []
  readonly published: EventOutboxPublishSuccess[] = []
  readonly failed: EventOutboxPublishFailure[] = []
  private readonly pending: EventOutboxRecord[]

  constructor(records: ReadonlyArray<EventOutboxRecord>) {
    this.pending = [...records]
  }

  claimPending(input: EventOutboxClaimInput) {
    return Effect.sync(() => {
      this.claims.push(input)
      return this.pending.splice(0, input.batch_size)
    })
  }

  markPublished(
    successes: ReadonlyArray<EventOutboxPublishSuccess>,
    _publishedAt: Date,
  ) {
    return Effect.sync(() => {
      this.published.push(...successes)
      return successes.length
    })
  }

  markFailed(
    failures: ReadonlyArray<EventOutboxPublishFailure>,
    _failedAt: Date,
  ) {
    return Effect.sync(() => {
      this.failed.push(...failures)
      return failures.length
    })
  }
}

const deterministicClock = (
  ...dates: ReadonlyArray<Date>
): (() => Date) => {
  let index = 0

  return () => {
    const date = dates[index] ?? dates.at(-1)
    index += 1

    if (!date) {
      return new Date("2026-05-18T00:00:00Z")
    }

    return new Date(date)
  }
}

const uuidFor = (index: number): string =>
  `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Event outbox worker smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
