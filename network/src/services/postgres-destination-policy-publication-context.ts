import { Effect } from "effect"

import { persistenceError, type NetworkError } from "../errors.js"
import type { IssuerEnrollmentProjection } from "./domain-proof.js"
import type { DestinationPolicyPublicationContextResolverShape } from "./destination-policy-publication.js"
import {
  domainProofRecordFromPostgresRow,
  issuerDomainProofsByIssuerCommand,
  type PostgresDomainProofRow,
} from "./postgres-domain-proof-store.js"
import type { SqlCommand } from "./postgres-persistence.js"
import type { IssuerNamespace } from "./verifier-cache.js"

export interface PostgresDestinationPolicyIssuerRow {
  readonly root_program_id: string
  readonly delegated_authority_id: string
  readonly issuer_id: string
  readonly display_name: string
  readonly assurance_tier: string
  readonly enrollment_status: IssuerEnrollmentProjection["enrollment_status"]
}

export interface PostgresDestinationPolicyPublicationContextExecutorShape {
  readonly queryIssuerEnrollment: (
    command: SqlCommand,
  ) => Effect.Effect<
    ReadonlyArray<PostgresDestinationPolicyIssuerRow>,
    NetworkError
  >
  readonly queryDomainProofs: (
    command: SqlCommand,
  ) => Effect.Effect<ReadonlyArray<PostgresDomainProofRow>, NetworkError>
  readonly recorded: () => ReadonlyArray<SqlCommand>
}

export const issuerEnrollmentByNamespaceCommand = (
  namespace: IssuerNamespace,
): SqlCommand => ({
  name: "issuers.by_namespace",
  text: `
select
  root_program_id,
  delegated_authority_id,
  issuer_id,
  display_name,
  assurance_tier,
  enrollment_status
from qr_trust.issuers
where root_program_id = $1
  and delegated_authority_id = $2
  and issuer_id = $3
limit 1
`.trim(),
  values: [
    namespace.root_program_id,
    namespace.delegated_authority_id,
    namespace.issuer_id,
  ],
})

export const makePostgresDestinationPolicyPublicationContextResolver = (
  executor: PostgresDestinationPolicyPublicationContextExecutorShape,
): DestinationPolicyPublicationContextResolverShape => ({
  resolveDestinationPolicyContext: (input, destinationPolicy) =>
    Effect.gen(function* () {
      const namespace = destinationPolicy.namespace
      const issuerRows = yield* executor.queryIssuerEnrollment(
        issuerEnrollmentByNamespaceCommand(namespace),
      )
      const issuer = yield* requireSingleIssuerEnrollment(
        issuerRows,
        namespace,
        input.artifact_id,
      )
      const domainProofRows = yield* executor.queryDomainProofs(
        issuerDomainProofsByIssuerCommand(namespace),
      )

      return {
        issuer,
        domain_proofs: domainProofRows.map(domainProofRecordFromPostgresRow),
      }
    }),
})

export const makeRecordingPostgresDestinationPolicyPublicationContextExecutor =
  (
    initialIssuerRows: ReadonlyArray<PostgresDestinationPolicyIssuerRow> = [],
    initialDomainProofRows: ReadonlyArray<PostgresDomainProofRow> = [],
  ): PostgresDestinationPolicyPublicationContextExecutorShape => {
    const issuerRows = [...initialIssuerRows]
    const domainProofRows = [...initialDomainProofRows]
    const commands: SqlCommand[] = []

    return {
      queryIssuerEnrollment: (command) =>
        Effect.sync(() => {
          commands.push(command)

          if (command.name !== "issuers.by_namespace") {
            return []
          }

          const rootProgramId = stringCommandValue(command, 0)
          const delegatedAuthorityId = stringCommandValue(command, 1)
          const issuerId = stringCommandValue(command, 2)

          return issuerRows.filter(
            (row) =>
              row.root_program_id === rootProgramId &&
              row.delegated_authority_id === delegatedAuthorityId &&
              row.issuer_id === issuerId,
          )
        }),
      queryDomainProofs: (command) =>
        Effect.sync(() => {
          commands.push(command)

          if (command.name !== "issuer_domain_proofs.by_issuer") {
            return []
          }

          const rootProgramId = stringCommandValue(command, 0)
          const delegatedAuthorityId = stringCommandValue(command, 1)
          const issuerId = stringCommandValue(command, 2)

          return domainProofRows.filter(
            (row) =>
              row.root_program_id === rootProgramId &&
              row.delegated_authority_id === delegatedAuthorityId &&
              row.issuer_id === issuerId,
          )
        }),
      recorded: () => [...commands],
    }
  }

export const decodePostgresDestinationPolicyIssuerRows = (
  rows: ReadonlyArray<Record<string, unknown>>,
): Effect.Effect<
  ReadonlyArray<PostgresDestinationPolicyIssuerRow>,
  NetworkError
> =>
  Effect.try({
    try: () => rows.map(postgresDestinationPolicyIssuerRowFromRecord),
    catch: (cause) =>
      persistenceError(
        "Postgres destination-policy issuer row decoding failed.",
        cause,
      ),
  })

const requireSingleIssuerEnrollment = (
  rows: ReadonlyArray<PostgresDestinationPolicyIssuerRow>,
  namespace: IssuerNamespace,
  artifactId: string,
): Effect.Effect<IssuerEnrollmentProjection, NetworkError> => {
  if (rows.length !== 1) {
    return Effect.fail(
      persistenceError(
        "Destination policy publication context is missing issuer enrollment.",
        {
          artifact_id: artifactId,
          namespace,
          row_count: rows.length,
        },
      ),
    )
  }

  const row = rows[0]
  if (!row) {
    return Effect.fail(
      persistenceError(
        "Destination policy publication context is missing issuer enrollment.",
        {
          artifact_id: artifactId,
          namespace,
          row_count: rows.length,
        },
      ),
    )
  }

  return Effect.succeed(issuerEnrollmentProjectionFromRow(row))
}

const issuerEnrollmentProjectionFromRow = (
  row: PostgresDestinationPolicyIssuerRow,
): IssuerEnrollmentProjection => ({
  namespace: {
    root_program_id: row.root_program_id,
    delegated_authority_id: row.delegated_authority_id,
    issuer_id: row.issuer_id,
  },
  issuer_display_name: row.display_name,
  assurance_tier: row.assurance_tier,
  enrollment_status: row.enrollment_status,
})

const postgresDestinationPolicyIssuerRowFromRecord = (
  row: Record<string, unknown>,
): PostgresDestinationPolicyIssuerRow => ({
  root_program_id: requireStringField(row, "root_program_id"),
  delegated_authority_id: requireStringField(row, "delegated_authority_id"),
  issuer_id: requireStringField(row, "issuer_id"),
  display_name: requireStringField(row, "display_name"),
  assurance_tier: requireStringField(row, "assurance_tier"),
  enrollment_status: requireEnrollmentStatusField(row, "enrollment_status"),
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
    throw new Error(`Postgres destination-policy issuer row is missing ${field}.`)
  }

  return value
}

const requireEnrollmentStatusField = (
  row: Record<string, unknown>,
  field: string,
): IssuerEnrollmentProjection["enrollment_status"] => {
  const value = row[field]
  if (
    value === "pending" ||
    value === "active" ||
    value === "suspended" ||
    value === "revoked" ||
    value === "expired"
  ) {
    return value
  }

  throw new Error(`Postgres destination-policy issuer row has invalid ${field}.`)
}
