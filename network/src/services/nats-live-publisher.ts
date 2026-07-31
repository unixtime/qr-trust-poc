import { Effect } from "effect"

import { eventPublicationError, type NetworkError } from "../errors.js"
import type {
  JetStreamMessageSinkShape,
  JetStreamName,
  JetStreamPublishMessage,
} from "./nats-propagation.js"

export interface LiveJetStreamPublishOptions {
  readonly headers: Readonly<Record<string, string>>
  readonly messageId: string
  readonly expectedStream: JetStreamName
}

export interface LiveJetStreamPublisherShape {
  readonly publish: (
    subject: string,
    payload: Uint8Array,
    options: LiveJetStreamPublishOptions,
  ) => Promise<unknown>
}

export const makeLiveJetStreamMessageSink = (
  publisher: LiveJetStreamPublisherShape,
): JetStreamMessageSinkShape => {
  const encoder = new TextEncoder()
  const published: JetStreamPublishMessage[] = []

  return {
    publish: (message) =>
      Effect.tryPromise({
        try: async () => {
          const messageId = message.headers["Nats-Msg-Id"]

          if (!messageId) {
            throw new Error("Nats-Msg-Id header is required for idempotency.")
          }

          await publisher.publish(
            message.subject,
            encoder.encode(message.payload),
            {
              headers: message.headers,
              messageId,
              expectedStream: message.stream,
            },
          )

          published.push(message)
          return message
        },
        catch: (cause): NetworkError =>
          eventPublicationError("Failed to publish JetStream message.", {
            cause,
            subject: message.subject,
            stream: message.stream,
          }),
      }),
    recorded: () => [...published],
  }
}
