import { Effect } from "effect"

import { contractValidationError, type NetworkError } from "../errors.js"
import type { ArtifactStoreShape, SignedArtifact } from "./artifact-store.js"
import {
  makeFixtureSignatureVerifier,
  type SignatureVerificationReason,
  type SignatureVerifierShape,
  type SignedTrustArtifactSummary,
} from "./signature-verification.js"
import type { VerifierCacheReadModelWorkItem } from "./verifier-cache-read-model-worker.js"

export interface VerifierCacheWorkItemAuthorizationReport {
  readonly authorized: true
  readonly verifier_id: string
  readonly status_event_artifact_id: string
  readonly signed_by: string
  readonly root_program_id: string
  readonly delegated_authority_id: string
  readonly issuer_id: string
  readonly signature_reason: SignatureVerificationReason
}

export interface VerifierCacheReadModelWorkItemAuthorizerShape {
  readonly authorize: (
    input: VerifierCacheReadModelWorkItem,
  ) => Effect.Effect<VerifierCacheWorkItemAuthorizationReport, NetworkError>
}

export const makeVerifierCacheReadModelWorkItemAuthorizer = (
  artifactStore: ArtifactStoreShape,
  signatureVerifier: SignatureVerifierShape = makeFixtureSignatureVerifier(),
): VerifierCacheReadModelWorkItemAuthorizerShape => ({
  authorize: (input) =>
    Effect.gen(function* () {
      const issuerRecordArtifact = yield* fetchRequiredArtifact(
        artifactStore,
        input.artifacts.issuer_record_artifact_id,
        "issuer record",
      )
      const rootManifestArtifact = yield* fetchRequiredArtifact(
        artifactStore,
        input.artifacts.root_manifest_artifact_id,
        "root manifest",
      )
      const delegatedAuthorityArtifact = yield* fetchRequiredArtifact(
        artifactStore,
        input.artifacts.delegated_authority_manifest_artifact_id,
        "delegated authority manifest",
      )
      const destinationPolicyArtifact = yield* fetchRequiredArtifact(
        artifactStore,
        input.artifacts.destination_policy_artifact_id,
        "destination policy",
      )
      const statusEventArtifact = yield* fetchRequiredArtifact(
        artifactStore,
        input.artifacts.status_event_artifact_id,
        "status event",
      )

      const issuerNamespace = yield* issuerNamespaceFromArtifact(
        issuerRecordArtifact,
      )
      const statusEvent = yield* statusEventBody(statusEventArtifact)
      const target = yield* statusEventTarget(statusEvent)
      const signedBy = yield* requireString(statusEvent, "signed_by")
      const rootProgramId = yield* requireString(statusEvent, "root_program_id")
      const delegatedAuthorityId = yield* requireString(
        statusEvent,
        "delegated_authority_id",
      )

      yield* verifyRequiredTrustSignature(
        signatureVerifier,
        rootManifestArtifact,
        "root manifest",
        input,
      )
      yield* verifyRequiredTrustSignature(
        signatureVerifier,
        delegatedAuthorityArtifact,
        "delegated authority manifest",
        input,
      )
      yield* verifyRequiredTrustSignature(
        signatureVerifier,
        issuerRecordArtifact,
        "issuer record",
        input,
      )
      yield* verifyRequiredTrustSignature(
        signatureVerifier,
        destinationPolicyArtifact,
        "destination policy",
        input,
      )

      if (rootProgramId !== issuerNamespace.root_program_id) {
        return yield* failAuthorization(
          "Status event root program does not match issuer record namespace.",
          input,
          {
            expected_root_program_id: issuerNamespace.root_program_id,
            actual_root_program_id: rootProgramId,
          },
        )
      }

      if (
        delegatedAuthorityId !== issuerNamespace.delegated_authority_id ||
        target.issuer_id !== issuerNamespace.issuer_id
      ) {
        return yield* failAuthorization(
          "Status event issuer scope does not match issuer record namespace.",
          input,
          {
            expected_delegated_authority_id:
              issuerNamespace.delegated_authority_id,
            actual_delegated_authority_id: delegatedAuthorityId,
            expected_issuer_id: issuerNamespace.issuer_id,
            actual_issuer_id: target.issuer_id,
          },
        )
      }

      if (target.target_type !== "issuer_record") {
        return yield* failAuthorization(
          "Status event target must authorize an issuer record.",
          input,
          { target_type: target.target_type },
        )
      }

      if (signedBy !== delegatedAuthorityId) {
        return yield* failAuthorization(
          "Status event must be signed by the issuer delegated authority.",
          input,
          {
            signed_by: signedBy,
            delegated_authority_id: delegatedAuthorityId,
          },
        )
      }

      const signatureResult = yield* signatureVerifier.verifyTrustArtifact(
        statusEvent as unknown as SignedTrustArtifactSummary,
      )

      if (!signatureResult.accepted) {
        return yield* failAuthorization(
          "Status event signature was not accepted.",
          input,
          {
            signed_by: signatureResult.signer,
            signature_reason: signatureResult.reason,
          },
        )
      }

      return {
        authorized: true,
        verifier_id: input.verifier_id,
        status_event_artifact_id: statusEventArtifact.artifact_id,
        signed_by: signedBy,
        root_program_id: rootProgramId,
        delegated_authority_id: delegatedAuthorityId,
        issuer_id: target.issuer_id,
        signature_reason: signatureResult.reason,
      }
    }),
})

const verifyRequiredTrustSignature = (
  signatureVerifier: SignatureVerifierShape,
  artifact: SignedArtifact,
  label: string,
  input: VerifierCacheReadModelWorkItem,
): Effect.Effect<void, NetworkError> =>
  Effect.gen(function* () {
    const body = yield* signedTrustArtifactBody(artifact, label)
    const result = yield* signatureVerifier.verifyTrustArtifact(body)
    if (!result.accepted) {
      return yield* failAuthorization(
        "Source trust artifact signature was not accepted.",
        input,
        {
          artifact_id: artifact.artifact_id,
          artifact_type: artifact.artifact_type,
          artifact_label: label,
          signed_by: result.signer,
          signature_reason: result.reason,
        },
      )
    }
  })

const signedTrustArtifactBody = (
  artifact: SignedArtifact,
  label: string,
): Effect.Effect<SignedTrustArtifactSummary, NetworkError> =>
  Effect.gen(function* () {
    const body = yield* recordValue(artifact.body, `${label} body`)
    const artifactType = yield* requireString(body, "artifact_type")
    if (artifactType !== artifact.artifact_type) {
      return yield* Effect.fail(
        contractValidationError(
          "Verifier cache work-item authorization source artifact type mismatch.",
          {
            artifact_id: artifact.artifact_id,
            artifact_type: artifact.artifact_type,
            body_artifact_type: artifactType,
          },
        ),
      )
    }
    yield* requireString(body, "root_program_id")
    yield* requireString(body, "signed_by")
    yield* requireString(body, "signature_status")

    return body as unknown as SignedTrustArtifactSummary
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
        `Verifier cache work-item authorizer could not find ${label} artifact.`,
        { artifact_id: artifactId },
      ),
    )
  })

const statusEventBody = (
  artifact: SignedArtifact,
): Effect.Effect<Record<string, unknown>, NetworkError> =>
  Effect.gen(function* () {
    if (artifact.artifact_type !== "revocation_status_event") {
      return yield* Effect.fail(
        contractValidationError(
          "Verifier cache work item status artifact has the wrong type.",
          {
            artifact_id: artifact.artifact_id,
            artifact_type: artifact.artifact_type,
          },
        ),
      )
    }

    const body = yield* recordValue(artifact.body, "status event body")
    const artifactType = yield* requireString(body, "artifact_type")
    if (artifactType !== "revocation_status_event") {
      return yield* Effect.fail(
        contractValidationError(
          "Verifier cache work item status body has the wrong artifact type.",
          {
            artifact_id: artifact.artifact_id,
            artifact_type: artifactType,
          },
        ),
      )
    }

    return body
  })

const issuerNamespaceFromArtifact = (
  artifact: SignedArtifact,
): Effect.Effect<
  {
    readonly root_program_id: string
    readonly delegated_authority_id: string
    readonly issuer_id: string
  },
  NetworkError
> =>
  Effect.gen(function* () {
    if (artifact.artifact_type !== "issuer_record") {
      return yield* Effect.fail(
        contractValidationError(
          "Verifier cache work item issuer artifact has the wrong type.",
          {
            artifact_id: artifact.artifact_id,
            artifact_type: artifact.artifact_type,
          },
        ),
      )
    }

    const body = yield* recordValue(artifact.body, "issuer record body")
    const artifactType = yield* requireString(body, "artifact_type")
    if (artifactType !== "issuer_record") {
      return yield* Effect.fail(
        contractValidationError(
          "Verifier cache work item issuer body has the wrong artifact type.",
          {
            artifact_id: artifact.artifact_id,
            artifact_type: artifactType,
          },
        ),
      )
    }

    const issuerNamespace = yield* recordValue(
      body.issuer_namespace,
      "issuer namespace",
    )

    return {
      root_program_id: yield* requireString(
        issuerNamespace,
        "root_program_id",
      ),
      delegated_authority_id: yield* requireString(
        issuerNamespace,
        "delegated_authority_id",
      ),
      issuer_id: yield* requireString(issuerNamespace, "issuer_id"),
    }
  })

const statusEventTarget = (
  statusEvent: Record<string, unknown>,
): Effect.Effect<
  {
    readonly target_type: string
    readonly issuer_id: string
  },
  NetworkError
> =>
  Effect.gen(function* () {
    const target = yield* recordValue(statusEvent.target, "status event target")
    return {
      target_type: yield* requireString(target, "target_type"),
      issuer_id: yield* requireString(target, "issuer_id"),
    }
  })

const recordValue = (
  value: unknown,
  label: string,
): Effect.Effect<Record<string, unknown>, NetworkError> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Effect.succeed(value as Record<string, unknown>)
  }

  return Effect.fail(
    contractValidationError(
      `Verifier cache work-item authorization expected ${label} to be an object.`,
      { value },
    ),
  )
}

const requireString = (
  record: Record<string, unknown>,
  field: string,
): Effect.Effect<string, NetworkError> => {
  const value = record[field]
  if (typeof value === "string" && value.length > 0) {
    return Effect.succeed(value)
  }

  return Effect.fail(
    contractValidationError(
      `Verifier cache work-item authorization expected ${field} to be a string.`,
      { field, value },
    ),
  )
}

const failAuthorization = (
  reason: string,
  input: VerifierCacheReadModelWorkItem,
  details: Readonly<Record<string, unknown>>,
): Effect.Effect<never, NetworkError> =>
  Effect.fail(
    contractValidationError(
      "Verifier cache work item status event is not authorized.",
      {
        reason,
        verifier_id: input.verifier_id,
        status_event_artifact_id: input.artifacts.status_event_artifact_id,
        ...details,
      },
    ),
  )
