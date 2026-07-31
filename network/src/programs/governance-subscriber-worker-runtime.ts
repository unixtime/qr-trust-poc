import { Console, Effect } from "effect"
import type { Pool } from "pg"

import {
  connectNatsJs,
  drainNatsJsConnection,
  ensureQrTrustJetStreamStreams,
  makeInMemoryEventBus,
  makePgPool,
  makePostgresArtifactStore,
  makePostgresExecutorFromClient,
  makePostgresVerifierCacheWriter,
  makeVerifierSyncService,
  loadNatsSubscriberAuthorization,
  natsSubscriberMaterializationSubjectsForStream,
  natsSubscriberSubjectMatchesStream,
  natsSubscriberSubjectAllowed,
  persistenceError,
  runNatsGovernanceSubscriber,
  type NetworkError,
  type NetworkEvent,
} from "../index.js"

interface WorkerRuntimeConfig {
  readonly database_url: string
  readonly nats_url: string
  readonly nats_user: string
  readonly nats_password: string
  readonly accepted_root_program_ids: ReadonlyArray<string>
  readonly worker_id: string
  readonly subscriber_id: string
  readonly durable_name: string
  readonly verifier_id: string
  readonly filter_subject?: string
  readonly max_messages: number
  readonly expires_ms: number
  readonly nats_timeout_ms: number
}

const shutdown = new AbortController()
const shutdownSignal = shutdown.signal

process.once("SIGINT", () => shutdown.abort())
process.once("SIGTERM", () => shutdown.abort())

const program = Effect.gen(function* () {
  const config = loadRuntimeConfig(process.env)

  yield* Console.log(
    JSON.stringify(
      {
        governance_subscriber_worker_runtime: "starting",
        database: databaseLabel(config.database_url),
        nats_url: natsLabel(config.nats_url),
        worker_id: config.worker_id,
        subscriber_id: config.subscriber_id,
        durable_name: config.durable_name,
        verifier_id: config.verifier_id,
        accepted_root_program_ids: config.accepted_root_program_ids,
        filter_subject: config.filter_subject ?? "all_governance_subjects",
        max_messages: finiteOrUnbounded(config.max_messages),
        expires_ms: config.expires_ms,
        cache_writer: "postgres_verifier_cache_entries",
      },
      null,
      2,
    ),
  )

  const report = yield* withPgPool(config.database_url, (pool) =>
    Effect.acquireUseRelease(
      connectNatsJs({
        servers: config.nats_url,
        name: config.worker_id,
        user: config.nats_user,
        pass: config.nats_password,
        timeout_ms: config.nats_timeout_ms,
      }),
      (connection) =>
        Effect.gen(function* () {
          const streamEnsure = yield* Effect.tryPromise({
            try: () => connection.jetstreamManager(),
            catch: (cause) =>
              persistenceError("Failed to create JetStream manager.", cause),
          }).pipe(
            Effect.flatMap(ensureQrTrustJetStreamStreams),
            Effect.match({
              onFailure: (error) => ({
                status: "skipped",
                reason: error.message,
              }),
              onSuccess: (ensureReport) => ({
                status: "ready",
                streams: ensureReport.streams,
              }),
            }),
          )

          yield* Console.log(
            JSON.stringify(
              {
                governance_subscriber_worker_runtime: "streams",
                stream_ensure: streamEnsure,
              },
              null,
              2,
            ),
          )

          const executor = makePostgresExecutorFromClient(pool)
          const subscriberAuthorization =
            yield* loadNatsSubscriberAuthorization(pool, config.subscriber_id)
          const effectiveDurableName = subscriberAuthorization.durable_name
          const effectiveFilterSubjects = config.filter_subject
            ? [config.filter_subject]
            : natsSubscriberMaterializationSubjectsForStream(
                subscriberAuthorization,
                "QRTRUST_GOVERNANCE",
              )
          if (effectiveFilterSubjects.length === 0) {
            return yield* Effect.fail(
              persistenceError(
                "NATS subscriber has no authorized governance subjects.",
                subscriberAuthorization,
              ),
            )
          }
          const offStreamFilterSubjects = effectiveFilterSubjects.filter(
            (subject) =>
              !natsSubscriberSubjectMatchesStream("QRTRUST_GOVERNANCE", subject),
          )
          if (offStreamFilterSubjects.length > 0) {
            return yield* Effect.fail(
              persistenceError(
                "NATS subscriber filter subject is outside the governance stream.",
                {
                  subscriber_id: subscriberAuthorization.subscriber_id,
                  filter_subjects: offStreamFilterSubjects,
                  authorized_subjects: subscriberAuthorization.subjects,
                },
              ),
            )
          }
          const unauthorizedFilterSubjects = effectiveFilterSubjects.filter(
            (subject) =>
              !natsSubscriberSubjectAllowed(subscriberAuthorization, subject),
          )
          if (unauthorizedFilterSubjects.length > 0) {
            return yield* Effect.fail(
              persistenceError(
                "NATS subscriber is not authorized for filter subject.",
                {
                  subscriber_id: subscriberAuthorization.subscriber_id,
                  filter_subjects: unauthorizedFilterSubjects,
                  authorized_subjects: subscriberAuthorization.subjects,
                },
              ),
            )
          }

          yield* Console.log(
            JSON.stringify(
              {
                governance_subscriber_worker_runtime: "authorization",
                subscriber_id: subscriberAuthorization.subscriber_id,
                durable_name: effectiveDurableName,
                filter_subjects: effectiveFilterSubjects,
              },
              null,
              2,
            ),
          )

          const cacheExecutor = {
            ...executor,
            query: (text: string, values?: ReadonlyArray<unknown>) =>
              pool.query(text, values ? [...values] : undefined),
          }
          const artifactStore = makePostgresArtifactStore(executor)
          const cache = makePostgresVerifierCacheWriter(cacheExecutor, {
            verifier_id: config.verifier_id,
            accepted_root_program_ids: config.accepted_root_program_ids,
          })

          return yield* runNatsGovernanceSubscriber(
            connection,
            {
              durable_name: effectiveDurableName,
              filter_subjects: effectiveFilterSubjects,
              max_messages: config.max_messages,
              expires_ms: config.expires_ms,
              shutdown_signal: shutdownSignal,
            },
            {
              syncReference: (event: NetworkEvent) => {
                const eventBus = makeInMemoryEventBus()
                const syncService = makeVerifierSyncService(
                  artifactStore,
                  eventBus,
                  cache,
                )

                return eventBus
                  .publish(event)
                  .pipe(Effect.flatMap(() => syncService.syncRecent()))
              },
            },
          )
        }),
      (connection) => drainNatsJsConnection(connection).pipe(Effect.orDie),
    ),
  )

  yield* Console.log(
    JSON.stringify(
      {
        governance_subscriber_worker_runtime: "stopped",
        cache_writer: "postgres_verifier_cache_entries",
        report,
      },
      null,
      2,
    ),
  )
})

const withPgPool = <A>(
  connectionString: string,
  use: (pool: Pool) => Effect.Effect<A, NetworkError>,
): Effect.Effect<A, NetworkError> =>
  Effect.acquireUseRelease(
    Effect.sync(() => makePgPool({ connectionString, max: 3 })),
    use,
    (pool) =>
      Effect.tryPromise({
        try: () => pool.end(),
        catch: (cause) =>
          persistenceError("Postgres pool shutdown failed.", cause),
      }).pipe(Effect.orDie),
  )

const loadRuntimeConfig = (
  env: NodeJS.ProcessEnv,
): WorkerRuntimeConfig => {
  const filterSubject = optionalEnv(env, "QRTRUST_GOVERNANCE_SUBSCRIBER_SUBJECT")

  return {
    database_url: requiredEnv(env, "QRTRUST_NETWORK_DATABASE_URL"),
    nats_url: env.QRTRUST_NETWORK_NATS_URL ?? "nats://127.0.0.1:4222",
    nats_user:
      env.QRTRUST_NETWORK_NATS_USER ?? "qrtrust_governance_subscriber",
    nats_password:
      env.QRTRUST_NETWORK_NATS_PASSWORD ??
      "qrtrust_governance_subscriber_dev",
    accepted_root_program_ids: stringListEnv(
      env,
      "QRTRUST_ACCEPTED_ROOT_PROGRAM_IDS",
      ["root:qrtrust-demo:2026"],
    ),
    worker_id:
      env.QRTRUST_GOVERNANCE_SUBSCRIBER_WORKER_ID ??
      `qrtrust-governance-subscriber-${process.pid}`,
    subscriber_id:
      env.QRTRUST_GOVERNANCE_SUBSCRIBER_ID ??
      "subscriber:reference-governance",
    durable_name:
      env.QRTRUST_GOVERNANCE_SUBSCRIBER_DURABLE ??
      "qrtrust_governance_subscriber_worker",
    verifier_id:
      env.QRTRUST_GOVERNANCE_SUBSCRIBER_VERIFIER_ID ??
      "verifier:reference-network",
    ...(filterSubject ? { filter_subject: filterSubject } : {}),
    max_messages: positiveIntegerOrInfinityEnv(
      env,
      "QRTRUST_GOVERNANCE_SUBSCRIBER_MAX_MESSAGES",
      Number.POSITIVE_INFINITY,
    ),
    expires_ms: positiveIntegerEnv(
      env,
      "QRTRUST_GOVERNANCE_SUBSCRIBER_EXPIRES_MS",
      2_000,
    ),
    nats_timeout_ms: positiveIntegerEnv(env, "QRTRUST_NATS_TIMEOUT_MS", 2_000),
  }
}

const optionalEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
): string | undefined => {
  const value = env[key]
  return value === undefined || value === "" ? undefined : value
}

const requiredEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
): string => {
  const value = env[key]
  if (!value) {
    throw new Error(
      `${key} is required for the governance subscriber worker runtime.`,
    )
  }

  return value
}

const stringListEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const value = env[key]
  if (!value) {
    return fallback
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

const positiveIntegerEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number => {
  const value = env[key]
  if (value === undefined || value === "") {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer.`)
  }

  return parsed
}

const positiveIntegerOrInfinityEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number => {
  const value = env[key]
  if (value === undefined || value === "") {
    return fallback
  }
  if (value === "Infinity" || value === "unbounded") {
    return Number.POSITIVE_INFINITY
  }

  return positiveIntegerEnv(env, key, fallback)
}

const finiteOrUnbounded = (value: number): number | "unbounded" =>
  Number.isFinite(value) ? value : "unbounded"

const databaseLabel = (connectionString: string): string => {
  try {
    const url = new URL(connectionString)
    return `${url.protocol}//${url.username || "user"}@${url.host}${url.pathname}`
  } catch {
    return "configured"
  }
}

const natsLabel = (connectionString: string): string => {
  try {
    const url = new URL(connectionString)
    const user = url.username ? `${url.username}@` : ""
    return `${url.protocol}//${user}${url.host}${url.pathname}`
  } catch {
    return "configured"
  }
}

Effect.runPromise(program).catch((cause: NetworkError | unknown) => {
  console.error(cause)
  process.exitCode = 1
})
