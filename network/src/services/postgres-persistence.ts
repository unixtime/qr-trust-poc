import { Effect } from "effect"

import type {
  RuntimeSafetyObservation,
  ScannerDecision,
} from "../contracts.js"
import type { NetworkError } from "../errors.js"
import type { SignedArtifact } from "./artifact-store.js"
import type { NetworkEvent } from "./event-bus.js"
import type {
  DestinationPolicyProjection,
  IssuerProjection,
} from "./verifier-cache.js"

export interface SqlCommand {
  readonly name: string
  readonly text: string
  readonly values: ReadonlyArray<unknown>
}

export interface VerifierCacheEntryPersistenceInput {
  readonly verifier_id: string
  readonly issuer: IssuerProjection
  readonly policy: DestinationPolicyProjection
  readonly source_artifact_hashes?: ReadonlyArray<string>
  readonly freshness_status?: "fresh" | "stale" | "expired" | "unavailable"
}

export interface ScannerDecisionPersistenceInput {
  readonly verifier_id: string
  readonly decision: ScannerDecision
}

export interface NetworkPersistenceBatchInput {
  readonly artifacts?: ReadonlyArray<SignedArtifact>
  readonly events?: ReadonlyArray<NetworkEvent>
  readonly verifier_cache_entries?: ReadonlyArray<VerifierCacheEntryPersistenceInput>
  readonly runtime_observations?: ReadonlyArray<RuntimeSafetyObservation>
  readonly scanner_decisions?: ReadonlyArray<ScannerDecisionPersistenceInput>
}

export interface NetworkPersistenceReport {
  readonly commands_executed: number
  readonly artifacts_upserted: number
  readonly status_events_upserted: number
  readonly events_enqueued: number
  readonly cache_entries_upserted: number
  readonly runtime_observations_inserted: number
  readonly scanner_decisions_inserted: number
}

export interface PostgresStatementSinkShape {
  readonly execute: (command: SqlCommand) => Effect.Effect<SqlCommand, NetworkError>
  readonly recorded: () => ReadonlyArray<SqlCommand>
}

export interface PostgresPersistenceServiceShape {
  readonly persistBatch: (
    input: NetworkPersistenceBatchInput,
  ) => Effect.Effect<NetworkPersistenceReport, NetworkError>
}

export const makeRecordingPostgresStatementSink =
  (): PostgresStatementSinkShape => {
    const commands: SqlCommand[] = []

    return {
      execute: (command) =>
        Effect.sync(() => {
          commands.push(command)
          return command
        }),
      recorded: () => [...commands],
    }
  }

export const makePostgresPersistenceService = (
  sink: PostgresStatementSinkShape,
): PostgresPersistenceServiceShape => ({
  persistBatch: (input) =>
    Effect.gen(function* () {
      let commandsExecuted = 0
      let artifactsUpserted = 0
      let statusEventsUpserted = 0
      let eventsEnqueued = 0
      let cacheEntriesUpserted = 0
      let runtimeObservationsInserted = 0
      let scannerDecisionsInserted = 0

      for (const artifact of input.artifacts ?? []) {
        yield* sink.execute(publishedArtifactCommand(artifact))
        commandsExecuted += 1
        artifactsUpserted += 1

        const statusCommand = statusEventCommand(artifact)
        if (statusCommand) {
          yield* sink.execute(statusCommand)
          commandsExecuted += 1
          statusEventsUpserted += 1
        }
      }

      for (const event of input.events ?? []) {
        yield* sink.execute(eventOutboxCommand(event))
        commandsExecuted += 1
        eventsEnqueued += 1
      }

      for (const cacheEntry of input.verifier_cache_entries ?? []) {
        yield* sink.execute(verifierCacheEntryCommand(cacheEntry))
        commandsExecuted += 1
        cacheEntriesUpserted += 1
      }

      for (const runtimeObservation of input.runtime_observations ?? []) {
        yield* sink.execute(runtimeObservationCommand(runtimeObservation))
        commandsExecuted += 1
        runtimeObservationsInserted += 1
      }

      for (const scannerDecision of input.scanner_decisions ?? []) {
        yield* sink.execute(
          scannerDecisionCommand(
            scannerDecision.verifier_id,
            scannerDecision.decision,
          ),
        )
        commandsExecuted += 1
        scannerDecisionsInserted += 1
      }

      return {
        commands_executed: commandsExecuted,
        artifacts_upserted: artifactsUpserted,
        status_events_upserted: statusEventsUpserted,
        events_enqueued: eventsEnqueued,
        cache_entries_upserted: cacheEntriesUpserted,
        runtime_observations_inserted: runtimeObservationsInserted,
        scanner_decisions_inserted: scannerDecisionsInserted,
      }
    }),
})

export const publishedArtifactCommand = (
  artifact: SignedArtifact,
): SqlCommand => {
  const scope = artifactScopeFromBody(artifact.body)
  const rootProgramId = requireString(
    scope.root_program_id,
    `Artifact ${artifact.artifact_id} is missing root_program_id.`,
  )

  return {
    name: "published_artifacts.upsert",
    text: `
insert into qr_trust.published_artifacts (
  artifact_id,
  artifact_type,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id,
  canonical_json,
  artifact_hash,
  version,
  publication_status,
  published_at
) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'published', $10::timestamptz)
on conflict (artifact_id) do update set
  canonical_json = excluded.canonical_json,
  artifact_hash = excluded.artifact_hash,
  version = excluded.version,
  publication_status = excluded.publication_status,
  published_at = excluded.published_at
`.trim(),
    values: [
      artifact.artifact_id,
      artifact.artifact_type,
      rootProgramId,
      scope.delegated_authority_id ?? null,
      scope.issuer_id ?? null,
      scope.destination_policy_id ?? null,
      jsonb(artifact.body),
      artifact.artifact_hash,
      artifact.version,
      scope.published_at ?? null,
    ],
  }
}

export const statusEventCommand = (
  artifact: SignedArtifact,
): SqlCommand | undefined => {
  const body = recordValue(artifact.body)
  if (body?.artifact_type !== "revocation_status_event") {
    return undefined
  }

  const target = recordValue(body.target)
  const targetType = requireString(
    stringValue(target?.target_type),
    `Status artifact ${artifact.artifact_id} is missing target_type.`,
  )
  const targetId = requireString(
    targetIdFromStatusTarget(target),
    `Status artifact ${artifact.artifact_id} is missing target identifier.`,
  )

  return {
    name: "status_events.upsert",
    text: `
insert into qr_trust.status_events (
  status_event_id,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id,
  target_type,
  target_id,
  status,
  reason_code,
  effective_at
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
on conflict (status_event_id) do update set
  status = excluded.status,
  reason_code = excluded.reason_code,
  effective_at = excluded.effective_at
`.trim(),
    values: [
      requireString(
        stringValue(body.status_event_id),
        `Status artifact ${artifact.artifact_id} is missing status_event_id.`,
      ),
      requireString(
        stringValue(body.root_program_id),
        `Status artifact ${artifact.artifact_id} is missing root_program_id.`,
      ),
      stringValue(body.delegated_authority_id) ?? null,
      stringValue(target?.issuer_id) ?? null,
      stringValue(target?.destination_policy_id) ?? null,
      targetType,
      targetId,
      requireString(
        stringValue(body.status),
        `Status artifact ${artifact.artifact_id} is missing status.`,
      ),
      stringValue(body.reason) ?? "unspecified",
      requireString(
        stringValue(body.effective_at),
        `Status artifact ${artifact.artifact_id} is missing effective_at.`,
      ),
    ],
  }
}

export const eventOutboxCommand = (event: NetworkEvent): SqlCommand => {
  const envelope = event.envelope

  return {
    name: "event_outbox.enqueue",
    text: `
insert into qr_trust.event_outbox (
  event_id,
  event_type,
  aggregate_type,
  aggregate_id,
  artifact_id,
  artifact_hash,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id,
  payload
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
on conflict (event_id) do nothing
`.trim(),
    values: [
      envelope.event_id,
      envelope.type,
      aggregateType(envelope.type),
      aggregateId(event),
      envelope.artifact_id,
      envelope.artifact_hash,
      envelope.root_program_id,
      envelope.delegated_authority_id ?? null,
      envelope.issuer_id ?? null,
      envelope.destination_policy_id ?? null,
      jsonb(event),
    ],
  }
}

export const verifierCacheEntryCommand = (
  input: VerifierCacheEntryPersistenceInput,
): SqlCommand => ({
  name: "verifier_cache_entries.upsert",
  text: `
insert into qr_trust.verifier_cache_entries (
  verifier_id,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id,
  source_artifact_hashes,
  scanner_trust_projection,
  cache_generated_at,
  cache_expires_at,
  freshness_status
) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9::timestamptz, $10)
on conflict (
  verifier_id,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id
) do update set
  source_artifact_hashes = excluded.source_artifact_hashes,
  scanner_trust_projection = excluded.scanner_trust_projection,
  cache_generated_at = excluded.cache_generated_at,
  cache_expires_at = excluded.cache_expires_at,
  freshness_status = excluded.freshness_status
`.trim(),
  values: [
    input.verifier_id,
    input.issuer.namespace.root_program_id,
    input.issuer.namespace.delegated_authority_id,
    input.issuer.namespace.issuer_id,
    input.policy.destination_policy_id,
    input.source_artifact_hashes ?? [],
    jsonb({
      issuer: {
        namespace: input.issuer.namespace,
        display_name: input.issuer.issuer_display_name,
        assurance_tier: input.issuer.assurance_tier,
      },
      destination_policy: {
        destination_policy_id: input.policy.destination_policy_id,
        approved_destinations: input.policy.approved_destinations,
        redirect_policy: input.policy.redirect_policy,
      },
    }),
    input.issuer.cache_generated_at,
    input.issuer.cache_expires_at,
    input.freshness_status ?? "fresh",
  ],
})

export const scannerDecisionCommand = (
  verifierId: string,
  decision: ScannerDecision,
): SqlCommand => ({
  name: "scanner_decisions.insert",
  text: `
insert into qr_trust.scanner_decisions (
  decision_id,
  verifier_id,
  decision_color,
  decision_state,
  reason_codes,
  risk_score,
  destination_url,
  destination_fingerprint,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id,
  usage_policy,
  hold_to_open_required,
  hold_to_open_duration_ms,
  decision_path,
  created_at
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::timestamptz)
on conflict (decision_id) do nothing
`.trim(),
  values: [
    decision.decision_id,
    verifierId,
    decision.decision_color,
    decision.decision_state,
    decision.reason_codes,
    decision.risk_score ?? null,
    decision.destination.url,
    decision.destination.fingerprint,
    decision.governance?.root_program_id ?? null,
    decision.governance?.delegated_authority_id ?? null,
    decision.governance?.issuer_id ?? null,
    decision.governance?.destination_policy_id ?? null,
    null,
    decision.hold_to_open.required,
    decision.hold_to_open.duration_ms,
    jsonb(decision.trust_path),
    decision.decided_at,
  ],
})

export const runtimeObservationCommand = (
  observation: RuntimeSafetyObservation,
): SqlCommand => ({
  name: "runtime_observations.insert",
  text: `
insert into qr_trust.runtime_observations (
  provider_id,
  destination_host,
  destination_url,
  final_url,
  verdict,
  risk_score,
  reason_codes,
  observed_at,
  expires_at
) values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)
`.trim(),
  values: [
    observation.provider.provider_id,
    observation.destination.destination_host,
    observation.destination.destination_url,
    observation.destination.final_url ?? null,
    observation.verdict,
    observation.risk_score,
    observation.reason_codes,
    observation.observed_at,
    observation.expires_at ?? null,
  ],
})

interface ArtifactScope {
  readonly root_program_id: string | undefined
  readonly delegated_authority_id: string | undefined
  readonly issuer_id: string | undefined
  readonly destination_policy_id: string | undefined
  readonly published_at: string | undefined
}

const artifactScopeFromBody = (body: unknown): ArtifactScope => {
  const candidate = recordValue(body)
  const namespace = recordValue(candidate?.issuer_namespace)
  const publication = recordValue(candidate?.publication)
  const destinationPolicy = firstRecord(candidate?.destination_policies)

  return {
    root_program_id:
      stringValue(candidate?.root_program_id) ??
      stringValue(namespace?.root_program_id),
    delegated_authority_id:
      stringValue(candidate?.delegated_authority_id) ??
      stringValue(namespace?.delegated_authority_id),
    issuer_id:
      stringValue(candidate?.issuer_id) ?? stringValue(namespace?.issuer_id),
    destination_policy_id:
      stringValue(candidate?.destination_policy_id) ??
      stringValue(destinationPolicy?.destination_policy_id),
    published_at: stringValue(publication?.published_at),
  }
}

const aggregateType = (eventType: string): string =>
  eventType.split(".").at(0) ?? "event"

const aggregateId = (event: NetworkEvent): string =>
  event.envelope.destination_policy_id ??
  event.envelope.issuer_id ??
  event.envelope.delegated_authority_id ??
  event.envelope.artifact_id

const targetIdFromStatusTarget = (
  target: Record<string, unknown> | undefined,
): string | undefined =>
  stringValue(target?.issuer_id) ??
  stringValue(target?.certificate_ref) ??
  stringValue(target?.destination_policy_id) ??
  stringValue(target?.delegated_authority_id) ??
  stringValue(target?.key_id)

const firstRecord = (
  value: unknown,
): Record<string, unknown> | undefined => {
  if (!Array.isArray(value)) {
    return undefined
  }

  return recordValue(value[0])
}

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

const requireString = (value: string | undefined, message: string): string => {
  if (!value) {
    throw new Error(message)
  }

  return value
}

const jsonb = (value: unknown): string => JSON.stringify(value)
