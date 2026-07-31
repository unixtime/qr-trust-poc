import { Console, Effect } from "effect"

import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
  makeArtifactPublicationService,
  makeAuthorityPublicationService,
  makeEventOutboxPublisher,
  makePostgresArtifactStore,
  makePostgresEventBus,
  makePostgresGovernancePublicationSource,
  makePostgresPersistenceService,
  makeRecordingJetStreamMessageSink,
  makeRecordingPostgresArtifactStoreExecutor,
  makeRecordingPostgresGovernancePublicationSourceExecutor,
  type EventOutboxRecord,
  type SqlCommand,
} from "../index.js"
import { postgresGovernancePublicationFixtureRow } from "./postgres-governance-fixture.js"

const observedAt = new Date("2026-05-20T14:00:00Z")

const expectedSubjects = [
  "qrtrust.root-qrtrust-demo-2026.root.manifest.published.v1",
  "qrtrust.root-qrtrust-demo-2026.authority.manifest.published.v1",
  "qrtrust.root-qrtrust-demo-2026.issuer.record.published.v1",
  "qrtrust.root-qrtrust-demo-2026.destination.policy.published.v1",
] as const

const program = Effect.gen(function* () {
  const executor = makeRecordingPostgresArtifactStoreExecutor()
  const artifactStore = makePostgresArtifactStore(executor)
  const persistence = makePostgresPersistenceService(executor)
  const eventBus = makePostgresEventBus(persistence)
  const artifactPublisher = makeArtifactPublicationService(
    artifactStore,
    eventBus,
  )
  const source = makePostgresGovernancePublicationSource(
    makeRecordingPostgresGovernancePublicationSourceExecutor([
      postgresGovernancePublicationFixtureRow(),
    ]),
  )
  const authorityPublisher = makeAuthorityPublicationService(
    source,
    artifactPublisher,
  )

  const report = yield* authorityPublisher.publishGovernanceBundle({
    namespace: demoIssuerProjection.namespace,
    destination_policy_id: demoDestinationPolicyProjection.destination_policy_id,
    observedAt,
  })
  const commands = executor.recorded()
  const artifactCommands = commands.filter(
    (command) => command.name === "published_artifacts.upsert",
  )
  const outboxCommands = commands.filter(
    (command) => command.name === "event_outbox.enqueue",
  )
  const records = eventOutboxRecordsFromCommands(outboxCommands)
  const sink = makeRecordingJetStreamMessageSink()
  const propagationReport = yield* makeEventOutboxPublisher(sink).publishBatch(
    records,
  )
  const messages = sink.recorded()

  yield* assertSmoke(
    report.published_artifacts === 4,
    "authority publication should produce the full governance bundle",
  )
  yield* assertSmoke(
    artifactCommands.length === 4,
    "authority publication should persist four artifact rows",
  )
  yield* assertSmoke(
    outboxCommands.length === 4,
    "authority publication should enqueue one propagation event per artifact",
  )
  yield* assertSmoke(
    records.every((record) => record.payload && typeof record.payload === "object"),
    "event_outbox records should carry event payload objects",
  )
  yield* assertSmoke(
    outboxCommands.every((command) => command.values[4] && command.values[5]),
    "event_outbox rows must retain artifact id and artifact hash references",
  )
  yield* assertSmoke(
    propagationReport.published === records.length &&
      propagationReport.failed === 0,
    "outbox publisher should propagate every authority event",
  )
  yield* assertSmoke(
    messages.length === expectedSubjects.length,
    "authority outbox handoff should emit one JetStream message per event",
  )
  expectedSubjects.forEach((subject, index) => {
    if (messages[index]?.subject !== subject) {
      throw new Error(
        `Authority publication outbox handoff smoke failed: message ${index} should publish ${subject}`,
      )
    }
  })
  yield* assertSmoke(
    messages.every((message) => message.stream === "QRTRUST_GOVERNANCE"),
    "authority publication events should stay on the governance stream",
  )
  yield* assertSmoke(
    messages.every((message) => !message.payload.includes('"body"')),
    "NATS propagation payloads must carry envelopes only, not artifact bodies",
  )
  yield* assertSmoke(
    messages.every(
      (message) =>
        message.headers["QRTrust-Artifact-Id"] &&
        message.headers["QRTrust-Artifact-Hash"],
    ),
    "NATS propagation headers must expose artifact id and hash references",
  )

  yield* Console.log(
    JSON.stringify(
      {
        authority_publication_outbox_handoff_smoke: "passed",
        artifact_rows: artifactCommands.length,
        outbox_rows: outboxCommands.length,
        propagated_messages: propagationReport.published,
        subjects: messages.map((message) => message.subject),
      },
      null,
      2,
    ),
  )
})

const eventOutboxRecordsFromCommands = (
  commands: ReadonlyArray<SqlCommand>,
): ReadonlyArray<EventOutboxRecord> =>
  commands.map((command, index) => ({
    outbox_id: uuidFor(index + 1),
    event_id: requireStringCommandValue(command, 0, "event_id"),
    payload: jsonbValue(command.values[10]),
  }))

const uuidFor = (value: number): string =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`

const requireStringCommandValue = (
  command: SqlCommand,
  index: number,
  label: string,
): string => {
  const value = command.values[index]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Authority publication outbox handoff smoke failed: ${command.name} is missing ${label}.`,
    )
  }

  return value
}

const jsonbValue = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value
  }

  return JSON.parse(value) as unknown
}

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(
        `Authority publication outbox handoff smoke failed: ${message}`,
      )
    }
  })

Effect.runPromise(program)
