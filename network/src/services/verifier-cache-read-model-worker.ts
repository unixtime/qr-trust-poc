import { Effect } from "effect"

import type { ScannerDecision } from "../contracts.js"
import { contractValidationError, type NetworkError } from "../errors.js"
import type { ArtifactStoreShape, SignedArtifact } from "./artifact-store.js"
import type { EventBusShape } from "./event-bus.js"
import type {
  NetworkPersistenceReport,
  PostgresPersistenceServiceShape,
} from "./postgres-persistence.js"
import { makeScannerDecisionService } from "./scanner-decision.js"
import {
  makeInMemoryVerifierCache,
  type DestinationPolicyProjection,
  type IssuerProjection,
} from "./verifier-cache.js"
import {
  CACHE_MATERIALIZED_AFTER_EXPIRY_WARNING,
  makeVerifierCacheMaterializationService,
} from "./verifier-cache-materialization.js"

export interface VerifierCacheReadModelArtifactRefs {
  readonly root_manifest_artifact_id: string
  readonly delegated_authority_manifest_artifact_id: string
  readonly issuer_record_artifact_id: string
  readonly destination_policy_artifact_id: string
  readonly status_event_artifact_id: string
}

export interface VerifierCacheScannerProbe {
  readonly payload: string
  readonly issuer_hint_host?: string
}

export interface VerifierCacheReadModelWorkItem {
  readonly verifier_id: string
  readonly artifacts: VerifierCacheReadModelArtifactRefs
  readonly materialized_at: Date
  readonly scanner_probes?: ReadonlyArray<VerifierCacheScannerProbe>
}

export interface VerifierCacheReadModelWorkerReport {
  readonly verifier_id: string
  readonly cache_entry_id: string
  readonly source_artifact_ids: VerifierCacheReadModelArtifactRefs
  readonly source_artifact_hashes: ReadonlyArray<string>
  readonly scanner_decisions: ReadonlyArray<ScannerDecision>
  readonly persistence_report: NetworkPersistenceReport
  readonly materialization_warnings: ReadonlyArray<string>
}

export interface VerifierCacheReadModelWorkerShape {
  readonly process: (
    input: VerifierCacheReadModelWorkItem,
  ) => Effect.Effect<VerifierCacheReadModelWorkerReport, NetworkError>
}

export const makeVerifierCacheReadModelWorker = (
  artifactStore: ArtifactStoreShape,
  persistence: PostgresPersistenceServiceShape,
  eventBus: EventBusShape,
): VerifierCacheReadModelWorkerShape => ({
  process: (input) =>
    Effect.gen(function* () {
      const artifacts = yield* fetchMaterializationArtifacts(
        artifactStore,
        input.artifacts,
      )
      const materializer = makeVerifierCacheMaterializationService()
      const materialized = yield* materializer.materialize({
        root_manifest: artifacts.root_manifest,
        delegated_authority_manifest: artifacts.delegated_authority_manifest,
        issuer_record: artifacts.issuer_record,
        destination_policy: artifacts.destination_policy,
        status_event: artifacts.status_event,
        materialized_at: input.materialized_at,
      })

      const scannerDecisions = yield* runScannerProbes(
        input.scanner_probes ?? [],
        input.materialized_at,
        materialized.issuer_projection,
        materialized.destination_policy_projection,
        eventBus,
      )
      // The row has to advertise the freshness the materializer actually
      // observed. Persisting "fresh" unconditionally means an entry
      // materialized past its own expiry looks current to every reader, and
      // the "expired" state the schema defines is never written by anything.
      const materializedAfterExpiry =
        materialized.materialization_warnings.includes(
          CACHE_MATERIALIZED_AFTER_EXPIRY_WARNING,
        )
      const persistenceReport = yield* persistence.persistBatch({
        verifier_cache_entries: [
          {
            verifier_id: input.verifier_id,
            issuer: materialized.issuer_projection,
            policy: materialized.destination_policy_projection,
            source_artifact_hashes: materialized.source_artifact_hashes,
            freshness_status: materializedAfterExpiry ? "expired" : "fresh",
          },
        ],
        scanner_decisions: scannerDecisions.map((decision) => ({
          verifier_id: input.verifier_id,
          decision,
        })),
      })

      return {
        verifier_id: input.verifier_id,
        cache_entry_id: materialized.cache_entry.cache_entry_id,
        source_artifact_ids: input.artifacts,
        source_artifact_hashes: materialized.source_artifact_hashes,
        scanner_decisions: scannerDecisions,
        persistence_report: persistenceReport,
        materialization_warnings: materialized.materialization_warnings,
      }
    }),
})

const fetchMaterializationArtifacts = (
  artifactStore: ArtifactStoreShape,
  refs: VerifierCacheReadModelArtifactRefs,
): Effect.Effect<
  {
    readonly root_manifest: SignedArtifact
    readonly delegated_authority_manifest: SignedArtifact
    readonly issuer_record: SignedArtifact
    readonly destination_policy: SignedArtifact
    readonly status_event: SignedArtifact
  },
  NetworkError
> =>
  Effect.gen(function* () {
    const rootManifest = yield* fetchRequiredArtifact(
      artifactStore,
      refs.root_manifest_artifact_id,
      "root manifest",
    )
    const delegatedAuthorityManifest = yield* fetchRequiredArtifact(
      artifactStore,
      refs.delegated_authority_manifest_artifact_id,
      "delegated authority manifest",
    )
    const issuerRecord = yield* fetchRequiredArtifact(
      artifactStore,
      refs.issuer_record_artifact_id,
      "issuer record",
    )
    const destinationPolicy = yield* fetchRequiredArtifact(
      artifactStore,
      refs.destination_policy_artifact_id,
      "destination policy",
    )
    const statusEvent = yield* fetchRequiredArtifact(
      artifactStore,
      refs.status_event_artifact_id,
      "status event",
    )

    return {
      root_manifest: rootManifest,
      delegated_authority_manifest: delegatedAuthorityManifest,
      issuer_record: issuerRecord,
      destination_policy: destinationPolicy,
      status_event: statusEvent,
    }
  })

const fetchRequiredArtifact = (
  artifactStore: ArtifactStoreShape,
  artifactId: string,
  label: string,
): Effect.Effect<SignedArtifact, NetworkError> =>
  Effect.gen(function* () {
    const artifact = yield* artifactStore.get(artifactId)
    if (artifact) {
      return artifact
    }

    return yield* Effect.fail(
      contractValidationError(
        `Verifier cache read-model worker could not find ${label} artifact.`,
        { artifact_id: artifactId },
      ),
    )
  })

const runScannerProbes = (
  probes: ReadonlyArray<VerifierCacheScannerProbe>,
  observedAt: Date,
  issuerProjection: IssuerProjection,
  destinationPolicyProjection: DestinationPolicyProjection,
  eventBus: EventBusShape,
): Effect.Effect<ReadonlyArray<ScannerDecision>, NetworkError> =>
  Effect.gen(function* () {
    const cache = makeInMemoryVerifierCache(
      [issuerProjection],
      [destinationPolicyProjection],
    )
    const scanner = makeScannerDecisionService(cache, eventBus)
    const decisions: ScannerDecision[] = []

    for (const probe of probes) {
      const decision = yield* scanner.decide({
        payload: probe.payload,
        observedAt,
        ...(probe.issuer_hint_host
          ? { issuerHintHost: probe.issuer_hint_host }
          : {}),
      })
      decisions.push(decision)
    }

    return decisions
  })
