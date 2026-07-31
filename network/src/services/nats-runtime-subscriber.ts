import {
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  type NatsConnection,
} from "nats"
import { Effect } from "effect"

import {
  decodeEventEnvelope,
  decodeRuntimeSafetyObservation,
  type RuntimeSafetyObservation,
} from "../contracts.js"
import { hashJson } from "../hash.js"
import { persistenceError, type NetworkError } from "../errors.js"
import type { ArtifactStoreShape } from "./artifact-store.js"
import type { NetworkEvent } from "./event-bus.js"
import {
  natsGovernanceConsumerFilterConfig,
} from "./nats-governance-subscriber.js"
import type {
  PostgresPersistenceServiceShape,
} from "./postgres-persistence.js"

export const qrTrustRuntimeStreamName = "QRTRUST_RUNTIME"

export interface NatsRuntimeSubscriberConfig {
  readonly stream_name?: string
  readonly durable_name: string
  readonly filter_subject?: string
  readonly filter_subjects?: ReadonlyArray<string>
  readonly deliver_policy?: DeliverPolicy
  readonly max_messages?: number
  readonly expires_ms: number
  readonly ack_wait_ms?: number
  readonly max_deliver?: number
  readonly delete_consumer_on_stop?: boolean
  readonly shutdown_signal?: AbortSignal
}

export interface NatsRuntimeSubscriberMaterializationPath {
  readonly artifactStore: ArtifactStoreShape
  readonly persistence: PostgresPersistenceServiceShape
}

export interface NatsRuntimeSubscriberReport {
  readonly stream_name: string
  readonly durable_name: string
  readonly received_messages: number
  readonly observed_messages: number
  readonly malformed_messages: number
  readonly rejected_messages: number
  readonly persistence_failures: number
  readonly terminated_messages: number
  readonly nacked_messages: number
  readonly timed_out_polls: number
  readonly last_observation_id?: string
}

export interface NatsRuntimeMessageShape {
  readonly data: Uint8Array
  readonly ack: () => void
  readonly nak: (millis?: number) => void
  readonly term: (reason?: string) => void
}

export type NatsRuntimeMessageProcessResult =
  | {
      readonly status: "observed"
      readonly observation_id: string
    }
  | {
      readonly status: "malformed"
      readonly terminated: boolean
    }
  | {
      readonly status: "rejected"
      readonly reason:
        | "unsupported_event_type"
        | "missing_artifact"
        | "artifact_hash_mismatch"
        | "invalid_runtime_observation"
      readonly terminated: boolean
    }
  | {
      readonly status: "persist_failed"
      readonly nacked: boolean
    }

type RuntimeRejectionReason = Extract<
  NatsRuntimeMessageProcessResult,
  { readonly status: "rejected" }
>["reason"]

export const runNatsRuntimeSubscriber = (
  connection: NatsConnection,
  config: NatsRuntimeSubscriberConfig,
  materializationPath: NatsRuntimeSubscriberMaterializationPath,
): Effect.Effect<NatsRuntimeSubscriberReport, NetworkError> =>
  Effect.tryPromise({
    try: () => runSubscriber(connection, config, materializationPath),
    catch: (cause): NetworkError =>
      isNetworkError(cause)
        ? cause
        : persistenceError("NATS runtime subscriber failed.", cause),
  })

export const decodeNatsRuntimePayload = (
  payload: Uint8Array,
): Effect.Effect<NetworkEvent, NetworkError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(new TextDecoder().decode(payload)) as unknown,
      catch: (cause) =>
        persistenceError("Malformed NATS runtime JSON payload.", cause),
    })

    if (!parsed || typeof parsed !== "object" || !("envelope" in parsed)) {
      return yield* Effect.fail(
        persistenceError(
          "Malformed NATS runtime payload: expected an envelope object.",
          parsed,
        ),
      )
    }

    const envelope = yield* decodeEventEnvelope(
      (parsed as { readonly envelope: unknown }).envelope,
    ).pipe(
      Effect.mapError((cause) =>
        persistenceError(
          "Malformed NATS runtime payload: envelope does not match NetworkEvent.",
          cause,
        ),
      ),
    )

    return { envelope }
  })

export const processNatsRuntimeMessage = async (
  message: NatsRuntimeMessageShape,
  materializationPath: NatsRuntimeSubscriberMaterializationPath,
): Promise<NatsRuntimeMessageProcessResult> => {
  let event: NetworkEvent
  try {
    event = await Effect.runPromise(decodeNatsRuntimePayload(message.data))
  } catch {
    return { status: "malformed", terminated: termMessage(message) }
  }

  const result = await Effect.runPromise(
    materializeRuntimeObservation(event, materializationPath).pipe(
      Effect.either,
    ),
  )

  if (result._tag === "Left") {
    const reason = runtimeRejectionReason(result.left)
    if (reason) {
      return {
        status: "rejected",
        reason,
        terminated: termMessage(message, reason),
      }
    }

    return { status: "persist_failed", nacked: nakMessage(message) }
  }

  message.ack()
  return {
    status: "observed",
    observation_id: result.right.observation_id,
  }
}

const materializeRuntimeObservation = (
  event: NetworkEvent,
  materializationPath: NatsRuntimeSubscriberMaterializationPath,
): Effect.Effect<RuntimeSafetyObservation, NetworkError> =>
  Effect.gen(function* () {
    if (event.envelope.type !== "runtime.verdict.observed") {
      return yield* Effect.fail(
        persistenceError("Unsupported runtime subscriber event type.", {
          event_type: event.envelope.type,
        }),
      )
    }

    const artifact = yield* materializationPath.artifactStore.get(
      event.envelope.artifact_id,
    )
    if (!artifact) {
      return yield* Effect.fail(
        persistenceError("Runtime observation artifact is missing.", {
          artifact_id: event.envelope.artifact_id,
        }),
      )
    }
    if (
      artifact.artifact_hash !== event.envelope.artifact_hash ||
      `sha256:${hashJson(artifact.body)}` !== event.envelope.artifact_hash
    ) {
      return yield* Effect.fail(
        persistenceError("Runtime observation artifact hash mismatch.", {
          event_hash: event.envelope.artifact_hash,
          artifact_hash: artifact.artifact_hash,
        }),
      )
    }
    if (artifact.artifact_type !== "runtime_safety_observation") {
      return yield* Effect.fail(
        persistenceError("Runtime subscriber artifact type is invalid.", {
          artifact_type: artifact.artifact_type,
        }),
      )
    }

    const observation = yield* decodeRuntimeSafetyObservation(
      artifact.body,
    ).pipe(
      Effect.mapError((cause) =>
        persistenceError("Runtime observation artifact schema is invalid.", cause),
      ),
    )

    yield* materializationPath.persistence.persistBatch({
      runtime_observations: [observation],
    })

    return observation
  })

const runtimeRejectionReason = (
  error: NetworkError,
): RuntimeRejectionReason | undefined => {
  const message = error.message
  if (message.includes("Unsupported runtime subscriber event type")) {
    return "unsupported_event_type"
  }
  if (message.includes("artifact is missing")) {
    return "missing_artifact"
  }
  if (message.includes("hash mismatch")) {
    return "artifact_hash_mismatch"
  }
  if (
    message.includes("schema is invalid") ||
    message.includes("artifact type is invalid")
  ) {
    return "invalid_runtime_observation"
  }

  return undefined
}

const runSubscriber = async (
  connection: NatsConnection,
  config: NatsRuntimeSubscriberConfig,
  materializationPath: NatsRuntimeSubscriberMaterializationPath,
): Promise<NatsRuntimeSubscriberReport> => {
  const streamName = config.stream_name ?? qrTrustRuntimeStreamName
  await ensureDurableConsumer(connection, streamName, config)

  let receivedMessages = 0
  let observedMessages = 0
  let malformedMessages = 0
  let rejectedMessages = 0
  let persistenceFailures = 0
  let terminatedMessages = 0
  let nackedMessages = 0
  let timedOutPolls = 0
  let lastObservationId: string | undefined

  try {
    const consumer = await connection
      .jetstream()
      .consumers.get(streamName, config.durable_name)
    const maxMessages = config.max_messages ?? Number.POSITIVE_INFINITY

    while (
      observedMessages < maxMessages &&
      config.shutdown_signal?.aborted !== true
    ) {
      const message = await consumer.next({ expires: config.expires_ms })
      if (!message) {
        timedOutPolls += 1
        if (Number.isFinite(maxMessages)) {
          break
        }
        continue
      }

      receivedMessages += 1
      const result = await processNatsRuntimeMessage(message, materializationPath)
      if (result.status === "malformed") {
        malformedMessages += 1
        terminatedMessages += result.terminated ? 1 : 0
        continue
      }
      if (result.status === "rejected") {
        rejectedMessages += 1
        terminatedMessages += result.terminated ? 1 : 0
        continue
      }
      if (result.status === "persist_failed") {
        persistenceFailures += 1
        nackedMessages += result.nacked ? 1 : 0
        continue
      }

      observedMessages += 1
      lastObservationId = result.observation_id
    }
  } finally {
    if (config.delete_consumer_on_stop) {
      await deleteConsumerIfPresent(connection, streamName, config.durable_name)
    }
  }

  const report = {
    stream_name: streamName,
    durable_name: config.durable_name,
    received_messages: receivedMessages,
    observed_messages: observedMessages,
    malformed_messages: malformedMessages,
    rejected_messages: rejectedMessages,
    persistence_failures: persistenceFailures,
    terminated_messages: terminatedMessages,
    nacked_messages: nackedMessages,
    timed_out_polls: timedOutPolls,
  }

  return lastObservationId
    ? { ...report, last_observation_id: lastObservationId }
    : report
}

const ensureDurableConsumer = async (
  connection: NatsConnection,
  streamName: string,
  config: NatsRuntimeSubscriberConfig,
): Promise<void> => {
  const manager = await connection.jetstreamManager()
  const expectedConfig = expectedConsumerConfig(config)

  try {
    const info = await manager.consumers.info(streamName, config.durable_name)
    if (consumerConfigMatches(info.config, expectedConfig)) {
      return
    }

    await manager.consumers.delete(streamName, config.durable_name)
  } catch (cause) {
    if (!isMissingConsumerError(cause)) {
      throw cause
    }
  }

  await manager.consumers.add(streamName, expectedConfig)
}

const expectedConsumerConfig = (config: NatsRuntimeSubscriberConfig) => ({
  durable_name: config.durable_name,
  ack_policy: AckPolicy.Explicit,
  deliver_policy: config.deliver_policy ?? DeliverPolicy.All,
  replay_policy: ReplayPolicy.Instant,
  max_ack_pending: 1,
  max_waiting: 1,
  ack_wait: millisecondsToNanoseconds(config.ack_wait_ms ?? 30_000),
  max_deliver: config.max_deliver ?? 5,
  ...natsGovernanceConsumerFilterConfig(
    config.filter_subject
      ? [config.filter_subject]
      : (config.filter_subjects ?? []),
  ),
})

const consumerConfigMatches = (
  actual: {
    readonly ack_policy?: unknown
    readonly deliver_policy?: unknown
    readonly replay_policy?: unknown
    readonly filter_subject?: unknown
    readonly filter_subjects?: unknown
    readonly ack_wait?: unknown
    readonly max_deliver?: unknown
    readonly max_ack_pending?: unknown
    readonly max_waiting?: unknown
  },
  expected: ReturnType<typeof expectedConsumerConfig>,
): boolean =>
  actual.ack_policy === expected.ack_policy &&
  actual.deliver_policy === expected.deliver_policy &&
  actual.replay_policy === expected.replay_policy &&
  (actual.filter_subject ?? undefined) ===
    (expected.filter_subject ?? undefined) &&
  stringArrayFieldMatches(actual.filter_subjects, expected.filter_subjects) &&
  numericFieldMatches(actual.ack_wait, expected.ack_wait) &&
  numericFieldMatches(actual.max_deliver, expected.max_deliver) &&
  numericFieldMatches(actual.max_ack_pending, expected.max_ack_pending) &&
  numericFieldMatches(actual.max_waiting, expected.max_waiting)

const stringArrayFieldMatches = (
  actual: unknown,
  expected: ReadonlyArray<string> | undefined,
): boolean => {
  if (expected === undefined) {
    return actual === undefined
  }
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  )
}

const numericFieldMatches = (actual: unknown, expected: number): boolean =>
  typeof actual === "number"
    ? actual === expected
    : typeof actual === "string" && actual.length > 0
      ? Number(actual) === expected
      : false

const termMessage = (
  message: NatsRuntimeMessageShape,
  reason = "malformed runtime envelope payload",
): boolean => {
  try {
    message.term(reason)
    return true
  } catch {
    return false
  }
}

const nakMessage = (message: NatsRuntimeMessageShape): boolean => {
  try {
    message.nak(1_000)
    return true
  } catch {
    return false
  }
}

const deleteConsumerIfPresent = async (
  connection: NatsConnection,
  streamName: string,
  durableName: string,
): Promise<void> => {
  try {
    const manager = await connection.jetstreamManager()
    await manager.consumers.delete(streamName, durableName)
  } catch {
    // Cleanup is best-effort; the primary failure should stay visible.
  }
}

const millisecondsToNanoseconds = (value: number): number => value * 1_000_000

const isMissingConsumerError = (cause: unknown): boolean => {
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String((cause as { readonly code?: unknown }).code)
      : ""
  const message =
    cause instanceof Error ? cause.message.toLowerCase() : String(cause)

  return code === "404" || message.includes("consumer not found")
}

const isNetworkError = (cause: unknown): cause is NetworkError =>
  Boolean(
    cause &&
      typeof cause === "object" &&
      "_tag" in cause &&
      typeof (cause as { readonly _tag?: unknown })._tag === "string",
  )
