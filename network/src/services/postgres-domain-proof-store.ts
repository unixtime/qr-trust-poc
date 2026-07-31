import { Effect } from "effect"

import { persistenceError, type NetworkError } from "../errors.js"
import type {
  DomainProofMethod,
  DomainProofRecord,
  DomainProofVerificationStatus,
} from "./domain-proof.js"
import type { SqlCommand } from "./postgres-persistence.js"
import type { IssuerNamespace } from "./verifier-cache.js"

export interface PostgresDomainProofRow {
  readonly domain_proof_id: string
  readonly root_program_id: string
  readonly delegated_authority_id: string
  readonly issuer_id: string
  readonly domain: string
  readonly proof_method: DomainProofMethod
  readonly verification_status: DomainProofVerificationStatus
  readonly verified_at?: string | null
  readonly expires_at?: string | null
  readonly evidence_ref?: string | null
}

export interface DomainProofStoreShape {
  readonly loadIssuerDomainProofs: (
    namespace: IssuerNamespace,
  ) => Effect.Effect<ReadonlyArray<DomainProofRecord>, NetworkError>
}

export interface PostgresDomainProofStoreExecutorShape {
  readonly queryDomainProofs: (
    command: SqlCommand,
  ) => Effect.Effect<ReadonlyArray<PostgresDomainProofRow>, NetworkError>
  readonly recorded: () => ReadonlyArray<SqlCommand>
}

export const issuerDomainProofsByIssuerCommand = (
  namespace: IssuerNamespace,
): SqlCommand => ({
  name: "issuer_domain_proofs.by_issuer",
  text: `
select
  domain_proof_id,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  domain,
  proof_method,
  verification_status,
  verified_at,
  expires_at,
  evidence_ref
from qr_trust.issuer_domain_proofs
where root_program_id = $1
  and delegated_authority_id = $2
  and issuer_id = $3
order by
  case verification_status
    when 'verified' then 1
    when 'pending' then 2
    when 'failed' then 3
    when 'expired' then 4
    when 'revoked' then 5
    else 6
  end asc,
  domain asc,
  created_at desc,
  domain_proof_id asc
`.trim(),
  values: [
    namespace.root_program_id,
    namespace.delegated_authority_id,
    namespace.issuer_id,
  ],
})

export const makePostgresDomainProofStore = (
  executor: PostgresDomainProofStoreExecutorShape,
): DomainProofStoreShape => ({
  loadIssuerDomainProofs: (namespace) =>
    executor
      .queryDomainProofs(issuerDomainProofsByIssuerCommand(namespace))
      .pipe(Effect.map((rows) => rows.map(domainProofRecordFromPostgresRow))),
})

export const makeRecordingPostgresDomainProofStoreExecutor = (
  initialRows: ReadonlyArray<PostgresDomainProofRow> = [],
): PostgresDomainProofStoreExecutorShape => {
  const rows = [...initialRows]
  const commands: SqlCommand[] = []

  return {
    queryDomainProofs: (command) =>
      Effect.sync(() => {
        commands.push(command)

        if (command.name !== "issuer_domain_proofs.by_issuer") {
          return []
        }

        const rootProgramId = stringCommandValue(command, 0)
        const delegatedAuthorityId = stringCommandValue(command, 1)
        const issuerId = stringCommandValue(command, 2)

        return rows.filter(
          (row) =>
            row.root_program_id === rootProgramId &&
            row.delegated_authority_id === delegatedAuthorityId &&
            row.issuer_id === issuerId,
        )
      }),
    recorded: () => [...commands],
  }
}

export const decodePostgresDomainProofRows = (
  rows: ReadonlyArray<Record<string, unknown>>,
): Effect.Effect<ReadonlyArray<PostgresDomainProofRow>, NetworkError> =>
  Effect.try({
    try: () => rows.map(postgresDomainProofRowFromRecord),
    catch: (cause) =>
      persistenceError("Postgres domain proof row decoding failed.", cause),
  })

export const domainProofRecordFromPostgresRow = (
  row: PostgresDomainProofRow,
): DomainProofRecord => ({
  namespace: {
    root_program_id: row.root_program_id,
    delegated_authority_id: row.delegated_authority_id,
    issuer_id: row.issuer_id,
  },
  domain: row.domain,
  proof_method: row.proof_method,
  verification_status: row.verification_status,
  ...(row.verified_at ? { verified_at: row.verified_at } : {}),
  ...(row.expires_at ? { expires_at: row.expires_at } : {}),
  ...(row.evidence_ref ? { evidence_ref: row.evidence_ref } : {}),
})

const postgresDomainProofRowFromRecord = (
  row: Record<string, unknown>,
): PostgresDomainProofRow => ({
  domain_proof_id: requireStringField(row, "domain_proof_id"),
  root_program_id: requireStringField(row, "root_program_id"),
  delegated_authority_id: requireStringField(row, "delegated_authority_id"),
  issuer_id: requireStringField(row, "issuer_id"),
  domain: requireStringField(row, "domain"),
  proof_method: requireProofMethodField(row, "proof_method"),
  verification_status: requireVerificationStatusField(
    row,
    "verification_status",
  ),
  verified_at: optionalTimestampField(row, "verified_at"),
  expires_at: optionalTimestampField(row, "expires_at"),
  evidence_ref: optionalStringField(row, "evidence_ref"),
})

const stringCommandValue = (
  command: SqlCommand,
  index: number,
): string | undefined => {
  const value = command.values[index]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

const requireStringField = (
  row: Record<string, unknown>,
  field: string,
): string => {
  const value = row[field]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Postgres domain proof row is missing ${field}.`)
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

const optionalTimestampField = (
  row: Record<string, unknown>,
  field: string,
): string | null => {
  const value = row[field]
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === "string" && value.length > 0) {
    return value
  }

  return null
}

const requireProofMethodField = (
  row: Record<string, unknown>,
  field: string,
): DomainProofMethod => {
  const value = row[field]
  if (
    value === "dns_txt" ||
    value === "https_well_known" ||
    value === "payment_processor" ||
    value === "enterprise_directory" ||
    value === "manual_review"
  ) {
    return value
  }

  throw new Error(`Postgres domain proof row has invalid ${field}.`)
}

const requireVerificationStatusField = (
  row: Record<string, unknown>,
  field: string,
): DomainProofVerificationStatus => {
  const value = row[field]
  if (
    value === "pending" ||
    value === "verified" ||
    value === "failed" ||
    value === "expired" ||
    value === "revoked"
  ) {
    return value
  }

  throw new Error(`Postgres domain proof row has invalid ${field}.`)
}
