import {
  createPublicKey,
  verify as cryptoVerify,
} from "node:crypto"
import { Effect } from "effect"

import type { NetworkError } from "../errors.js"
import { canonicalJsonStringify } from "../hash.js"
import {
  makeDefaultKeyMaterialProvider,
  type KeyMaterialProviderShape,
} from "./key-material.js"
import {
  makeInMemoryTrustKeyRegistry,
  type TrustKeyLookupReason,
  type TrustKeyRegistryShape,
} from "./trust-key-registry.js"

export const trustSignatureInput = "canonical-json-excluding-signature"
export const trustSignatureStatus = "ed25519-signed"

export interface SignedTrustArtifactSummary {
  readonly artifact_type: string
  readonly root_program_id: string
  readonly signed_by: string
  readonly signature_status: string
  readonly signature_algorithm_id?: string
  readonly signature_input?: string
  readonly signature?: string
  readonly accepted_algorithm_ids?: ReadonlyArray<string>
  readonly delegated_authority_id?: string
}

export type SignatureVerificationReason =
  | "signature_verified"
  | "missing_signature"
  | "invalid_signature_input"
  | "unsupported_signature_algorithm"
  | "key_material_unavailable"
  | "signature_verification_failed"
  | TrustKeyLookupReason

export interface SignatureVerificationResult {
  readonly accepted: boolean
  readonly signer: string
  readonly reason: SignatureVerificationReason
}

export interface SignatureVerifierShape {
  readonly verifyTrustArtifact: (
    artifact: SignedTrustArtifactSummary,
  ) => Effect.Effect<SignatureVerificationResult, NetworkError>
}

export const makeCryptographicSignatureVerifier = (
  keyRegistry: TrustKeyRegistryShape = makeInMemoryTrustKeyRegistry(),
  keyMaterialProvider: KeyMaterialProviderShape = makeDefaultKeyMaterialProvider(),
): SignatureVerifierShape => ({
  verifyTrustArtifact: (artifact) =>
    Effect.gen(function* () {
      const lookup = yield* keyRegistry.lookupSignerKey({
        signed_by: artifact.signed_by,
        root_program_id: artifact.root_program_id,
        accepted_algorithm_ids: artifact.accepted_algorithm_ids ?? [
          "ed25519",
        ],
        ...(artifact.delegated_authority_id
          ? { delegated_authority_id: artifact.delegated_authority_id }
          : {}),
      })

      if (lookup.reason) {
        return {
          accepted: false,
          signer: artifact.signed_by,
          reason: lookup.reason,
        }
      }

      if (artifact.signature_algorithm_id !== "ed25519") {
        return {
          accepted: false,
          signer: artifact.signed_by,
          reason: "unsupported_signature_algorithm",
        }
      }

      if (artifact.signature_input !== trustSignatureInput) {
        return {
          accepted: false,
          signer: artifact.signed_by,
          reason: "invalid_signature_input",
        }
      }

      if (!artifact.signature) {
        return {
          accepted: false,
          signer: artifact.signed_by,
          reason: "missing_signature",
        }
      }

      const key = lookup.key
      if (!key) {
        return {
          accepted: false,
          signer: artifact.signed_by,
          reason: "key_material_unavailable",
        }
      }

      const keyMaterial = yield* keyMaterialProvider.loadPublicKeyMaterial(key)
      if (!keyMaterial) {
        return {
          accepted: false,
          signer: artifact.signed_by,
          reason: "key_material_unavailable",
        }
      }

      const verified = verifyEd25519Signature(
        artifact,
        keyMaterial.public_key_material_pem,
      )

      if (!verified) {
        return {
          accepted: false,
          signer: artifact.signed_by,
          reason: "signature_verification_failed",
        }
      }

      return {
        accepted: true,
        signer: artifact.signed_by,
        reason: "signature_verified",
      }
    }),
})

export const makeFixtureSignatureVerifier = makeCryptographicSignatureVerifier

export const trustSignaturePayloadBytes = (artifact: unknown): Buffer =>
  Buffer.from(canonicalJsonStringify(stripSignatureMetadata(artifact)), "utf8")

const verifyEd25519Signature = (
  artifact: SignedTrustArtifactSummary,
  publicKeyPem: string,
): boolean => {
  try {
    return cryptoVerify(
      null,
      trustSignaturePayloadBytes(artifact),
      createPublicKey(publicKeyPem),
      Buffer.from(artifact.signature ?? "", "base64url"),
    )
  } catch {
    return false
  }
}

const stripSignatureMetadata = (artifact: unknown): unknown => {
  if (Array.isArray(artifact)) {
    return artifact.map(stripSignatureMetadata)
  }

  if (!artifact || typeof artifact !== "object") {
    return artifact
  }

  return Object.fromEntries(
    Object.entries(artifact as Record<string, unknown>)
      .filter(
        ([key]) =>
          key !== "signature" &&
          key !== "signature_algorithm_id" &&
          key !== "signature_input" &&
          key !== "signature_status",
      )
      .map(([key, value]) => [key, stripSignatureMetadata(value)]),
  )
}
