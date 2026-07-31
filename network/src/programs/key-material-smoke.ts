import { Console, Effect } from "effect"

import {
  makeCompositeKeyMaterialProvider,
  makeCryptographicSignatureVerifier,
  makeEnvironmentKeyMaterialProvider,
  makeFixtureTrustArtifactSigner,
  makeFixtureKeyMaterialProvider,
  makeInMemoryTrustKeyRegistry,
  makeManagedKeyMaterialProvider,
  type TrustArtifactSignerShape,
  type TrustKeyRecord,
} from "../index.js"
import {
  demoDelegatedAuthorityTrustKey,
  demoRootPublicKeyPem,
  demoRootTrustKey,
} from "../services/trust-key-registry.js"
import { demoIssuerProjection } from "../services/verifier-cache.js"

const program = Effect.gen(function* () {
  const signer = makeFixtureTrustArtifactSigner()
  const fixtureRegistry = makeInMemoryTrustKeyRegistry([
    withoutInlinePem(demoRootTrustKey),
    withoutInlinePem(demoDelegatedAuthorityTrustKey),
  ])
  const fixtureVerifier = makeCryptographicSignatureVerifier(
    fixtureRegistry,
    makeFixtureKeyMaterialProvider(),
  )

  const rootFixtureResult = yield* fixtureVerifier.verifyTrustArtifact(
    yield* signSummary(
      signer,
      {
        artifact_type: "revocation_status_event",
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        signed_by: demoIssuerProjection.namespace.root_program_id,
      },
      demoIssuerProjection.namespace.root_program_id,
    ),
  )

  const delegatedFixtureResult = yield* fixtureVerifier.verifyTrustArtifact(
    yield* signSummary(
      signer,
      {
        artifact_type: "revocation_status_event",
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        delegated_authority_id:
          demoIssuerProjection.namespace.delegated_authority_id,
        signed_by: demoIssuerProjection.namespace.delegated_authority_id,
      },
      demoIssuerProjection.namespace.delegated_authority_id,
      demoIssuerProjection.namespace.delegated_authority_id,
    ),
  )

  const envBackedRootKey: TrustKeyRecord = {
    ...withoutInlinePem(demoRootTrustKey),
    key_id: "key:root:qrtrust-demo:2026:ed25519:env",
    public_key_material_ref: "env://QRTRUST_TEST_ROOT_PUBLIC_KEY_PEM",
  }
  const envVerifier = makeCryptographicSignatureVerifier(
    makeInMemoryTrustKeyRegistry([envBackedRootKey]),
    makeEnvironmentKeyMaterialProvider({
      QRTRUST_TEST_ROOT_PUBLIC_KEY_PEM: demoRootPublicKeyPem,
    }),
  )
  const envResult = yield* envVerifier.verifyTrustArtifact(
    yield* signSummary(
      signer,
      {
        artifact_type: "revocation_status_event",
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        signed_by: demoIssuerProjection.namespace.root_program_id,
      },
      demoIssuerProjection.namespace.root_program_id,
    ),
  )

  const managedBackedRootKey: TrustKeyRecord = {
    ...withoutInlinePem(demoRootTrustKey),
    key_id: "key:root:qrtrust-demo:2026:ed25519:managed",
    public_key_material_ref: "managed://qrtrust-demo/root-public-key",
  }
  const managedVerifier = makeCryptographicSignatureVerifier(
    makeInMemoryTrustKeyRegistry([managedBackedRootKey]),
    makeManagedKeyMaterialProvider({
      loadPublicKeyMaterial: (input) =>
        Effect.succeed(
          input.public_key_material_ref ===
            "managed://qrtrust-demo/root-public-key"
            ? demoRootPublicKeyPem
            : undefined,
        ),
    }),
  )
  const managedResult = yield* managedVerifier.verifyTrustArtifact(
    yield* signSummary(
      signer,
      {
        artifact_type: "revocation_status_event",
        root_program_id: demoIssuerProjection.namespace.root_program_id,
        signed_by: demoIssuerProjection.namespace.root_program_id,
      },
      demoIssuerProjection.namespace.root_program_id,
    ),
  )

  const missingMaterialVerifier = makeCryptographicSignatureVerifier(
    makeInMemoryTrustKeyRegistry([envBackedRootKey]),
    makeCompositeKeyMaterialProvider([]),
  )
  const missingMaterialResult =
    yield* missingMaterialVerifier.verifyTrustArtifact(
      yield* signSummary(
        signer,
        {
          artifact_type: "revocation_status_event",
          root_program_id: demoIssuerProjection.namespace.root_program_id,
          signed_by: demoIssuerProjection.namespace.root_program_id,
        },
        demoIssuerProjection.namespace.root_program_id,
      ),
    )

  yield* assertSmoke(
    rootFixtureResult.reason === "signature_verified",
    "fixture root public key material was not loaded by reference",
  )
  yield* assertSmoke(
    delegatedFixtureResult.reason === "signature_verified",
    "fixture delegated public key material was not loaded by reference",
  )
  yield* assertSmoke(
    envResult.reason === "signature_verified",
    "environment public key material was not loaded by reference",
  )
  yield* assertSmoke(
    managedResult.reason === "signature_verified",
    "managed public key material was not loaded by reference",
  )
  yield* assertSmoke(
    missingMaterialResult.reason === "key_material_unavailable",
    "missing key material should fail closed",
  )

  yield* Console.log(
    JSON.stringify(
      {
        fixture_root: rootFixtureResult.reason,
        fixture_delegated: delegatedFixtureResult.reason,
        environment_root: envResult.reason,
        managed_root: managedResult.reason,
        missing_material: missingMaterialResult.reason,
      },
      null,
      2,
    ),
  )
})

const withoutInlinePem = (key: TrustKeyRecord): TrustKeyRecord => {
  const { public_key_material_pem: _publicKeyMaterialPem, ...rest } = key
  return rest
}

const signSummary = <T extends Record<string, unknown>>(
  signer: TrustArtifactSignerShape,
  body: T,
  signedBy: string,
  delegatedAuthorityId?: string,
) =>
  Effect.map(
    signer.signTrustArtifact({
      body,
      signed_by: signedBy,
      root_program_id: demoIssuerProjection.namespace.root_program_id,
      ...(delegatedAuthorityId
        ? { delegated_authority_id: delegatedAuthorityId }
        : {}),
    }),
    (result) => result.body,
  )

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Key material smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
