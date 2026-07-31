import { Effect } from "effect"

import type { NetworkError } from "../errors.js"
import { demoIssuerProjection } from "./verifier-cache.js"

export type TrustKeyScope = "root_program" | "delegated_authority"
export type TrustKeyStatus = "active" | "suspended" | "revoked" | "expired"

export type TrustKeyLookupReason =
  | "key_not_found"
  | "key_not_active"
  | "algorithm_not_accepted"
  | "scope_mismatch"

export interface TrustKeyRecord {
  readonly key_id: string
  readonly signer_id: string
  readonly root_program_id: string
  readonly algorithm_id: string
  readonly scope: TrustKeyScope
  readonly status: TrustKeyStatus
  readonly public_key_material_ref: string
  readonly public_key_material_pem?: string
  readonly delegated_authority_id?: string
}

export interface TrustKeyLookupInput {
  readonly signed_by: string
  readonly root_program_id: string
  readonly accepted_algorithm_ids: ReadonlyArray<string>
  readonly delegated_authority_id?: string
}

export interface TrustKeyLookupResult {
  readonly key?: TrustKeyRecord
  readonly reason?: TrustKeyLookupReason
}

export interface TrustKeyRegistryShape {
  readonly lookupSignerKey: (
    input: TrustKeyLookupInput,
  ) => Effect.Effect<TrustKeyLookupResult, NetworkError>
}

export interface TrustKeyStatusUpdateInput {
  readonly root_program_id: string
  readonly key_id: string
  readonly status: TrustKeyStatus
}

export interface TrustKeyRegistryWriterShape extends TrustKeyRegistryShape {
  readonly upsertTrustKey: (
    key: TrustKeyRecord,
  ) => Effect.Effect<TrustKeyRecord, NetworkError>
  readonly updateTrustKeyStatus: (
    input: TrustKeyStatusUpdateInput,
  ) => Effect.Effect<boolean, NetworkError>
  readonly snapshot: () => Effect.Effect<ReadonlyArray<TrustKeyRecord>, NetworkError>
}

export const demoRootPublicKeyPem = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAseMBxIZiw1NaivXwFJ+8NldswDygR/KBWhRAXdyvAvs=
-----END PUBLIC KEY-----`

export const demoDelegatedAuthorityPublicKeyPem = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAJ2O6Y98hIMFptRCGOG1MNCp+3minvjf6egySST3gVAQ=
-----END PUBLIC KEY-----`

export const demoRootTrustKey: TrustKeyRecord = {
  key_id: "key:root:qrtrust-demo:2026:ed25519:v1",
  signer_id: demoIssuerProjection.namespace.root_program_id,
  root_program_id: demoIssuerProjection.namespace.root_program_id,
  algorithm_id: "ed25519",
  scope: "root_program",
  status: "active",
  public_key_material_ref: "pem://fixture/root/qrtrust-demo-2026",
  public_key_material_pem: demoRootPublicKeyPem,
}

export const demoDelegatedAuthorityTrustKey: TrustKeyRecord = {
  key_id: "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
  signer_id: demoIssuerProjection.namespace.delegated_authority_id,
  root_program_id: demoIssuerProjection.namespace.root_program_id,
  delegated_authority_id: demoIssuerProjection.namespace.delegated_authority_id,
  algorithm_id: "ed25519",
  scope: "delegated_authority",
  status: "active",
  public_key_material_ref: "pem://fixture/authority/qrtrust-demo-merchant-web",
  public_key_material_pem: demoDelegatedAuthorityPublicKeyPem,
}

export const demoReplacementDelegatedAuthorityTrustKey: TrustKeyRecord = {
  ...demoDelegatedAuthorityTrustKey,
  key_id: "key:authority:qrtrust-demo:merchant-web:ed25519:v2",
  public_key_material_ref:
    "pem://fixture/authority/qrtrust-demo-merchant-web-v2",
}

export const selectTrustKeyForLookup = (
  keys: ReadonlyArray<TrustKeyRecord>,
  input: TrustKeyLookupInput,
): TrustKeyLookupResult => {
  const candidates = keys.filter(
    (candidate) =>
      candidate.signer_id === input.signed_by &&
      candidate.root_program_id === input.root_program_id,
  )

  if (candidates.length === 0) {
    return { reason: "key_not_found" }
  }
  const firstCandidate = candidates[0] as TrustKeyRecord

  const scoped = candidates.filter((candidate) =>
    keyMatchesScope(candidate, input),
  )
  if (scoped.length === 0) {
    return { key: firstCandidate, reason: "scope_mismatch" }
  }
  const firstScoped = scoped[0] as TrustKeyRecord

  const algorithmMatches = scoped.filter((candidate) =>
    input.accepted_algorithm_ids.includes(candidate.algorithm_id),
  )
  if (algorithmMatches.length === 0) {
    return { key: firstScoped, reason: "algorithm_not_accepted" }
  }
  const firstAlgorithmMatch = algorithmMatches[0] as TrustKeyRecord

  const activeKey = algorithmMatches.find(
    (candidate) => candidate.status === "active",
  )
  if (!activeKey) {
    return { key: firstAlgorithmMatch, reason: "key_not_active" }
  }

  return { key: activeKey }
}

export const makeInMemoryTrustKeyRegistry = (
  keys: ReadonlyArray<TrustKeyRecord> = [
    demoRootTrustKey,
    demoDelegatedAuthorityTrustKey,
  ],
): TrustKeyRegistryWriterShape => {
  const records = new Map(keys.map((key) => [key.key_id, key]))

  return {
    lookupSignerKey: (input) =>
      Effect.sync(() => selectTrustKeyForLookup([...records.values()], input)),
    upsertTrustKey: (key) =>
      Effect.sync(() => {
        records.set(key.key_id, key)
        return key
      }),
    updateTrustKeyStatus: (input) =>
      Effect.sync(() => {
        const key = records.get(input.key_id)
        if (!key || key.root_program_id !== input.root_program_id) {
          return false
        }

        records.set(input.key_id, {
          ...key,
          status: input.status,
        })
        return true
      }),
    snapshot: () => Effect.sync(() => [...records.values()]),
  }
}

const keyMatchesScope = (
  key: TrustKeyRecord,
  input: TrustKeyLookupInput,
): boolean => {
  if (key.scope === "root_program") {
    return key.signer_id === input.root_program_id
  }

  return (
    typeof input.delegated_authority_id === "string" &&
    key.delegated_authority_id === input.delegated_authority_id &&
    key.signer_id === input.delegated_authority_id
  )
}
