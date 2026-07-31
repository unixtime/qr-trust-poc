import { createPrivateKey, sign as cryptoSign } from "node:crypto"
import { readFile } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"

import type { NetworkError } from "../errors.js"
import { signingCustodyError } from "../errors.js"
import {
  demoDelegatedAuthorityFixturePrivateKeyPem,
  demoRootFixturePrivateKeyPem,
} from "../fixtures/demo-signing-private-keys.js"
import {
  trustSignatureInput,
  trustSignaturePayloadBytes,
  trustSignatureStatus,
} from "./signature-verification.js"
import {
  demoDelegatedAuthorityTrustKey,
  demoReplacementDelegatedAuthorityTrustKey,
  demoRootTrustKey,
  type TrustKeyStatus,
} from "./trust-key-registry.js"
import { demoIssuerProjection } from "./verifier-cache.js"

export type SigningMaterialSource =
  | "fixture"
  | "environment"
  | "filesystem"
  | "managed"
  | "static"

export type SigningKeyScope =
  | "root_program"
  | "delegated_authority"
  | "issuer"

export interface SigningKeyRecord {
  readonly key_id: string
  readonly signer_id: string
  readonly root_program_id: string
  readonly algorithm_id: string
  readonly scope: SigningKeyScope
  readonly status: TrustKeyStatus
  readonly private_key_material_ref: string
  readonly delegated_authority_id?: string
}

export interface SigningCustodyRequest {
  readonly payload: Uint8Array
  readonly signed_by: string
  readonly root_program_id: string
  readonly accepted_algorithm_ids?: ReadonlyArray<string>
  readonly delegated_authority_id?: string
  readonly key_id?: string
}

export interface SigningCustodySignature {
  readonly key_id: string
  readonly signer_id: string
  readonly algorithm_id: string
  readonly signature: string
  readonly private_key_material_ref: string
  readonly source: SigningMaterialSource
}

export interface SigningCustodyProviderShape {
  readonly signPayload: (
    request: SigningCustodyRequest,
  ) => Effect.Effect<SigningCustodySignature | undefined, NetworkError>
}

export interface TrustArtifactSigningInput<T extends Record<string, unknown>> {
  readonly body: T
  readonly signed_by: string
  readonly root_program_id: string
  readonly accepted_algorithm_ids?: ReadonlyArray<string>
  readonly delegated_authority_id?: string
  readonly key_id?: string
}

export type SignedTrustArtifactBody<T extends Record<string, unknown>> = T & {
  readonly signed_by: string
  readonly root_program_id: string
  readonly delegated_authority_id?: string
  readonly signature_algorithm_id: string
  readonly signature_input: typeof trustSignatureInput
  readonly signature: string
  readonly signature_status: typeof trustSignatureStatus
}

export interface TrustArtifactSigningResult<T extends Record<string, unknown>> {
  readonly body: SignedTrustArtifactBody<T>
  readonly signer_id: string
  readonly key_id: string
  readonly algorithm_id: string
  readonly private_key_material_ref: string
  readonly source: SigningMaterialSource
}

export interface TrustArtifactSignerShape {
  readonly signTrustArtifact: <T extends Record<string, unknown>>(
    input: TrustArtifactSigningInput<T>,
  ) => Effect.Effect<TrustArtifactSigningResult<T>, NetworkError>
}

export interface FileSystemSigningCustodyProviderOptions {
  readonly baseDirectory?: string
  readonly allowAbsolutePaths?: boolean
}

export interface ManagedSigningCustodySignInput {
  readonly payload: Uint8Array
  readonly key: SigningKeyRecord
  readonly private_key_material_ref: string
}

export interface ManagedSigningCustodySignResult {
  readonly signature: string
}

export interface ManagedSigningCustodyClientShape {
  readonly signPayload: (
    input: ManagedSigningCustodySignInput,
  ) => Effect.Effect<ManagedSigningCustodySignResult, NetworkError>
}

export interface ManagedSigningCustodyProviderOptions {
  readonly acceptedMaterialRefPrefixes?: ReadonlyArray<string>
}

export const demoRootSigningKey: SigningKeyRecord = {
  key_id: demoRootTrustKey.key_id,
  signer_id: demoRootTrustKey.signer_id,
  root_program_id: demoRootTrustKey.root_program_id,
  algorithm_id: demoRootTrustKey.algorithm_id,
  scope: demoRootTrustKey.scope,
  status: demoRootTrustKey.status,
  private_key_material_ref: "pem://fixture/private/root/qrtrust-demo-2026",
}

export const demoDelegatedAuthoritySigningKey: SigningKeyRecord = {
  key_id: demoDelegatedAuthorityTrustKey.key_id,
  signer_id: demoDelegatedAuthorityTrustKey.signer_id,
  root_program_id: demoDelegatedAuthorityTrustKey.root_program_id,
  delegated_authority_id:
    demoDelegatedAuthorityTrustKey.delegated_authority_id ??
    demoIssuerProjection.namespace.delegated_authority_id,
  algorithm_id: demoDelegatedAuthorityTrustKey.algorithm_id,
  scope: demoDelegatedAuthorityTrustKey.scope,
  status: demoDelegatedAuthorityTrustKey.status,
  private_key_material_ref:
    "pem://fixture/private/authority/qrtrust-demo-merchant-web",
}

export const demoReplacementDelegatedAuthoritySigningKey: SigningKeyRecord = {
  ...demoDelegatedAuthoritySigningKey,
  key_id: demoReplacementDelegatedAuthorityTrustKey.key_id,
  private_key_material_ref:
    "pem://fixture/private/authority/qrtrust-demo-merchant-web-v2",
}

export const demoUnauthorizedIssuerSigningKey: SigningKeyRecord = {
  key_id: "key:issuer:acme-demo:ed25519:fixture",
  signer_id: demoIssuerProjection.namespace.issuer_id,
  root_program_id: demoIssuerProjection.namespace.root_program_id,
  delegated_authority_id:
    demoIssuerProjection.namespace.delegated_authority_id,
  algorithm_id: "ed25519",
  scope: "issuer",
  status: "active",
  private_key_material_ref:
    "pem://fixture/private/authority/qrtrust-demo-merchant-web",
}

const fixturePrivateKeyMaterialByRef: ReadonlyMap<string, string> = new Map([
  [
    demoRootSigningKey.private_key_material_ref,
    demoRootFixturePrivateKeyPem,
  ],
  [
    demoDelegatedAuthoritySigningKey.private_key_material_ref,
    demoDelegatedAuthorityFixturePrivateKeyPem,
  ],
  [
    demoReplacementDelegatedAuthoritySigningKey.private_key_material_ref,
    demoDelegatedAuthorityFixturePrivateKeyPem,
  ],
])

export const makeStaticSigningCustodyProvider = (
  signingKeys: ReadonlyArray<SigningKeyRecord>,
  materialByRef: ReadonlyMap<string, string>,
  source: SigningMaterialSource = "static",
): SigningCustodyProviderShape => ({
  signPayload: (request) =>
    Effect.gen(function* () {
      const key = yield* selectSigningKey(signingKeys, request)
      if (!key) {
        return undefined
      }

      const privateKeyMaterialPem = materialByRef.get(
        key.private_key_material_ref,
      )
      if (!privateKeyMaterialPem) {
        return yield* Effect.fail(
          signingCustodyError(
            `Private signing material is unavailable for ${key.key_id}.`,
            {
              private_key_material_ref: key.private_key_material_ref,
            },
          ),
        )
      }

      const signature = yield* signEd25519Payload(
        request.payload,
        privateKeyMaterialPem,
        key,
        source,
      )
      return signature
    }),
})

export const makeFixtureSigningCustodyProvider = (
  signingKeys: ReadonlyArray<SigningKeyRecord> = [
    demoRootSigningKey,
    demoDelegatedAuthoritySigningKey,
    demoReplacementDelegatedAuthoritySigningKey,
    demoUnauthorizedIssuerSigningKey,
  ],
): SigningCustodyProviderShape =>
  makeStaticSigningCustodyProvider(
    signingKeys,
    fixturePrivateKeyMaterialByRef,
    "fixture",
  )

export const makeEnvironmentSigningCustodyProvider = (
  signingKeys: ReadonlyArray<SigningKeyRecord> = [],
  env: Readonly<Record<string, string | undefined>> = process.env,
): SigningCustodyProviderShape => ({
  signPayload: (request) =>
    Effect.gen(function* () {
      const key = yield* selectSigningKey(signingKeys, request)
      if (!key) {
        return undefined
      }
      if (!key.private_key_material_ref.startsWith("env://")) {
        return undefined
      }

      const envName = key.private_key_material_ref.slice("env://".length)
      const privateKeyMaterialPem = env[envName]
      if (!privateKeyMaterialPem) {
        return yield* Effect.fail(
          signingCustodyError(
            `Environment signing material ${envName} is unavailable for ${key.key_id}.`,
            { envName },
          ),
        )
      }

      return yield* signEd25519Payload(
        request.payload,
        privateKeyMaterialPem,
        key,
        "environment",
      )
    }),
})

export const makeFileSystemSigningCustodyProvider = (
  signingKeys: ReadonlyArray<SigningKeyRecord> = [],
  options: FileSystemSigningCustodyProviderOptions = {},
): SigningCustodyProviderShape => ({
  signPayload: (request) =>
    Effect.gen(function* () {
      const key = yield* selectSigningKey(signingKeys, request)
      if (!key) {
        return undefined
      }

      const filePath = yield* filePathFromMaterialRef(
        key.private_key_material_ref,
        options,
      )
      if (!filePath) {
        return undefined
      }

      const privateKeyMaterialPem = yield* Effect.tryPromise({
        try: () => readFile(filePath, "utf8"),
        catch: (cause) =>
          signingCustodyError(
            `Unable to load private signing material for ${key.key_id} from ${key.private_key_material_ref}.`,
            cause,
          ),
      })

      return yield* signEd25519Payload(
        request.payload,
        privateKeyMaterialPem,
        key,
        "filesystem",
      )
    }),
})

export const makeManagedSigningCustodyProvider = (
  signingKeys: ReadonlyArray<SigningKeyRecord>,
  client: ManagedSigningCustodyClientShape,
  options: ManagedSigningCustodyProviderOptions = {},
): SigningCustodyProviderShape => ({
  signPayload: (request) =>
    Effect.gen(function* () {
      const key = yield* selectSigningKey(signingKeys, request)
      if (!key) {
        return undefined
      }

      if (
        !managedMaterialRefIsAccepted(key.private_key_material_ref, options)
      ) {
        return undefined
      }

      const signature = yield* client.signPayload({
        payload: request.payload,
        key,
        private_key_material_ref: key.private_key_material_ref,
      })

      if (!signature.signature) {
        return yield* Effect.fail(
          signingCustodyError(
            `Managed signing custody provider returned an empty signature for ${key.key_id}.`,
            { private_key_material_ref: key.private_key_material_ref },
          ),
        )
      }

      return {
        key_id: key.key_id,
        signer_id: key.signer_id,
        algorithm_id: key.algorithm_id,
        signature: signature.signature,
        private_key_material_ref: key.private_key_material_ref,
        source: "managed",
      }
    }),
})

export const makeCompositeSigningCustodyProvider = (
  providers: ReadonlyArray<SigningCustodyProviderShape>,
): SigningCustodyProviderShape => ({
  signPayload: (request) =>
    Effect.gen(function* () {
      for (const provider of providers) {
        const signature = yield* provider.signPayload(request)
        if (signature) {
          return signature
        }
      }

      return undefined
    }),
})

export const makeDefaultSigningCustodyProvider =
  (): SigningCustodyProviderShape =>
    makeCompositeSigningCustodyProvider([
      makeEnvironmentSigningCustodyProvider(),
      makeFileSystemSigningCustodyProvider(),
      makeFixtureSigningCustodyProvider(),
    ])

export const makeTrustArtifactSigner = (
  custodyProvider: SigningCustodyProviderShape = makeDefaultSigningCustodyProvider(),
): TrustArtifactSignerShape => ({
  signTrustArtifact: (input) =>
    Effect.gen(function* () {
      const unsignedBody = normalizeSigningBody(input)
      const signature = yield* custodyProvider.signPayload({
        payload: trustSignaturePayloadBytes(unsignedBody),
        signed_by: input.signed_by,
        root_program_id: input.root_program_id,
        accepted_algorithm_ids: input.accepted_algorithm_ids ?? ["ed25519"],
        ...(input.delegated_authority_id
          ? { delegated_authority_id: input.delegated_authority_id }
          : {}),
        ...(input.key_id ? { key_id: input.key_id } : {}),
      })

      if (!signature) {
        return yield* Effect.fail(
          signingCustodyError(
            `No signing custody provider could sign as ${input.signed_by}.`,
            {
              signed_by: input.signed_by,
              root_program_id: input.root_program_id,
              delegated_authority_id: input.delegated_authority_id,
              key_id: input.key_id,
            },
          ),
        )
      }

      const body = {
        ...unsignedBody,
        signature_algorithm_id: signature.algorithm_id,
        signature_input: trustSignatureInput,
        signature: signature.signature,
        signature_status: trustSignatureStatus,
      } as SignedTrustArtifactBody<typeof input.body>

      return {
        body,
        signer_id: signature.signer_id,
        key_id: signature.key_id,
        algorithm_id: signature.algorithm_id,
        private_key_material_ref: signature.private_key_material_ref,
        source: signature.source,
      }
    }),
})

export const makeFixtureTrustArtifactSigner = (): TrustArtifactSignerShape =>
  makeTrustArtifactSigner(makeFixtureSigningCustodyProvider())

const normalizeSigningBody = <T extends Record<string, unknown>>(
  input: TrustArtifactSigningInput<T>,
): T & {
  readonly signed_by: string
  readonly root_program_id: string
  readonly delegated_authority_id?: string
} => ({
  ...input.body,
  root_program_id: input.root_program_id,
  signed_by: input.signed_by,
  ...(input.delegated_authority_id
    ? { delegated_authority_id: input.delegated_authority_id }
    : {}),
})

const selectSigningKey = (
  signingKeys: ReadonlyArray<SigningKeyRecord>,
  request: SigningCustodyRequest,
): Effect.Effect<SigningKeyRecord | undefined, NetworkError> => {
  const candidates = signingKeys.filter((key) =>
    request.key_id
      ? key.key_id === request.key_id
      : key.signer_id === request.signed_by &&
        key.root_program_id === request.root_program_id,
  )

  if (candidates.length === 0) {
    return Effect.succeed(undefined)
  }

  const scoped = candidates.filter((key) => signingKeyMatchesScope(key, request))
  if (scoped.length === 0) {
    return Effect.fail(
      signingCustodyError(
        `Signing key exists but does not match requested signer scope for ${request.signed_by}.`,
        { signed_by: request.signed_by },
      ),
    )
  }

  const acceptedAlgorithmIds = request.accepted_algorithm_ids ?? ["ed25519"]
  const algorithmMatch = scoped.filter((key) =>
    acceptedAlgorithmIds.includes(key.algorithm_id),
  )
  if (algorithmMatch.length === 0) {
    return Effect.fail(
      signingCustodyError(
        `No accepted signing algorithm is available for ${request.signed_by}.`,
        { accepted_algorithm_ids: acceptedAlgorithmIds },
      ),
    )
  }

  const activeKey = algorithmMatch.find((key) => key.status === "active")
  if (!activeKey) {
    return Effect.fail(
      signingCustodyError(
        `Signing key is not active for ${request.signed_by}.`,
        { status: algorithmMatch[0]?.status },
      ),
    )
  }

  return Effect.succeed(activeKey)
}

const signingKeyMatchesScope = (
  key: SigningKeyRecord,
  request: SigningCustodyRequest,
): boolean => {
  if (key.scope === "root_program") {
    return (
      key.signer_id === request.root_program_id &&
      request.signed_by === request.root_program_id
    )
  }

  if (key.scope === "delegated_authority") {
    return (
      typeof request.delegated_authority_id === "string" &&
      key.delegated_authority_id === request.delegated_authority_id &&
      key.signer_id === request.delegated_authority_id &&
      request.signed_by === request.delegated_authority_id
    )
  }

  return (
    typeof request.delegated_authority_id === "string" &&
    key.delegated_authority_id === request.delegated_authority_id &&
    key.signer_id === request.signed_by
  )
}

const signEd25519Payload = (
  payload: Uint8Array,
  privateKeyPem: string,
  key: SigningKeyRecord,
  source: SigningMaterialSource,
): Effect.Effect<SigningCustodySignature, NetworkError> => {
  if (key.algorithm_id !== "ed25519") {
    return Effect.fail(
      signingCustodyError(
        `Unsupported signing algorithm for ${key.key_id}: ${key.algorithm_id}.`,
        { algorithm_id: key.algorithm_id },
      ),
    )
  }

  return Effect.try({
    try: () => ({
      key_id: key.key_id,
      signer_id: key.signer_id,
      algorithm_id: key.algorithm_id,
      signature: cryptoSign(
        null,
        Buffer.from(payload),
        createPrivateKey(privateKeyPem),
      ).toString("base64url"),
      private_key_material_ref: key.private_key_material_ref,
      source,
    }),
    catch: (cause) =>
      signingCustodyError(
        `Unable to sign canonical trust artifact payload for ${key.key_id}.`,
        cause,
      ),
  })
}

const managedMaterialRefIsAccepted = (
  materialRef: string,
  options: ManagedSigningCustodyProviderOptions,
): boolean =>
  (options.acceptedMaterialRefPrefixes ?? [
    "kms://",
    "hsm://",
    "managed://",
  ]).some((prefix) => materialRef.startsWith(prefix))

const filePathFromMaterialRef = (
  materialRef: string,
  options: FileSystemSigningCustodyProviderOptions,
): Effect.Effect<string | undefined, NetworkError> =>
  Effect.try({
    try: () => {
      if (!materialRef.startsWith("file://")) {
        return undefined
      }

      const filePath = fileURLToPath(materialRef)
      if (isAbsolute(filePath)) {
        return options.allowAbsolutePaths === false ? undefined : filePath
      }

      return resolve(options.baseDirectory ?? process.cwd(), filePath)
    },
    catch: (cause) =>
      signingCustodyError(
        `Invalid private signing-material reference: ${materialRef}.`,
        cause,
      ),
  })
