import { Effect } from "effect"

import { decodeEventEnvelope } from "../contracts.js"
import { contractValidationError } from "../errors.js"
import type { NetworkEvent } from "./event-bus.js"
import {
  makeNatsPropagationService,
  type JetStreamMessageSinkShape,
  type JetStreamName,
} from "./nats-propagation.js"

export interface EventOutboxRecord {
  readonly outbox_id: string
  readonly event_id: string
  readonly payload: unknown
}

export interface EventOutboxPublishSuccess {
  readonly outbox_id: string
  readonly event_id: string
  readonly subject: string
  readonly stream: JetStreamName
}

export interface EventOutboxPublishFailure {
  readonly outbox_id: string
  readonly event_id: string
  readonly reason: string
}

export interface EventOutboxPublishReport {
  readonly attempted: number
  readonly published: number
  readonly failed: number
  readonly successes: ReadonlyArray<EventOutboxPublishSuccess>
  readonly failures: ReadonlyArray<EventOutboxPublishFailure>
}

export interface EventOutboxPublisherShape {
  readonly publishBatch: (
    records: ReadonlyArray<EventOutboxRecord>,
  ) => Effect.Effect<EventOutboxPublishReport, never>
}

export const makeEventOutboxPublisher = (
  sink: JetStreamMessageSinkShape,
): EventOutboxPublisherShape => ({
  publishBatch: (records) =>
    Effect.gen(function* () {
      const successes: EventOutboxPublishSuccess[] = []
      const failures: EventOutboxPublishFailure[] = []
      const propagation = makeNatsPropagationService(sink)

      for (const record of records) {
        const result = yield* Effect.either(
          Effect.gen(function* () {
            const event = yield* networkEventFromOutboxRecord(record)
            const report = yield* propagation.publishEvents([event])
            const published = sink.recorded().at(-1)

            if (!published) {
              return yield* Effect.fail(
                new Error(
                  `No JetStream message was recorded for outbox event ${record.event_id}.`,
                ),
              )
            }

            return {
              outbox_id: record.outbox_id,
              event_id: record.event_id,
              subject: report.subjects[0] ?? published.subject,
              stream: published.stream,
            }
          }),
        )

        if (result._tag === "Right") {
          successes.push(result.right)
        } else {
          failures.push({
            outbox_id: record.outbox_id,
            event_id: record.event_id,
            reason: failureReason(result.left),
          })
        }
      }

      return {
        attempted: records.length,
        published: successes.length,
        failed: failures.length,
        successes,
        failures,
      }
    }),
})

const networkEventFromOutboxRecord = (
  record: EventOutboxRecord,
): Effect.Effect<NetworkEvent, unknown> =>
  Effect.gen(function* () {
    const payload = yield* payloadObject(record.payload)
    const envelope = yield* decodeEventEnvelope(payload.envelope).pipe(
      Effect.mapError((cause) =>
        contractValidationError("Outbox payload envelope is invalid.", cause),
      ),
    )

    return payload.body === undefined
      ? { envelope }
      : { envelope, body: payload.body }
  })

const payloadObject = (
  payload: unknown,
): Effect.Effect<{ readonly envelope: unknown; readonly body?: unknown }, unknown> =>
  Effect.try({
    try: () => {
      if (payload && typeof payload === "object" && "envelope" in payload) {
        return payload as { readonly envelope: unknown; readonly body?: unknown }
      }

      throw new Error("Outbox payload must contain an event envelope.")
    },
    catch: (cause) => cause,
  })

const failureReason = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message
  }

  if (cause && typeof cause === "object" && "message" in cause) {
    return String((cause as { readonly message: unknown }).message)
  }

  return String(cause)
}
