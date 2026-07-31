import { generateKeyPairSync, sign as cryptoSign } from "node:crypto"
import { Console, Effect } from "effect"

import {
  makeCryptographicSignatureVerifier,
  makeFixtureSignatureVerifier,
  makeFixtureTrustArtifactSigner,
  makeManagedSigningCustodyProvider,
  makeInMemoryTrustKeyRegistry,
  makeTrustArtifactSigner,
  type SigningKeyRecord,
  type TrustArtifactSigningResult,
  type TrustKeyRecord,
} from "../index.js"
import type { NetworkError } from "../errors.js"
import { demoIssuerProjection } from "../services/verifier-cache.js"

const program = Effect.gen(function* () {
  const signer = makeFixtureTrustArtifactSigner()
  const verifier = makeFixtureSignatureVerifier(makeInMemoryTrustKeyRegistry())

  const rootSigned = yield* signer.signTrustArtifact({
    body: {
      artifact_type: "root_manifest",
      root_program_id: demoIssuerProjection.namespace.root_program_id,
    },
    signed_by: demoIssuerProjection.namespace.root_program_id,
    root_program_id: demoIssuerProjection.namespace.root_program_id,
  })

  const delegatedSigned = yield* signer.signTrustArtifact({
    body: {
      artifact_type: "revocation_status_event",
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id:
        demoIssuerProjection.namespace.delegated_authority_id,
    },
    signed_by: demoIssuerProjection.namespace.delegated_authority_id,
    root_program_id: demoIssuerProjection.namespace.root_program_id,
    delegated_authority_id:
      demoIssuerProjection.namespace.delegated_authority_id,
  })

  const rootVerification = yield* verifier.verifyTrustArtifact(rootSigned.body)
  const delegatedVerification = yield* verifier.verifyTrustArtifact(
    delegatedSigned.body,
  )

  const managedKeyPair = generateKeyPairSync("ed25519")
  const managedPublicKeyPem = managedKeyPair.publicKey
    .export({ format: "pem", type: "spki" })
    .toString()
  const managedPrivateKeyPem = managedKeyPair.privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString()
  const managedRootProgramId = "root:managed-custody-smoke"
  const managedSigningKey: SigningKeyRecord = {
    key_id: "key:root:managed-custody-smoke:ed25519:v1",
    signer_id: managedRootProgramId,
    root_program_id: managedRootProgramId,
    algorithm_id: "ed25519",
    scope: "root_program",
    status: "active",
    private_key_material_ref: "kms://qrtrust-smoke/root",
  }
  const managedTrustKey: TrustKeyRecord = {
    key_id: managedSigningKey.key_id,
    signer_id: managedSigningKey.signer_id,
    root_program_id: managedSigningKey.root_program_id,
    algorithm_id: managedSigningKey.algorithm_id,
    scope: "root_program",
    status: managedSigningKey.status,
    public_key_material_ref: "managed://qrtrust-smoke/root",
    public_key_material_pem: managedPublicKeyPem,
  }
  const managedSigner = makeTrustArtifactSigner(
    makeManagedSigningCustodyProvider([managedSigningKey], {
      signPayload: (input) =>
        Effect.sync(() => ({
          signature: cryptoSign(
            null,
            Buffer.from(input.payload),
            managedKeyPair.privateKey,
          ).toString("base64url"),
        })),
    }),
  )
  const managedVerifier = makeCryptographicSignatureVerifier(
    makeInMemoryTrustKeyRegistry([managedTrustKey]),
  )
  const managedSigned = yield* managedSigner.signTrustArtifact({
    body: {
      artifact_type: "root_manifest",
      root_program_id: managedRootProgramId,
    },
    signed_by: managedRootProgramId,
    root_program_id: managedRootProgramId,
  })
  const managedVerification = yield* managedVerifier.verifyTrustArtifact(
    managedSigned.body,
  )

  const missingSigner = yield* Effect.either(
    signer.signTrustArtifact({
      body: {
        artifact_type: "revocation_status_event",
        root_program_id: demoIssuerProjection.namespace.root_program_id,
      },
      signed_by: "authority:missing",
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      delegated_authority_id: "authority:missing",
    }),
  )

  yield* assertSmoke(
    rootVerification.reason === "signature_verified",
    "root fixture signer did not produce a verifiable signature",
  )
  yield* assertSmoke(
    delegatedVerification.reason === "signature_verified",
    "delegated-authority fixture signer did not produce a verifiable signature",
  )
  yield* assertSmoke(
    !serializedSigningResult(rootSigned).includes("BEGIN PRIVATE KEY"),
    "root signing result exposed private key material",
  )
  yield* assertSmoke(
    !serializedSigningResult(delegatedSigned).includes("BEGIN PRIVATE KEY"),
    "delegated signing result exposed private key material",
  )
  yield* assertSmoke(
    managedVerification.reason === "signature_verified",
    "managed signing custody provider did not produce a verifiable signature",
  )
  yield* assertSmoke(
    managedSigned.source === "managed",
    "managed signing custody provider did not report managed source",
  )
  yield* assertSmoke(
    !serializedSigningResult(managedSigned).includes("BEGIN PRIVATE KEY") &&
      !serializedSigningResult(managedSigned).includes(managedPrivateKeyPem),
    "managed signing result exposed private key material",
  )
  yield* assertSmoke(
    missingSigner._tag === "Left" &&
      missingSigner.left._tag === "SigningCustodyError",
    "missing signer should fail through the signing-custody boundary",
  )

  yield* Console.log(
    JSON.stringify(
      {
        fixture_root: rootVerification.reason,
        fixture_delegated: delegatedVerification.reason,
        managed_root: managedVerification.reason,
        managed_source: managedSigned.source,
        private_material_exposed: false,
        missing_signer:
          missingSigner._tag === "Left"
            ? missingSigner.left._tag
            : "unexpected_success",
      },
      null,
      2,
    ),
  )
})

const serializedSigningResult = <T extends Record<string, unknown>>(
  result: TrustArtifactSigningResult<T>,
): string => JSON.stringify(result)

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Signing custody smoke failed: ${message}`)
    }
  })

Effect.runPromise(program).catch((cause: NetworkError | Error) => {
  throw cause
})
