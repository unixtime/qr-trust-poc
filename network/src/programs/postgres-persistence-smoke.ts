import { Console, Effect } from "effect"

import {
  EventBus,
  InMemoryEventBusLive,
  makeArtifactPublicationService,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makeInMemoryVerifierCache,
  makePostgresPersistenceService,
  makeRecordingPostgresStatementSink,
  makeRuntimeSafetyObservation,
  makeScannerDecisionService,
  makeVerifierSyncService,
  makeFixtureTrustArtifactSigner,
} from "../index.js"
import type { SignedArtifact } from "../services/artifact-store.js"
import {
  demoDestinationPolicyProjection,
  demoIssuerProjection,
} from "../services/verifier-cache.js"
import type { NetworkError } from "../errors.js"

const observedAt = new Date("2026-05-17T00:00:00Z")

const program = Effect.gen(function* () {
  const eventBus = yield* EventBus
  const artifactStore = makeInMemoryArtifactStore()
  const cache = makeInMemoryVerifierCache()
  const publisher = makeArtifactPublicationService(artifactStore, eventBus)
  const governancePublisher = makeGovernancePublicationService(publisher)
  const verifierSync = makeVerifierSyncService(artifactStore, eventBus, cache)
  const scanner = makeScannerDecisionService(cache, eventBus)
  const sink = makeRecordingPostgresStatementSink()
  const persistence = makePostgresPersistenceService(sink)
  const signer = makeFixtureTrustArtifactSigner()

  const publishedGovernance = yield* governancePublisher.publishReferenceBundle(
    observedAt,
  )
  const sync = yield* verifierSync.syncRecent()
  const green = yield* scanner.decide({
    payload: "https://acme.example/pay",
    observedAt,
  })
  const publishedIssuerStatus = yield* publisher.publishArtifact({
    artifact_type: "revocation_status_event",
    artifact_id: "art_status_acme_demo_suspended_v1",
    version: 1,
    root_program_id: demoIssuerProjection.namespace.root_program_id,
    delegated_authority_id:
      demoIssuerProjection.namespace.delegated_authority_id,
    issuer_id: demoIssuerProjection.namespace.issuer_id,
    body: (yield* signer.signTrustArtifact({
      body: {
        artifact_type: "revocation_status_event",
        schema_version: "0.1.0",
        status_event_id: "status:acme-demo:suspended:v1",
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        delegated_authority_id:
          demoIssuerProjection.namespace.delegated_authority_id,
        target: {
          target_type: "issuer_record",
          issuer_id: demoIssuerProjection.namespace.issuer_id,
        },
        status: "suspended",
        reason: "signed suspension proves status-event persistence mapping",
        effective_at: observedAt.toISOString(),
        signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      },
      signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
    })).body,
    occurredAt: observedAt,
    eventType: "issuer.status.changed",
    reason: "signed suspension for persistence smoke path",
  })

  const artifacts = yield* fetchArtifacts([
    publishedGovernance.root_manifest_artifact_id,
    publishedGovernance.delegated_authority_artifact_id,
    publishedGovernance.issuer_record_artifact_id,
    publishedGovernance.destination_policy_artifact_id,
    publishedIssuerStatus.artifact.artifact_id,
  ], artifactStore.get)

  const events = yield* eventBus.recent()
  const persistenceReport = yield* persistence.persistBatch({
    artifacts,
    events,
    verifier_cache_entries: [
      {
        verifier_id: "verifier:local-demo",
        issuer: demoIssuerProjection,
        policy: demoDestinationPolicyProjection,
        source_artifact_hashes: artifacts.map((artifact) => artifact.artifact_hash),
      },
    ],
    runtime_observations: [
      makeRuntimeSafetyObservation({
        runtime_input: {
          destinationUrl: new URL("https://acme.example/pay"),
          observedAt,
        },
        verdict: {
          status: "clear",
          provider: "deterministic-runtime-safety",
          observed_at: observedAt.toISOString(),
          effective_url: "https://acme.example/pay",
          risk_score_delta: 0,
          reason_codes: ["runtime_clear"],
          message: "Runtime provider did not report current destination risk.",
        },
        ttl_seconds: 300,
        governance: {
          ...demoIssuerProjection.namespace,
          destination_policy_id:
            demoDestinationPolicyProjection.destination_policy_id,
        },
      }),
    ],
    scanner_decisions: [
      {
        verifier_id: "verifier:local-demo",
        decision: green,
      },
    ],
  })

  const recorded = sink.recorded()
  const artifactCommand = requireCommand(
    recorded.find((command) => command.name === "published_artifacts.upsert"),
    "published artifact command missing",
  )
  const statusCommand = requireCommand(
    recorded.find((command) => command.name === "status_events.upsert"),
    "status event command missing",
  )
  const scannerCommand = requireCommand(
    recorded.find((command) => command.name === "scanner_decisions.insert"),
    "scanner decision command missing",
  )
  const runtimeObservationCommand = requireCommand(
    recorded.find((command) => command.name === "runtime_observations.insert"),
    "runtime observation command missing",
  )
  const cacheCommand = requireCommand(
    recorded.find((command) => command.name === "verifier_cache_entries.upsert"),
    "verifier cache command missing",
  )

  yield* assertSmoke(
    sync.projected_issuers === 1 && sync.projected_destination_policies === 1,
    "verifier cache was not materialized before persistence mapping",
  )
  yield* assertSmoke(
    artifactCommand.values[0] === "art_root_qrtrust_demo_2026_v1",
    "published artifact ID must stay contract-native text",
  )
  yield* assertSmoke(
    statusCommand.values[0] === "status:acme-demo:suspended:v1",
    "status_event_id must stay contract-native text",
  )
  yield* assertSmoke(
    scannerCommand.values[0] === green.decision_id,
    "scanner decision command did not preserve decision_id",
  )
  yield* assertSmoke(
    cacheCommand.values[0] === "verifier:local-demo",
    "verifier cache command did not preserve verifier_id",
  )
  yield* assertSmoke(
    runtimeObservationCommand.values[0] === "deterministic-runtime-safety" &&
      runtimeObservationCommand.values[4] === "clear" &&
      runtimeObservationCommand.values[5] === 0,
    "runtime observation command did not preserve provider/verdict/risk evidence",
  )
  yield* assertSmoke(
    persistenceReport.commands_executed === recorded.length,
    "persistence report command count drifted from recorded statements",
  )
  yield* assertSmoke(
    persistenceReport.artifacts_upserted === 5 &&
      persistenceReport.status_events_upserted === 1 &&
      persistenceReport.events_enqueued === events.length &&
      persistenceReport.cache_entries_upserted === 1 &&
      persistenceReport.runtime_observations_inserted === 1 &&
      persistenceReport.scanner_decisions_inserted === 1,
    "persistence batch counts do not match expected publication shape",
  )

  yield* Console.log(
    JSON.stringify(
      {
        sql_commands: recorded.length,
        persistence_report: persistenceReport,
        command_names: [...new Set(recorded.map((command) => command.name))],
        artifacts_persisted: artifacts.length,
        events_enqueued: events.length,
        scanner_decision: {
          id: green.decision_id,
          color: green.decision_color,
          state: green.decision_state,
        },
        runtime_observation: {
          provider: runtimeObservationCommand.values[0],
          verdict: runtimeObservationCommand.values[4],
          risk_score: runtimeObservationCommand.values[5],
        },
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

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

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Postgres persistence smoke failed: ${message}`)
    }
  })

const requireCommand = (
  command: ReturnType<PostgresStatementSink["recorded"]>[number] | undefined,
  message: string,
) => {
  if (!command) {
    throw new Error(`Postgres persistence smoke failed: ${message}`)
  }

  return command
}

type PostgresStatementSink = ReturnType<typeof makeRecordingPostgresStatementSink>

Effect.runPromise(program)
