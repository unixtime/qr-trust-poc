import { Effect } from "effect"

import { decodeEventEnvelope } from "../contracts.js"
import { contractValidationError, type NetworkError } from "../errors.js"
import { hashJson } from "../hash.js"
import type { ArtifactStoreShape, SignedArtifact } from "./artifact-store.js"
import type { EventBusShape, NetworkEvent } from "./event-bus.js"

export interface ArtifactPublicationInput {
  readonly artifact_type: string
  readonly artifact_id: string
  readonly version: number
  readonly root_program_id: string
  readonly body: unknown
  readonly occurredAt: Date
  readonly eventType: string
  readonly delegated_authority_id?: string
  readonly issuer_id?: string
  readonly destination_policy_id?: string
  readonly artifact_ref?: string
  readonly previous_version?: number
  readonly reason?: string
}

export interface ArtifactPublicationResult {
  readonly artifact: SignedArtifact
  readonly event: NetworkEvent
}

export interface ArtifactPublicationServiceShape {
  readonly publishArtifact: (
    input: ArtifactPublicationInput,
  ) => Effect.Effect<ArtifactPublicationResult, NetworkError>
}

export const makeArtifactPublicationService = (
  store: ArtifactStoreShape,
  eventBus: EventBusShape,
): ArtifactPublicationServiceShape => ({
  publishArtifact: (input) =>
    Effect.gen(function* () {
      const artifact: SignedArtifact = {
        artifact_id: input.artifact_id,
        artifact_hash: `sha256:${hashJson(input.body)}`,
        artifact_type: input.artifact_type,
        version: input.version,
        body: input.body,
      }

      const stored = yield* store.put(artifact)

      const envelope = yield* decodeEventEnvelope({
        event_id: eventIdForPublication(input.eventType, stored),
        type: input.eventType,
        occurred_at: input.occurredAt.toISOString(),
        root_program_id: input.root_program_id,
        artifact_id: stored.artifact_id,
        artifact_hash: stored.artifact_hash,
        version: stored.version,
        ...(input.delegated_authority_id
          ? { delegated_authority_id: input.delegated_authority_id }
          : {}),
        ...(input.issuer_id ? { issuer_id: input.issuer_id } : {}),
        ...(input.destination_policy_id
          ? { destination_policy_id: input.destination_policy_id }
          : {}),
        ...(input.artifact_ref ? { artifact_ref: input.artifact_ref } : {}),
        ...(input.previous_version
          ? { previous_version: input.previous_version }
          : {}),
        ...(input.reason ? { reason: input.reason } : {}),
      }).pipe(
        Effect.mapError((cause) =>
          contractValidationError(
            "Artifact publication event failed contract validation.",
            cause,
          ),
        ),
      )

      const event = {
        envelope,
        body: stored,
      } satisfies NetworkEvent

      yield* eventBus.publish(event)

      return {
        artifact: stored,
        event,
      }
    }),
})

const eventIdForPublication = (
  eventType: string,
  artifact: SignedArtifact,
): string =>
  `evt_${hashJson({
    artifact_hash: artifact.artifact_hash,
    artifact_id: artifact.artifact_id,
    event_type: eventType,
    version: artifact.version,
  })}`
