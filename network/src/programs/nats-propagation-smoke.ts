import { Console, Effect } from "effect"

import {
  EventBus,
  InMemoryEventBusLive,
  jetStreamMessageFromEvent,
  makeArtifactPublicationService,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryVerifierCache,
  makeNatsPropagationService,
  makeRecordingJetStreamMessageSink,
  makeScannerDecisionService,
  makeVerifierSyncService,
} from "../index.js"

const observedAt = new Date("2026-05-17T00:00:00Z")

const program = Effect.gen(function* () {
  const eventBus = yield* EventBus
  const artifactStore = makeInMemoryArtifactStore()
  const cache = makeInMemoryVerifierCache()
  const publisher = makeArtifactPublicationService(artifactStore, eventBus)
  const governancePublisher = makeGovernancePublicationService(publisher)
  const verifierSync = makeVerifierSyncService(artifactStore, eventBus, cache)
  const scanner = makeScannerDecisionService(cache, eventBus)

  yield* governancePublisher.publishReferenceBundle(observedAt)
  yield* verifierSync.syncRecent()
  yield* scanner.decide({
    payload: "https://acme.example/pay",
    observedAt,
  })

  const events = yield* eventBus.recent()
  const firstEvent = yield* firstPublishedEvent(events)
  const sink = makeRecordingJetStreamMessageSink()
  const propagation = makeNatsPropagationService(sink)
  const report = yield* propagation.publishEvents(events)
  const messages = sink.recorded()

  yield* assertSmoke(
    report.messages_published === events.length,
    "every event should be mapped to one JetStream message",
  )
  yield* assertSmoke(
    report.governance_messages === 4,
    "reference bundle should produce four governance messages",
  )
  yield* assertSmoke(
    report.runtime_messages === 0,
    "this smoke path does not publish runtime messages",
  )
  yield* assertSmoke(
    report.scanner_audit_messages === 1,
    "scanner decision should publish to the scanner audit stream",
  )
  yield* assertSmoke(
    report.subjects.includes(
      "qrtrust.root-qrtrust-demo-2026.root.manifest.published.v1",
    ),
    "root manifest subject did not match the documented convention",
  )
  yield* assertSmoke(
    report.subjects.includes(
      "qrtrust.root-qrtrust-demo-2026.authority.manifest.published.v1",
    ),
    "delegated authority event was not normalized to the authority subject",
  )
  yield* assertSmoke(
    messages.every((message) => !message.payload.includes('"body"')),
    "propagation payloads should carry envelopes only, not full artifact bodies",
  )
  yield* assertSmoke(
    messages.every((message) => message.headers["Nats-Msg-Id"]),
    "idempotency header is required for every propagated message",
  )
  for (const expectation of managementEventSubjectExpectations) {
    const message = yield* jetStreamMessageFromEvent({
      ...firstEvent,
      envelope: {
        ...firstEvent.envelope,
        event_id: `evt_${expectation.type.replace(/[^a-z0-9]+/gi, "_")}_smoke`,
        type: expectation.type,
        artifact_id: expectation.artifact_id,
        root_program_id:
          expectation.root_program_id ?? firstEvent.envelope.root_program_id,
      },
    })
    yield* assertSmoke(
      message.subject === expectation.subject,
      `${expectation.type} did not publish to the expected subject`,
    )
  }
  const unsupported = yield* Effect.either(
    jetStreamMessageFromEvent({
      ...firstEvent,
      envelope: {
        ...firstEvent.envelope,
        type: "unknown.event.type",
      },
    }),
  )
  yield* assertSmoke(
    unsupported._tag === "Left",
    "unknown event types should fail closed instead of publishing ad hoc subjects",
  )
  const controlPlaneTrustState = yield* Effect.either(
    jetStreamMessageFromEvent({
      ...firstEvent,
      envelope: {
        ...firstEvent.envelope,
        event_id: "evt_control_plane_issuer_record_smoke",
        type: "issuer.record.published",
        root_program_id: "control-plane",
      },
    }),
  )
  yield* assertSmoke(
    controlPlaneTrustState._tag === "Left",
    "control-plane root published trust-state subject",
  )
  const rootScopedControlPlaneEvent = yield* Effect.either(
    jetStreamMessageFromEvent({
      ...firstEvent,
      envelope: {
        ...firstEvent.envelope,
        event_id: "evt_root_scoped_runtime_provider_smoke",
        type: "runtime_provider.upserted",
      },
    }),
  )
  yield* assertSmoke(
    rootScopedControlPlaneEvent._tag === "Left",
    "control-plane management event published under a trust root",
  )

  yield* Console.log(
    JSON.stringify(
      {
        published: report.messages_published,
        governance: report.governance_messages,
        runtime: report.runtime_messages,
        scanner_audit: report.scanner_audit_messages,
        subjects: report.subjects,
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`NATS propagation smoke failed: ${message}`)
    }
  })

const firstPublishedEvent = <T>(
  events: ReadonlyArray<T>,
): Effect.Effect<T> =>
  Effect.sync(() => {
    const first = events[0]
    if (!first) {
      throw new Error("NATS propagation smoke failed: no events were published")
    }
    return first
  })

const managementEventSubjectExpectations: ReadonlyArray<{
  readonly type: string
  readonly artifact_id: string
  readonly subject: string
  readonly root_program_id?: string
}> = [
  {
    type: "root_program.upserted",
    artifact_id: "root:qrtrust-demo:2026",
    subject: "qrtrust.root-qrtrust-demo-2026.root.program.upserted.v1",
  },
  {
    type: "scanner.spike.detected",
    artifact_id: "evt_scan_spike_smoke",
    subject: "qrtrust.root-qrtrust-demo-2026.scanner.spike.detected.v1",
  },
  {
    type: "delegated_authority.upserted",
    artifact_id: "authority:qrtrust-demo:merchant-web",
    subject: "qrtrust.root-qrtrust-demo-2026.authority.delegated.upserted.v1",
  },
  {
    type: "issuer.enrollment.requested",
    artifact_id: "issuer:acme-demo",
    subject: "qrtrust.root-qrtrust-demo-2026.issuer.enrollment.requested.v1",
  },
  {
    type: "domain_proof.upserted",
    artifact_id: "acme.example",
    subject: "qrtrust.root-qrtrust-demo-2026.issuer.domain-proof.upserted.v1",
  },
  {
    type: "destination_policy.upserted",
    artifact_id: "policy:acme-demo:web-payments:v1",
    subject: "qrtrust.root-qrtrust-demo-2026.destination.policy.upserted.v1",
  },
  {
    type: "destination_policy.status.changed",
    artifact_id: "policy:acme-demo:web-payments:v1",
    subject:
      "qrtrust.root-qrtrust-demo-2026.destination.policy.status.changed.v1",
  },
  {
    type: "trust_key.upserted",
    artifact_id: "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
    subject: "qrtrust.root-qrtrust-demo-2026.certificate.trust-key.upserted.v1",
  },
  {
    type: "trust_key.status.changed",
    artifact_id: "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
    subject:
      "qrtrust.root-qrtrust-demo-2026.certificate.trust-key.status.changed.v1",
  },
  {
    type: "runtime_provider.upserted",
    artifact_id: "deterministic-runtime-safety",
    root_program_id: "control-plane",
    subject: "qrtrust.control-plane.runtime.provider.upserted.v1",
  },
  {
    type: "nats.subscriber.authorization.changed",
    artifact_id: "subscriber:reference-governance",
    root_program_id: "control-plane",
    subject:
      "qrtrust.control-plane.authority.nats-subscriber.authorization.changed.v1",
  },
  {
    type: "trust-key.status.changed",
    artifact_id: "artifact:trust-key-status:authority:v1",
    subject: "qrtrust.root-qrtrust-demo-2026.certificate.status.changed.v1",
  },
] as const

Effect.runPromise(program)
