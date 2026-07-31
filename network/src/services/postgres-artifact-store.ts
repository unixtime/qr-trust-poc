import { Effect } from "effect"

import type { NetworkError } from "../errors.js"
import type { ArtifactStoreShape, SignedArtifact } from "./artifact-store.js"
import {
  publishedArtifactCommand,
  type SqlCommand,
} from "./postgres-persistence.js"

export interface PostgresArtifactRow {
  readonly artifact_id: string
  readonly artifact_hash: string
  readonly artifact_type: string
  readonly version: number
  readonly canonical_json: unknown
}

export interface PostgresArtifactStoreExecutorShape {
  readonly execute: (command: SqlCommand) => Effect.Effect<SqlCommand, NetworkError>
  readonly queryOne: (
    command: SqlCommand,
  ) => Effect.Effect<PostgresArtifactRow | undefined, NetworkError>
  readonly recorded: () => ReadonlyArray<SqlCommand>
}

export const artifactByIdCommand = (artifactId: string): SqlCommand => ({
  name: "published_artifacts.get",
  text: `
select
  artifact_id,
  artifact_hash,
  artifact_type,
  version,
  canonical_json
from qr_trust.published_artifacts
where artifact_id = $1
  and publication_status = 'published'
limit 1
`.trim(),
  values: [artifactId],
})

export const makeRecordingPostgresArtifactStoreExecutor = (
  initialRows: ReadonlyArray<PostgresArtifactRow> = [],
): PostgresArtifactStoreExecutorShape => {
  const rows = new Map(
    initialRows.map((row) => [row.artifact_id, row] as const),
  )
  const commands: SqlCommand[] = []

  return {
    execute: (command) =>
      Effect.sync(() => {
        commands.push(command)

        const row = rowFromPublishedArtifactUpsert(command)
        if (row) {
          rows.set(row.artifact_id, row)
        }

        return command
      }),
    queryOne: (command) =>
      Effect.sync(() => {
        commands.push(command)

        if (command.name !== "published_artifacts.get") {
          return undefined
        }

        const artifactId = stringCommandValue(command, 0)
        return artifactId ? rows.get(artifactId) : undefined
      }),
    recorded: () => [...commands],
  }
}

export const makePostgresArtifactStore = (
  executor: PostgresArtifactStoreExecutorShape,
): ArtifactStoreShape => ({
  get: (artifactId) =>
    executor.queryOne(artifactByIdCommand(artifactId)).pipe(
      Effect.map((row) =>
        row
          ? {
              artifact_id: row.artifact_id,
              artifact_hash: row.artifact_hash,
              artifact_type: row.artifact_type,
              version: row.version,
              body: canonicalJsonBody(row.canonical_json),
            }
          : undefined,
      ),
    ),
  put: (artifact) =>
    Effect.gen(function* () {
      yield* executor.execute(publishedArtifactCommand(artifact))
      return artifact
    }),
})

const rowFromPublishedArtifactUpsert = (
  command: SqlCommand,
): PostgresArtifactRow | undefined => {
  if (command.name !== "published_artifacts.upsert") {
    return undefined
  }

  const artifactId = requireStringCommandValue(command, 0, "artifact_id")
  const artifactType = requireStringCommandValue(command, 1, "artifact_type")
  const canonicalJson = command.values[6]
  const artifactHash = requireStringCommandValue(command, 7, "artifact_hash")
  const version = requireNumberCommandValue(command, 8, "version")

  return {
    artifact_id: artifactId,
    artifact_hash: artifactHash,
    artifact_type: artifactType,
    version,
    canonical_json: canonicalJsonBody(canonicalJson),
  }
}

const canonicalJsonBody = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value
  }

  return JSON.parse(value) as unknown
}

const requireStringCommandValue = (
  command: SqlCommand,
  index: number,
  label: string,
): string => {
  const value = stringCommandValue(command, index)
  if (!value) {
    throw new Error(
      `Postgres artifact store command ${command.name} is missing ${label}.`,
    )
  }

  return value
}

const stringCommandValue = (
  command: SqlCommand,
  index: number,
): string | undefined => {
  const value = command.values[index]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

const requireNumberCommandValue = (
  command: SqlCommand,
  index: number,
  label: string,
): number => {
  const value = command.values[index]
  if (typeof value !== "number") {
    throw new Error(
      `Postgres artifact store command ${command.name} is missing ${label}.`,
    )
  }

  return value
}
