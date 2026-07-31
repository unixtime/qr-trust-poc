import { Console, Effect } from "effect"

import {
  EventBus,
  InMemoryEventBusLive,
  makeArtifactPublicationService,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryVerifierCache,
  makeLiveJetStreamMessageSink,
  makeNatsPropagationService,
  makeScannerDecisionService,
  makeVerifierSyncService,
  type LiveJetStreamPublishOptions,
} from "../index.js"

const observedAt = new Date("2026-05-18T00:00:00Z")

interface CapturedPublish {
  readonly subject: string
  readonly payload: string
  readonly options: LiveJetStreamPublishOptions
}

const program = Effect.gen(function* () {
  const eventBus = yield* EventBus
  const artifactStore = makeInMemoryArtifactStore()
  const cache = makeInMemoryVerifierCache()
  const publisher = makeArtifactPublicationService(artifactStore, eventBus)
  const governancePublisher = makeGovernancePublicationService(publisher)
  const verifierSync = makeVerifierSyncService(artifactStore, eventBus, cache)
  const scanner = makeScannerDecisionService(cache, eventBus)
  const captured: CapturedPublish[] = []

  yield* governancePublisher.publishReferenceBundle(observedAt)
  yield* verifierSync.syncRecent()
  yield* scanner.decide({
    payload: "https://acme.example/pay",
    observedAt,
  })

  const events = yield* eventBus.recent()
  const liveSink = makeLiveJetStreamMessageSink({
    publish: async (subject, payload, options) => {
      captured.push({
        subject,
        payload: new TextDecoder().decode(payload),
        options,
      })
    },
  })
  const livePropagation = makeNatsPropagationService(liveSink)
  const report = yield* livePropagation.publishEvents(events)

  yield* assertSmoke(
    captured.length === events.length,
    "live sink should publish each mapped event exactly once",
  )
  yield* assertSmoke(
    captured.every((call) => call.options.messageId.length > 0),
    "live sink must pass a NATS idempotency message id",
  )
  yield* assertSmoke(
    captured.some(
      (call) => call.options.expectedStream === "QRTRUST_SCANNER_AUDIT",
    ),
    "scanner decision events should target the scanner audit stream",
  )
  yield* assertSmoke(
    captured.every((call) => call.payload.includes('"envelope"')),
    "live sink payload should carry the mapped envelope payload",
  )
  yield* assertSmoke(
    captured.every((call) => !call.payload.includes('"body"')),
    "live sink payload must not duplicate full artifact bodies",
  )
  yield* assertSmoke(
    liveSink.recorded().length === captured.length,
    "live sink should retain only successfully published messages",
  )

  const failingSink = makeLiveJetStreamMessageSink({
    publish: async () => {
      throw new Error("broker unavailable")
    },
  })
  const failed = yield* Effect.either(
    makeNatsPropagationService(failingSink).publishEvents(events.slice(0, 1)),
  )
  yield* assertSmoke(
    failed._tag === "Left" && failingSink.recorded().length === 0,
    "broker publish failures should fail closed and avoid successful recordings",
  )

  yield* Console.log(
    JSON.stringify(
      {
        published: report.messages_published,
        captured: captured.length,
        first_subject: captured[0]?.subject,
        streams: Array.from(
          new Set(captured.map((call) => call.options.expectedStream)),
        ),
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Live NATS publisher smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
