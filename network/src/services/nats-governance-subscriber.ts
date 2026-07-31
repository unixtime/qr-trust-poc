import {
  AckPolicy,
  DeliverPolicy,
  ReplayPolicy,
  type NatsConnection,
} from "nats"
import { Effect } from "effect"

import { decodeEventEnvelope } from "../contracts.js"
import {
  persistenceError,
  type NetworkError,
} from "../errors.js"
import type { NetworkEvent } from "./event-bus.js"
import type { JetStreamName } from "./nats-propagation.js"
import type { VerifierSyncReport } from "./verifier-sync.js"

export const qrTrustGovernanceStreamName = "QRTRUST_GOVERNANCE"

export interface NatsGovernanceSubscriberConfig {
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

export interface NatsSubscriberAuthorization {
  readonly subscriber_id: string
  readonly durable_name: string
  readonly subjects: ReadonlyArray<string>
}

export interface NatsSubscriberAuthorizationExecutor {
  readonly query: (
    text: string,
    values?: ReadonlyArray<unknown>,
  ) => Promise<{ readonly rows: ReadonlyArray<Record<string, unknown>> }>
}

export interface NatsGovernanceSubscriberSyncPath {
  readonly syncReference: (
    event: NetworkEvent,
  ) => Effect.Effect<VerifierSyncReport, NetworkError>
}

export interface NatsGovernanceSubscriberReport {
  readonly stream_name: string
  readonly durable_name: string
  readonly received_messages: number
  readonly consumed_messages: number
  readonly sync_runs: number
  readonly rejected_sync_reports: number
  readonly malformed_messages: number
  readonly sync_failures: number
  readonly terminated_messages: number
  readonly nacked_messages: number
  readonly timed_out_polls: number
  readonly last_sync_report?: VerifierSyncReport
}

export const runNatsGovernanceSubscriber = (
  connection: NatsConnection,
  config: NatsGovernanceSubscriberConfig,
  syncPath: NatsGovernanceSubscriberSyncPath,
): Effect.Effect<NatsGovernanceSubscriberReport, NetworkError> =>
  Effect.tryPromise({
    try: () => runSubscriber(connection, config, syncPath),
    catch: (cause): NetworkError =>
      isNetworkError(cause)
        ? cause
        : persistenceError("NATS governance subscriber failed.", cause),
  })

export const decodeNatsGovernancePayload = (
  payload: Uint8Array,
): Effect.Effect<NetworkEvent, NetworkError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(new TextDecoder().decode(payload)) as unknown,
      catch: (cause) =>
        persistenceError("Malformed NATS governance JSON payload.", cause),
    })

    if (!parsed || typeof parsed !== "object" || !("envelope" in parsed)) {
      return yield* Effect.fail(
        persistenceError(
          "Malformed NATS governance payload: expected an envelope object.",
          parsed,
        ),
      )
    }

    const envelope = yield* decodeEventEnvelope(
      (parsed as { readonly envelope: unknown }).envelope,
    ).pipe(
      Effect.mapError((cause) =>
        persistenceError(
          "Malformed NATS governance payload: envelope does not match NetworkEvent.",
          cause,
        ),
      ),
    )

    return { envelope }
  })

export const loadNatsSubscriberAuthorization = (
  executor: NatsSubscriberAuthorizationExecutor,
  subscriberId: string,
): Effect.Effect<NatsSubscriberAuthorization, NetworkError> =>
  Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () =>
        executor.query(
          `
select
  s.subscriber_id,
  s.durable_name,
  array_agg(ss.subject order by ss.subject) as subjects
from qr_trust.nats_subscribers s
join qr_trust.nats_subscriber_subjects ss
  on ss.subscriber_id = s.subscriber_id
where s.subscriber_id = $1
  and s.status = 'active'
group by s.subscriber_id, s.durable_name
`.trim(),
          [subscriberId],
        ),
      catch: (cause) =>
        persistenceError("Failed to load NATS subscriber authorization.", cause),
    })

    const [row] = result.rows
    if (!row) {
      return yield* Effect.fail(
        persistenceError("NATS subscriber is not active or authorized.", {
          subscriber_id: subscriberId,
        }),
      )
    }

    return yield* decodeNatsSubscriberAuthorizationRow(row, subscriberId)
  })

export const natsSubscriberSubjectAllowed = (
  authorization: NatsSubscriberAuthorization,
  subject: string,
): boolean =>
  authorization.subjects.some((allowedSubject) =>
    natsSubjectMatches(allowedSubject, subject),
  )

export const natsSubscriberSubjectMatchesStream = (
  streamName: JetStreamName,
  subject: string,
): boolean => {
  if (!isQrTrustSubscriberSubject(subject)) {
    return false
  }
  const family = subject.split(".")[2]
  return Boolean(family && streamSubjectFamilies[streamName].has(family))
}

export const natsSubscriberSubjectsForStream = (
  authorization: NatsSubscriberAuthorization,
  streamName: JetStreamName,
): ReadonlyArray<string> =>
  authorization.subjects.filter((subject) =>
    natsSubscriberSubjectMatchesStream(streamName, subject),
  )

export const natsSubscriberMaterializationSubjectsForStream = (
  authorization: NatsSubscriberAuthorization,
  streamName: JetStreamName,
): ReadonlyArray<string> => {
  const materializationSubjects = streamMaterializationSubjects[streamName]
  const narrowedSubjects: string[] = []

  for (const allowedSubject of authorization.subjects) {
    if (!natsSubscriberSubjectMatchesStream(streamName, allowedSubject)) {
      continue
    }

    const rootToken = rootTokenFromSubject(allowedSubject)
    if (!rootToken) {
      continue
    }

    for (const subjectTemplate of materializationSubjects) {
      const subject = subjectTemplate.replace("qrtrust.*.", `qrtrust.${rootToken}.`)
      if (natsSubjectMatches(allowedSubject, subject)) {
        narrowedSubjects.push(subject)
      }
    }
  }

  return [...new Set(narrowedSubjects)]
}

export const natsGovernanceConsumerFilterConfig = (
  subjects: ReadonlyArray<string>,
): { readonly filter_subject?: string; readonly filter_subjects?: string[] } => {
  const uniqueSubjects = [...new Set(subjects)]
  if (uniqueSubjects.length === 0) {
    return {}
  }
  if (uniqueSubjects.length === 1) {
    const [subject] = uniqueSubjects
    return subject ? { filter_subject: subject } : {}
  }
  return { filter_subjects: uniqueSubjects }
}

const natsSubjectFamilies = new Set([
  "root",
  "authority",
  "issuer",
  "destination",
  "certificate",
  "runtime",
  "verifier",
  "scanner",
])
const controlPlaneSubjectRoot = "control-plane"
const controlPlaneSubscriberSubjects = new Set([
  "qrtrust.control-plane.runtime.provider.upserted.v1",
  "qrtrust.control-plane.authority.nats-subscriber.authorization.changed.v1",
])
const natsSubjectTokenPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

const streamSubjectFamilies: Readonly<Record<JetStreamName, ReadonlySet<string>>> = {
  QRTRUST_GOVERNANCE: new Set([
    "root",
    "authority",
    "issuer",
    "destination",
    "certificate",
  ]),
  QRTRUST_RUNTIME: new Set(["runtime", "verifier"]),
  QRTRUST_SCANNER_AUDIT: new Set(["scanner"]),
}

const streamMaterializationSubjects: Readonly<
  Record<JetStreamName, ReadonlyArray<string>>
> = {
  QRTRUST_GOVERNANCE: [
    "qrtrust.*.root.manifest.published.v1",
    "qrtrust.*.authority.manifest.published.v1",
    "qrtrust.*.issuer.record.published.v1",
    "qrtrust.*.issuer.status.changed.v1",
    "qrtrust.*.destination.policy.published.v1",
    "qrtrust.*.destination.policy.revoked.v1",
    "qrtrust.*.certificate.status.changed.v1",
  ],
  QRTRUST_RUNTIME: ["qrtrust.*.runtime.verdict.observed.v1"],
  QRTRUST_SCANNER_AUDIT: ["qrtrust.*.scanner.decision.recorded.v1"],
}

const rootTokenFromSubject = (subject: string): string | undefined => {
  const tokens = subject.split(".")
  if (tokens[0] !== "qrtrust" || !tokens[1] || !tokens[2]) {
    return undefined
  }
  return tokens[1]
}

const decodeNatsSubscriberAuthorizationRow = (
  row: Record<string, unknown>,
  expectedSubscriberId: string,
): Effect.Effect<NatsSubscriberAuthorization, NetworkError> => {
  const subscriberId = row.subscriber_id
  const durableName = row.durable_name
  const subjects = row.subjects

  if (subscriberId !== expectedSubscriberId) {
    return Effect.fail(
      persistenceError("NATS subscriber authorization row has wrong id.", row),
    )
  }
  if (typeof durableName !== "string" || durableName.length === 0) {
    return Effect.fail(
      persistenceError(
        "NATS subscriber authorization row is missing durable_name.",
        row,
      ),
    )
  }
  if (
    !Array.isArray(subjects) ||
    subjects.some(
      (subject) =>
        typeof subject !== "string" ||
        subject.length === 0 ||
        !isQrTrustSubscriberSubject(subject),
    )
  ) {
    return Effect.fail(
      persistenceError(
        "NATS subscriber authorization row has invalid subjects.",
        row,
      ),
    )
  }

  return Effect.succeed({
    subscriber_id: subscriberId,
    durable_name: durableName,
    subjects: subjects as ReadonlyArray<string>,
  })
}

const isQrTrustSubscriberSubject = (subject: string): boolean => {
  const tokens = subject.split(".")
  if (
    tokens.length < 4 ||
    tokens[0] !== "qrtrust" ||
    tokens.some((token) => token.length === 0) ||
    !natsSubjectFamilies.has(tokens[2] ?? "")
  ) {
    return false
  }

  for (const token of tokens) {
    if (token === "*" || token === ">") {
      continue
    }
    if (
      token.includes("*") ||
      token.includes(">") ||
      !natsSubjectTokenPattern.test(token)
    ) {
      return false
    }
  }

  if (tokens.slice(0, -1).includes(">")) {
    return false
  }
  if (tokens[1] === controlPlaneSubjectRoot) {
    return controlPlaneSubscriberSubjects.has(subject)
  }
  if (tokens.at(-1) === ">") {
    return tokens.length === 4
  }
  return tokens.at(-1) === "v1" && tokens.length >= 5
}

const natsSubjectMatches = (allowed: string, subject: string): boolean => {
  const allowedTokens = allowed.split(".")
  const subjectTokens = subject.split(".")

  for (let index = 0; index < allowedTokens.length; index += 1) {
    const allowedToken = allowedTokens[index]
    const subjectToken = subjectTokens[index]

    if (allowedToken === ">") {
      return (
        index === allowedTokens.length - 1 &&
        subjectTokens.length > index
      )
    }
    if (subjectToken === undefined) {
      return false
    }
    if (allowedToken === "*") {
      continue
    }
    if (allowedToken !== subjectToken) {
      return false
    }
  }

  return subjectTokens.length === allowedTokens.length
}

const runSubscriber = async (
  connection: NatsConnection,
  config: NatsGovernanceSubscriberConfig,
  syncPath: NatsGovernanceSubscriberSyncPath,
): Promise<NatsGovernanceSubscriberReport> => {
  const streamName = config.stream_name ?? qrTrustGovernanceStreamName
  await ensureDurableConsumer(connection, streamName, config)

  let receivedMessages = 0
  let consumedMessages = 0
  let syncRuns = 0
  let rejectedSyncReports = 0
  let malformedMessages = 0
  let syncFailures = 0
  let terminatedMessages = 0
  let nackedMessages = 0
  let timedOutPolls = 0
  let lastSyncReport: VerifierSyncReport | undefined

  try {
    const consumer = await connection
      .jetstream()
      .consumers.get(streamName, config.durable_name)
    const maxMessages = config.max_messages ?? Number.POSITIVE_INFINITY

    while (
      consumedMessages < maxMessages &&
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
      const result = await processNatsGovernanceMessage(message, syncPath)
      if (result.status === "malformed") {
        malformedMessages += 1
        terminatedMessages += result.terminated ? 1 : 0
        continue
      }
      if (result.status === "sync_failed") {
        syncFailures += 1
        nackedMessages += result.nacked ? 1 : 0
        continue
      }
      if (result.status === "sync_rejected") {
        rejectedSyncReports += 1
        terminatedMessages += result.terminated ? 1 : 0
        continue
      }

      consumedMessages += 1
      syncRuns += 1
      lastSyncReport = result.sync_report
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
    consumed_messages: consumedMessages,
    sync_runs: syncRuns,
    rejected_sync_reports: rejectedSyncReports,
    malformed_messages: malformedMessages,
    sync_failures: syncFailures,
    terminated_messages: terminatedMessages,
    nacked_messages: nackedMessages,
    timed_out_polls: timedOutPolls,
  }

  return lastSyncReport
    ? { ...report, last_sync_report: lastSyncReport }
    : report
}

type MessageProcessResult =
  | {
      readonly status: "synced"
      readonly sync_report: VerifierSyncReport
    }
  | {
      readonly status: "malformed"
      readonly terminated: boolean
    }
  | {
      readonly status: "sync_failed"
      readonly nacked: boolean
    }
  | {
      readonly status: "sync_rejected"
      readonly terminated: boolean
      readonly reason: string
    }

export interface NatsGovernanceMessageShape {
  readonly data: Uint8Array
  readonly ack: () => void
  readonly nak: (millis?: number) => void
  readonly term: (reason?: string) => void
}

export const processNatsGovernanceMessage = async (
  message: NatsGovernanceMessageShape,
  syncPath: NatsGovernanceSubscriberSyncPath,
): Promise<MessageProcessResult> => {
  let event: NetworkEvent
  try {
    event = await Effect.runPromise(decodeNatsGovernancePayload(message.data))
  } catch {
    return { status: "malformed", terminated: termMessage(message) }
  }

  try {
    const syncReport = await Effect.runPromise(syncPath.syncReference(event))
    const acceptance = natsGovernanceSyncReportAcceptance(event, syncReport)
    if (!acceptance.accepted) {
      return {
        status: "sync_rejected",
        terminated: termMessage(message, acceptance.reason),
        reason: acceptance.reason,
      }
    }

    message.ack()

    return { status: "synced", sync_report: syncReport }
  } catch {
    return { status: "sync_failed", nacked: nakMessage(message) }
  }
}

export interface NatsGovernanceSyncReportAcceptance {
  readonly accepted: boolean
  readonly reason: string
}

export const natsGovernanceSyncReportAcceptance = (
  event: NetworkEvent,
  report: VerifierSyncReport,
): NatsGovernanceSyncReportAcceptance => {
  if (report.missing_artifacts.length > 0) {
    return {
      accepted: false,
      reason: "missing_artifacts",
    }
  }
  if (report.artifact_hash_mismatches.length > 0) {
    return {
      accepted: false,
      reason: "artifact_hash_mismatches",
    }
  }
  if (report.rejected_status_events.length > 0) {
    return {
      accepted: false,
      reason: "rejected_status_events",
    }
  }
  if (report.processed_events < 1 || report.fetched_artifacts < 1) {
    return {
      accepted: false,
      reason: "referenced_artifact_not_validated",
    }
  }
  if (
    governanceEventRequiresSignatureValidation(event.envelope.type) &&
    (report.validated_trust_artifacts ?? 0) < 1
  ) {
    return {
      accepted: false,
      reason: "governance_event_not_signature_validated",
    }
  }
  if (
    governanceEventRequiresCacheMutation(event.envelope.type) &&
    report.projected_issuers +
      report.projected_destination_policies +
      report.applied_status_events +
      report.applied_key_status_events <
      1
  ) {
    return {
      accepted: false,
      reason: "governance_event_not_materialized",
    }
  }

  return {
    accepted: true,
    reason: "sync_report_accepted",
  }
}

const governanceEventRequiresSignatureValidation = (eventType: string): boolean =>
  [
    "root.manifest.published",
    "delegated_authority.manifest.published",
  ].includes(eventType) || governanceEventRequiresCacheMutation(eventType)

const governanceEventRequiresCacheMutation = (eventType: string): boolean =>
  [
    "issuer.record.published",
    "issuer.status.changed",
    "destination.policy.published",
    "destination.policy.revoked",
    "certificate.status.changed",
  ].includes(eventType)

const ensureDurableConsumer = async (
  connection: NatsConnection,
  streamName: string,
  config: NatsGovernanceSubscriberConfig,
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

const expectedConsumerConfig = (
  config: NatsGovernanceSubscriberConfig,
) => ({
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
  message: NatsGovernanceMessageShape,
  reason = "malformed governance envelope payload",
): boolean => {
  try {
    message.term(reason)
    return true
  } catch {
    return false
  }
}

const nakMessage = (message: NatsGovernanceMessageShape): boolean => {
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
