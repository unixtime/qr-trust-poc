import { Console, Effect } from "effect"
import type { Pool } from "pg"

import {
  EventBus,
  InMemoryEventBusLive,
  makeArtifactPublicationService,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryVerifierCache,
  makePgPool,
  makePostgresArtifactStore,
  makePostgresExecutorFromClient,
  makePostgresPersistenceService,
  makePostgresTransactionRunner,
  makeScannerDecisionService,
  makeVerifierSyncService,
} from "../index.js"
import { persistenceError, type NetworkError } from "../errors.js"
import type { SignedArtifact } from "../services/artifact-store.js"
import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
} from "../services/verifier-cache.js"
import {
  resetAndApplyReferenceSchema,
  seedReferenceRows,
} from "./postgres-reference-seed.js"

const observedAt = new Date("2026-05-17T00:00:00Z")
const databaseUrl = process.env.QRTRUST_NETWORK_DATABASE_URL
const resetRequested =
  process.env.QRTRUST_NETWORK_LIVE_SMOKE_RESET === "true"

const runLiveSmoke = (connectionString: string) =>
  withPgPool(connectionString, (pool) =>
    Effect.gen(function* () {
      yield* resetAndApplyReferenceSchema(pool)

      const eventBus = yield* EventBus
      const artifactStore = makeInMemoryArtifactStore()
      const cache = makeInMemoryVerifierCache()
      const publisher = makeArtifactPublicationService(artifactStore, eventBus)
      const governancePublisher = makeGovernancePublicationService(publisher)
      const verifierSync = makeVerifierSyncService(artifactStore, eventBus, cache)
      const scanner = makeScannerDecisionService(cache, eventBus)

      const publishedGovernance =
        yield* governancePublisher.publishReferenceBundle(observedAt)
      const sync = yield* verifierSync.syncRecent()
      const green = yield* scanner.decide({
        payload: "https://acme.example/pay",
        observedAt,
      })

      const artifacts = yield* fetchArtifacts([
        publishedGovernance.root_manifest_artifact_id,
        publishedGovernance.delegated_authority_artifact_id,
        publishedGovernance.issuer_record_artifact_id,
        publishedGovernance.destination_policy_artifact_id,
      ], artifactStore.get)
      const events = yield* eventBus.recent()

      const runner = makePostgresTransactionRunner(pool)
      const persistenceReport = yield* runner.transact((executor) =>
        Effect.gen(function* () {
          yield* seedReferenceRows(executor)

          return yield* makePostgresPersistenceService(executor).persistBatch({
            artifacts,
            events,
            verifier_cache_entries: [
              {
                verifier_id: "verifier:live-postgres-smoke",
                issuer: demoIssuerProjection,
                policy: demoDestinationPolicyProjection,
                source_artifact_hashes: artifacts.map(
                  (artifact) => artifact.artifact_hash,
                ),
              },
            ],
            scanner_decisions: [
              {
                verifier_id: "verifier:live-postgres-smoke",
                decision: green,
              },
            ],
          })
        }),
      )

      const liveArtifactStore = makePostgresArtifactStore(
        makePostgresExecutorFromClient(pool),
      )
      const rootArtifact = yield* requireValue(
        yield* liveArtifactStore.get(
          publishedGovernance.root_manifest_artifact_id,
        ),
        "root manifest was not readable after commit",
      )
      const counts = yield* fetchCounts(pool)

      yield* assertSmoke(
        sync.projected_issuers === 1 && sync.projected_destination_policies === 1,
        "verifier sync did not materialize the reference issuer and policy",
      )
      yield* assertSmoke(
        rootArtifact.artifact_hash === artifacts[0]?.artifact_hash,
        "artifact lookup returned a different root manifest hash",
      )
      yield* assertSmoke(
        counts.published_artifacts === 4 &&
          counts.event_outbox === events.length &&
          counts.verifier_cache_entries === 1 &&
          counts.scanner_decisions === 1,
        "live Postgres row counts do not match the expected reference batch",
      )

      yield* Console.log(
        JSON.stringify(
          {
            live_postgres_smoke: "passed",
            reset_schema: "qr_trust",
            persistence_report: persistenceReport,
            row_counts: counts,
            scanner_decision: {
              id: green.decision_id,
              color: green.decision_color,
              state: green.decision_state,
            },
          },
          null,
          2,
        ),
      )
    }).pipe(Effect.provide(InMemoryEventBusLive)),
  )

const withPgPool = <A>(
  connectionString: string,
  use: (pool: Pool) => Effect.Effect<A, NetworkError>,
): Effect.Effect<A, NetworkError> =>
  Effect.acquireUseRelease(
    Effect.sync(() => makePgPool({ connectionString, max: 1 })),
    use,
    (pool) =>
      Effect.tryPromise({
        try: () => pool.end(),
        catch: (cause) =>
          persistenceError("Postgres pool shutdown failed.", cause),
      }).pipe(Effect.orDie),
  )

const fetchArtifacts = (
  artifactIds: ReadonlyArray<string>,
  getArtifact: (
    artifactId: string,
  ) => Effect.Effect<SignedArtifact | undefined, NetworkError>,
): Effect.Effect<ReadonlyArray<SignedArtifact>, NetworkError> =>
  Effect.gen(function* () {
    const artifacts: SignedArtifact[] = []
    for (const artifactId of artifactIds) {
      const artifact = yield* getArtifact(artifactId)
      if (!artifact) {
        throw new Error(`Expected artifact ${artifactId} to exist.`)
      }
      artifacts.push(artifact)
    }

    return artifacts
  })

const fetchCounts = (
  pool: Pool,
): Effect.Effect<
  {
    readonly published_artifacts: number
    readonly event_outbox: number
    readonly verifier_cache_entries: number
    readonly scanner_decisions: number
  },
  NetworkError
> =>
  Effect.tryPromise({
    try: async () => {
      const result = await pool.query<{
        readonly published_artifacts: number
        readonly event_outbox: number
        readonly verifier_cache_entries: number
        readonly scanner_decisions: number
      }>(`
select
  (select count(*)::int from qr_trust.published_artifacts) as published_artifacts,
  (select count(*)::int from qr_trust.event_outbox) as event_outbox,
  (select count(*)::int from qr_trust.verifier_cache_entries) as verifier_cache_entries,
  (select count(*)::int from qr_trust.scanner_decisions) as scanner_decisions
`)
      const row = result.rows[0]
      if (!row) {
        throw new Error("Postgres count query returned no rows.")
      }
      return row
    },
    catch: (cause) => persistenceError("Postgres count query failed.", cause),
  })

const requireValue = <A>(
  value: A | undefined,
  message: string,
): Effect.Effect<A> =>
  Effect.sync(() => {
    if (value === undefined) {
      throw new Error(`Live Postgres smoke failed: ${message}`)
    }

    return value
  })

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Live Postgres smoke failed: ${message}`)
    }
  })

const skipped = (reason: string): Effect.Effect<void> =>
  Console.log(
    JSON.stringify(
      {
        live_postgres_smoke: "skipped",
        reason,
      },
      null,
      2,
    ),
  )

const program = databaseUrl
  ? resetRequested
    ? runLiveSmoke(databaseUrl)
    : skipped(
        "QRTRUST_NETWORK_LIVE_SMOKE_RESET=true is required before this smoke resets qr_trust.",
      )
  : skipped(
      "Set QRTRUST_NETWORK_DATABASE_URL to run the optional scratch Postgres smoke.",
    )

Effect.runPromise(program)
