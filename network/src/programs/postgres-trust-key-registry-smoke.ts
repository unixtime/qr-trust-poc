import { Console, Effect } from "effect"

import {
  demoDelegatedAuthorityTrustKey,
  demoRootTrustKey,
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

// The root program's own signing key, reachable through the same lookup path
// because a root-scoped key matches on `signer_id === root_program_id`.
const rootLookupInput = {
  signed_by: demoRootTrustKey.signer_id,
  root_program_id: demoRootTrustKey.root_program_id,
  accepted_algorithm_ids: ["ed25519"],
}

const program = Effect.gen(function* () {
  const executor = makeRecordingPostgresTrustKeyRegistryExecutor([
    rowFromTrustKey(demoDelegatedAuthorityTrustKey),
    rowFromTrustKey(demoRootTrustKey),
  ])
  const registry = makePostgresTrustKeyRegistry(executor)

  const initialLookup = yield* registry.lookupSignerKey(lookupInput)
  const missingUpdate = yield* registry.updateTrustKeyStatus({
    root_program_id: lookupInput.root_program_id,
    key_id: "key:missing",
    status: "revoked",
  })
  // A delegated authority must not reach the root program's key. Both fixtures
  // share a root_program_id, so that column alone confines nothing — only the
  // delegated-authority predicate does.
  const crossAuthorityUpdate = yield* registry.updateTrustKeyStatus({
    root_program_id: lookupInput.root_program_id,
    key_id: demoRootTrustKey.key_id,
    status: "revoked",
    delegated_authority_id: lookupInput.delegated_authority_id,
  })
  const rootAfterCrossAuthority =
    yield* registry.lookupSignerKey(rootLookupInput)

  const revoked = yield* registry.updateTrustKeyStatus({
    root_program_id: lookupInput.root_program_id,
    key_id: demoDelegatedAuthorityTrustKey.key_id,
    status: "revoked",
    // Revoking its own key keeps the authority inside its own scope.
    delegated_authority_id: lookupInput.delegated_authority_id,
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

  // Root-program authority omits the predicate and keeps its full reach.
  const rootAuthorityUpdate = yield* registry.updateTrustKeyStatus({
    root_program_id: rootLookupInput.root_program_id,
    key_id: demoRootTrustKey.key_id,
    status: "suspended",
  })

  const snapshot = yield* registry.snapshot()
  const recorded = executor.recorded()

  yield* assertSmoke(
    demoRootTrustKey.root_program_id === lookupInput.root_program_id,
    "fixtures drifted: the root and delegated keys no longer share a root program, so the cross-authority case proves nothing",
  )
  yield* assertSmoke(
    initialLookup.key?.key_id === demoDelegatedAuthorityTrustKey.key_id,
    "initial delegated authority key was not found",
  )
  yield* assertSmoke(
    missingUpdate === false,
    "status update for a missing key should report false",
  )
  yield* assertSmoke(
    crossAuthorityUpdate === false,
    "a delegated authority revoked the root program's trust key",
  )
  yield* assertSmoke(
    rootAfterCrossAuthority.key?.key_id === demoRootTrustKey.key_id &&
      rootAfterCrossAuthority.reason === undefined,
    "root program key did not survive a cross-authority revocation attempt",
  )
  yield* assertSmoke(
    rootAuthorityUpdate,
    "root-program authority could not update a key in its own program",
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
    snapshot.length === 3,
    "snapshot did not include the root, revoked, and rotated trust keys",
  )

  yield* Console.log(
    JSON.stringify(
      {
        initial_lookup: initialLookup.key?.key_id,
        missing_update: missingUpdate,
        cross_authority_update: crossAuthorityUpdate,
        root_key_after_cross_authority: rootAfterCrossAuthority.key?.status,
        root_authority_update: rootAuthorityUpdate,
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
