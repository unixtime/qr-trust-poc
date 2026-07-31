import { Effect } from "effect"

import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  makeInMemoryEventBus,
  makeInMemoryVerifierCache,
  makeScannerDecisionService,
} from "../index.js"

const assertSmoke = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`Scanner decision ungoverned event smoke failed: ${message}`)
  }
}

const main = Effect.gen(function* () {
  const observedAt = new Date("2026-05-25T12:00:00Z")
  const ungovernedEventBus = makeInMemoryEventBus()
  const ungovernedScanner = makeScannerDecisionService(
    makeInMemoryVerifierCache([], []),
    ungovernedEventBus,
  )

  const ungovernedDecision = yield* ungovernedScanner.decide({
    payload: "https://unknown.example/pay",
    observedAt,
  })
  assertSmoke(
    !ungovernedDecision.governance,
    "unrecognized destination should not carry governance",
  )

  const ungovernedEvents = yield* ungovernedEventBus.recent()
  assertSmoke(
    ungovernedEvents.length === 0,
    "ungoverned scanner decision should not publish an event",
  )

  const governedEventBus = makeInMemoryEventBus()
  const governedScanner = makeScannerDecisionService(
    makeInMemoryVerifierCache(
      [demoIssuerProjection],
      [demoDestinationPolicyProjection],
    ),
    governedEventBus,
  )

  const governedDecision = yield* governedScanner.decide({
    payload: "https://acme.example/pay",
    observedAt,
  })
  assertSmoke(
    Boolean(governedDecision.governance),
    "recognized destination should carry governance",
  )

  const governedEvents = yield* governedEventBus.recent()
  assertSmoke(
    governedEvents.length === 1,
    "governed scanner decision should publish exactly one event",
  )

  const [event] = governedEvents
  assertSmoke(
    event?.envelope.root_program_id ===
      governedDecision.governance?.root_program_id,
    "governed event root_program_id should match decision governance",
  )

  console.log(
    JSON.stringify(
      {
        status: "ok",
        ungoverned_events: ungovernedEvents.length,
        governed_events: governedEvents.length,
        governed_root_program_id: event?.envelope.root_program_id,
      },
      null,
      2,
    ),
  )
})

Effect.runPromise(main).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
