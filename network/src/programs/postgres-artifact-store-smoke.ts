import { Console, Effect } from "effect"

import {
  EventBus,
  InMemoryEventBusLive,
  makeArtifactPublicationService,
  makeGovernancePublicationService,
  makePostgresArtifactStore,
  makeRecordingPostgresArtifactStoreExecutor,
} from "../index.js"
import type { NetworkError } from "../errors.js"
import type { SignedArtifact } from "../services/artifact-store.js"

const observedAt = new Date("2026-05-17T00:00:00Z")

const program = Effect.gen(function* () {
  const eventBus = yield* EventBus
  const executor = makeRecordingPostgresArtifactStoreExecutor()
  const artifactStore = makePostgresArtifactStore(executor)
  const publisher = makeArtifactPublicationService(artifactStore, eventBus)
  const governancePublisher = makeGovernancePublicationService(publisher)

  const publishedGovernance = yield* governancePublisher.publishReferenceBundle(
    observedAt,
  )

  const rootManifest = yield* requireArtifact(
    artifactStore.get(publishedGovernance.root_manifest_artifact_id),
    "root manifest",
  )
  const issuerRecord = yield* requireArtifact(
    artifactStore.get(publishedGovernance.issuer_record_artifact_id),
    "issuer record",
  )
  const events = yield* eventBus.recent()
  const recorded = executor.recorded()
  const commandNames = recorded.map((command) => command.name)

  yield* assertSmoke(
    publishedGovernance.published_artifacts === 4,
    "governance bundle did not publish all four reference artifacts",
  )
  yield* assertSmoke(
    rootManifest.artifact_type === "root_manifest",
    "root manifest readback returned the wrong artifact type",
  )
  yield* assertSmoke(
    Boolean(rootManifest.body) &&
      typeof rootManifest.body === "object" &&
      !Array.isArray(rootManifest.body),
    "root manifest readback did not preserve canonical JSON body",
  )
  yield* assertSmoke(
    issuerRecord.artifact_id === "art_issuer_acme_demo_v1",
    "issuer record readback did not preserve artifact_id",
  )
  yield* assertSmoke(
    events.length === 4,
    "artifact publication events were not emitted through the Postgres store",
  )
  yield* assertSmoke(
    commandNames.filter((name) => name === "published_artifacts.upsert")
      .length === 4,
    "expected four published artifact upserts",
  )
  yield* assertSmoke(
    commandNames.filter((name) => name === "published_artifacts.get").length ===
      2,
    "expected two published artifact lookups",
  )
  yield* assertSmoke(
    recorded.some(
      (command) =>
        command.name === "published_artifacts.get" &&
        command.values[0] === "art_root_qrtrust_demo_2026_v1",
    ),
    "artifact lookup did not use the contract-native root artifact ID",
  )

  yield* Console.log(
    JSON.stringify(
      {
        sql_commands: recorded.length,
        command_names: [...new Set(commandNames)],
        published_governance: publishedGovernance,
        readback: {
          root_artifact_id: rootManifest.artifact_id,
          root_artifact_hash: rootManifest.artifact_hash,
          issuer_artifact_id: issuerRecord.artifact_id,
          issuer_artifact_hash: issuerRecord.artifact_hash,
        },
        events_published: events.length,
      },
      null,
      2,
    ),
  )
}).pipe(Effect.provide(InMemoryEventBusLive))

const requireArtifact = (
  effect: Effect.Effect<SignedArtifact | undefined, NetworkError>,
  label: string,
): Effect.Effect<SignedArtifact, NetworkError> =>
  effect.pipe(
    Effect.map((artifact) => {
      if (!artifact) {
        throw new Error(`Postgres artifact store smoke failed: missing ${label}.`)
      }

      return artifact
    }),
  )

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Postgres artifact store smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
