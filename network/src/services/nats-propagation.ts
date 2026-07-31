import { Effect } from "effect"

import type { EventEnvelope } from "../contracts.js"
import { eventPublicationError, type NetworkError } from "../errors.js"
import type { NetworkEvent } from "./event-bus.js"

export type JetStreamName =
  | "QRTRUST_GOVERNANCE"
  | "QRTRUST_RUNTIME"
  | "QRTRUST_SCANNER_AUDIT"

export interface JetStreamPublishMessage {
  readonly subject: string
  readonly stream: JetStreamName
  readonly headers: Readonly<Record<string, string>>
  readonly payload: string
}

export interface JetStreamMessageSinkShape {
  readonly publish: (
    message: JetStreamPublishMessage,
  ) => Effect.Effect<JetStreamPublishMessage, NetworkError>
  readonly recorded: () => ReadonlyArray<JetStreamPublishMessage>
}

export interface NatsPropagationReport {
  readonly messages_published: number
  readonly governance_messages: number
  readonly runtime_messages: number
  readonly scanner_audit_messages: number
  readonly subjects: ReadonlyArray<string>
}

export interface NatsPropagationServiceShape {
  readonly publishEvents: (
    events: ReadonlyArray<NetworkEvent>,
  ) => Effect.Effect<NatsPropagationReport, NetworkError>
}

export const makeRecordingJetStreamMessageSink =
  (): JetStreamMessageSinkShape => {
    const messages: JetStreamPublishMessage[] = []

    return {
      publish: (message) =>
        Effect.sync(() => {
          messages.push(message)
          return message
        }),
      recorded: () => [...messages],
    }
  }

export const makeNatsPropagationService = (
  sink: JetStreamMessageSinkShape,
): NatsPropagationServiceShape => ({
  publishEvents: (events) =>
    Effect.gen(function* () {
      const messages: JetStreamPublishMessage[] = []

      for (const event of events) {
        const message = yield* jetStreamMessageFromEvent(event)
        messages.push(yield* sink.publish(message))
      }

      return {
        messages_published: messages.length,
        governance_messages: messages.filter(
          (message) => message.stream === "QRTRUST_GOVERNANCE",
        ).length,
        runtime_messages: messages.filter(
          (message) => message.stream === "QRTRUST_RUNTIME",
        ).length,
        scanner_audit_messages: messages.filter(
          (message) => message.stream === "QRTRUST_SCANNER_AUDIT",
        ).length,
        subjects: messages.map((message) => message.subject),
      }
    }),
})

export const jetStreamMessageFromEvent = (
  event: NetworkEvent,
): Effect.Effect<JetStreamPublishMessage, NetworkError> =>
  Effect.gen(function* () {
    const subjectTail = yield* subjectTailFromEventType(event.envelope.type)
    const rootSubject = yield* subjectRootFromEnvelope(event.envelope)
    yield* enforceControlPlaneBoundary(event.envelope, rootSubject)
    const stream = yield* streamForSubjectTail(subjectTail)

    return {
      subject: `qrtrust.${rootSubject}.${subjectTail}.v1`,
      stream,
      headers: headersFromEnvelope(event.envelope),
      payload: JSON.stringify({
        envelope: event.envelope,
      }),
    }
  })

export const normalizeSubjectToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")

const subjectRootFromEnvelope = (
  envelope: EventEnvelope,
): Effect.Effect<string, NetworkError> => {
  const normalized = normalizeSubjectToken(envelope.root_program_id)

  if (normalized.length > 0) {
    return Effect.succeed(normalized)
  }

  return Effect.fail(
    eventPublicationError("Event root_program_id cannot form a NATS subject.", {
      event_id: envelope.event_id,
      root_program_id: envelope.root_program_id,
    }),
  )
}

const controlPlaneSubjectRoot = "control-plane"
const controlPlaneEventTypes = new Set([
  "runtime_provider.upserted",
  "nats.subscriber.authorization.changed",
])

const enforceControlPlaneBoundary = (
  envelope: EventEnvelope,
  normalizedRoot: string,
): Effect.Effect<void, NetworkError> => {
  const isControlPlaneEvent = controlPlaneEventTypes.has(envelope.type)
  if (normalizedRoot === controlPlaneSubjectRoot && !isControlPlaneEvent) {
    return Effect.fail(
      eventPublicationError(
        "Control-plane root cannot publish trust-state NATS subjects.",
        {
          event_id: envelope.event_id,
          event_type: envelope.type,
          root_program_id: envelope.root_program_id,
        },
      ),
    )
  }

  if (isControlPlaneEvent && normalizedRoot !== controlPlaneSubjectRoot) {
    return Effect.fail(
      eventPublicationError(
        "Control-plane management events must use the control-plane root.",
        {
          event_id: envelope.event_id,
          event_type: envelope.type,
          root_program_id: envelope.root_program_id,
        },
      ),
    )
  }

  return Effect.void
}

const headersFromEnvelope = (
  envelope: EventEnvelope,
): Readonly<Record<string, string>> => ({
  "Nats-Msg-Id": envelope.event_id,
  "QRTrust-Event-Type": envelope.type,
  "QRTrust-Root-Program-Id": envelope.root_program_id,
  "QRTrust-Artifact-Id": envelope.artifact_id,
  "QRTrust-Artifact-Hash": envelope.artifact_hash,
  "QRTrust-Version": String(envelope.version),
})

const subjectTailFromEventType = (
  eventType: string,
): Effect.Effect<string, NetworkError> => {
  const mapped = eventTypeToSubjectTail[eventType]

  if (mapped) {
    return Effect.succeed(mapped)
  }

  return Effect.fail(
    eventPublicationError(
      `Unsupported QR trust network event type: ${eventType}`,
      { eventType },
    ),
  )
}

const streamForSubjectTail = (
  subjectTail: string,
): Effect.Effect<JetStreamName, NetworkError> => {
  if (
    subjectTail.startsWith("root.") ||
    subjectTail.startsWith("authority.") ||
    subjectTail.startsWith("issuer.") ||
    subjectTail.startsWith("destination.") ||
    subjectTail.startsWith("certificate.")
  ) {
    return Effect.succeed("QRTRUST_GOVERNANCE")
  }

  if (
    subjectTail.startsWith("runtime.") ||
    subjectTail.startsWith("verifier.")
  ) {
    return Effect.succeed("QRTRUST_RUNTIME")
  }

  if (subjectTail.startsWith("scanner.")) {
    return Effect.succeed("QRTRUST_SCANNER_AUDIT")
  }

  return Effect.fail(
    eventPublicationError(
      `Unsupported QR trust network subject tail: ${subjectTail}`,
      { subjectTail },
    ),
  )
}

const eventTypeToSubjectTail: Readonly<Record<string, string>> = {
  "root_program.upserted": "root.program.upserted",
  "root.manifest.published": "root.manifest.published",
  "delegated_authority.upserted": "authority.delegated.upserted",
  "delegated_authority.manifest.published": "authority.manifest.published",
  "issuer.enrollment.requested": "issuer.enrollment.requested",
  "domain_proof.upserted": "issuer.domain-proof.upserted",
  "issuer.record.published": "issuer.record.published",
  "issuer.status.changed": "issuer.status.changed",
  "destination_policy.upserted": "destination.policy.upserted",
  "destination_policy.status.changed": "destination.policy.status.changed",
  "destination.policy.published": "destination.policy.published",
  "destination.policy.revoked": "destination.policy.revoked",
  "trust_key.upserted": "certificate.trust-key.upserted",
  "trust_key.status.changed": "certificate.trust-key.status.changed",
  "trust-key.status.changed": "certificate.status.changed",
  "certificate.status.changed": "certificate.status.changed",
  "verifier.cache.refreshed": "verifier.cache.refreshed",
  "runtime_provider.upserted": "runtime.provider.upserted",
  "runtime.verdict.observed": "runtime.verdict.observed",
  "nats.subscriber.authorization.changed":
    "authority.nats-subscriber.authorization.changed",
  "scanner.decision.recorded": "scanner.decision.recorded",
}
