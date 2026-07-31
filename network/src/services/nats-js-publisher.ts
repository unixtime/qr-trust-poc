import {
  connect,
  DiscardPolicy,
  headers,
  RetentionPolicy,
  StorageType,
  type JetStreamClient,
  type JetStreamManager,
  type NatsConnection,
  type StreamConfig,
} from "nats"
import { Effect } from "effect"

import { eventPublicationError, type NetworkError } from "../errors.js"
import type {
  LiveJetStreamPublishOptions,
  LiveJetStreamPublisherShape,
} from "./nats-live-publisher.js"
import type { JetStreamName } from "./nats-propagation.js"

export interface NatsJsConnectionOptions {
  readonly servers: string | ReadonlyArray<string>
  readonly name?: string
  readonly user?: string | undefined
  readonly pass?: string | undefined
  readonly timeout_ms?: number
}

export interface QrTrustJetStreamDefinition {
  readonly name: JetStreamName
  readonly description: string
  readonly subjects: ReadonlyArray<string>
}

export interface QrTrustJetStreamEnsureEntry {
  readonly name: JetStreamName
  readonly subjects: ReadonlyArray<string>
  readonly status: "created" | "existing" | "updated"
}

export interface QrTrustJetStreamEnsureReport {
  readonly streams: ReadonlyArray<QrTrustJetStreamEnsureEntry>
}

export const qrTrustJetStreamDefinitions: ReadonlyArray<QrTrustJetStreamDefinition> =
  [
    {
      name: "QRTRUST_GOVERNANCE",
      description:
        "QR Trust root, delegated authority, issuer, destination policy, and certificate status propagation.",
      subjects: [
        "qrtrust.*.root.>",
        "qrtrust.*.authority.>",
        "qrtrust.*.issuer.>",
        "qrtrust.*.destination.>",
        "qrtrust.*.certificate.>",
      ],
    },
    {
      name: "QRTRUST_RUNTIME",
      description:
        "QR Trust verifier cache and runtime destination-safety propagation.",
      subjects: ["qrtrust.*.verifier.>", "qrtrust.*.runtime.>"],
    },
    {
      name: "QRTRUST_SCANNER_AUDIT",
      description:
        "QR Trust scanner-visible decision audit events. This stream is append-only evidence, not trust-state authority.",
      subjects: ["qrtrust.*.scanner.>"],
    },
  ]

export const connectNatsJs = (
  options: NatsJsConnectionOptions,
): Effect.Effect<NatsConnection, NetworkError> =>
  Effect.tryPromise({
    try: () => {
      const connectionOptions: NonNullable<Parameters<typeof connect>[0]> = {
        servers: toServerList(options.servers),
      }
      if (options.name) {
        connectionOptions.name = options.name
      }
      if (options.timeout_ms !== undefined) {
        connectionOptions.timeout = options.timeout_ms
      }
      if (options.user) {
        connectionOptions.user = options.user
      }
      if (options.pass) {
        connectionOptions.pass = options.pass
      }

      return connect(connectionOptions)
    },
    catch: (cause): NetworkError =>
      eventPublicationError("Failed to connect to NATS.", { cause }),
  })

export const drainNatsJsConnection = (
  connection: NatsConnection,
): Effect.Effect<void, NetworkError> =>
  Effect.tryPromise({
    try: () => connection.drain(),
    catch: (cause): NetworkError =>
      eventPublicationError("Failed to drain NATS connection.", { cause }),
  })

export const ensureQrTrustJetStreamStreams = (
  manager: JetStreamManager,
): Effect.Effect<QrTrustJetStreamEnsureReport, NetworkError> =>
  Effect.tryPromise({
    try: async () => {
      const entries: QrTrustJetStreamEnsureEntry[] = []

      for (const definition of qrTrustJetStreamDefinitions) {
        const entry = await ensureStream(manager, definition)
        entries.push(entry)
      }

      return { streams: entries }
    },
    catch: (cause): NetworkError =>
      eventPublicationError("Failed to ensure QR Trust JetStream streams.", {
        cause,
      }),
  })

export const makeNatsJsJetStreamPublisher = (
  jetStream: JetStreamClient,
  publishTimeoutMs = 2_500,
): LiveJetStreamPublisherShape => ({
  publish: (subject, payload, options) =>
    publishJetStreamMessage(jetStream, subject, payload, options, publishTimeoutMs),
})

const publishJetStreamMessage = async (
  jetStream: JetStreamClient,
  subject: string,
  payload: Uint8Array,
  options: LiveJetStreamPublishOptions,
  publishTimeoutMs: number,
) => {
  const messageHeaders = headers()

  for (const [key, value] of Object.entries(options.headers)) {
    messageHeaders.set(key, value)
  }

  return jetStream.publish(subject, payload, {
    msgID: options.messageId,
    timeout: publishTimeoutMs,
    headers: messageHeaders,
    expect: {
      streamName: options.expectedStream,
    },
  })
}

const ensureStream = async (
  manager: JetStreamManager,
  definition: QrTrustJetStreamDefinition,
): Promise<QrTrustJetStreamEnsureEntry> => {
  try {
    const info = await manager.streams.info(definition.name)
    const existingSubjects = info.config.subjects ?? []

    if (sameSubjects(existingSubjects, definition.subjects)) {
      return {
        name: definition.name,
        subjects: definition.subjects,
        status: "existing",
      }
    }

    await manager.streams.update(definition.name, {
      subjects: [...definition.subjects],
      description: definition.description,
      max_msgs: 100_000,
      max_bytes: -1,
      max_age: 0,
      max_msg_size: -1,
      discard: DiscardPolicy.Old,
    })

    return {
      name: definition.name,
      subjects: definition.subjects,
      status: "updated",
    }
  } catch (cause) {
    if (!isMissingStreamError(cause)) {
      throw cause
    }

    await manager.streams.add(streamConfig(definition))

    return {
      name: definition.name,
      subjects: definition.subjects,
      status: "created",
    }
  }
}

const streamConfig = (
  definition: QrTrustJetStreamDefinition,
): Partial<StreamConfig> => ({
  name: definition.name,
  description: definition.description,
  subjects: [...definition.subjects],
  retention: RetentionPolicy.Limits,
  storage: StorageType.File,
  discard: DiscardPolicy.Old,
  max_consumers: -1,
  max_msgs: 100_000,
  max_bytes: -1,
  max_age: 0,
  max_msg_size: -1,
  max_msgs_per_subject: -1,
})

const sameSubjects = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): boolean => {
  const normalize = (value: ReadonlyArray<string>) => [...value].sort().join("\n")
  return normalize(left) === normalize(right)
}

const isMissingStreamError = (cause: unknown): boolean => {
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { readonly code?: unknown }).code)
      : ""
  const message =
    cause instanceof Error ? cause.message.toLowerCase() : String(cause)

  return code === "404" || message.includes("stream not found")
}

const toServerList = (value: string | ReadonlyArray<string>): string | string[] =>
  typeof value === "string" ? value : [...value]
