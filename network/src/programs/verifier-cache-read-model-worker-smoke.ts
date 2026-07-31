import { Console, Effect } from "effect"

import {
  EventBus,
  InMemoryEventBusLive,
  makeArtifactPublicationService,
  makeFixtureTrustArtifactSigner,
  makeGovernancePublicationService,
  makeInMemoryArtifactStore,
  makePostgresPersistenceService,
  makeRecordingPostgresStatementSink,
  makeVerifierCacheReadModelWorker,
} from "../index.js"
import { demoIssuerProjection } from "../services/verifier-cache.js"

const observedAt = new Date("2026-05-17T00:00:00Z")

const program = Effect.gen(function* () {
  const eventBus = yield* EventBus
  const artifactStore = makeInMemoryArtifactStore()
  const publisher = makeArtifactPublicationService(artifactStore, eventBus)
  const governancePublisher = makeGovernancePublicationService(publisher)
  const signer = makeFixtureTrustArtifactSigner()
  const sink = makeRecordingPostgresStatementSink()
  const persistence = makePostgresPersistenceService(sink)
  const worker = makeVerifierCacheReadModelWorker(
    artifactStore,
    persistence,
    eventBus,
  )

  const publishedGovernance = yield* governancePublisher.publishReferenceBundle(
    observedAt,
  )
  const publishedIssuerStatus = yield* publisher.publishArtifact({
    artifact_type: "revocation_status_event",
    artifact_id: "art_status_acme_demo_active_v1",
    version: 1,
    root_program_id: demoIssuerProjection.namespace.root_program_id,
    delegated_authority_id:
      demoIssuerProjection.namespace.delegated_authority_id,
    issuer_id: demoIssuerProjection.namespace.issuer_id,
    body: (yield* signer.signTrustArtifact({
      body: {
        artifact_type: "revocation_status_event",
        schema_version: "0.1.0",
        status_event_id: "status:acme-demo:active:v1",
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        delegated_authority_id:
          demoIssuerProjection.namespace.delegated_authority_id,
        target: {
          target_type: "issuer_record",
          issuer_id: demoIssuerProjection.namespace.issuer_id,
          certificate_ref: "cert:acme-demo:web-signing:v1",
        },
        status: "active",
        reason: "active status event proves read-model worker materialization",
        effective_at: observedAt.toISOString(),
        expires_at: demoIssuerProjection.cache_expires_at,
        signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      },
      signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
    })).body,
    occurredAt: observedAt,
    eventType: "issuer.status.changed",
    reason: "signed active status for verifier-cache read-model worker smoke",
  })

  const report = yield* worker.process({
    verifier_id: "verifier:local-demo",
    artifacts: {
      root_manifest_artifact_id: publishedGovernance.root_manifest_artifact_id,
      delegated_authority_manifest_artifact_id:
        publishedGovernance.delegated_authority_artifact_id,
      issuer_record_artifact_id: publishedGovernance.issuer_record_artifact_id,
      destination_policy_artifact_id:
        publishedGovernance.destination_policy_artifact_id,
      status_event_artifact_id: publishedIssuerStatus.artifact.artifact_id,
    },
    materialized_at: observedAt,
    scanner_probes: [
      {
        payload: "https://acme.example/pay",
      },
    ],
  })

  const recorded = sink.recorded()
  const commandNames = recorded.map((command) => command.name)

  yield* assertSmoke(
    report.cache_entry_id.startsWith("cache:acme-demo:acme-demo:web-payments:v1:"),
    "worker did not return the deterministic verifier-cache entry ID prefix",
  )
  yield* assertSmoke(
    report.source_artifact_hashes.length === 5,
    "worker did not preserve the five source artifact hashes",
  )
  yield* assertSmoke(
    report.scanner_decisions.length === 1 &&
      report.scanner_decisions[0]?.decision_color === "green",
    "worker scanner probe did not produce a green decision from the materialized cache",
  )
  yield* assertSmoke(
    report.persistence_report.cache_entries_upserted === 1 &&
      report.persistence_report.scanner_decisions_inserted === 1,
    "worker did not persist one cache entry and one scanner decision",
  )
  yield* assertSmoke(
    report.persistence_report.artifacts_upserted === 0 &&
      report.persistence_report.status_events_upserted === 0 &&
      report.persistence_report.events_enqueued === 0,
    "read-model worker should consume artifact refs, not republish source artifacts or outbox events",
  )
  yield* assertSmoke(
    commandNames[0] === "verifier_cache_entries.upsert" &&
      commandNames[1] === "scanner_decisions.insert",
    "worker persistence commands were not emitted in read-model order",
  )

  yield* Console.log(
    JSON.stringify(
      {
        cache_entry_id: report.cache_entry_id,
        source_artifact_hashes: report.source_artifact_hashes.length,
        scanner_decisions: report.scanner_decisions.map((decision) => ({
          color: decision.decision_color,
          state: decision.decision_state,
          issuer: decision.governance?.issuer_id,
        })),
        persistence_report: report.persistence_report,
        command_names: commandNames,
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Verifier cache read-model worker smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
