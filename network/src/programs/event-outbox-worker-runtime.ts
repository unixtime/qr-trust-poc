import { Console, Effect } from "effect"
import type { Pool } from "pg"

import {
  connectNatsJs,
  drainNatsJsConnection,
  ensureQrTrustJetStreamStreams,
  eventPublicationError,
  makeEventOutboxPublisher,
  makeEventOutboxSupervisor,
  makeEventOutboxWorker,
  makeLiveJetStreamMessageSink,
  makeNatsJsJetStreamPublisher,
  makePgPool,
  makePostgresEventOutboxMetricsStore,
  makePostgresEventOutboxWorkerStore,
  makePostgresExecutorFromClient,
  persistenceError,
  type NetworkError,
} from "../index.js"

interface WorkerRuntimeConfig {
  readonly database_url: string
  readonly nats_url: string
  readonly nats_user?: string | undefined
  readonly nats_password?: string | undefined
  readonly worker_id: string
  readonly batch_size: number
  readonly claim_ttl_ms: number
  readonly poll_interval_ms: number
  readonly idle_poll_interval_ms: number
  readonly idle_iteration_limit: number
  readonly max_iterations: number
  readonly failed_row_limit: number
  readonly max_retry_attempts: number
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
        event_outbox_worker_runtime: "starting",
        database: databaseLabel(config.database_url),
        nats_url: natsLabel(config.nats_url),
        worker_id: config.worker_id,
        batch_size: config.batch_size,
        claim_ttl_ms: config.claim_ttl_ms,
        poll_interval_ms: config.poll_interval_ms,
        idle_poll_interval_ms: config.idle_poll_interval_ms,
        idle_iteration_limit: finiteOrUnbounded(config.idle_iteration_limit),
        max_iterations: finiteOrUnbounded(config.max_iterations),
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
        timeout_ms: config.nats_timeout_ms,
        user: config.nats_user,
        pass: config.nats_password,
      }),
      (connection) =>
        Effect.gen(function* () {
          const manager = yield* Effect.tryPromise({
            try: () => connection.jetstreamManager(),
            catch: (cause): NetworkError =>
              eventPublicationError("Failed to create JetStream manager.", {
                cause,
              }),
          })
          const ensureReport = yield* ensureQrTrustJetStreamStreams(manager)
          yield* Console.log(
            JSON.stringify(
              {
                event_outbox_worker_runtime: "streams_ready",
                streams: ensureReport.streams,
              },
              null,
              2,
            ),
          )

          const executor = makePostgresExecutorFromClient(pool)
          const sink = makeLiveJetStreamMessageSink(
            makeNatsJsJetStreamPublisher(connection.jetstream()),
          )
          const worker = makeEventOutboxWorker(
            makePostgresEventOutboxWorkerStore(executor),
            makeEventOutboxPublisher(sink),
            {
              worker_id: config.worker_id,
              batch_size: config.batch_size,
              claim_ttl_ms: config.claim_ttl_ms,
              max_retry_attempts: config.max_retry_attempts,
            },
          )
          const supervisor = makeEventOutboxSupervisor(
            worker,
            makePostgresEventOutboxMetricsStore(executor),
            {
              worker_id: config.worker_id,
              poll_interval_ms: config.poll_interval_ms,
              idle_poll_interval_ms: config.idle_poll_interval_ms,
              idle_iteration_limit: config.idle_iteration_limit,
              max_iterations: config.max_iterations,
              failed_row_limit: config.failed_row_limit,
              max_retry_attempts: config.max_retry_attempts,
              shutdown_signal: shutdownSignal,
            },
          )

          return yield* supervisor.run()
        }),
      (connection) => drainNatsJsConnection(connection).pipe(Effect.orDie),
    ),
  )

  yield* Console.log(
    JSON.stringify(
      {
        event_outbox_worker_runtime: "stopped",
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
    Effect.sync(() => makePgPool({ connectionString, max: 2 })),
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
  const databaseUrl = requiredEnv(env, "QRTRUST_NETWORK_DATABASE_URL")

  return {
    database_url: databaseUrl,
    nats_url: env.QRTRUST_NETWORK_NATS_URL ?? "nats://127.0.0.1:4222",
    nats_user: optionalEnv(env, "QRTRUST_NETWORK_NATS_USER"),
    nats_password: optionalEnv(env, "QRTRUST_NETWORK_NATS_PASSWORD"),
    worker_id:
      env.QRTRUST_OUTBOX_WORKER_ID ?? `qrtrust-outbox-worker-${process.pid}`,
    batch_size: positiveIntegerEnv(env, "QRTRUST_OUTBOX_BATCH_SIZE", 100),
    claim_ttl_ms: positiveIntegerEnv(env, "QRTRUST_OUTBOX_CLAIM_TTL_MS", 60_000),
    poll_interval_ms: nonNegativeIntegerEnv(
      env,
      "QRTRUST_OUTBOX_POLL_INTERVAL_MS",
      1_000,
    ),
    idle_poll_interval_ms: nonNegativeIntegerEnv(
      env,
      "QRTRUST_OUTBOX_IDLE_POLL_INTERVAL_MS",
      5_000,
    ),
    idle_iteration_limit: positiveIntegerOrInfinityEnv(
      env,
      "QRTRUST_OUTBOX_IDLE_ITERATION_LIMIT",
      Number.POSITIVE_INFINITY,
    ),
    max_iterations: positiveIntegerOrInfinityEnv(
      env,
      "QRTRUST_OUTBOX_MAX_ITERATIONS",
      Number.POSITIVE_INFINITY,
    ),
    failed_row_limit: positiveIntegerEnv(
      env,
      "QRTRUST_OUTBOX_FAILED_ROW_LIMIT",
      10,
    ),
    max_retry_attempts: positiveIntegerEnv(
      env,
      "QRTRUST_OUTBOX_MAX_RETRY_ATTEMPTS",
      3,
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
    throw new Error(`${key} is required for the event outbox worker runtime.`)
  }

  return value
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

const nonNegativeIntegerEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number => {
  const value = env[key]
  if (value === undefined || value === "") {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${key} must be a non-negative integer.`)
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
