import { Console, Effect } from "effect"

import {
  connectNatsJs,
  drainNatsJsConnection,
  ensureQrTrustJetStreamStreams,
  InMemoryEventBusLive,
  makeLiveJetStreamMessageSink,
  makeNatsJsJetStreamPublisher,
  makeNatsPropagationService,
  eventPublicationError,
  type NetworkError,
} from "../index.js"
import { makeReferenceNetworkFixture } from "./reference-network-fixture.js"

const observedAt = new Date("2026-05-18T00:00:00Z")
const natsUrl = process.env.QRTRUST_NETWORK_NATS_URL ?? "nats://127.0.0.1:4222"
const natsUser = process.env.QRTRUST_NETWORK_NATS_USER
const natsPassword = process.env.QRTRUST_NETWORK_NATS_PASSWORD

const program = Effect.acquireUseRelease(
  connectNatsJs({
    servers: natsUrl,
    name: "qrtrust-network-live-broker-smoke",
    timeout_ms: 2_000,
    user: natsUser,
    pass: natsPassword,
  }),
  (connection) =>
    Effect.gen(function* () {
      const manager = yield* Effect.tryPromise({
        try: () => connection.jetstreamManager(),
        catch: (cause): NetworkError =>
          eventPublicationError("Failed to create JetStream manager.", {
            cause,
          }),
      })
      const ensureReport = yield* ensureQrTrustJetStreamStreams(
        manager,
      )
      const fixture = yield* makeReferenceNetworkFixture(observedAt)
      const sink = makeLiveJetStreamMessageSink(
        makeNatsJsJetStreamPublisher(connection.jetstream()),
      )
      const report = yield* makeNatsPropagationService(sink).publishEvents(
        fixture.events,
      )
      const recorded = sink.recorded()

      yield* assertSmoke(
        recorded.length === fixture.events.length,
        "live NATS broker should accept every mapped fixture event",
      )
      yield* assertSmoke(
        recorded.some((message) => message.stream === "QRTRUST_SCANNER_AUDIT"),
        "scanner-visible decisions should reach the scanner audit stream",
      )
      yield* assertSmoke(
        recorded.every((message) => !message.payload.includes('"body"')),
        "JetStream payloads should remain envelope-only",
      )

      yield* Console.log(
        JSON.stringify(
          {
            live_nats_broker_smoke: "passed",
            nats_url: natsUrl,
            streams: ensureReport.streams,
            published: report.messages_published,
            governance: report.governance_messages,
            runtime: report.runtime_messages,
            scanner_audit: report.scanner_audit_messages,
            scanner_decision: {
              id: fixture.scanner_decision.decision_id,
              color: fixture.scanner_decision.decision_color,
              state: fixture.scanner_decision.decision_state,
            },
          },
          null,
          2,
        ),
      )
    }),
  (connection) => drainNatsJsConnection(connection).pipe(Effect.orDie),
).pipe(Effect.provide(InMemoryEventBusLive))

const assertSmoke = (
  condition: boolean,
  message: string,
): Effect.Effect<void, never, never> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Live NATS broker smoke failed: ${message}`)
    }
  })

Effect.runPromise(program).catch((cause: NetworkError | unknown) => {
  console.error(cause)
  process.exitCode = 1
})
