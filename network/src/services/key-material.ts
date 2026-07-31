import { readFile } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"

import type { NetworkError } from "../errors.js"
import { keyMaterialError } from "../errors.js"
import {
  demoDelegatedAuthorityPublicKeyPem,
  demoRootPublicKeyPem,
  type TrustKeyRecord,
} from "./trust-key-registry.js"

export type KeyMaterialSource =
  | "inline"
  | "fixture"
  | "environment"
  | "filesystem"
  | "managed"
  | "static"

export interface PublicKeyMaterialResult {
  readonly key_id: string
  readonly public_key_material_ref: string
  readonly public_key_material_pem: string
  readonly source: KeyMaterialSource
}

export interface KeyMaterialProviderShape {
  readonly loadPublicKeyMaterial: (
    key: TrustKeyRecord,
  ) => Effect.Effect<PublicKeyMaterialResult | undefined, NetworkError>
}

export interface FileSystemKeyMaterialProviderOptions {
  readonly baseDirectory?: string
  readonly allowAbsolutePaths?: boolean
}

export interface ManagedKeyMaterialLoadInput {
  readonly key: TrustKeyRecord
  readonly public_key_material_ref: string
}

export interface ManagedKeyMaterialClientShape {
  readonly loadPublicKeyMaterial: (
    input: ManagedKeyMaterialLoadInput,
  ) => Effect.Effect<string | undefined, NetworkError>
}

export interface ManagedKeyMaterialProviderOptions {
  readonly acceptedMaterialRefPrefixes?: ReadonlyArray<string>
}

export const fixturePublicKeyMaterialByRef: ReadonlyMap<string, string> =
  new Map([
    ["pem://fixture/root/qrtrust-demo-2026", demoRootPublicKeyPem],
    [
      "pem://fixture/authority/qrtrust-demo-merchant-web",
      demoDelegatedAuthorityPublicKeyPem,
    ],
  ])

export const makeInlineKeyMaterialProvider = (): KeyMaterialProviderShape => ({
  loadPublicKeyMaterial: (key) =>
    Effect.succeed(
      key.public_key_material_pem
        ? materialResult(key, key.public_key_material_pem, "inline")
        : undefined,
    ),
})

export const makeStaticKeyMaterialProvider = (
  materialByRef: ReadonlyMap<string, string>,
  source: KeyMaterialSource = "static",
): KeyMaterialProviderShape => ({
  loadPublicKeyMaterial: (key) => {
    const publicKeyMaterialPem = materialByRef.get(key.public_key_material_ref)
    return Effect.succeed(
      publicKeyMaterialPem
        ? materialResult(key, publicKeyMaterialPem, source)
        : undefined,
    )
  },
})

export const makeFixtureKeyMaterialProvider = (): KeyMaterialProviderShape =>
  makeStaticKeyMaterialProvider(fixturePublicKeyMaterialByRef, "fixture")

export const makeEnvironmentKeyMaterialProvider = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): KeyMaterialProviderShape => ({
  loadPublicKeyMaterial: (key) => {
    if (!key.public_key_material_ref.startsWith("env://")) {
      return Effect.succeed(undefined)
    }

    const envName = key.public_key_material_ref.slice("env://".length)
    const publicKeyMaterialPem = env[envName]

    return Effect.succeed(
      publicKeyMaterialPem
        ? materialResult(key, publicKeyMaterialPem, "environment")
        : undefined,
    )
  },
})

export const makeFileSystemKeyMaterialProvider = (
  options: FileSystemKeyMaterialProviderOptions = {},
): KeyMaterialProviderShape => ({
  loadPublicKeyMaterial: (key) =>
    Effect.gen(function* () {
      const filePath = yield* filePathFromMaterialRef(
        key.public_key_material_ref,
        options,
      )
      if (!filePath) {
        return undefined
      }

      return yield* Effect.tryPromise({
        try: async () => {
          const publicKeyMaterialPem = await readFile(filePath, "utf8")
          return materialResult(key, publicKeyMaterialPem, "filesystem")
        },
        catch: (cause) =>
          keyMaterialError(
            `Unable to load key material for ${key.key_id} from ${key.public_key_material_ref}.`,
            cause,
          ),
      })
    }),
})

export const makeManagedKeyMaterialProvider = (
  client: ManagedKeyMaterialClientShape,
  options: ManagedKeyMaterialProviderOptions = {},
): KeyMaterialProviderShape => ({
  loadPublicKeyMaterial: (key) =>
    Effect.gen(function* () {
      if (
        !managedMaterialRefIsAccepted(key.public_key_material_ref, options)
      ) {
        return undefined
      }

      const publicKeyMaterialPem = yield* client.loadPublicKeyMaterial({
        key,
        public_key_material_ref: key.public_key_material_ref,
      })

      return publicKeyMaterialPem
        ? materialResult(key, publicKeyMaterialPem, "managed")
        : undefined
    }),
})

export const makeCompositeKeyMaterialProvider = (
  providers: ReadonlyArray<KeyMaterialProviderShape>,
): KeyMaterialProviderShape => ({
  loadPublicKeyMaterial: (key) =>
    Effect.gen(function* () {
      for (const provider of providers) {
        const material = yield* provider.loadPublicKeyMaterial(key)
        if (material) {
          return material
        }
      }

      return undefined
    }),
})

export const makeDefaultKeyMaterialProvider = (): KeyMaterialProviderShape =>
  makeCompositeKeyMaterialProvider([
    makeInlineKeyMaterialProvider(),
    makeEnvironmentKeyMaterialProvider(),
    makeFileSystemKeyMaterialProvider(),
    makeFixtureKeyMaterialProvider(),
  ])

const materialResult = (
  key: TrustKeyRecord,
  publicKeyMaterialPem: string,
  source: KeyMaterialSource,
): PublicKeyMaterialResult => ({
  key_id: key.key_id,
  public_key_material_ref: key.public_key_material_ref,
  public_key_material_pem: publicKeyMaterialPem,
  source,
})

const managedMaterialRefIsAccepted = (
  materialRef: string,
  options: ManagedKeyMaterialProviderOptions,
): boolean =>
  (options.acceptedMaterialRefPrefixes ?? [
    "kms://",
    "hsm://",
    "managed://",
  ]).some((prefix) => materialRef.startsWith(prefix))

const filePathFromMaterialRef = (
  materialRef: string,
  options: FileSystemKeyMaterialProviderOptions,
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
      keyMaterialError(
        `Invalid file key-material reference: ${materialRef}.`,
        cause,
      ),
  })
