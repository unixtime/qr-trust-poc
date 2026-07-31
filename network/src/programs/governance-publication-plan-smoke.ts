import { Console, Effect } from "effect"

import {
  demoIssuerProjection,
  planReferenceGovernancePublication,
  type ArtifactPublicationInput,
} from "../index.js"

const observedAt = new Date("2026-05-20T00:00:00Z")

const expectedArtifactTypes = [
  "root_manifest",
  "delegated_authority_manifest",
  "issuer_record",
  "destination_policy",
] as const

const expectedEventTypes = [
  "root.manifest.published",
  "delegated_authority.manifest.published",
  "issuer.record.published",
  "destination.policy.published",
] as const

const program = Effect.gen(function* () {
  const plan = planReferenceGovernancePublication(observedAt)
  const artifacts = plan.artifacts
  const [rootManifest, delegatedAuthority, issuerRecord, destinationPolicy] =
    artifacts

  yield* assertSmoke(
    artifacts.length === expectedArtifactTypes.length,
    "governance plan should publish the four source governance artifacts",
  )

  artifacts.forEach((artifact, index) => {
    const expectedType = expectedArtifactTypes[index]
    const expectedEventType = expectedEventTypes[index]

    if (artifact.artifact_type !== expectedType) {
      throw new Error(
        `expected artifact ${index} to be ${expectedType}, got ${artifact.artifact_type}`,
      )
    }

    if (artifact.eventType !== expectedEventType) {
      throw new Error(
        `expected artifact ${index} event ${expectedEventType}, got ${artifact.eventType}`,
      )
    }

    if (artifact.occurredAt !== observedAt) {
      throw new Error(`expected artifact ${index} to reuse observedAt`)
    }
  })

  yield* assertSmoke(
    rootManifest.root_program_id ===
      demoIssuerProjection.namespace.root_program_id,
    "root manifest is not scoped to the demo root program",
  )
  yield* assertSmoke(
    delegatedAuthority.root_program_id === rootManifest.root_program_id &&
      delegatedAuthority.delegated_authority_id ===
        demoIssuerProjection.namespace.delegated_authority_id,
    "delegated authority is not rooted in the same trust program",
  )
  yield* assertSmoke(
    issuerRecord.root_program_id === rootManifest.root_program_id &&
      issuerRecord.delegated_authority_id ===
        delegatedAuthority.delegated_authority_id &&
      issuerRecord.issuer_id === demoIssuerProjection.namespace.issuer_id,
    "issuer record is not scoped under the delegated authority",
  )
  yield* assertSmoke(
    destinationPolicy.root_program_id === rootManifest.root_program_id &&
      destinationPolicy.delegated_authority_id ===
        delegatedAuthority.delegated_authority_id &&
      destinationPolicy.issuer_id === issuerRecord.issuer_id &&
      destinationPolicy.destination_policy_id ===
        demoIssuerProjection.destination_policy_id,
    "destination policy is not issuer-scoped",
  )

  const issuerBody = objectBody(issuerRecord, "issuer record")
  const issuerNamespace = objectValue(
    issuerBody.issuer_namespace,
    "issuer namespace",
  )
  const destinationPolicyBody = objectBody(
    destinationPolicy,
    "destination policy",
  )

  yield* assertSmoke(
    issuerNamespace.root_program_id === rootManifest.root_program_id &&
      issuerNamespace.delegated_authority_id ===
        delegatedAuthority.delegated_authority_id &&
      issuerNamespace.issuer_id === issuerRecord.issuer_id,
    "issuer body namespace does not match artifact routing metadata",
  )
  yield* assertSmoke(
    destinationPolicyBody.root_program_id === rootManifest.root_program_id &&
      destinationPolicyBody.delegated_authority_id ===
        delegatedAuthority.delegated_authority_id &&
      destinationPolicyBody.issuer_id === issuerRecord.issuer_id &&
      destinationPolicyBody.destination_policy_id ===
        destinationPolicy.destination_policy_id,
    "destination policy body does not match artifact routing metadata",
  )

  yield* Console.log(
    JSON.stringify(
      {
        planned_artifacts: artifacts.map((artifact) => ({
          artifact_id: artifact.artifact_id,
          artifact_type: artifact.artifact_type,
          event_type: artifact.eventType,
        })),
        root_program_id: rootManifest.root_program_id,
        delegated_authority_id: delegatedAuthority.delegated_authority_id,
        issuer_id: issuerRecord.issuer_id,
        destination_policy_id: destinationPolicy.destination_policy_id,
      },
      null,
      2,
    ),
  )
})

const objectBody = (
  artifact: ArtifactPublicationInput,
  label: string,
): Record<string, unknown> => objectValue(artifact.body, label)

const objectValue = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} should be an object`)
  }

  return value as Record<string, unknown>
}

const assertSmoke = (condition: boolean, message: string) =>
  condition ? Effect.void : Effect.dieMessage(message)

Effect.runPromise(program)
