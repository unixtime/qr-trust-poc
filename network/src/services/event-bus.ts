import { Context, Effect, Layer } from "effect"

import type { EventEnvelope } from "../contracts.js"
import type { NetworkError } from "../errors.js"

export interface NetworkEvent {
  readonly envelope: EventEnvelope
  readonly body?: unknown
}

export interface EventBusShape {
  readonly publish: (event: NetworkEvent) => Effect.Effect<void, NetworkError>
  readonly recent: () => Effect.Effect<ReadonlyArray<NetworkEvent>, NetworkError>
}

export class EventBus extends Context.Tag("qrtrust/EventBus")<
  EventBus,
  EventBusShape
>() {}

export const makeInMemoryEventBus = (): EventBusShape => {
  const events: NetworkEvent[] = []

  return {
    publish: (event) =>
      Effect.sync(() => {
        events.push(event)
      }),
    recent: () => Effect.succeed([...events]),
  }
}

export const InMemoryEventBusLive = Layer.succeed(
  EventBus,
  makeInMemoryEventBus(),
)
