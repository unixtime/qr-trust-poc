import { Context, Effect, Layer } from "effect"

import type { NetworkError } from "../errors.js"

export interface SignedArtifact {
  readonly artifact_id: string
  readonly artifact_hash: string
  readonly artifact_type: string
  readonly version: number
  readonly body: unknown
}

export interface ArtifactStoreShape {
  readonly get: (
    artifactId: string,
  ) => Effect.Effect<SignedArtifact | undefined, NetworkError>
  readonly put: (
    artifact: SignedArtifact,
  ) => Effect.Effect<SignedArtifact, NetworkError>
}

export class ArtifactStore extends Context.Tag("qrtrust/ArtifactStore")<
  ArtifactStore,
  ArtifactStoreShape
>() {}

export const makeInMemoryArtifactStore = (
  initial: ReadonlyArray<SignedArtifact> = [],
): ArtifactStoreShape => {
  const artifacts = new Map(initial.map((artifact) => [artifact.artifact_id, artifact]))

  return {
    get: (artifactId) => Effect.succeed(artifacts.get(artifactId)),
    put: (artifact) =>
      Effect.sync(() => {
        artifacts.set(artifact.artifact_id, artifact)
        return artifact
      }),
  }
}

export const InMemoryArtifactStoreLive = Layer.succeed(
  ArtifactStore,
  makeInMemoryArtifactStore(),
)
