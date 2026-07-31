import { Console, Effect } from "effect"

import {
  demoDelegatedAuthorityTrustKey,
  makePostgresTrustKeyRegistry,
  makeRecordingPostgresTrustKeyRegistryExecutor,
  type PostgresTrustKeyRow,
  type TrustKeyRecord,
} from "../index.js"
import { demoIssuerProjection } from "../services/verifier-cache.js"

const lookupInput = {
  signed_by: demoIssuerProjection.namespace.delegated_authority_id,
  root_program_id: demoIssuerProjection.namespace.root_program_id,
  delegated_authority_id:
    demoIssuerProjection.namespace.delegated_authority_id,
  accepted_algorithm_ids: ["ed25519"],
}

const program = Effect.gen(function* () {
  const executor = makeRecordingPostgresTrustKeyRegistryExecutor([
    rowFromTrustKey(demoDelegatedAuthorityTrustKey),
  ])
  const registry = makePostgresTrustKeyRegistry(executor)

  const initialLookup = yield* registry.lookupSignerKey(lookupInput)
  const missingUpdate = yield* registry.updateTrustKeyStatus({
    root_program_id: lookupInput.root_program_id,
    key_id: "key:missing",
    status: "revoked",
  })
  const revoked = yield* registry.updateTrustKeyStatus({
    root_program_id: lookupInput.root_program_id,
    key_id: demoDelegatedAuthorityTrustKey.key_id,
    status: "revoked",
  })
  const afterRevocation = yield* registry.lookupSignerKey(lookupInput)
  const unsupportedAlgorithm = yield* registry.lookupSignerKey({
    ...lookupInput,
    accepted_algorithm_ids: ["rsa-fixture"],
  })

  const rotatedKey = yield* registry.upsertTrustKey({
    ...demoDelegatedAuthorityTrustKey,
    key_id: "key:authority:qrtrust-demo:merchant-web:ed25519:v2",
    status: "active",
    public_key_material_ref:
      "pem://fixture/authority/qrtrust-demo-merchant-web-v2",
  })
  const afterRotation = yield* registry.lookupSignerKey(lookupInput)
  const snapshot = yield* registry.snapshot()
  const recorded = executor.recorded()

  yield* assertSmoke(
    initialLookup.key?.key_id === demoDelegatedAuthorityTrustKey.key_id,
    "initial delegated authority key was not found",
  )
  yield* assertSmoke(
    missingUpdate === false,
    "status update for a missing key should report false",
  )
  yield* assertSmoke(revoked, "status update did not report revoked key")
  yield* assertSmoke(
    afterRevocation.reason === "key_not_active",
    "revoked key remained active in Postgres registry lookup",
  )
  yield* assertSmoke(
    unsupportedAlgorithm.reason === "algorithm_not_accepted",
    "unsupported algorithm lookup did not explain the failure",
  )
  yield* assertSmoke(
    rotatedKey.key_id.endsWith(":v2"),
    "rotated key upsert did not return the persisted key",
  )
  yield* assertSmoke(
    afterRotation.key?.key_id === rotatedKey.key_id,
    "active rotated key was not selected after revocation",
  )
  yield* assertSmoke(
    snapshot.length === 2,
    "snapshot did not include revoked and rotated trust keys",
  )

  yield* Console.log(
    JSON.stringify(
      {
        initial_lookup: initialLookup.key?.key_id,
        missing_update: missingUpdate,
        after_revocation: afterRevocation.reason,
        unsupported_algorithm: unsupportedAlgorithm.reason,
        after_rotation: afterRotation.key?.key_id,
        snapshot_keys: snapshot.map((key) => ({
          key_id: key.key_id,
          status: key.status,
        })),
        sql_commands: recorded.length,
        command_names: [...new Set(recorded.map((command) => command.name))],
      },
      null,
      2,
    ),
  )
})

const rowFromTrustKey = (key: TrustKeyRecord): PostgresTrustKeyRow => ({
  key_id: key.key_id,
  root_program_id: key.root_program_id,
  delegated_authority_id: key.delegated_authority_id ?? null,
  signer_id: key.signer_id,
  algorithm_id: key.algorithm_id,
  public_key_material_ref: key.public_key_material_ref,
  public_key_material_pem: key.public_key_material_pem ?? null,
  scope: key.scope,
  key_status: key.status,
})

const assertSmoke = (condition: boolean, message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!condition) {
      throw new Error(`Postgres trust key registry smoke failed: ${message}`)
    }
  })

Effect.runPromise(program)
