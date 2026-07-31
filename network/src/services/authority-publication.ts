import { Effect } from "effect"

import type { NetworkError } from "../errors.js"
import type { ArtifactPublicationServiceShape } from "./artifact-publication.js"
import {
  signGovernancePublicationPlan,
  type GovernancePublicationReport,
} from "./governance-publication.js"
import type {
  PostgresGovernancePublicationSourceInput,
  PostgresGovernancePublicationSourceShape,
} from "./postgres-governance-publication-source.js"
import {
  makeFixtureTrustArtifactSigner,
  type TrustArtifactSignerShape,
} from "./signing-custody.js"

export const authorityPublicationEventTypes = [
  "root.manifest.published",
  "delegated_authority.manifest.published",
  "issuer.record.published",
  "destination.policy.published",
] as const

export interface AuthorityPublicationReport
  extends GovernancePublicationReport {
  readonly source: "postgres_governance_publication_source"
  readonly published_event_types: typeof authorityPublicationEventTypes
}

export interface AuthorityPublicationServiceShape {
  readonly publishGovernanceBundle: (
    input: PostgresGovernancePublicationSourceInput,
  ) => Effect.Effect<AuthorityPublicationReport, NetworkError>
}

export const makeAuthorityPublicationService = (
  source: PostgresGovernancePublicationSourceShape,
  publisher: ArtifactPublicationServiceShape,
  signer: TrustArtifactSignerShape = makeFixtureTrustArtifactSigner(),
): AuthorityPublicationServiceShape => ({
  publishGovernanceBundle: (input) =>
    Effect.gen(function* () {
      const plan = yield* source.planGovernancePublication(input)
      const signedArtifacts = yield* signGovernancePublicationPlan(plan, signer)
      const rootManifest = yield* publisher.publishArtifact(signedArtifacts[0])
      const delegatedAuthority = yield* publisher.publishArtifact(
        signedArtifacts[1],
      )
      const issuerRecord = yield* publisher.publishArtifact(signedArtifacts[2])
      const destinationPolicy = yield* publisher.publishArtifact(
        signedArtifacts[3],
      )

      return {
        root_manifest_artifact_id: rootManifest.artifact.artifact_id,
        delegated_authority_artifact_id:
          delegatedAuthority.artifact.artifact_id,
        issuer_record_artifact_id: issuerRecord.artifact.artifact_id,
        destination_policy_artifact_id:
          destinationPolicy.artifact.artifact_id,
        published_artifacts: 4,
        published_event_types: authorityPublicationEventTypes,
        source: "postgres_governance_publication_source",
      }
    }),
})
