import { Console, Effect } from "effect"
import type { Pool } from "pg"

import {
  makeInMemoryEventBus,
  makeCryptographicSignatureVerifier,
  makeDefaultKeyMaterialProvider,
  makePgPool,
  makePostgresArtifactStore,
  makePostgresExecutorFromClient,
  makePostgresPersistenceService,
  makePostgresTrustKeyRegistry,
  makePostgresVerifierCacheReadModelQueueStore,
  makeVerifierCacheReadModelQueueSupervisor,
  makeVerifierCacheReadModelQueueWorker,
  makeVerifierCacheReadModelWorker,
  makeVerifierCacheReadModelWorkItemAuthorizer,
  persistenceError,
  type NetworkError,
} from "../index.js"

interface WorkerRuntimeConfig {
  readonly database_url: string
  readonly worker_id: string
  readonly batch_size: number
  readonly claim_ttl_ms: number
  readonly poll_interval_ms: number
  readonly idle_poll_interval_ms: number
  readonly idle_iteration_limit: number
  readonly max_iterations: number
  readonly require_status_event_authorization: boolean
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
        verifier_cache_read_model_worker_runtime: "starting",
        database: databaseLabel(config.database_url),
        worker_id: config.worker_id,
        batch_size: config.batch_size,
        claim_ttl_ms: config.claim_ttl_ms,
        poll_interval_ms: config.poll_interval_ms,
        idle_poll_interval_ms: config.idle_poll_interval_ms,
        idle_iteration_limit: finiteOrUnbounded(config.idle_iteration_limit),
        max_iterations: finiteOrUnbounded(config.max_iterations),
        status_event_authorization:
          config.require_status_event_authorization ? "enabled" : "disabled",
      },
      null,
      2,
    ),
  )

  const report = yield* withPgPool(config.database_url, (pool) =>
    Effect.gen(function* () {
      const executor = makePostgresExecutorFromClient(pool)
      const artifactStore = makePostgresArtifactStore(executor)
      const persistence = makePostgresPersistenceService(executor)
      const eventBus = makeInMemoryEventBus()
      const statusEventAuthorizer =
        config.require_status_event_authorization
          ? makeVerifierCacheReadModelWorkItemAuthorizer(
              artifactStore,
              makeCryptographicSignatureVerifier(
                makePostgresTrustKeyRegistry(executor),
                makeDefaultKeyMaterialProvider(),
              ),
            )
          : undefined
      const readModelWorker = makeVerifierCacheReadModelWorker(
        artifactStore,
        persistence,
        eventBus,
      )
      const queueWorker = makeVerifierCacheReadModelQueueWorker(
        makePostgresVerifierCacheReadModelQueueStore(executor),
        readModelWorker,
        {
          worker_id: config.worker_id,
          batch_size: config.batch_size,
          claim_ttl_ms: config.claim_ttl_ms,
          ...(statusEventAuthorizer
            ? { authorizer: statusEventAuthorizer }
            : {}),
        },
      )
      const supervisor = makeVerifierCacheReadModelQueueSupervisor(queueWorker, {
        worker_id: config.worker_id,
        poll_interval_ms: config.poll_interval_ms,
        idle_poll_interval_ms: config.idle_poll_interval_ms,
        idle_iteration_limit: config.idle_iteration_limit,
        max_iterations: config.max_iterations,
        shutdown_signal: shutdownSignal,
      })

      return yield* supervisor.run()
    }),
  )

  yield* Console.log(
    JSON.stringify(
      {
        verifier_cache_read_model_worker_runtime: "stopped",
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
  const databaseUrl = requiredEnv(env, "QRTRUST_NETWORK_DATABASE_URL")

  return {
    database_url: databaseUrl,
    worker_id:
      env.QRTRUST_VERIFIER_CACHE_WORKER_ID ??
      `qrtrust-verifier-cache-worker-${process.pid}`,
    batch_size: positiveIntegerEnv(
      env,
      "QRTRUST_VERIFIER_CACHE_BATCH_SIZE",
      50,
    ),
    claim_ttl_ms: positiveIntegerEnv(
      env,
      "QRTRUST_VERIFIER_CACHE_CLAIM_TTL_MS",
      60_000,
    ),
    poll_interval_ms: nonNegativeIntegerEnv(
      env,
      "QRTRUST_VERIFIER_CACHE_POLL_INTERVAL_MS",
      1_000,
    ),
    idle_poll_interval_ms: nonNegativeIntegerEnv(
      env,
      "QRTRUST_VERIFIER_CACHE_IDLE_POLL_INTERVAL_MS",
      5_000,
    ),
    idle_iteration_limit: positiveIntegerOrInfinityEnv(
      env,
      "QRTRUST_VERIFIER_CACHE_IDLE_ITERATION_LIMIT",
      Number.POSITIVE_INFINITY,
    ),
    max_iterations: positiveIntegerOrInfinityEnv(
      env,
      "QRTRUST_VERIFIER_CACHE_MAX_ITERATIONS",
      Number.POSITIVE_INFINITY,
    ),
    require_status_event_authorization: booleanEnv(
      env,
      "QRTRUST_VERIFIER_CACHE_REQUIRE_STATUS_EVENT_AUTHORIZATION",
      true,
    ),
  }
}

const requiredEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
): string => {
  const value = env[key]
  if (!value) {
    throw new Error(
      `${key} is required for the verifier-cache read-model worker runtime.`,
    )
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

const booleanEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: boolean,
): boolean => {
  const value = env[key]
  if (value === undefined || value === "") {
    return fallback
  }

  const normalized = value.toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false
  }

  throw new Error(`${key} must be a boolean value.`)
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

Effect.runPromise(program).catch((cause: NetworkError | unknown) => {
  console.error(cause)
  process.exitCode = 1
})
