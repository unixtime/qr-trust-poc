import { Effect } from "effect"

import type { EventBusShape, NetworkEvent } from "./event-bus.js"
import type { PostgresPersistenceServiceShape } from "./postgres-persistence.js"

export const makePostgresEventBus = (
  persistence: PostgresPersistenceServiceShape,
): EventBusShape => ({
  publish: (event: NetworkEvent) =>
    persistence.persistBatch({ events: [event] }).pipe(Effect.asVoid),
  recent: () => Effect.succeed([]),
})
