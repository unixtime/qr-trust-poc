import { Effect } from "effect"

import { persistenceError, type NetworkError } from "../errors.js"
import type { SqlCommand } from "./postgres-persistence.js"
import {
  selectTrustKeyForLookup,
  type TrustKeyLookupInput,
  type TrustKeyRecord,
  type TrustKeyRegistryWriterShape,
  type TrustKeyScope,
  type TrustKeyStatus,
  type TrustKeyStatusUpdateInput,
} from "./trust-key-registry.js"

export interface PostgresTrustKeyRow {
  readonly key_id: string
  readonly root_program_id: string
  readonly delegated_authority_id?: string | null
  readonly signer_id: string
  readonly algorithm_id: string
  readonly public_key_material_ref: string
  readonly public_key_material_pem?: string | null
  readonly scope: TrustKeyScope
  readonly key_status: TrustKeyStatus
}

export interface PostgresTrustKeyRegistryExecutorShape {
  readonly execute: (command: SqlCommand) => Effect.Effect<SqlCommand, NetworkError>
  readonly queryMany: (
    command: SqlCommand,
  ) => Effect.Effect<ReadonlyArray<PostgresTrustKeyRow>, NetworkError>
  readonly recorded: () => ReadonlyArray<SqlCommand>
}

export const trustKeyLookupCommand = (
  input: TrustKeyLookupInput,
): SqlCommand => ({
  name: "trust_keys.lookup",
  text: `
select
  key_id,
  root_program_id,
  delegated_authority_id,
  signer_id,
  algorithm_id,
  public_key_material_ref,
  public_key_material_pem,
  scope,
  key_status
from qr_trust.trust_keys
where root_program_id = $1
  and signer_id = $2
order by created_at asc, key_id asc
`.trim(),
  values: [input.root_program_id, input.signed_by],
})

export const trustKeySnapshotCommand = (): SqlCommand => ({
  name: "trust_keys.snapshot",
  text: `
select
  key_id,
  root_program_id,
  delegated_authority_id,
  signer_id,
  algorithm_id,
  public_key_material_ref,
  public_key_material_pem,
  scope,
  key_status
from qr_trust.trust_keys
order by root_program_id asc, signer_id asc, key_id asc
`.trim(),
  values: [],
})

export const trustKeyUpsertCommand = (key: TrustKeyRecord): SqlCommand => ({
  name: "trust_keys.upsert",
  text: `
insert into qr_trust.trust_keys (
  key_id,
  root_program_id,
  delegated_authority_id,
  signer_id,
  algorithm_id,
  public_key_material_ref,
  public_key_material_pem,
  scope,
  key_status
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
on conflict (key_id) do update set
  root_program_id = excluded.root_program_id,
  delegated_authority_id = excluded.delegated_authority_id,
  signer_id = excluded.signer_id,
  algorithm_id = excluded.algorithm_id,
  public_key_material_ref = excluded.public_key_material_ref,
  public_key_material_pem = excluded.public_key_material_pem,
  scope = excluded.scope,
  key_status = excluded.key_status
returning
  key_id,
  root_program_id,
  delegated_authority_id,
  signer_id,
  algorithm_id,
  public_key_material_ref,
  public_key_material_pem,
  scope,
  key_status
`.trim(),
  values: [
    key.key_id,
    key.root_program_id,
    key.delegated_authority_id ?? null,
    key.signer_id,
    key.algorithm_id,
    key.public_key_material_ref,
    key.public_key_material_pem ?? null,
    key.scope,
    key.status,
  ],
})

export const trustKeyStatusUpdateCommand = (
  input: TrustKeyStatusUpdateInput,
): SqlCommand => ({
  name: "trust_keys.update_status",
  text: `
update qr_trust.trust_keys
set key_status = $3
where root_program_id = $1
  and key_id = $2
returning
  key_id,
  root_program_id,
  delegated_authority_id,
  signer_id,
  algorithm_id,
  public_key_material_ref,
  public_key_material_pem,
  scope,
  key_status
`.trim(),
  values: [input.root_program_id, input.key_id, input.status],
})

export const makeRecordingPostgresTrustKeyRegistryExecutor = (
  initialRows: ReadonlyArray<PostgresTrustKeyRow> = [],
): PostgresTrustKeyRegistryExecutorShape => {
  const rows = new Map(initialRows.map((row) => [row.key_id, row] as const))
  const commands: SqlCommand[] = []

  return {
    execute: (command) =>
      Effect.sync(() => {
        commands.push(command)
        return command
      }),
    queryMany: (command) =>
      Effect.sync(() => {
        commands.push(command)

        if (command.name === "trust_keys.lookup") {
          const rootProgramId = stringCommandValue(command, 0)
          const signerId = stringCommandValue(command, 1)
          return [...rows.values()].filter(
            (row) =>
              row.root_program_id === rootProgramId &&
              row.signer_id === signerId,
          )
        }

        if (command.name === "trust_keys.snapshot") {
          return [...rows.values()]
        }

        if (command.name === "trust_keys.upsert") {
          const row = rowFromUpsertCommand(command)
          rows.set(row.key_id, row)
          return [row]
        }

        if (command.name === "trust_keys.update_status") {
          const row = rowFromStatusUpdateCommand(command, rows)
          return row ? [row] : []
        }

        return []
      }),
    recorded: () => [...commands],
  }
}

export const makePostgresTrustKeyRegistry = (
  executor: PostgresTrustKeyRegistryExecutorShape,
): TrustKeyRegistryWriterShape => ({
  lookupSignerKey: (input) =>
    executor.queryMany(trustKeyLookupCommand(input)).pipe(
      Effect.map((rows) =>
        selectTrustKeyForLookup(rows.map(trustKeyRecordFromRow), input),
      ),
    ),
  upsertTrustKey: (key) =>
    executor.queryMany(trustKeyUpsertCommand(key)).pipe(
      Effect.flatMap((rows) => requireSingleTrustKeyRow(rows, "upsert")),
      Effect.map(trustKeyRecordFromRow),
    ),
  updateTrustKeyStatus: (input) =>
    executor
      .queryMany(trustKeyStatusUpdateCommand(input))
      .pipe(Effect.map((rows) => rows.length > 0)),
  snapshot: () =>
    executor
      .queryMany(trustKeySnapshotCommand())
      .pipe(Effect.map((rows) => rows.map(trustKeyRecordFromRow))),
})

export const decodePostgresTrustKeyRows = (
  rows: ReadonlyArray<Record<string, unknown>>,
): Effect.Effect<ReadonlyArray<PostgresTrustKeyRow>, NetworkError> =>
  Effect.try({
    try: () => rows.map(postgresTrustKeyRowFromRecord),
    catch: (cause) =>
      persistenceError("Postgres trust key row decoding failed.", cause),
  })

const trustKeyRecordFromRow = (row: PostgresTrustKeyRow): TrustKeyRecord => ({
  key_id: row.key_id,
  signer_id: row.signer_id,
  root_program_id: row.root_program_id,
  ...(row.delegated_authority_id
    ? { delegated_authority_id: row.delegated_authority_id }
    : {}),
  algorithm_id: row.algorithm_id,
  scope: row.scope,
  status: row.key_status,
  public_key_material_ref: row.public_key_material_ref,
  ...(row.public_key_material_pem
    ? { public_key_material_pem: row.public_key_material_pem }
    : {}),
})

const requireSingleTrustKeyRow = (
  rows: ReadonlyArray<PostgresTrustKeyRow>,
  operation: string,
): Effect.Effect<PostgresTrustKeyRow, NetworkError> =>
  Effect.try({
    try: () => {
      const row = rows[0]
      if (!row) {
        throw new Error(`No trust key row returned for ${operation}.`)
      }
      return row
    },
    catch: (cause) =>
      persistenceError(`Postgres trust key ${operation} failed.`, cause),
  })

const rowFromUpsertCommand = (command: SqlCommand): PostgresTrustKeyRow => ({
  key_id: requireStringCommandValue(command, 0, "key_id"),
  root_program_id: requireStringCommandValue(command, 1, "root_program_id"),
  delegated_authority_id: optionalStringCommandValue(command, 2),
  signer_id: requireStringCommandValue(command, 3, "signer_id"),
  algorithm_id: requireStringCommandValue(command, 4, "algorithm_id"),
  public_key_material_ref: requireStringCommandValue(
    command,
    5,
    "public_key_material_ref",
  ),
  public_key_material_pem: optionalStringCommandValue(command, 6),
  scope: requireScopeCommandValue(command, 7),
  key_status: requireStatusCommandValue(command, 8),
})

const rowFromStatusUpdateCommand = (
  command: SqlCommand,
  rows: Map<string, PostgresTrustKeyRow>,
): PostgresTrustKeyRow | undefined => {
  const rootProgramId = stringCommandValue(command, 0)
  const keyId = stringCommandValue(command, 1)
  const keyStatus = statusCommandValue(command, 2)

  if (!rootProgramId || !keyId || !keyStatus) {
    return undefined
  }

  const row = rows.get(keyId)
  if (!row || row.root_program_id !== rootProgramId) {
    return undefined
  }

  const updated = {
    ...row,
    key_status: keyStatus,
  }
  rows.set(updated.key_id, updated)
  return updated
}

const postgresTrustKeyRowFromRecord = (
  row: Record<string, unknown>,
): PostgresTrustKeyRow => ({
  key_id: requireStringField(row, "key_id"),
  root_program_id: requireStringField(row, "root_program_id"),
  delegated_authority_id: optionalStringField(row, "delegated_authority_id"),
  signer_id: requireStringField(row, "signer_id"),
  algorithm_id: requireStringField(row, "algorithm_id"),
  public_key_material_ref: requireStringField(row, "public_key_material_ref"),
  public_key_material_pem: optionalStringField(row, "public_key_material_pem"),
  scope: requireScopeField(row, "scope"),
  key_status: requireStatusField(row, "key_status"),
})

const requireStringCommandValue = (
  command: SqlCommand,
  index: number,
  label: string,
): string => {
  const value = stringCommandValue(command, index)
  if (!value) {
    throw new Error(`Postgres trust key command ${command.name} is missing ${label}.`)
  }

  return value
}

const optionalStringCommandValue = (
  command: SqlCommand,
  index: number,
): string | null => stringCommandValue(command, index) ?? null

const stringCommandValue = (
  command: SqlCommand,
  index: number,
): string | undefined => {
  const value = command.values[index]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

const requireScopeCommandValue = (
  command: SqlCommand,
  index: number,
): TrustKeyScope => {
  const value = stringCommandValue(command, index)
  if (value === "root_program" || value === "delegated_authority") {
    return value
  }

  throw new Error(`Postgres trust key command ${command.name} has invalid scope.`)
}

const requireStatusCommandValue = (
  command: SqlCommand,
  index: number,
): TrustKeyStatus => {
  const value = statusCommandValue(command, index)
  if (value) {
    return value
  }

  throw new Error(
    `Postgres trust key command ${command.name} has invalid key_status.`,
  )
}

const statusCommandValue = (
  command: SqlCommand,
  index: number,
): TrustKeyStatus | undefined => {
  const value = stringCommandValue(command, index)
  return value === "active" ||
    value === "suspended" ||
    value === "revoked" ||
    value === "expired"
    ? value
    : undefined
}

const requireStringField = (
  row: Record<string, unknown>,
  field: string,
): string => {
  const value = row[field]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Postgres trust key row is missing ${field}.`)
  }

  return value
}

const optionalStringField = (
  row: Record<string, unknown>,
  field: string,
): string | null => {
  const value = row[field]
  return typeof value === "string" && value.length > 0 ? value : null
}

const requireScopeField = (
  row: Record<string, unknown>,
  field: string,
): TrustKeyScope => {
  const value = row[field]
  if (value === "root_program" || value === "delegated_authority") {
    return value
  }

  throw new Error(`Postgres trust key row has invalid ${field}.`)
}

const requireStatusField = (
  row: Record<string, unknown>,
  field: string,
): TrustKeyStatus => {
  const value = row[field]
  if (
    value === "active" ||
    value === "suspended" ||
    value === "revoked" ||
    value === "expired"
  ) {
    return value
  }

  throw new Error(`Postgres trust key row has invalid ${field}.`)
}
